# Fractional Trading Cards (RWA) on Intercom

This is an experimental project exploring **fractional ownership** using **Intercom**.

Trading cards are the initial focus because they already sit at the intersection of **physical assets** and **digital ownership**. Their ongoing digitalization and active trading culture make them a natural starting point for testing decentralized, fractional ownership models.

This repo is a fork-based exploration built on Intercom’s peer-to-peer stack: direct communication, deterministic shared state (contracts), and optional value settlement — without relying on a central platform.

## What this aims to build (MVP)

**Each trading card becomes its own peer-to-peer asset network:**
- A dedicated **P2P channel** for real-time coordination between holders
- A replicated **ownership state** (shares / cap table) maintained by a contract
- A simple **offer/accept** flow for peer-to-peer share transfers
- Optional settlement later (crypto payments), once the core ownership model is proven

## Why Intercom

Intercom provides:
- **Sidechannels**: fast P2P messaging for coordination
- **Subnet contracts**: deterministic replicated state for ownership
- **SC-Bridge**: a local authenticated WebSocket interface for apps/agents (no TTY required)
- Optional **settlement** for value transfer

## Status

Experimental — research & prototype phase.

## Based on

Intercom by Trac Systems: https://github.com/Trac-Systems/intercom
