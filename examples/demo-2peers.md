# Demo: Run 2 Peers (Admin + Joiner)

This demo proves that your Intercom fork runs correctly and that peers can connect to the same subnet.

You will:

- start one admin peer
- copy its writer key
- start one joiner peer

This is the foundation for fractional asset ownership later.

---

# Requirements

You must do this later on your local computer, not on GitHub.

Install Node.js 22 or newer.

Install Pear runtime:

```bash
npm install -g pear
pear -v
