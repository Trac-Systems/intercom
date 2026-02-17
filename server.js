// server.js
// Intercom Dashboard Bot — Localhost Web UI + Dexscreener + GeckoTerminal OHLCV Charts + Agent
// NOTE: Dexscreener API has no OHLCV candles; we use GeckoTerminal for candle data.
// Cache TTL reduces rate limits.

import express from "express";

const app = express();
const PORT = process.env.PORT || 8788;

// --- Config ---
const SOL_RPC = process.env.SOL_RPC || "https://api.mainnet-beta.solana.com";
const REFRESH_TTL_MS = Number(process.env.REFRESH_TTL_MS || 15000); // cache 15s
const TX_LIMIT = Number(process.env.TX_LIMIT || 10);

// Optional AI (Groq) — if not set, fallback logic used
const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const GROQ_BASE = "https://api.groq.com/openai/v1";

// GeckoTerminal (free public API)
const GECKO_BASE = "https://api.geckoterminal.com/api/v2";

const cache = new Map(); // key -> { ts, data }
async function cached(key, fn) {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.ts < REFRESH_TTL_MS) return hit.data;
  const data = await fn();
  cache.set(key, { ts: now, data });
  return data;
}

app.use(express.json());
app.use(express.static("public"));

// ---- Solana RPC helpers ----
async function solRpc(method, params = []) {
  const res = await fetch(SOL_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`RPC ${res.status}: ${await res.text()}`);
  const j = await res.json();
  if (j?.error) throw new Error(j.error?.message || "RPC error");
  return j.result;
}
const lamportsToSOL = (l) => Number(l) / 1_000_000_000;

// ---- Optional Groq JSON helper ----
async function groqJSON(system, user) {
  if (!GROQ_API_KEY) return null;
  const res = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0.2,
      messages: [
        { role: "system", content: system + "\nReturn STRICT JSON only. No markdown." },
        { role: "user", content: user },
      ],
    }),
  });
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || "{}";
  try {
    return JSON.parse(text);
  } catch {
    const s = text.indexOf("{");
    const e = text.lastIndexOf("}");
    if (s !== -1 && e !== -1) {
      try {
        return JSON.parse(text.slice(s, e + 1));
      } catch {}
    }
    return null;
  }
}

// ---- Health ----
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// ---- Solana balance ----
app.get("/api/sol/balance", async (req, res) => {
  try {
    const pubkey = String(req.query.pubkey || "").trim();
    if (!pubkey) return res.status(400).json({ ok: false, error: "Missing pubkey" });

    const data = await cached(`bal:${pubkey}`, async () => {
      const lamports = await solRpc("getBalance", [pubkey, { commitment: "confirmed" }]);
      return { sol: lamportsToSOL(lamports.value) };
    });

    res.json({ ok: true, pubkey, ...data, updated: new Date().toISOString() });
  } catch (e) {
    res.json({ ok: false, error: String(e?.message || e) });
  }
});

// ---- Solana recent TX ----
app.get("/api/sol/tx", async (req, res) => {
  try {
    const pubkey = String(req.query.pubkey || "").trim();
    if (!pubkey) return res.status(400).json({ ok: false, error: "Missing pubkey" });

    const data = await cached(`tx:${pubkey}`, async () => {
      const sigs = await solRpc("getSignaturesForAddress", [pubkey, { limit: TX_LIMIT }]);
      return { sigs };
    });

    res.json({ ok: true, pubkey, ...data, updated: new Date().toISOString() });
  } catch (e) {
    res.json({ ok: false, error: String(e?.message || e) });
  }
});

// ---- Prices (CoinGecko simple) ----
app.get("/api/prices", async (_req, res) => {
  try {
    const data = await cached("prices", async () => {
      const url =
        "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true";
      const r = await fetch(url);
      if (!r.ok) throw new Error(`CoinGecko ${r.status}`);
      return await r.json();
    });
    res.json({ ok: true, data, updated: new Date().toISOString() });
  } catch (e) {
    res.json({ ok: false, error: String(e?.message || e) });
  }
});

// ✅ Chart data (CoinGecko market_chart 24h) — lightweight
// /api/chart?coin=bitcoin|ethereum|solana
app.get("/api/chart", async (req, res) => {
  try {
    const coin = String(req.query.coin || "bitcoin").trim();
    const allow = new Set(["bitcoin", "ethereum", "solana"]);
    if (!allow.has(coin)) return res.status(400).json({ ok: false, error: "coin must be bitcoin|ethereum|solana" });

    const data = await cached(`chart:${coin}`, async () => {
      const url = `https://api.coingecko.com/api/v3/coins/${coin}/market_chart?vs_currency=usd&days=1`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`CoinGecko ${r.status}`);
      const j = await r.json();
      const prices = Array.isArray(j?.prices) ? j.prices.slice(-180) : []; // last points
      return { prices };
    });

    res.json({ ok: true, coin, ...data, updated: new Date().toISOString() });
  } catch (e) {
    res.json({ ok: false, error: String(e?.message || e) });
  }
});

// ---- Swap simulator ----
app.post("/api/simulate", (req, res) => {
  try {
    const reserveX = Number(req.body?.reserveX ?? 1000);
    const reserveY = Number(req.body?.reserveY ?? 1000);
    const amountIn = Number(req.body?.amountIn ?? 10);
    const feeBps = Number(req.body?.feeBps ?? 30);

    if (![reserveX, reserveY, amountIn, feeBps].every(Number.isFinite)) {
      return res.status(400).json({ ok: false, error: "Bad input" });
    }
    if (reserveX <= 0 || reserveY <= 0 || amountIn <= 0) {
      return res.status(400).json({ ok: false, error: "Values must be > 0" });
    }

    const fee = feeBps / 10_000;
    const amountInAfterFee = amountIn * (1 - fee);

    const k = reserveX * reserveY;
    const newX = reserveX + amountInAfterFee;
    const newY = k / newX;
    const amountOut = reserveY - newY;

    const priceImpactPct = (amountOut / reserveY) * 100;

    res.json({
      ok: true,
      input: { reserveX, reserveY, amountIn, feeBps },
      result: { amountOut, newReserveX: newX, newReserveY: newY, priceImpactPct },
    });
  } catch (e) {
    res.json({ ok: false, error: String(e?.message || e) });
  }
});

// ================================
// ✅ DEXSCREENER + AGENT + TOKEN OHLCV (GeckoTerminal)
// ================================

function mapDexChainToGeckoNetwork(chainId) {
  const c = String(chainId || "").toLowerCase();
  // GeckoTerminal uses "networks/{network}"
  // common matches:
  // solana, ethereum, bsc, base, arbitrum, polygon, avalanche, optimism, etc.
  const map = {
    solana: "solana",
    ethereum: "ethereum",
    eth: "ethereum",
    bsc: "bsc",
    "binance-smart-chain": "bsc",
    base: "base",
    polygon: "polygon_pos",
    arbitrum: "arbitrum",
    optimism: "optimism",
    avalanche: "avax",
  };
  return map[c] || c || null;
}

async function fetchDex(q) {
  let url;
  if (q.startsWith("0x") || q.length > 30) {
    url = `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(q)}`;
  } else {
    url = `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`;
  }
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Dexscreener ${r.status}`);
  const j = await r.json();
  if (!j?.pairs?.length) return null;

  const p = j.pairs[0];
  return {
    name: p.baseToken?.name || "Unknown",
    symbol: p.baseToken?.symbol || "Unknown",
    chain: p.chainId || "unknown",
    dex: p.dexId || "unknown",
    priceUsd: p.priceUsd || "N/A",
    liquidityUsd: p.liquidity?.usd || 0,
    volume24h: p.volume?.h24 || 0,
    fdv: p.fdv || 0,
    pairAddress: p.pairAddress || "",
    url: p.url || "",
  };
}

// Fetch Dexscreener market snapshot (symbol or CA)
app.get("/api/dex", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) return res.status(400).json({ ok: false, error: "Missing q (symbol or CA)" });

    const data = await cached(`dex:${q}`, async () => await fetchDex(q));
    if (!data) return res.json({ ok: false, error: "No pairs found. Try CA for accuracy." });

    res.json({ ok: true, q, data, updated: new Date().toISOString() });
  } catch (e) {
    res.json({ ok: false, error: String(e?.message || e) });
  }
});

// ✅ Token OHLCV chart (24h) using GeckoTerminal candles
// Flow: q -> Dexscreener (pairAddress+chain) -> GeckoTerminal OHLCV -> return close series for canvas chart
// GET /api/token_chart?q=<symbol or CA>
app.get("/api/token_chart", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) return res.status(400).json({ ok: false, error: "Missing q" });

    const dex = await cached(`dex:${q}`, async () => await fetchDex(q));
    if (!dex) return res.json({ ok: false, error: "No pairs found. Use contract address (CA)." });

    const network = mapDexChainToGeckoNetwork(dex.chain);
    const pool = dex.pairAddress;

    if (!network || !pool) {
      return res.json({ ok: false, error: "Missing network/pool. Try CA or different token." });
    }

    // GeckoTerminal OHLCV endpoint
    // /networks/{network}/pools/{pool_address}/ohlcv/{timeframe}?aggregate=1&before_timestamp=...
    // timeframe: minute|hour|day (doc supports granular + aggregate) :contentReference[oaicite:1]{index=1}
    const timeframe = "hour";
    const aggregate = 1;

    const data = await cached(`ohlcv:${network}:${pool}`, async () => {
      const url = `${GECKO_BASE}/networks/${encodeURIComponent(network)}/pools/${encodeURIComponent(pool)}/ohlcv/${timeframe}?aggregate=${aggregate}&limit=48`;
      const r = await fetch(url, {
        headers: {
          // GeckoTerminal public API: no key required (cached) :contentReference[oaicite:2]{index=2}
          accept: "application/json",
        },
      });
      if (!r.ok) throw new Error(`GeckoTerminal ${r.status}`);
      const j = await r.json();

      // Response structure can vary; we extract OHLCV list safely.
      // Expect: data.attributes.ohlcv_list = [[ts, open, high, low, close, volume], ...]
      const ohlcv =
        j?.data?.attributes?.ohlcv_list ||
        j?.data?.attributes?.ohlcv ||
        j?.data?.attributes?.candles ||
        [];

      if (!Array.isArray(ohlcv) || !ohlcv.length) {
        return { ohlcv: [], closes: [] };
      }

      // Normalize -> [tsMs, close]
      const closes = ohlcv
        .filter((row) => Array.isArray(row) && row.length >= 5)
        .map((row) => {
          const ts = Number(row[0]); // seconds or ms depending
          const close = Number(row[4]);
          const tsMs = ts > 2_000_000_000 ? ts * 1000 : ts * 1000; // keep ms
          return [tsMs, close];
        })
        .slice(-48);

      return { ohlcv, closes };
    });

    res.json({
      ok: true,
      q,
      dex,
      gecko: { network, pool, timeframe, aggregate, points: data.closes.length },
      closes: data.closes,
      updated: new Date().toISOString(),
    });
  } catch (e) {
    res.json({ ok: false, error: String(e?.message || e) });
  }
});

// Agent analyze (Dex snapshot + AI optional)
app.get("/api/agent/analyze", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) return res.status(400).json({ ok: false, error: "Missing q" });

    const dex = await cached(`dex:${q}`, async () => await fetchDex(q));
    if (!dex) return res.json({ ok: false, error: "No pairs found. Use contract address (CA)." });

    // ---------- Fallback logic ----------
    const liq = Number(dex.liquidityUsd || 0);
    const vol = Number(dex.volume24h || 0);

    let signal = "HOLD";
    const why = [];
    let status = "CAUTION";
    const flags = [];
    const checklist = ["verify_contract_CA", "check_liquidity_depth", "check_top_holders", "start_small_test_trade"];

    if (liq < 5000) {
      status = "BLOCK";
      flags.push("Very low liquidity → high slippage / rug risk.");
    } else if (liq < 20000) {
      status = "CAUTION";
      flags.push("Low liquidity → expect slippage.");
    }

    if (vol < 5000) {
      status = status === "BLOCK" ? "BLOCK" : "CAUTION";
      flags.push("Very low 24h volume → easy to manipulate.");
    }

    signal = "HOLD";
    why.push(liq >= 50000 && vol >= 50000 ? "Liquidity + volume look healthy (still not a guarantee)." : "Risk/confirmation is weak from snapshot.");
    why.push("Avoid chasing pumps — wait for confirmation.");
    why.push("Start with tiny size if you proceed.");

    // ---------- Optional AI refine ----------
    const system = `
You are a trading copilot (Intercom-style).
Return STRICT JSON only:
{
  "signal":"BUY|SELL|HOLD",
  "why":["...","...","..."],
  "risk":{"status":"SAFE|CAUTION|BLOCK","flags":["...","..."],"checklist":["...","..."]},
  "decision":"OK TO PROCEED|SMALL SIZE / WAIT|DO NOT TRADE"
}
No hype. No guarantees.
`.trim();

    const user = `
Token query: ${q}
Dexscreener snapshot:
${JSON.stringify(dex, null, 2)}
Use the snapshot only.
`.trim();

    const ai = await groqJSON(system, user);

    let out;
    if (ai && ai.signal && ai.risk?.status) out = ai;
    else {
      const decision = status === "BLOCK" ? "DO NOT TRADE" : "SMALL SIZE / WAIT";
      out = {
        signal,
        why: why.slice(0, 3),
        risk: { status, flags: flags.slice(0, 4), checklist: checklist.slice(0, 4) },
        decision,
      };
    }

    res.json({
      ok: true,
      q,
      dex,
      agent: out,
      updated: new Date().toISOString(),
      mode: GROQ_API_KEY ? "ai" : "fallback",
    });
  } catch (e) {
    res.json({ ok: false, error: String(e?.message || e) });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`⚡ Dashboard running: http://127.0.0.1:${PORT}`);
  console.log(`RPC: ${SOL_RPC}`);
  console.log(`Cache TTL: ${REFRESH_TTL_MS}ms`);
  console.log(`Agent mode: ${GROQ_API_KEY ? "Groq AI" : "Fallback (no API)"}`);
});
