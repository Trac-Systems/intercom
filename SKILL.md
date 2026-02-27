# SKILL — DegenOracle (Degen Horoscope Bot)

## What this app does

DegenOracle is a P2P daily crypto horoscope generator built on Intercom (Trac Network).  
It takes a Trac wallet address and today's date, hashes them together, and deterministically generates a personalized "degen horoscope" reading — covering market outlook, lucky token, risk level, and a one-liner cosmic tip.

Readings are broadcast over Intercom sidechannels and stored in the shared contract state so peers can read each other's daily vibes.

---

## Runtime requirement

**Always use Pear runtime. Never native node.**

```bash
pear run --tmp-store --no-pre . \
  --peer-store-name admin \
  --msb-store-name admin-msb \
  --subnet-channel degen-oracle-v1
```

---

## Install

```bash
git clone https://github.com/danFabCode/intercom
cd intercom-degen-oracle
npm install
npm pkg set overrides.trac-wallet=1.0.1
rm -rf node_modules package-lock.json
npm install
```

---

## Commands

### `horoscope_get`
Generate your daily horoscope from your Trac address.  
Deterministic: same address + same date = same reading every time.

```json
{ "op": "horoscope_get", "address": "trac1youraddresshere" }
```

**Response fields:**
- `sign` — Your degen zodiac sign (e.g. "Bullish Scorpio", "Bearish Crab")
- `outlook` — Market outlook for today: `bullish`, `bearish`, or `crab`
- `risk_level` — `low`, `medium`, `degen`, or `ape`
- `lucky_token` — A token ticker to watch today
- `tip` — One-liner cosmic advice
- `reading` — Full paragraph horoscope text

---

### `horoscope_broadcast`
Broadcast your daily reading to all peers on the sidechannel and store it in shared contract state.

```json
{ "op": "horoscope_broadcast", "address": "trac1youraddresshere" }
```

---

### `horoscope_feed`
List today's broadcasted readings from the community. Stored in replicated contract state.

```json
{ "op": "horoscope_feed", "limit": 10 }
```

**Response:** Array of `{ address_short, sign, outlook, tip, timestamp }`

---

### `lucky_token`
Quick lookup — just get today's lucky token for an address.

```json
{ "op": "lucky_token", "address": "trac1youraddresshere" }
```

---

## How the horoscope is generated

1. Concatenate: `address + YYYY-MM-DD (UTC)`
2. SHA-256 hash the string
3. Use specific byte ranges from the hash to deterministically pick:
   - Degen zodiac sign (12 signs)
   - Market outlook (3 options)
   - Risk level (4 options)
   - Lucky token (from a pool of 20 crypto tickers)
   - Tip + full reading template (from pools of ~30 each)
4. Result is the same for the same address on the same UTC day — resets at UTC midnight

---

## Contract state keys

- `horoscope:feed:{YYYY-MM-DD}` — Array of today's broadcasted readings
- `horoscope:last:{address_short}` — Last broadcast from a given address

---

## Sidechannel events

- `horoscope_broadcast` — emitted when a peer broadcasts their reading
- `horoscope_request` — peer requests another peer's reading

---

## Agent tips

- Call `horoscope_get` first to preview before broadcasting
- Call `horoscope_feed` after joining to see what the network is vibing today
- The `risk_level: "ape"` reading means the stars say go all in — but that's on you
