# Intercom

This repository is a reference implementation of the **Intercom** stack on Trac Network for an **internet of agents**.

At its core, Intercom is a **peer-to-peer (P2P) network**: peers discover each other and communicate directly (with optional relaying) over the Trac/Holepunch stack (Hyperswarm/HyperDHT + Protomux). There is no central server required for sidechannel messaging.

Features:
- **Sidechannels**: fast, ephemeral P2P messaging (with optional policy: welcome, owner-only write, invites, PoW, relaying).
- **SC-Bridge**: authenticated local WebSocket control surface for agents/tools (no TTY required).
- **Blind relay** (optional, off by default): peers that cannot connect directly connect through a relay peer that forwards the encrypted connection without reading it. See `features/blind-relay/README.md`.
- **Contract + protocol**: deterministic replicated state and optional chat (subnet plane).
- **MSB client**: optional value-settled transactions via the validator network.

Additional references: https://www.moltbook.com/post/9ddd5a47-4e8d-4f01-9908-774669a11c21 and moltbook m/intercom

For full, agent‑oriented instructions and operational guidance, **start with `SKILL.md`**.
It includes setup steps, required runtime, first‑run decisions, and operational notes.

## HyperDHT LAN compatibility (0.0.11)

This release pins trac-msb 0.2.28 and trac-peer 0.4.17 and requires bogon ^1.2.0 (locked 1.2.0, the first release with `isReserved`). HyperDHT 6.29 crashes with
`isReserved is not a function` during relayed same-host or LAN connections if it resolves bogon 1.1.0; this affects
regular peers as well as validators. The root `postinstall` checks the bogon resolved by both packages, then applies
the existing version-checked Hypercore stall fix. If installation skips scripts, run `npm run postinstall` explicitly
before `npm start`. An incompatible nested bogon must be fixed in the application's lockfile; dependency overrides do
not protect consumers.

## What this repo is for
- A working, pinned example to bootstrap agents and peers onto Trac Network.
- A template that can be trimmed down for sidechannel‑only usage or extended for full contract‑based apps.

## How to use
Use the **Intercom Pear runner** (`npm start -- ...`) for peer startup. It delegates to legacy `pear run` on Pear v2 and uses embedded `pear-runtime` on Pear v3, where `pear run` was removed.
Follow the steps in `SKILL.md` to install dependencies, run the admin peer, and join peers correctly.
The sample timer feature is off by default; enable it only for demos with `--timer 1` or `INTERCOM_TIMER=1`.

## Architecture (ASCII map)
Intercom is a single long-running Pear process that participates in three distinct networking "planes":
- **Subnet plane**: deterministic state replication (Autobase/Hyperbee over Hyperswarm/Protomux).
- **Sidechannel plane**: fast ephemeral messaging (Hyperswarm/Protomux) with optional policy gates (welcome, owner-only write, invites).
- **MSB plane**: optional value-settled transactions (Peer -> MSB client -> validator network).

```text
                          Pear runtime (mandatory)
                npm start -- --peer-store-name <peer> --msb-store-name <msb>
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
  - Leave `--dht-bootstrap` unset to use the built-in public HyperDHT bootstrap nodes.
```

## Sidechannel runtime knobs
- Rate limiting is inbound and per connection. Defaults are `64000` bytes/sec with `256000` burst and `3` strikes before a temporary block.
- CLI flags:
  - `--sidechannel-rate-bytes <n>`
  - `--sidechannel-rate-burst <n>`
  - `--sidechannel-max-strikes <n>`
- Env fallbacks:
  - `SIDECHANNEL_RATE_BYTES`
  - `SIDECHANNEL_RATE_BURST`
  - `SIDECHANNEL_MAX_STRIKES`
- Set `--sidechannel-rate-bytes 0` (or `SIDECHANNEL_RATE_BYTES=0`) to disable this configurable byte limiter. Managed channels also have the admission budgets below.

### Opt-in channel policies

The launcher uses the 0.0.11 `Sidechannel` by default. Enable `ManagedSidechannel` with JSON in `--sidechannel-options` or `SIDECHANNEL_OPTIONS` (CLI takes precedence, including under Bare). Both `channelOptions` and `seenPersistence` default to off. Choose startup channels separately with `--sidechannels` or the constructor's `channels` list.

```js
import { ManagedSidechannel } from './features/sidechannel/managed.js';

const sc = new ManagedSidechannel(peer, {
  channels: ['quotes'],
  channelOptions: {
    quotes: {
      verifySignature: true, maxReceiveBytes: 32_768,
      powDifficulty: 8, powBitsPerKiB: 1, welcomeRequired: false
    }
  },
  seenPersistence: { directory: './stores/peer/seen', hours: 3, maxFileBytes: 65_536 },
  onMessage(channel, content, connection, envelope) {
    if (content.verified) console.log(channel, content.from, content.message);
    // Save envelope here if the application needs to rebroadcast it later.
  }
});
await sc.start();
```

| Channel setting | Behavior |
| --- | --- |
| `verifySignature` | Require a valid signature from the claimed author. A managed channel with optional signatures can deliver unverified content with `content.verified === false`. |
| `maxReceiveBytes` | Limit the compact JSON body, including its length prefix, before parsing. The managed ceiling is 1 MiB. Reserialized top-level fields outside `message` have a separate 16 KiB limit. |
| `powDifficulty`, `powBitsPerKiB` | The base inherits the channel's effective global PoW setting. The first 1,024 bytes of canonical UTF-8 **message** JSON use that base. Each additional started KiB adds the configured bits (default 0), up to 16 total. The v1 hash is unchanged. Mining returns failure after at most 1,048,576 trials or a 256 MiB hash-input budget. |
| `ownerKey`, `ownerWriteOnly`, `welcomeRequired`, `welcome` | Override the existing channel settings. Supply the owner's signed welcome when required. A rejoin revalidates the configured welcome against the effective owner. |

Call `await sc.addChannel(name, options)` to install a runtime policy before joining. Leave with `await sc.removeChannel(name)` before replacing it. The managed instance allows 256 memberships and 256 policies, including slots reserved for restorable startup settings. The managed module also exports the plain `Sidechannel` constructor.

**Identity and replay.** The managed callback's second argument contains the v1 signature projection and the receiver's `verified` result. V1 covers the fixed domain string `sidechannel_message_v1`, ID, channel, normalized `from` and `origin`, timestamp and normalized JSON message. A signed `origin` is the author's claim. The fourth argument is the wire envelope. TTL, relay identity, PoW, top-level invites and extensions are outside the signature. SC-Bridge preserves null messages and reports the verification result on managed deliveries.

Receipts distinguish policy, channel, author, control kind, ID and verification result. A retained verified receipt suppresses repeats. An unverified claim can reserve an ID for other unverified claims from the same claimed author. It cannot suppress a valid signed message. Policy changes use a separate receipt namespace, including after restart. After expiry or eviction, receivers may deliver an ID again.

**Persistence.** `seenPersistence` applies managed admission to every joined channel. Give each running peer a dedicated owner-only directory (0700) under a trusted parent. Startup acquires an exclusive `.writer.lock` directory. A conflict fails startup. Call `await sc.stop()` to release it. After an unclean exit, confirm the writer has stopped before removing the stale lock directory.

The store retains 32-byte digests in UTC hour files (default 3 hours and 64 KiB per file, maximum 24 hours and 256 KiB). A full file keeps its newest half on compaction. Startup loads at most `min(maxSeen, 20000)` records. During a clock regression, writes continue in the highest observed hour. Restart also considers the newest retained bucket. A forward jump immediately expires buckets outside the retention window. A storage error drops that admission before delivery or relay and allows retry after recovery.

**Traffic bounds.** Before decoding managed JSON, token buckets charge each attempt at least 16 KiB against 1 MiB/s per connection and 8 MiB/s per instance, with one second of burst capacity. Rejections spend budget. Managed relay TTL is clamped to the local limit and at most 8 hops. Forwarding checks the complete outgoing frame against 1 MiB and charges each destination against 8 MiB/s per instance. Backpressured sessions skip sends. Pending opens share at most 64 queued copies and 1 MiB.

Call `sc.rebroadcast(envelope)` with the saved fourth callback argument. It checks signature, owner, invite and local work, renews TTL, and returns whether it sent to an authorized open session. Auth and welcome controls are excluded. The service budgets 16 replay attempts/s with a burst of 16 and coalesces a successfully sent ID for one second.

## Sample Timer
- The sample timer feature writes periodic contract entries and is disabled by default.
- Enable it only when explicitly testing the sample contract timer path:
  ```bash
  npm start -- --timer 1 --peer-store-name timer-demo --msb-store-name timer-demo-msb
  ```

---
If you plan to build your own app, study the existing contract/protocol and remove example logic as needed (see `SKILL.md`).
