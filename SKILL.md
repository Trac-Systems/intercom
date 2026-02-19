# ⚡ SKILL — Intercom Real Price Analyzer

> Localhost Web Dashboard + Agent Signal + CA Token Scanner  
> No CLI • Realtime • SC-Bridge Ready

---

## 🧠 What This Skill Does

This skill runs a **real-time trading dashboard** locally with:

- Live market data (CoinGecko)
- Token scanner via CA / Mint (DexScreener)
- Built-in trading agent (EMA + RSI + Momentum)
- WebSocket realtime updates

Everything runs in **localhost (web UI only)**.

---

## ⚙️ Requirements

- Node.js **18+**
- npm **9+**
- OS: Linux / Windows / macOS

---

## 🚀 One-Command Setup

```bash
git clone https://github.com/comand87/intercom-agent-console.git && cd intercom-agent-console && npm install && npm start
```

Open in browser:
```
http://localhost:3000
```

---

## 🧩 Core System

### Frontend
- Vanilla JS UI (dark mode)
- Market analyzer (chart + signal)
- Token checker input (CA / Mint)
- Agent feed logs

### Backend
- Node.js + Express
- WebSocket server (realtime push)
- API integration:
  - CoinGecko
  - DexScreener

---

## 🔎 Token Checker

Input:
- Solana Mint Address
- EVM Contract Address

Returns:
- Price
- Liquidity
- 24h change
- Pair info
- DexScreener link

---

## 🤖 Agent Logic

The agent analyzes:

- EMA crossover
- RSI levels
- Momentum strength

### Output:

- 🟢 BUY  
- 🔴 SELL  
- 🟡 WAIT  

---

## 📡 Realtime Engine

- WebSocket-based
- No page refresh needed
- Live logs via Agent Feed

---

## 🛡️ Safety Mode

- No wallet required
- No transaction execution
- Read-only analysis only
- Safe for testing tokens

---

## 🔗 Trac Compatibility

- SC-Bridge ready (WebSocket control)
- Sidechannel compatible
- Agent-ready architecture

---

## 🧪 Dev Notes

- CoinGecko may return **429 (rate limit)** → system auto cooldown
- DexScreener depends on pair availability
- Agent runs stateless + lightweight

---

## 📁 Key Structure

```
/public        → frontend UI
/server        → backend logic
/assets        → images for README
```

---

## 🧠 Skill Summary

This skill demonstrates:

- Realtime data streaming
- Token intelligence via CA
- Agent-based decision making
- Clean web dashboard (no CLI)

---

## 👑 Author

**@comand87**  
Intercom Task — Trac Systems

---

## 💥 Usage

Just run:

```bash
npm start
```

Then open:

```
http://localhost:3000
```

Done.

