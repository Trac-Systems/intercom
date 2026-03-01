# Message Schema (Sidechannel) — Trading Card Assets

This project uses Intercom sidechannels for real-time coordination.

All sidechannel messages must be JSON objects with this structure:

```json
{
  "v": 1,
  "assetId": "tc:poke:base:charizard:psa10:12345678",
  "type": "offer:create",
  "ts": 0,
  "data": {}
}
