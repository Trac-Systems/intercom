import WebSocket from 'ws';
import crypto from 'crypto';

const WS_URL = "ws://127.0.0.1:8788"; // <-- JOINER SC-BRIDGE
const TOKEN = "CHANGE_ME_TO_A_LONG_RANDOM_TOKEN";

const ASSET_ID = "tc:poke:base:charizard:psa10:12345678";
const CHANNEL = "asset:" + ASSET_ID;

const offerId = crypto.randomBytes(8).toString("hex");

const ws = new WebSocket(WS_URL);

ws.on("open", () => {
  console.log("Connected (joiner bridge)");
  ws.send(JSON.stringify({ type: "auth", token: TOKEN }));
});

ws.on("message", (data) => {
  const msg = JSON.parse(data.toString());
  console.log("Received:", msg);

  if (msg.type === "auth_ok") {
    ws.send(JSON.stringify({ type: "join", channel: CHANNEL }));
    return;
  }

  if (msg.type === "joined") {
    const event = {
      v: 1,
      assetId: ASSET_ID,
      type: "offer:create",
      ts: Date.now(),
      data: {
        offerId,
        seller: "demo-seller",
        shares: 100,
        price: "100",
        expiresAt: Date.now() + 3600000
      }
    };

    console.log("Sending offer:create event (from joiner)");

    ws.send(JSON.stringify({
      type: "send",
      channel: CHANNEL,
      message: event
    }));
  }
});
