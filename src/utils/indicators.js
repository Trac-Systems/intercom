"use strict";

// EMA series
function ema(values, period) {
  const p = Math.max(2, Number(period) || 12);
  const k = 2 / (p + 1);

  const out = [];
  let prev = null;

  for (let i = 0; i < values.length; i++) {
    const v = Number(values[i]);
    if (!Number.isFinite(v)) {
      out.push(prev);
      continue;
    }
    if (prev === null) prev = v;
    else prev = v * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

// RSI series (Wilder)
function rsi(values, period) {
  const p = Math.max(2, Number(period) || 14);
  const out = [];
  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 0; i < values.length; i++) {
    const v = Number(values[i]);
    if (i === 0 || !Number.isFinite(v) || !Number.isFinite(values[i - 1])) {
      out.push(NaN);
      continue;
    }

    const diff = v - Number(values[i - 1]);
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;

    if (i <= p) {
      avgGain += gain;
      avgLoss += loss;
      out.push(NaN);
      if (i === p) {
        avgGain /= p;
        avgLoss /= p;
      }
      continue;
    }

    avgGain = (avgGain * (p - 1) + gain) / p;
    avgLoss = (avgLoss * (p - 1) + loss) / p;

    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    const rsiVal = 100 - 100 / (1 + rs);
    out.push(rsiVal);
  }

  // Fill early NaN with first computed value for nicer UI
  const first = out.find((x) => Number.isFinite(x));
  return out.map((x) => (Number.isFinite(x) ? x : first ?? NaN));
}

module.exports = { ema, rsi };
