const $ = (id) => document.getElementById(id);

const els = {
  wsStatus: $("wsStatus"),
  btnRefresh: $("btnRefresh"),

  marketId: $("marketId"),
  btnLoadMarket: $("btnLoadMarket"),
  mLast: $("mLast"),
  mSignal: $("mSignal"),
  mConf: $("mConf"),
  mUpdated: $("mUpdated"),
  mBadge: $("mBadge"),
  mReason: $("mReason"),
  mMinMax: $("mMinMax"),
  marketChart: $("marketChart"),

  caInput: $("caInput"),
  btnCheckCa: $("btnCheckCa"),
  tName: $("tName"),
  tPrice: $("tPrice"),
  tLiq: $("tLiq"),
  t24h: $("t24h"),
  tBadge: $("tBadge"),
  tReason: $("tReason"),
  tLink: $("tLink"),
  tMeta: $("tMeta"),

  logBox: $("logBox"),
  btnClearLogs: $("btnClearLogs")
};

function fmtUsd(n) {
  const x = Number(n);
  if (!isFinite(x)) return "-";
  if (x >= 1000) return `$${x.toFixed(0)}`;
  if (x >= 1) return `$${x.toFixed(4)}`;
  return `$${x.toFixed(8)}`;
}

function fmtNum(n) {
  const x = Number(n);
  if (!isFinite(x)) return "-";
  if (x >= 1_000_000) return `${(x / 1_000_000).toFixed(2)}M`;
  if (x >= 1_000) return `${(x / 1_000).toFixed(2)}K`;
  return `${x.toFixed(2)}`;
}

function setBadge(el, label, kind) {
  el.classList.remove("safe", "warn", "bad");
  if (kind) el.classList.add(kind);
  el.textContent = label;
}

function pickKindFromAction(action) {
  const a = String(action || "").toUpperCase();
  if (a === "BLOCK") return "bad";
  if (["SELL", "SHORT"].includes(a)) return "warn";
  if (["BUY", "LONG"].includes(a)) return "safe";
  return null;
}

function ts() {
  const d = new Date();
  return d.toISOString().replace("T", " ").replace("Z", "");
}

function addLog(level, message) {
  const line = document.createElement("div");
  line.className = "logLine";

  const levelClass =
    level === "ok" ? "ok" :
    level === "warn" ? "warn" :
    level === "bad" ? "bad" : "info";

  line.innerHTML = `
    <span class="ts">${ts()}</span>
    <span class="lvl ${levelClass}">[${level.toUpperCase()}]</span>
    <span class="msg">${escapeHtml(message)}</span>
  `;
  els.logBox.prepend(line);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}

// --- Chart
const ctx = els.marketChart.getContext("2d");

function drawLineChart(prices) {
  const w = els.marketChart.width;
  const h = els.marketChart.height;
  ctx.clearRect(0, 0, w, h);

  if (!Array.isArray(prices) || prices.length < 2) {
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = "16px ui-monospace";
    ctx.fillText("No data", 18, 30);
    return;
  }

  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const pad = 18;

  // grid
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const y = pad + ((h - pad * 2) * i) / 5;
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(w - pad, y);
    ctx.stroke();
  }

  // line
  ctx.strokeStyle = "rgba(57,255,180,0.85)";
  ctx.lineWidth = 2;

  const dx = (w - pad * 2) / (prices.length - 1);

  ctx.beginPath();
  for (let i = 0; i < prices.length; i++) {
    const v = prices[i];
    const x = pad + dx * i;
    const t = max === min ? 0.5 : (v - min) / (max - min);
    const y = (h - pad) - t * (h - pad * 2);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // glow
  ctx.globalAlpha = 0.25;
  ctx.strokeStyle = "rgba(87,199,255,0.9)";
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.globalAlpha = 1;

  els.mMinMax.textContent = `min: ${fmtUsd(min)}  max: ${fmtUsd(max)}`;
}

// --- API
async function apiGet(url) {
  const r = await fetch(url);
  return await r.json();
}

async function loadMarket() {
  const id = els.marketId.value;
  setBadge(els.mBadge, "Loading…", null);
  els.mReason.textContent = "";

  const data = await apiGet(`/api/market?id=${encodeURIComponent(id)}&vs=usd&days=1`);

  if (!data.ok) {
    setBadge(els.mBadge, `CAUTION: ${data.status || ""} ${data.error || "error"}`.trim(), "warn");
    addLog("warn", `Market error (${id}): ${data.error || "unknown"}`);
    return;
  }

  const prices = data.prices || [];
  const sig = data.signal || {};
  const last = prices.length ? prices[prices.length - 1] : null;

  els.mLast.textContent = last ? fmtUsd(last) : "-";
  els.mSignal.textContent = sig.action ? `${sig.action} (${sig.bias || "NEUTRAL"})` : "-";
  els.mConf.textContent = sig.confidence != null ? `${Math.round(sig.confidence * 100)}%` : "-";
  els.mUpdated.textContent = data.updatedAt ? data.updatedAt.replace("T"," ").replace("Z","") : "-";
  els.mReason.textContent = sig.reason || "";

  const kind = pickKindFromAction(sig.action);
  const label =
    kind === "safe" ? "SAFE" :
    kind === "warn" ? "CAUTION" :
    kind === "bad" ? "BLOCK" : "NEUTRAL";

  setBadge(els.mBadge, `${label}: ${sig.action || "HOLD"}`, kind);

  drawLineChart(prices);

  addLog("ok", `Market loaded (${id}). Signal=${sig.action} Conf=${sig.confidence}`);
}

async function checkCa() {
  const ca = els.caInput.value.trim();
  if (!ca) return;

  setBadge(els.tBadge, "Loading…", null);
  els.tReason.textContent = "";
  els.tMeta.textContent = "";
  els.tLink.href = "#";

  const data = await apiGet(`/api/token?ca=${encodeURIComponent(ca)}`);

  if (!data.ok) {
    setBadge(els.tBadge, `CAUTION: ${data.status || ""} ${data.error || "error"}`.trim(), "warn");
    addLog("warn", `Dex error: ${data.error || "unknown"}`);
    return;
  }

  els.tName.textContent = `${data.token.symbol} — ${data.token.name}`;
  els.tPrice.textContent = fmtUsd(data.pair.priceUsd);
  els.tLiq.textContent = `$${fmtNum(data.pair.liquidityUsd)}`;
  els.t24h.textContent = `${Number(data.pair.change24h).toFixed(2)}%`;

  const a = data.agent || {};
  const kind = pickKindFromAction(a.action);
  const label =
    kind === "safe" ? "SAFE" :
    kind === "warn" ? "CAUTION" :
    kind === "bad" ? "BLOCK" : "NEUTRAL";

  setBadge(els.tBadge, `${label}: ${a.action} (${Math.round((a.confidence || 0) * 100)}%)`, kind);
  els.tReason.textContent = a.reason || "";

  if (data.pair.url) {
    els.tLink.href = data.pair.url;
  }

  els.tMeta.textContent = `${data.token.chainId} / ${data.token.dexId} • Updated ${data.updatedAt.replace("T"," ").replace("Z","")}`;

  addLog(kind === "bad" ? "bad" : kind === "warn" ? "warn" : "ok",
    `CA checked ${data.token.symbol}: price=${data.pair.priceUsd} liq=$${data.pair.liquidityUsd} change24h=${data.pair.change24h}% action=${a.action}`);
}

// --- WebSocket
let ws = null;

function setWsStatus(state) {
  const dot = els.wsStatus.querySelector(".dot");
  if (state === "ok") {
    dot.className = "dot dot-ok";
    els.wsStatus.childNodes[2].textContent = " connected";
  } else if (state === "bad") {
    dot.className = "dot dot-bad";
    els.wsStatus.childNodes[2].textContent = " disconnected";
  } else {
    dot.className = "dot dot-warn";
    els.wsStatus.childNodes[2].textContent = " connecting";
  }
}

function connectWs() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const url = `${proto}://${location.host}`;
  ws = new WebSocket(url);

  setWsStatus("warn");

  ws.onopen = () => {
    setWsStatus("ok");
    addLog("ok", "WS connected.");
  };

  ws.onclose = () => {
    setWsStatus("bad");
    addLog("warn", "WS disconnected. Reconnecting…");
    setTimeout(connectWs, 1500);
  };

  ws.onerror = () => {
    setWsStatus("bad");
  };

  ws.onmessage = (ev) => {
    let msg = null;
    try { msg = JSON.parse(ev.data); } catch { return; }

    if (msg.type === "hello") {
      addLog("info", msg.message || "hello");
      return;
    }

    if (msg.type === "ticker") {
      // Optional: show live updates via logs
      const cg = msg.prices || {};
      const btc = cg?.bitcoin?.usd;
      const eth = cg?.ethereum?.usd;
      const sol = cg?.solana?.usd;
      if (btc || eth || sol) {
        addLog("info", `Live: BTC=${btc ?? "-"} ETH=${eth ?? "-"} SOL=${sol ?? "-"}`);
      }
      return;
    }

    if (msg.type === "agent_log") {
      addLog(msg.level || "info", msg.message || "agent");
      return;
    }

    if (msg.type === "error") {
      addLog("warn", msg.message || "ws error");
      return;
    }
  };
}

// --- Events
els.btnLoadMarket.onclick = loadMarket;
els.btnRefresh.onclick = () => {
  loadMarket();
  const ca = els.caInput.value.trim();
  if (ca) checkCa();
};

els.btnCheckCa.onclick = checkCa;
els.caInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") checkCa();
});

els.btnClearLogs.onclick = () => {
  els.logBox.innerHTML = "";
};

// --- Boot
addLog("info", "UI ready. Load market + paste CA to scan token.");
connectWs();
loadMarket();
