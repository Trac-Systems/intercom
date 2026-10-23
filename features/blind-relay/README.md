# Blind relay (optional)

Two peers behind home routers or mobile networks often cannot connect to each other directly. This Feature lets
them connect through a relay peer instead. The relay forwards end-to-end encrypted Noise traffic and cannot read it.
It carries the existing subnet replication and sidechannel protocols, uses the peer's existing swarm and leaves
trac-peer unchanged. It is off unless one of the flags below is given.

## Turning it on

```text
relay peer:   npm start -- ... --blind-relay-serve 1
client peers: npm start -- ... --blind-relay <relay-peer-pubkey-hex>,<backup-relay-pubkey-hex>
```

Use the relay's printed `Peer pubkey (hex)`, not its subnet bootstrap or writer key. Give the same relay list to
both peers of a connection: a peer accepts a relayed connection only through a relay on its own list. A peer can serve
and use relays at the same time. The environment variables `BLIND_RELAY` and `BLIND_RELAY_SERVE` work as fallbacks.

A relay should run on a machine with a public address. Give it its own subnet and sidechannels when it only relays:
forwarding encrypted links is separate from taking part in an application's channels. This Feature does not
configure or relay the MSB swarm.

## How connections use it

Normal Hyperswarm topic discovery and `joinPeer()` both use the fallback. A peer first tries a direct connection for
8 seconds, then a relay for 20 seconds, then the next relay. Each destination starts at a random relay of the list,
so peers spread over the relays, and after all relays were tried it tries direct again. Normal Hyperswarm backoff
stays in charge. Keepalives and a receive-silence deadline notice a relay that went away; the connection is then
re-established, so applications should retry ephemeral messages. Autobase resumes durable replication on the new
connection.

## Limits on a relay

| Flag | Default | Meaning |
| --- | --- | --- |
| `--blind-relay-max-clients` | 1024 | Client connections a relay accepts |
| `--blind-relay-max-sessions` | 512 | Relayed pairs at once |
| `--blind-relay-max-sessions-per-peer` | 64 | Connections and pairs per client peer |
| `--blind-relay-max-pending` | 1024 | Pairings waiting for their second side |
| `--blind-relay-rate-bytes-per-second` | 8388608 | Forwarded bytes per second, all links together |
| `--blind-relay-rate-burst-bytes` | 16777216 | Burst allowance for the rate above |
| `--blind-relay-idle-timeout-ms` | 120000 | A link without traffic for this long is closed |
| `--blind-relay-direct-timeout-ms` | 8000 | How long a client tries direct before a relay |
| `--blind-relay-relay-timeout-ms` | 20000 | How long a client tries one relay |

A pairing over a limit is ignored, so only that one attempt fails and moves on to the next relay; the peer's other
relayed connections stay up. Rate limiting closes sessions after a sampled overrun of the shared budget; it is not
packet shaping.

## Status

Authenticated SC-Bridge `stats` include `blindRelay`, and `info` includes `info.blindRelay`: the configured relays,
whether this peer serves, its limits and counters (`direct_failures`, `relay_attempts`, `relay_connections`,
`sessions_rejected`, `pairs_rejected`, `pairs_relayed`, `rate_limited`, `idle_closed`). The startup log prints whether
it serves and how many relays it uses.

## In your own code

```js
import BlindRelay from './features/blind-relay/index.js';

const relay = new BlindRelay(peer, { serve: true, relays: [] });
await relay.start();   // after the peer's swarm is ready
peer.blindRelay = relay;
relay.setRelays(['<relay-pubkey-hex>']);   // replace the dynamic list at runtime; static `relays` stay
// ... peer runs ...
await relay.stop();    // before destroying the swarm
```

The adapter depends on blind-relay 1.6.1's pair and unpair handlers and link lifecycle, HyperDHT 6.29.6's inbound
relay hook and Hyperswarm's retry fields; `package.json` pins both. Rerun `tests/blind-relay-*.test.mjs` after
upgrading them. Those tests start a local HyperDHT testnet and need no public network.
