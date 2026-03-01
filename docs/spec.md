# Spec: Fractional Trading Card Ownership (Intercom)

This document defines the minimal specification for fractional ownership of trading cards on top of Intercom.

It is intentionally simple and designed to be implemented step-by-step.

---

## 1) Core Idea

A **trading card** is treated as a **real-world asset (RWA)** with:

- an **Asset ID** (deterministic identifier)
- a **Share Supply** (fixed total shares)
- an **Ownership Table** (who owns how many shares)
- an optional **Offer Book** (peer-to-peer share transfer offers)

**Intercom mapping**
- **Sidechannels**: coordination + announcements + offers broadcast
- **Contracts/Subnet**: ownership truth (replicated, deterministic state)
- **SC-Bridge**: app/API control surface (WebSocket)

---

## 2) Asset ID (AssetID)

### 2.1 Format (human-readable)
AssetIDs use a colon-separated namespace:

`tc:<brand>:<series>:<card>:<grade>:<cert>`

Examples:
- `tc:poke:base:charizard:psa10:12345678`
- `tc:mtg:alpha:blacklotus:bgs95:000001`
- `tc:sports:nba:lebron-rookie:psa9:99887766`

### 2.2 Rules
- All lowercase
- Use `-` for spaces
- Must be unique per physical item (certificate/serial should ensure uniqueness)

---

## 3) Shares & Ownership Model

### 3.1 Supply
Each asset has a fixed share supply:

- `totalShares` (integer, e.g. 10_000)
- `decimals` (optional later; MVP assumes integer shares)

Default MVP:
- `totalShares = 10_000`
- Minimum trade size: `1` share

### 3.2 Ownership Table
Ownership is tracked as:

`holders[addressOrPubKey] -> shares`

Constraints:
- `sum(holders[*]) == totalShares`
- shares are non-negative integers
- transfers must not create or destroy shares (no mint/burn in MVP)

### 3.3 Roles (MVP)
- **Issuer**: initial creator of an asset (creates supply + initial allocation)
- **Holder**: owns shares, can transfer shares
- **Observer**: can read coordination messages (depending on channel policy)

---

## 4) Offer & Transfer (MVP)

This MVP supports a minimal peer-to-peer offer flow.

### 4.1 Offer structure
An offer represents: “I will sell X shares for price P”.

Fields:
- `offerId` (unique string)
- `assetId`
- `seller`
- `shares`
- `price` (string; unit is defined by the app; may be “offchain” in MVP)
- `expiresAt` (unix ms)
- `createdAt` (unix ms)

### 4.2 Offer rules
- Only a seller who currently owns `>= shares` may create an offer
- Offers expire automatically after `expiresAt`
- Offers can be cancelled by the seller

### 4.3 Accept rules
- Accepting an offer transfers shares:
  - `seller -= shares`
  - `buyer += shares`
- Settlement/payment is **out of scope** for the first MVP.
  - The first version only proves ownership transitions + replication.

---

## 5) Channel Naming (Sidechannels)

Each asset gets a dedicated coordination channel.

MVP naming:
- `asset:<assetId>`

Example:
- `asset:tc:poke:base:charizard:psa10:12345678`

Notes:
- Later we may switch to hashed channel names for length/compatibility.
- Entry/rendezvous can remain `0000intercom` for discovery.

---

## 6) Minimal Commands (Planned)

These are the minimal operations the contract/protocol will expose:

### Asset
- `createAsset(assetId, totalShares, initialOwner)`
- `getAsset(assetId)`

### Ownership
- `transferShares(assetId, to, shares)`

### Offers
- `createOffer(assetId, shares, price, expiresAt)`
- `cancelOffer(offerId)`
- `acceptOffer(offerId)`

---

## 7) Non-goals (for now)

Explicitly out of scope for MVP:
- fiat/crypto payments (settlement)
- custody / vault logistics / legal ownership enforcement
- disputes, arbitration
- fractional redemption / buyout
- pricing or oracle integrations

---

## 8) Disclaimer

This is an experimental prototype specification.
It does not constitute legal ownership, custody guarantees, or financial advice.
