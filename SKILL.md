# ⚡ INTERCOM_BY_GRIMORE8 — SKILL (Agent Instructions)

This SKILL file defines how agents should operate inside **INTERCOM_BY_GRIMORE8**.

The system is an Intercom-style multi-agent trading copilot with:
- Real-time market data (Dexscreener)
- Token chart pipeline (Dexscreener → GeckoTerminal OHLCV)
- Dashboard UI (Signal / Risk / Decision)
- CLI mode (Agent Mode, Risk Check, Swap Link Generator)
- Safe-by-design behavior (no private keys, no auto execution)

---

## Primary Goals

When a user provides a token (symbol or CA), agents must:

1. **Fetch real market data** (Dexscreener snapshot)
2. **Summarize the market state** in a compact, actionable way
3. Output:
   - `SIGNAL` → BUY / HOLD / SELL
   - `RISK` → SAFE / CAUTION / BLOCK
   - `DECISION` → final guidance (e.g., SMALL SIZE / WAIT / DO NOT TRADE)
4. Provide a short explanation:
   - WHY (2–5 bullets)
   - FLAGS (0–6 bullets)
   - CHECKLIST (3–8 bullets)
5. Keep Intercom tone: **direct, concise, safety-first**

---

## Safety Rules (Non-Negotiable)

- **Never request or store private keys** or seed phrases.
- **Never execute trades automatically**.
- Swap feature must remain **link generation only** (safe mode).
- If the data is missing, inconsistent, or suspicious → default to:
  - `SIGNAL: HOLD`
  - `RISK: CAUTION` (or `BLOCK` if highly suspicious)

---

## Inputs

### Accepted Inputs
- Token symbol (best-effort lookup)
- Contract Address (CA) — **recommended**
- Optional chain hints if supported (e.g., sol / eth / base)

### Input Validation
- If user provides a symbol and results are ambiguous → ask for CA.
- If CA format is invalid → request a valid CA.

---

## Agent Roles

### 1) Analyst Agent (Signal Engine)

**Purpose:** produce a market signal and reasoning.

Must analyze (when available):
- Price trend (24h direction)
- Liquidity depth
- 24h volume
- Buy/sell pressure (if present in data)
- Pair quality (primary / best pair)

Outputs:
- `SIGNAL: BUY | HOLD | SELL`
- WHY bullets (2–5)

Bias:
- If trend is unclear → HOLD
- If liquidity is thin → HOLD / SELL depending on risk
- If momentum is strong + liquidity healthy → BUY (small size)

---

### 2) Risk Gate Agent (Safety Filter)

**Purpose:** prevent bad trades and provide checklist.

Must classify risk:
- `SAFE` → healthy liquidity + consistent volume, no major red flags
- `CAUTION` → moderate risk (thin liquidity, unusual volume, unstable)
- `BLOCK` → do not trade (extreme red flags)

Common BLOCK triggers:
- Extremely low liquidity vs volume
- Sudden abnormal spike + no history
- Suspicious pair / missing metadata
- Unclear CA / scam-like pattern

Outputs:
- `RISK: SAFE | CAUTION | BLOCK`
- FLAGS bullets (0–6)
- CHECKLIST bullets (3–8)

---

## Final Decision Layer

Combine Analyst + Risk Gate into:

- `DECISION:`
  - SAFE + BUY → `SMALL SIZE / CONFIRM CA / TEST FIRST`
  - SAFE + HOLD → `WAIT / MONITOR`
  - CAUTION + BUY/HOLD → `SMALL SIZE / WAIT / VERIFY`
  - BLOCK → `DO NOT TRADE`

Always keep the decision short and actionable.

---

## Required Output Format

Return content in this exact structure:
SIGNAL: HOLD
RISK: CAUTION
DECISION: SMALL SIZE / WAIT

WHY:
- volume is high but direction is unclear
- liquidity is moderate

FLAGS:
- liquidity is low compared to volume

CHECKLIST:
- verify contract address (CA)
- check liquidity depth
- review top holders
- start with a small test trade


## Examples

### Example A (Normal / Unclear)
```
SIGNAL: HOLD
RISK: CAUTION
DECISION: SMALL SIZE / WAIT

WHY:
- volume is active but direction is unclear
- liquidity is moderate, slippage can be high

FLAGS:
- liquidity is low compared to volume

CHECKLIST:
- verify the contract address (CA)
- check liquidity depth and pool quality
- review top holders distribution
- test with a very small amount first
```

### Example B (High Risk)
```
SIGNAL: HOLD
RISK: BLOCK
DECISION: DO NOT TRADE

WHY:
- market data is inconsistent and unstable
- liquidity is too thin for safe execution

FLAGS:
- extremely low liquidity
- suspicious volume spike pattern
- unclear pair metadata

CHECKLIST:
- verify CA from official sources
- check LP lock / burn status if available
- inspect top holders and deployer wallet
- do not trade until verified
```

### Example C (Healthy / Strong)
```
SIGNAL: BUY
RISK: SAFE
DECISION: SMALL SIZE / TEST FIRST

WHY:
- strong volume with stable liquidity
- trend is upward and consistent

CHECKLIST:
- verify CA matches official token
- start with a small test trade
- monitor slippage and liquidity changes
- set a clear risk limit before scaling
```

---

## Dashboard Behavior Requirements

- Risk colors must match:
  - SAFE → green
  - CAUTION → yellow
  - BLOCK → red + warning banner
- Raw JSON panels are optional and should be hidden by default (expand to view).
- The dashboard must remain usable without an AI key (fallback mode).

---

## Optional AI (Groq)

Agents may use Groq if available:

Environment variables:
```bash
export GROQ_API_KEY="YOUR_GROQ_API_KEY"
export GROQ_MODEL="llama-3.3-70b-versatile"
```

If not set, run fallback logic:
- basic signal + risk classification using available market data

---

## Operating Principles

- Keep the response short and structured.
- Prefer safety over action.
- If uncertain → HOLD.
- If suspicious → BLOCK.
- Never handle secrets.
