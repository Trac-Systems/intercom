# 🔮 TracOracle — P2P Prediction Markets on Trac Network

> Fork of: https://github.com/Trac-Systems/intercom  
> Competition: https://github.com/Trac-Systems/awesome-intercom

**Trac Address:** bc1p5nl38pkejgz36lnund59t8s5rqlv2p2phj4y6e3nfqy8a9wqe9dseeeqzn

---

## What Is It?

TracOracle is a fully peer-to-peer prediction market built on Trac Network.

Agents and humans create YES/NO questions, stake TNK on outcomes, a trusted oracle resolves the result, and winners automatically claim their proportional share of the pool — all without a central server.

```
[Agent A creates market] "Will ETH hit $10k before July 2026?" → oracle: trac1...
[Agent B stakes 500 TNK on YES]
[Agent C stakes 200 TNK on NO]
         ↓  staking closes
[Oracle resolves: YES]
         ↓
[Agent B claims: 700 TNK — their 500 back + 200 from the losing pool]
```

---

## Why This Is New

Every existing Intercom fork is either a **swap** (trading), a **scanner** (information), a **timestamp** (certification), or an **inbox** (sharing). TracOracle is the first **prediction market** — a fundamentally different primitive that lets agents express beliefs about the future and get financially rewarded for being right.

---

## Market Lifecycle

```
open ──(closes_at)──▶ closed ──(oracle resolves)──▶ resolved ──▶ claim payouts
                           ╲──(oracle misses deadline)──▶ void (full refunds)
```

States: `open → closed → resolved` or `void`  
Outcomes: `yes`, `no`, `void`

---

## Quickstart

```bash
git clone https://github.com/YOUR_USERNAME/intercom   # your fork
cd intercom
npm install -g pear
npm install
pear run . store1
```

**First-run bootstrap:**
1. Copy your **Writer Key** from the terminal output
2. Open `index.js` → paste it as the bootstrap address
3. `/exit` → `pear run . store1` again
4. `/add_admin --address YourPeerAddress`
5. `/set_auto_add_writers --enabled 1`

**Join as a second peer:**
```bash
pear run . store2 --subnet-bootstrap <hex-from-store1>
```

---

## Commands

All commands use `/tx --command '{ ... }'`:

**Create a market**
```
/tx --command '{
  "op": "market_create",
  "question": "Will BTC hit $200k before Dec 2026?",
  "category": "crypto",
  "closes_in": 86400,
  "resolve_by": 604800,
  "oracle_address": "trac1..."
}'
```

**Stake on a side**
```
/tx --command '{ "op": "market_stake", "market_id": "<id>", "side": "yes", "amount": 500 }'
/tx --command '{ "op": "market_stake", "market_id": "<id>", "side": "no",  "amount": 200 }'
```

**List open markets**
```
/tx --command '{ "op": "market_list", "state": "open", "category": "crypto" }'
```

**Get one market**
```
/tx --command '{ "op": "market_get", "market_id": "<id>" }'
```

**Resolve (oracle only)**
```
/tx --command '{ "op": "market_resolve", "market_id": "<id>", "outcome": "yes" }'
```

**Claim winnings**
```
/tx --command '{ "op": "market_claim", "market_id": "<id>" }'
```

**See your stakes**
```
/tx --command '{ "op": "my_stakes" }'
```

**Watch live activity**
```
/sc_join --channel "tracoracle-activity"
```

---

## Payout Formula

```
your_payout = floor( (your_winning_stake / winning_pool) × total_pool )
```

Example: 1000 TNK YES pool, 500 TNK NO pool, you staked 200 TNK YES.  
Payout = `floor((200/1000) × 1500)` = **300 TNK** (+100 profit).

---

## Architecture

```
tracoracle/
├── index.js                      ← Boot, sidechannel event display
├── contract/
│   ├── contract.js               ← State machine (markets, stakes, claims)
│   └── protocol.js               ← Op router, MSB payout trigger
├── features/
│   └── oracle/index.js           ← Auto-closes staking, voids missed markets
├── SKILL.md                      ← Full agent instructions
└── package.json
```

- **Contract** — deterministic state, same on every peer, no disagreements
- **Protocol** — routes `/tx` ops to contract, triggers MSB payouts on claim
- **Oracle Feature** — privileged process on indexer nodes; closes staking at deadline, voids markets if oracle ghosts
- **Sidechannel** — `tracoracle-activity` channel broadcasts stakes, resolutions, claims in real time

---

## Roadmap

- [ ] Multi-outcome markets (not just YES/NO)
- [ ] Oracle reputation score (on-chain win rate)
- [ ] Oracle fee (% of pool goes to oracle as reward)
- [ ] Market search by keyword
- [ ] Leaderboard (top predictors by win rate and profit)
- [ ] Desktop UI (`"type": "desktop"` in package.json)

---

## License

MIT — based on the Intercom reference implementation by Trac Systems.
