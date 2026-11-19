import c from 'compact-encoding';
import PeerWallet from 'trac-wallet';

export async function wallet() {
  const result = new PeerWallet({});
  await result.ready;
  await result.generateKeyPair();
  return result;
}

export function peer(Type, signer, config = {}) {
  const delivered = [];
  const swarm = { join() {}, leave() {}, flush() {}, on() {}, connections: [] };
  const sc = new Type({ wallet: signer, swarm }, {
    channels: ['room'], welcomeRequired: false, rateBytesPerSecond: 0,
    onMessage(channel, content, connection, envelope) { delivered.push({ channel, payload: envelope ?? content }); },
    ...config
  });
  return { sc, delivered };
}

// Exchange actual compact-encoding message bodies at the Protomux codec boundary.
export function port(sc, name = 'room', remoteKey = sc.peer.wallet?.publicKey) {
  const sent = [];
  const wire = {
    sent,
    receive(bytes) {
      const decoded = c.decode(wire.encoding, bytes);
      wire.onmessage(decoded);
    },
    inject(payload) { wire.receive(c.encode(c.json, payload)); }
  };
  const session = {
    opened: true,
    open() {},
    close() { this.opened = false; },
    fullyOpened() { return Promise.resolve(this.opened); },
    addMessage({ encoding, onmessage }) {
      Object.assign(wire, { encoding, onmessage });
      return { send(payload) {
        const bytes = c.encode(encoding, payload);
        sent.push(bytes);
        wire.destination?.receive(bytes);
      } };
    }
  };
  const connection = { remotePublicKey: remoteKey, userData: { createChannel: () => session, pair() {} } };
  sc._openChannelForConnection(connection, sc.channels.get(name));
  return wire;
}

export function frame(bytes) { return c.decode(c.json, bytes); }
