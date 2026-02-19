import express from "express";
import { WebSocketServer } from "ws";

const app = express();

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";

// --- Simple cache (rate-limit friendly)
const cache = new Map(); // key -> { value, exp }
function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.exp) return null;
  return hit.value;
}
function cacheSet(key, value, ttlMs) {
  cache.set(key, { value, exp: Date.now() + ttlMs });
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

async function fetchJson(url, { timeoutMs = 10_000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "accept": "application/json"
      }
    });

    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    if (!res.ok) {
      const msg = data?.error?.message || data?.message || res.statusText || "Request failed";
      const err = new Error(`${res.status} ${msg}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }

    return data;
  } finally {
    clearTimeout(t);
  }
}

// --- Indicators
function ema(series, period) {
  if (!Array.isArray(series) || series.length === 0) return [];
  const k = 2 / (period + 1);
  const out = [];
  let prev = series[0];
  out.push(prev);
  for (let i = 1; i < series.length; i++) {
    const v = series[i] * k + prev * (1 - k);
    out.push(v);
    prev = v;
  }
  return out;
}

function rsi(series, period = 14) {
  if (!Array.isArray(series) || series.length < period + 1) return [];
  let gain = 0;
  let loss = 0;

  for (let i = 1; i <= period; i++) {
    const d = series[i] - series[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }

  gain /= period;
  loss /= period;

  const out = new Array(period).fill(null);
  out.push(loss === 0 ? 100 : 100 - 100 / (1 + gain / loss));

  for (let i = period + 1; i < series.length; i++) {
    const d = series[i] - series[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;

    gain = (gain * (period - 1) + g) / period;
    loss = (loss * (period - 1) + l) / period;

    const value = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    out.push(value);
  }

  return out;
}

function pctChange(a, b) {
  if (!isFinite(a) || !isFinite(b) || a === 0) return 0;
  return ((b - a) / a) * 100;
}

function buildAgentSignalFromPrices(prices, meta = {}) {
  const clean = prices.filter((x) => typeof x === "number" && isFinite(x));
  if (clean.length < 60) {
    return {
      action: "HOLD",
      bias: "NEUTRAL",
      confidence: 0.35,
      reason: "Not enough data points yet",
      metrics: { ...meta }
    };
  }

  const last = clean[clean.length - 1];
  const emaFast = ema(clean, 12);
  const emaSlow = ema(clean, 26);
  const rsi14 = rsi(clean, 14);

  const f = emaFast[emaFast.length - 1];
  const s = emaSlow[emaSlow.length - 1];
  const r = rsi14[rsi14.length - 1] ?? 50;

  const trend = f > s ? "UP" : f < s ? "DOWN" : "FLAT";
  const spread = s === 0 ? 0 : ((f - s) / s) * 100;

  // Momentum: compare last vs ~15 points ago
  const back = clean[clean.length - 15];
  const mom = pctChange(back, last);

  // Volatility proxy: range last 30 points
  const slice = clean.slice(-30);
  const min = Math.min(...slice);
  const max = Math.max(...slice);
  const vol = min === 0 ? 0 : ((max - min) / min) * 100;

  // Rules
  let action = "HOLD";
  let bias = "NEUTRAL";
  let reason = "No strong edge";

  const overbought = r >= 70;
  const oversold = r <= 30;

  // Trend-following bias
  if (trend === "UP" && !overbought && mom > 0.25) {
    action = "LONG";
    bias = "BULLISH";
    reason = "EMA trend up + positive momentum + RSI not overbought";
  } else if (trend === "DOWN" && !oversold && mom < -0.25) {
    action = "SHORT";
    bias = "BEARISH";
    reason = "EMA trend down + negative momentum + RSI not oversold";
  }

  // Mean reversion override
  if (oversold && trend !== "DOWN") {
    action = "BUY";
    bias = "BULLISH";
    reason = "RSI oversold bounce potential";
  } else if (overbought && trend !== "UP") {
    action = "SELL";
    bias = "BEARISH";
    reason = "RSI overbought pullback potential";
  }

  // Confidence scoring
  let conf = 0.45;
  conf += clamp(Math.abs(spread) / 1.5, 0, 0.25); // bigger ema divergence => more confidence
  conf += clamp(Math.abs(mom) / 2.0, 0, 0.20);
  conf += clamp((vol < 8 ? 0.08 : vol < 15 ? 0.04 : 0), 0, 0.08); // too volatile reduces edge
  if (overbought || oversold) conf += 0.05;
  if (action === "HOLD") conf = 0.35;

  conf = clamp(conf, 0.2, 0.92);

  return {
    action,
    bias,
    confidence: Number(conf.toFixed(2)),
    reason,
    metrics: {
      price: last,
      ema12: Number(f.toFixed(6)),
      ema26: Number(s.toFixed(6)),
      rsi14: Number((r ?? 50).toFixed(2)),
      emaSpreadPct: Number(spread.toFixed(2)),
      momentumPct: Number(mom.toFixed(2)),
      volatilityPct: Number(vol.toFixed(2)),
      ...meta
    }
  };
}

// --- Providers
async function getCoinGeckoMarketChart({ id, vs = "usd", days = 1 }) {
  const key = `cg:chart:${id}:${vs}:${days}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}/market_chart?vs_currency=${encodeURIComponent(vs)}&days=${encodeURIComponent(days)}`;
  const data = await fetchJson(url);

  // Cache 20s to reduce 429
  cacheSet(key, data, 20_000);
  return data;
}

async function getCoinGeckoSimplePrice({ ids, vs = "usd" }) {
  const key = `cg:simple:${ids}:${vs}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=${encodeURIComponent(vs)}`;
  const data = await fetchJson(url);

  cacheSet(key, data, 10_000);
  return data;
}

async function getDexScreenerToken(ca) {
  const key = `dex:token:${ca}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const url = `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(ca)}`;
  const data = await fetchJson(url);

  cacheSet(key, data, 8_000);
  return data;
}

// --- App
app.disable("x-powered-by");
app.use(express.json({ limit: "256kb" }));
app.use(express.static("public", { maxAge: "0" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// Market: CoinGecko chart + agent
app.get("/api/market", async (req, res) => {
  const id = String(req.query.id || "bitcoin").trim();
  const vs = String(req.query.vs || "usd").trim();
  const days = Number(req.query.days || 1);

  try {
    const chart = await getCoinGeckoMarketChart({ id, vs, days });
    const prices = Array.isArray(chart?.prices) ? chart.prices.map((p) => p[1]) : [];
    const signal = buildAgentSignalFromPrices(prices, { source: "CoinGecko", asset: id.toUpperCase() });

    res.json({
      ok: true,
      id,
      vs,
      days,
      prices,
      signal,
      updatedAt: new Date().toISOString()
    });
  } catch (e) {
    res.status(200).json({
      ok: false,
      error: e?.message || "Market fetch failed",
      status: e?.status || null,
      updatedAt: new Date().toISOString()
    });
  }
});

// Token by CA: DexScreener + agent from 24h change + liquidity
app.get("/api/token", async (req, res) => {
  const ca = String(req.query.ca || "").trim();
  if (!ca) return res.status(200).json({ ok: false, error: "Missing ca" });

  try {
    const data = await getDexScreenerToken(ca);
    const pairs = Array.isArray(data?.pairs) ? data.pairs : [];
    if (pairs.length === 0) return res.status(200).json({ ok: false, error: "Token not found on DexScreener" });

    // pick best liquidity
    const best = pairs.slice().sort((a, b) => (b?.liquidity?.usd || 0) - (a?.liquidity?.usd || 0))[0];

    const priceUsd = Number(best?.priceUsd || 0);
    const liqUsd = Number(best?.liquidity?.usd || 0);
    const ch24 = Number(best?.priceChange?.h24 ?? 0);

    // quick agent rule (token level)
    let action = "HOLD";
    let bias = "NEUTRAL";
    let reason = "No strong edge";
    let confidence = 0.4;

    if (liqUsd < 10_000) {
      action = "BLOCK";
      bias = "RISKY";
      reason = "Liquidity too low";
      confidence = 0.85;
    } else if (ch24 >= 8) {
      action = "BUY";
      bias = "BULLISH";
      reason = "Strong 24h momentum + decent liquidity";
      confidence = clamp(0.55 + Math.min(ch24 / 40, 0.25), 0.55, 0.85);
    } else if (ch24 <= -8) {
      action = "SELL";
      bias = "BEARISH";
      reason = "Strong 24h downtrend";
      confidence = clamp(0.55 + Math.min(Math.abs(ch24) / 40, 0.25), 0.55, 0.85);
    }

    res.json({
      ok: true,
      ca,
      token: {
        name: best?.baseToken?.name || "-",
        symbol: best?.baseToken?.symbol || "-",
        chainId: best?.chainId || "-",
        dexId: best?.dexId || "-"
      },
      pair: {
        url: best?.url || "",
        priceUsd,
        liquidityUsd: liqUsd,
        fdv: best?.fdv ?? null,
        mcap: best?.marketCap ?? null,
        volume24h: best?.volume?.h24 ?? null,
        txns24h: best?.txns?.h24 ?? null,
        change24h: ch24
      },
      agent: {
        action,
        bias,
        confidence: Number(confidence.toFixed(2)),
        reason
      },
      updatedAt: new Date().toISOString()
    });
  } catch (e) {
    res.status(200).json({
      ok: false,
      error: e?.message || "Dex fetch failed",
      status: e?.status || null,
      updatedAt: new Date().toISOString()
    });
  }
});

// Simple price (used by WS heartbeat)
app.get("/api/simple", async (req, res) => {
  const ids = String(req.query.ids || "bitcoin,ethereum").trim();
  const vs = String(req.query.vs || "usd").trim();

  try {
    const data = await getCoinGeckoSimplePrice({ ids, vs });
    res.json({ ok: true, ids, vs, data, updatedAt: new Date().toISOString() });
  } catch (e) {
    res.status(200).json({ ok: false, error: e?.message || "Simple price failed", status: e?.status || null });
  }
});

const server = app.listen(PORT, HOST, () => {
  console.log(`🔥 Web running: http://${HOST}:${PORT}`);
});

// --- WebSocket realtime feed
const wss = new WebSocketServer({ server });

function wsBroadcast(obj) {
  const msg = JSON.stringify(obj);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(msg);
  }
}

let tick = 0;

setInterval(async () => {
  tick++;

  // heartbeat prices
  try {
    const data = await getCoinGeckoSimplePrice({ ids: "bitcoin,ethereum,solana", vs: "usd" });
    wsBroadcast({
      type: "ticker",
      t: Date.now(),
      prices: data
    });
  } catch (e) {
    wsBroadcast({
      type: "error",
      t: Date.now(),
      message: `Ticker error: ${e?.message || "unknown"}`
    });
  }

  // light agent log every ~2 ticks
  if (tick % 2 === 0) {
    wsBroadcast({
      type: "agent_log",
      t: Date.now(),
      level: "info",
      message: "Agent heartbeat ok. Watching trend + momentum + RSI."
    });
  }
}, 3500);

wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ type: "hello", t: Date.now(), message: "Connected to Intercom Price Analyzer WS" }));
});
