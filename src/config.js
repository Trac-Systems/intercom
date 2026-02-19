"use strict";

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

const config = {
  COINGECKO_VS: process.env.COINGECKO_VS || "usd",
  POLL_MS: Math.max(1500, num(process.env.POLL_MS, 5000)),

  RSI_PERIOD: Math.min(50, Math.max(7, num(process.env.RSI_PERIOD, 14))),
  EMA_FAST: Math.min(100, Math.max(3, num(process.env.EMA_FAST, 12))),
  EMA_SLOW: Math.min(200, Math.max(5, num(process.env.EMA_SLOW, 26))),

  COINGECKO_TIMEOUT_MS: Math.min(20000, Math.max(3000, num(process.env.COINGECKO_TIMEOUT_MS, 12000))),
  DEXSCREENER_TIMEOUT_MS: Math.min(20000, Math.max(3000, num(process.env.DEXSCREENER_TIMEOUT_MS, 12000)))
};

module.exports = { config };
