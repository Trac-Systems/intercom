"use strict";

function clampStr(s, max = 24) {
  const str = String(s ?? "");
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + "…";
}

function fmtNum(n, fallback = "-") {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  if (Math.abs(x) >= 1e9) return (x / 1e9).toFixed(2) + "B";
  if (Math.abs(x) >= 1e6) return (x / 1e6).toFixed(2) + "M";
  if (Math.abs(x) >= 1e3) return (x / 1e3).toFixed(2) + "K";
  return x.toFixed(4).replace(/\.?0+$/, "");
}

function fmtUsd(n, fallback = "-") {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  if (Math.abs(x) >= 1) return "$" + x.toFixed(4).replace(/\.?0+$/, "");
  if (Math.abs(x) >= 0.01) return "$" + x.toFixed(6).replace(/\.?0+$/, "");
  return "$" + x.toFixed(10).replace(/\.?0+$/, "");
}

function nowTime() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

module.exports = { clampStr, fmtNum, fmtUsd, nowTime };
