// server.js
// Intercom Dashboard Bot — Localhost Web UI (anti-429 with cache)

import express from "express";

const app = express();
const PORT = process.env.PORT || 8788;

// --- Config ---
const SOL_RPC = process.env.SOL_RPC || "https://api.mainnet-beta.solana.com";
const REFRESH_TTL_MS = Number(process.env.REFRESH_TTL_MS || 15000); // cache 15s
const TX_LIMIT = Number(process.env.TX_LIMIT || 10);

// --- Simple in-memory cache (anti spam / anti 429) ---
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

function lamportsToSOL(l) {
  return Number(l) / 1_000_000_000;
}

// Health
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// Balance
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

// Recent TX
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

// Prices (CoinGecko)
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

// Swap simulator (x*y=k)
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

    // constant product AMM
    const k = reserveX * reserveY;
    const newX = reserveX + amountInAfterFee;
    const newY = k / newX;
    const amountOut = reserveY - newY;

    const priceImpactPct = (amountOut / reserveY) * 100;

    res.json({
      ok: true,
      input: { reserveX, reserveY, amountIn, feeBps },
      result: {
        amountOut,
        newReserveX: newX,
        newReserveY: newY,
        priceImpactPct,
      },
    });
  } catch (e) {
    res.json({ ok: false, error: String(e?.message || e) });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`⚡ Intercom Dashboard running on http://127.0.0.1:${PORT}`);
  console.log(`RPC: ${SOL_RPC}`);
  console.log(`Cache TTL: ${REFRESH_TTL_MS}ms`);
});
