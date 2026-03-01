# Architecture: Fractional Trading Cards on Intercom

This document explains how fractional ownership of trading cards is implemented using Intercom.

The system maps each real-world card to its own peer-to-peer coordination environment.

---

# Overview

Each trading card becomes its own distributed asset system.

There are three main layers:

1. Sidechannel (communication layer)
2. Contract / Subnet (ownership state layer)
3. App / SC-Bridge (user interface layer)

---

# Layer 1: Sidechannel

Purpose:

Real-time coordination between participants.

Each card has its own channel:

asset:<assetId>

Example:

asset:tc:poke:base:charizard:psa10:12345678

Sidechannel is used for:

- announcing offers
- coordination
- messaging
- governance (later)

No ownership is stored here.

---

# Layer 2: Contract / Subnet

Purpose:

This is the source of truth.

The contract stores:

- totalShares
- holders
- ownership changes

This state is:

- deterministic
- replicated across peers
- serverless

Every peer has the same ownership state.

---

# Layer 3: App / SC-Bridge

Purpose:

Interface between user and Intercom network.

The app connects via SC-Bridge.

The app allows users to:

- view assets
- transfer shares
- create offers
- accept offers

Users do not interact with Intercom directly.

The app handles this.

---

# Flow Example

1. Asset created
2. Channel created
3. Ownership defined
4. User creates offer
5. Another user accepts offer
6. Ownership updates
7. State replicates to all peers

---

# Diagram

User App
   ↓
SC-Bridge
   ↓
Intercom Peer
   ↓
Contract State (ownership)
   ↓
Sidechannel (coordination)

---

# Summary

Intercom provides the network.

Contracts provide ownership truth.

Sidechannels provide coordination.

Apps provide usability.

This creates peer-to-peer fractional ownership.
