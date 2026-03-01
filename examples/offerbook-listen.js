import WebSocket from 'ws';

// === CONFIG ===
const WS_URL = "ws://127.0.0.1:8787";
const TOKEN = "CHANGE_ME_TO_A_LONG_RANDOM_TOKEN";

const ASSET_ID = "tc:poke:base:charizard:psa10:12345678";
const CHANNEL = "asset:" + ASSET_ID;

// In-memory offer book
const offers = new Map();

function printOffers() {
  const list = Array.from(offers.values()).sort((a, b) => a.ts - b.ts);
  console.log("\n=== OFFER BOOK ===");
  if (list.length === 0) {
    console.log("(empty)");
    return;
  }
  for (const o of list) {
    const d = o.data || {};
    console.log(
      `offerId=${d.offerId} seller=${d.seller} shares=${d.shares} price=${d.price} expiresAt=${new Date(d.expiresAt).toISOString()}`
    );
    if (d.acceptedBy) {
      console.log(`  acceptedBy=${d.acceptedBy} acceptedAt=${new Date(d.acceptedAt).toISOString()}`);
    }
  }
}

const ws = new WebSocket(WS_URL);

ws.on("open", () => {
  console.log("Connected (offerbook listener)");
  ws.send(JSON.stringify({ type: "auth", token: TOKEN }));
});

ws.on("message", (data) => {
  const msg = JSON.parse(data.toString());

  if (msg.type === "auth_ok") {
    ws.send(JSON.stringify({ type: "join", channel: CHANNEL }));
    return;
  }

  if (msg.type === "joined") {
    console.log("Joined:", msg.channel);
    console.log("Listening for offer events...");
    printOffers();
    return;
  }

  // IMPORTANT:
  // SC-Bridge forwards sidechannel messages as:
  // { type:"sidechannel_message", channel, from, id, ts, message }
  if (msg.type === "sidechannel_message") {
    const event = msg.message;

    // Only handle our schema version + asset
    if (!event || event.v !== 1 || event.assetId !== ASSET_ID) return;

    if (event.type === "offer:create") {
      offers.set(event.data.offerId, event);
      console.log("\n[offer:create]", event.data.offerId);
      printOffers();
    }

    if (event.type === "offer:cancel") {
      offers.delete(event.data.offerId);
      console.log("\n[offer:cancel]", event.data.offerId);
      printOffers();
    }

    if (event.type === "offer:accept") {
      const existing = offers.get(event.data.offerId);
      if (existing) {
        existing.data.acceptedBy = event.data.buyer;
        existing.data.acceptedAt = event.ts;
        offers.set(event.data.offerId, existing);
      }
      console.log("\n[offer:accept]", event.data.offerId);
      printOffers();
    }
  }
});

ws.on("close", () => console.log("Disconnected"));
ws.on("error", (err) => console.error("Error:", err));
