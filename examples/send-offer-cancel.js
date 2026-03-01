import WebSocket from 'ws';

const WS_URL = "ws://127.0.0.1:8788"; // joiner bridge
const TOKEN = "CHANGE_ME_TO_A_LONG_RANDOM_TOKEN";

const ASSET_ID = "tc:poke:base:charizard:psa10:12345678";
const CHANNEL = "asset:" + ASSET_ID;

// USAGE:
//   node examples/send-offer-cancel.js <offerId>
const offerId = process.argv[2];

if (!offerId) {
  console.error("Usage: node examples/send-offer-cancel.js <offerId>");
  process.exit(1);
}

const ws = new WebSocket(WS_URL);

ws.on("open", () => {
  ws.send(JSON.stringify({ type: "auth", token: TOKEN }));
});

ws.on("message", (data) => {
  const msg = JSON.parse(data.toString());

  if (msg.type === "auth_ok") {
    ws.send(JSON.stringify({ type: "join", channel: CHANNEL }));
    return;
  }

  if (msg.type === "joined") {
    const event = {
      v: 1,
      assetId: ASSET_ID,
      type: "offer:cancel",
      ts: Date.now(),
      data: {
        offerId,
        seller: "demo-seller"
      }
    };

    console.log("Sending offer:cancel", offerId);

    ws.send(JSON.stringify({
      type: "send",
      channel: CHANNEL,
      message: event
    }));

    // exit shortly after
    setTimeout(() => process.exit(0), 500);
  }
});
