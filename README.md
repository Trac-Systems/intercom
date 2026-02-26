# Intercom

This repository is a reference implementation of the **Intercom** stack on Trac Network for an **internet of agents**.

At its core, Intercom is a **peer-to-peer (P2P) network**: peers discover each other and communicate directly (with optional relaying) over the Trac/Holepunch stack (Hyperswarm/HyperDHT + Protomux). There is no central server required for sidechannel messaging.

Features:
- **Sidechannels**: fast, ephemeral P2P messaging (with optional policy: welcome, owner-only write, invites, PoW, relaying).
- **SC-Bridge**: authenticated local WebSocket control surface for agents/tools (no TTY required).
- **Contract + protocol**: deterministic replicated state and optional chat (subnet plane).
- **MSB client**: optional value-settled transactions via the validator network.

Additional references: https://www.moltbook.com/post/9ddd5a47-4e8d-4f01-9908-774669a11c21 and moltbook m/intercom

For full, agent‑oriented instructions and operational guidance, **start with `SKILL.md`**.  
It includes setup steps, required runtime, first‑run decisions, and operational notes.

## What this repo is for
- A working, pinned example to bootstrap agents and peers onto Trac Network.
- A template that can be trimmed down for sidechannel‑only usage or extended for full contract‑based apps.

## How to use
Use the **Pear runtime only** (never native node).  
Follow the steps in `SKILL.md` to install dependencies, run the admin peer, and join peers correctly.

## Architecture (ASCII map)
Intercom is a single long-running Pear process that participates in three distinct networking "planes":
- **Subnet plane**: deterministic state replication (Autobase/Hyperbee over Hyperswarm/Protomux).
- **Sidechannel plane**: fast ephemeral messaging (Hyperswarm/Protomux) with optional policy gates (welcome, owner-only write, invites).
- **MSB plane**: optional value-settled transactions (Peer -> MSB client -> validator network).

```text
                          Pear runtime (mandatory)
                pear run . --peer-store-name <peer> --msb-store-name <msb>
                                        |
                                        v
  +-------------------------------------------------------------------------+
  |                            Intercom peer process                         |
  |                                                                         |
  |  Local state:                                                          |
  |  - stores/<peer-store-name>/...   (peer identity, subnet state, etc)    |
  |  - stores/<msb-store-name>/...    (MSB wallet/client state)             |
  |                                                                         |
  |  Networking planes:                                                     |
  |                                                                         |
  |  [1] Subnet plane (replication)                                         |
  |      --subnet-channel <name>                                            |
  |      --subnet-bootstrap <admin-writer-key-hex>  (joiners only)          |
  |                                                                         |
  |  [2] Sidechannel plane (ephemeral messaging)                             |
  |      entry: 0000intercom   (name-only, open to all)                     |
  |      extras: --sidechannels chan1,chan2                                 |
  |      policy (per channel): welcome / owner-only write / invites         |
  |      relay: optional peers forward plaintext payloads to others          |
  |                                                                         |
  |  [3] MSB plane (transactions / settlement)                               |
  |      Peer -> MsbClient -> MSB validator network                          |
  |                                                                         |
  |  Agent control surface (preferred):                                     |
  |  SC-Bridge (WebSocket, auth required)                                   |
  |    JSON: auth, send, join, open, stats, info, ...                       |
  +------------------------------+------------------------------+-----------+
                                 |                              |
                                 | SC-Bridge (ws://host:port)   | P2P (Hyperswarm)
                                 v                              v
                       +-----------------+            +-----------------------+
                       | Agent / tooling |            | Other peers (P2P)     |
                       | (no TTY needed) |<---------->| subnet + sidechannels |
                       +-----------------+            +-----------------------+

  Optional for local testing:
  - --dht-bootstrap "<host:port,host:port>" overrides the peer's HyperDHT bootstraps
    (all peers that should discover each other must use the same list).
```

---
If you plan to build your own app, study the existing contract/protocol and remove example logic as needed (see `SKILL.md`).

## Competition App: InterSplit (P2P Expense Splitter)
InterSplit is a sidechannel-native shared expense ledger for teams, friends, and co-travelers.

What it does:
- Tracks shared expenses in any sidechannel room.
- Computes per-member balances (who owes vs who should receive).
- Produces a minimal settlement plan (debtor -> creditor payments).
- Syncs entries peer-to-peer over Intercom sidechannels (no central server).
- Persists room snapshots into contract state for recovery after restarts.
- Exports settlement plans in one shot (`text`, `json`, or `csv`).

Terminal commands:
- `/expense_add --channel "<name>" --payer "<name>" --amount "<n>" --split "a,b,c" [--note "<text>"]`
- `/expense_list --channel "<name>"`
- `/expense_balance --channel "<name>"`
- `/expense_clear --channel "<name>"`
- `/expense_persist --channel "<name>" [--sim 1]`
- `/expense_restore --channel "<name>" [--confirmed 1|0] [--replace 1]`
- `/expense_export --channel "<name>" [--format text|json|csv]`

SC-Bridge JSON commands:
- `expense_add` with `channel`, `payer`, `amount`, `split`, optional `note`
- `expense_list` with `channel`
- `expense_balance` with `channel`
- `expense_clear` with `channel`
- `expense_persist` with `channel`, optional `sim`
- `expense_restore` with `channel`, optional `confirmed`, `replace`
- `expense_export` with `channel`, optional `format`

Web frontend (no terminal command entry needed):
1. Start Intercom with SC-Bridge enabled:
   - `pear run . --peer-store-name demo --msb-store-name demo-msb --subnet-channel intersplit-demo --sidechannels trip-nyc --sc-bridge 1 --sc-bridge-token YOUR_TOKEN`
2. Start UI server:
   - `npm run ui`
3. Open:
   - `http://127.0.0.1:5070`
4. In the UI:
   - Enter WS URL (`ws://127.0.0.1:49222`), token, and channel.
   - Click `Connect`, then `Join`, then use Chat/Expense controls.
   - `Persist` can take 10-60s depending on validator/network latency.
   - `Restore` in UI reads local node view first (`confirmed=0`) for faster feedback.
   - `Local node view` means files under `stores/<peer-store-name>/...` on your machine, not browser localStorage.
   - Assistant prompt accepts simple commands like:
     - `add alice 30 split alice,bob note dinner`
     - `balance`
     - `persist`
   - `restore`
   - `export text`

Frontend tutorial (end-to-end):
1. Start Intercom backend in terminal A:
```powershell
cd C:\Users\user\Documents\Emma\intercom
$env:PATH="$env:APPDATA\npm;$env:APPDATA\pear\bin;$env:PATH"
pear run . --peer-store-name demo2 --msb-store-name demo2-msb --subnet-channel intersplit-demo --sidechannels trip-nyc --sc-bridge 1 --sc-bridge-token mysecret123
```
2. Start frontend server in terminal B:
```powershell
cd C:\Users\user\Documents\Emma\intercom
npm run ui
```
3. Open browser at `http://127.0.0.1:5070`.
4. In the UI Connection card:
   - WS URL: `ws://127.0.0.1:49222`
   - Token: `mysecret123` (or your chosen token)
   - Channel: `trip-nyc`
   - Click `Connect`, `Join`, `Subscribe`.
5. In the UI, add expense records:
   - Form mode: fill payer/amount/split/note and click `Add Expense`.
   - Assistant mode: `add alice 30 split alice,bob note dinner`
6. Click `Balance` and verify expected output:
   - `alice: +15.00`
   - `bob: -15.00`
   - settlement `bob -> alice: 15.00`
7. Click `Persist` once and wait until a tx hash appears in Live Feed.
8. Click `Export Text` to generate a copyable settlement summary.
9. Optional restart proof:
   - Stop peer with `/exit` in terminal A.
   - Start the same command again using the same store names (`demo2`, `demo2-msb`).
   - In UI click `Restore` then `Balance`.
   - Live Feed will show `source=contract` or `source=local`.

Optional two-peer chat verification:
1. Start peer A:
   - `--peer-store-name demoA --msb-store-name demoA-msb --sc-bridge-port 49222 --sc-bridge-token tokenA`
2. Start peer B:
   - `--peer-store-name demoB --msb-store-name demoB-msb --subnet-bootstrap <peer-writer-key-from-peer-A> --sc-bridge-port 49223 --sc-bridge-token tokenB`
3. Open two UI tabs:
   - Tab A -> `ws://127.0.0.1:49222` / `tokenA`
   - Tab B -> `ws://127.0.0.1:49223` / `tokenB`
4. Join + subscribe on both tabs to `trip-nyc`.
5. Send a chat message in Tab A; Tab B should receive `sidechannel_message`.

Contract persistence keys:
- `expense/room/<channel>` stores room snapshots (`events`) and update metadata.
- Local fallback snapshot file per peer store:
  - `stores/<peer-store-name>/expense-split.snapshots.json`
  - UI/CLI restore falls back to this local file if contract state is not yet confirmed.

Quick 60-second demo:
1. Peer A and Peer B join the same sidechannel, e.g. `trip-nyc`.
2. Add two expenses:
   - `/expense_add --channel "trip-nyc" --payer "alice" --amount "30" --split "alice,bob" --note "dinner"`
   - `/expense_add --channel "trip-nyc" --payer "bob" --amount "10" --split "alice,bob" --note "snacks"`
3. View settlement:
   - `/expense_balance --channel "trip-nyc"`
4. Persist:
   - `/expense_persist --channel "trip-nyc"`
5. Export ready-to-share settlement:
   - `/expense_export --channel "trip-nyc" --format text`

## Trac Address (Payout)
- `trac1j8wqd88yhnssf74uzrpp5kvwmwdr6jnl42yxluldq893mjxvtf3s8hsyrq`
