# SKILL.md — AutoDEX Agent Fork

> Canonical instruction set for AI agents operating this fork.
> For upstream Intercom/IntercomSwap base skills, see the upstream SKILL.md.

---

## What This Fork Adds

**AutoDEX Agent** layers autonomous, event-driven trading on top of the Intercom P2P stack:

- Price-based agents fire RFQs when thresholds are crossed
- RSI, volume, and spread signals provide secondary confirmation
- Chain Watcher monitors Solana slots and auto-claims USDT escrow
- All settlement is atomic: BTC over Lightning ↔ USDT over Solana HTLC

---

## Recommended Models

- **Claude Sonnet 4.6 / Opus 4.6** (Anthropic)
- **GPT-5.3+ Codex** (OpenAI)

These models can install, configure, and operate the full stack autonomously via SKILL.md.

---

## Quick Install (Agent Prompt)

```
Install this repo using SKILL.md. Run all tests (unit + e2e).
Then start the AutoDEX agent stack: maker peer + promptd + chain watcher on test networks.
Report what was run and any failures.
```

### Step-by-Step

```bash
# Bootstrap
scripts/bootstrap.sh
npm install

# Tests (mandatory before any live use)
npm test
npm run test:e2e

# Config
./scripts/promptd.sh --print-template > onchain/prompt/setup.json
# Edit: llm.base_url / llm.model / llm.api_key
#       peer.keypair / sc_bridge.token_file
#       solana.rpc_url / ln.network

# Start peer (headless, recommended)
scripts/peermgr.sh start \
  --name autodex-maker \
  --store autodex-maker \
  --sc-port 49222 \
  --sidechannels 0000intercomswapbtcusdt

# Start promptd + AutoDEX dashboard
./scripts/promptd.sh --config onchain/prompt/setup.json
# Dashboard: http://127.0.0.1:9333/
# Standalone demo: open index.html in browser
```

---

## Run Path Matrix

| Goal | Path | Key Rule |
|---|---|---|
| Code validation | `test` | LN regtest + Solana devnet — separate stores |
| Live trading | `mainnet` | Never reuse test stores/ports/DBs |
| Agent automation | `headless` | Tool calls preferred over free-form prompts |
| Instant demo | `standalone` | Open `index.html` in browser — no backend needed |

---

## Deploying Autonomous Agents

### AutoBuy Agent

```
Start an AutoBuy agent:
- Buy 50,000 sats when BTC/USDT drops below $96,200
- Secondary condition: RSI(14) < 40
- Channel: 0000intercomswapbtcusdt
- Solana keypair: onchain/keys/maker.json
- Notify when first execution fires
```

Equivalent tool call sequence:
1. `intercomswap_sc_price_get` — check current price
2. `intercomswap_rfq_post` — post RFQ when condition met
3. `intercomswap_sc_wait_envelope` — wait for quote
4. `intercomswap_quote_accept` — accept best quote
5. `intercomswap_swap_verify_pre_pay` — verify escrow
6. `intercomswap_swap_ln_pay_and_post_verified` — pay + post proof
7. `intercomswap_swap_sol_claim_and_post` — claim USDT

### AutoSell Agent

```
Start an AutoSell agent:
- Sell 30,000 sats when BTC/USDT rises above $97,500
- Secondary condition: 1h volume > 2.0 BTC
- Channel: 0000intercomswapbtcusdt
```

### Chain Watcher Agent

```
Start the Chain Watcher:
- Monitor Solana for confirmed escrow PDAs on 0000intercomswapbtcusdt
- Auto-claim USDT when preimage is available in receipts DB
- Solana RPC: use configured rpc_url
- Store receipts: onchain/receipts/watcher.sqlite
```

### Arb Monitor Agent

```
Start Arb Monitor:
- Watch BTC-USDT spread across 0000intercomswapbtcusdt channel
- Trigger dual-leg swap when spread > 0.05%
- Min LN liquidity required: 100,000 sats
- Max total fees: 0.3%
```

---

## Condition Logic Format

```
IF   <metric> <operator> <value>
AND  <metric> <operator> <value>   (optional secondary)
THEN <action> <params>
```

### Supported Metrics

| Metric | Description |
|---|---|
| `price` | BTC/USDT spot from peer oracle |
| `rsi_14` | 14-period RSI from price oracle |
| `volume_1h` | 1-hour rolling volume |
| `spread` | Best ask - best bid / mid price |
| `ln_liquidity` | Available inbound LN sats |
| `escrow_slot` | Solana escrow confirmation status |
| `preimage` | LN preimage availability in receipts DB |

---

## Key Tool Reference

| Tool | Purpose |
|---|---|
| `intercomswap_sc_price_get` | Live BTC/USDT from peer oracle |
| `intercomswap_tradeauto_start` | Start backend trade automation worker |
| `intercomswap_tradeauto_status` | Check automation worker health |
| `intercomswap_rfq_post` | Post RFQ to rendezvous channel |
| `intercomswap_quote_accept` | Accept a received quote |
| `intercomswap_swap_verify_pre_pay` | Verify escrow before paying LN |
| `intercomswap_swap_ln_pay_and_post_verified` | Pay LN + post LN_PAID |
| `intercomswap_swap_sol_claim_and_post` | Claim escrow + post SOL_CLAIMED |
| `intercomswap_receipts_list_open_claims` | Find claimable trades (recovery) |
| `intercomswap_swaprecover_claim` | Recover stuck escrow claims |
| `intercomswap_sol_escrow_get` | Inspect escrow by payment_hash |

---

## Test vs Mainnet Separation

```
TEST instance
  port:     9333
  channel:  0000intercomswapbtcusdt_test
  receipts: onchain/receipts/test/
  ln:       regtest
  solana:   devnet or local validator

MAINNET instance
  port:     9334
  channel:  0000intercomswapbtcusdt
  receipts: onchain/receipts/mainnet/
  ln:       mainnet
  solana:   mainnet RPC (auth via HTTP_HEADERS_FILE)
```

**Critical rule:** Never run test and mainnet from the same peer store, DB, or promptd port.

---

## Recovery

```bash
# List open claims (LN paid but escrow not claimed)
./scripts/swaprecover.sh \
  --receipts-db onchain/receipts/mainnet/swap-maker.sqlite \
  list

# Claim stuck escrow
./scripts/swaprecover.sh \
  --receipts-db onchain/receipts/mainnet/swap-maker.sqlite \
  claim --trade-id <id> \
  --solana-rpc-url <url> \
  --solana-keypair onchain/keys/maker.json
```

---

## Secrets Hygiene

- `onchain/` is gitignored — wallets, tokens, receipts never commit
- Use `HTTP_HEADERS_FILE` for authenticated RPC bearer tokens
- Rotate test keypairs before going to mainnet
- Never commit `onchain/` contents under any circumstances

---

## Links

- Upstream Intercom: https://github.com/Trac-Systems/intercom
- IntercomSwap: https://github.com/TracSystems/intercom-swap
- Awesome Intercom: https://github.com/Trac-Systems/awesome-intercom
- Trac Address: `trac1s5uceuqlqaz5ezreyxwlx6azetn5hladjd9xtd5y27u6vaww3djqvpfk07`
