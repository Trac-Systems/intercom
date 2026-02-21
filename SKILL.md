# SKILL.md — TracOracle (Prediction Markets on Trac Network)

> Parent stack: https://github.com/Trac-Systems/intercom  
> This file gives AI coding agents everything needed to work on TracOracle.

---

## What TracOracle Does

A fully P2P prediction market. Agents and humans:
1. **Create** a YES/NO question with a TNK stake pool
2. **Stake** TNK on their predicted outcome before the market closes
3. A designated **oracle** resolves the outcome (YES / NO / VOID)
4. **Winners claim** their proportional share of the total pool

Market lifecycle:
```
open ──(closes_at)──▶ closed ──(oracle resolves)──▶ resolved ──▶ payouts
                            ╲──(oracle misses deadline)──▶ void (full refunds)
```

---

## Runtime

**Always use Pear. Never `node index.js`.**

```bash
npm install -g pear
npm install
pear run . store1        # first peer / bootstrap
pear run . store2        # second peer (same subnet)
```

First-run bootstrap setup:
1. `pear run . store1` → copy **Writer Key** from output
2. Open `index.js` → paste as `bootstrap` option in `new Peer(config)`
3. `/exit` → rerun `pear run . store1`
4. `/add_admin --address YourPeerAddress`
5. `/set_auto_add_writers --enabled 1`

---

## All Commands

Every command is sent as: `/tx --command '{ "op": "...", ...args }'`

### Create a market
```
/tx --command '{ "op": "market_create", "question": "Will BTC hit $200k before Dec 2026?", "category": "crypto", "closes_in": 86400, "resolve_by": 604800, "oracle_address": "trac1..." }'
```
- `closes_in`: seconds until staking closes (min 60, max 2592000)
- `resolve_by`: seconds until oracle must resolve (must be > closes_in)
- `oracle_address`: the Trac address that is allowed to call market_resolve
- `category`: one of `crypto`, `sports`, `politics`, `science`, `tech`, `other`

### Stake on a market
```
/tx --command '{ "op": "market_stake", "market_id": "<uuid>", "side": "yes", "amount": 500 }'
```

### List open markets
```
/tx --command '{ "op": "market_list", "state": "open", "category": "crypto", "limit": 10 }'
```

### Get one market
```
/tx --command '{ "op": "market_get", "market_id": "<uuid>" }'
```

### Resolve a market (oracle only)
```
/tx --command '{ "op": "market_resolve", "market_id": "<uuid>", "outcome": "yes" }'
```
- Only the address set as `oracle_address` at market creation can call this
- `outcome`: `"yes"`, `"no"`, or `"void"` (void = full refunds)

### Claim winnings
```
/tx --command '{ "op": "market_claim", "market_id": "<uuid>" }'
```
- Only callable after resolution
- One-time per address
- Proportional payout: `(your_stake / winning_pool) × total_pool`

### View your stakes
```
/tx --command '{ "op": "my_stakes" }'
```

### Monitor live activity (sidechannel)
```
/sc_join --channel "tracoracle-activity"
```

---

## Key Files

| File | What to change |
|------|---------------|
| `index.js` | Entry point. Add new sidechannel message types here. |
| `contract/contract.js` | State machine. Add new market types or fields here. |
| `contract/protocol.js` | Router. Add new `op` cases here. |
| `features/oracle/index.js` | Oracle watcher. Change auto-void logic or tick interval here. |

**Pattern:** every new feature = contract method + protocol case + README example.

---

## Payout Math

```
total_pool   = yes_pool + no_pool
your_payout  = floor( (your_winning_stake / winning_pool) * total_pool )
```

Example: 1000 TNK YES pool, 500 TNK NO pool. You staked 200 TNK on YES.
Payout = floor((200 / 1000) × 1500) = 300 TNK (50 TNK profit).

---

## Do Not

- Never call `node index.js` — always `pear run . store1`
- Never add SQL or central databases — all state via Trac's K/V store (`this.db`)
- Never let non-oracle addresses call `market_resolve`
- Never allow staking after `closes_at`
- Never allow double-claiming (`market.claimed[address]` check)

---

## Good First Agent Tasks

1. Add `market_search` op — filter markets by keyword in question text
2. Add `min_pool` filter to `market_list` — only show markets with enough liquidity
3. Add a `fee` field — small % of pool goes to oracle as compensation
4. Add multi-outcome markets: `outcome` is a string chosen from a list, not just YES/NO
5. Add a leaderboard: track each address's prediction win rate in contract state
