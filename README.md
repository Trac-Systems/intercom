# 🔮 Degen Horoscope Bot — Intercom App

**DegenOracle** is a P2P daily horoscope bot for the Trac Network built on Intercom.  
Enter your Trac wallet address and receive a deterministic daily crypto "horoscope" — your cosmic market reading for the day. Readings are broadcast over Intercom sidechannels so the whole network can see the vibes. A shared community feed stores today's top readings in the replicated state layer.

> *"The stars don't lie. Your portfolio might."*

---

## Trac Address (for payouts)

`trac18js59cjgh7lqnmf0g9yd44kyucpua55lf33lpjvpcqw4ljgew8tswzaj3k`

---

## Features

- 🔮 **Daily horoscope** generated deterministically from your Trac wallet address + today's date — same wallet = same reading each day
- 📡 **Broadcast** your reading to all peers on the Intercom sidechannel
- 📜 **Community feed** — view today's readings from all peers stored in shared contract state
- ⚡ Runs entirely P2P — no servers, no APIs, no tracking

---

## Proof

See `proof/` folder for screenshots of the app running.

---

## Quick Start

> Requires [Pear runtime](https://docs.pears.com). Never use native node.

```bash
git clone https://github.com/danFabCode/intercom
cd intercom-degen-oracle
npm install
npm pkg set overrides.trac-wallet=1.0.1
rm -rf node_modules package-lock.json
npm install
pear run --tmp-store --no-pre . --peer-store-name admin --msb-store-name admin-msb --subnet-channel degen-oracle-v1
```

---

## Usage

**Get your daily horoscope:**
```
/tx --command '{ "op": "horoscope_get", "address": "trac1youraddresshere" }'
```

**Broadcast your reading to the network:**
```
/tx --command '{ "op": "horoscope_broadcast", "address": "trac1youraddresshere" }'
```

**View today's community feed (latest 10 readings):**
```
/tx --command '{ "op": "horoscope_feed", "limit": 10 }'
```

**Check your lucky token for today:**
```
/tx --command '{ "op": "lucky_token", "address": "trac1youraddresshere" }'
```

---

## Competition Links

- Fork: https://github.com/danFabCode/intercom
- Main repo: https://github.com/Trac-Systems/intercom
- Awesome Intercom: https://github.com/Trac-Systems/awesome-intercom

---

## Notes

- Full setup and agent instructions in `SKILL.md`
- Readings reset daily at UTC midnight
- All state is stored in Intercom's replicated contract layer — fully decentralized
