import assert from 'node:assert/strict';
import { Duplex } from 'node:stream';
import test from 'node:test';
import Protomux from 'protomux';
import Old from './fixtures/sidechannel-0.0.11.js';
import Current from '../features/sidechannel/index.js';
import { wallet, peer, port } from './helpers/sidechannel-wire.mjs';

function streamPair() {
  const streams = [0, 1].map(i => new Duplex({
    objectMode: true,
    read() {},
    write(bytes, _encoding, done) {
      streams[1 - i].push(Buffer.from(bytes));
      done();
    }
  }));
  return streams;
}

test('real Protomux batch drops one oversize frame and delivers the next, both peer versions interoperate', async t => {
  const signer = await wallet();
  const legacy = peer(Old, signer, { powEnabled: true, powDifficulty: 3 });
  const current = peer(Current, signer, {
    channelOptions: { room: { maxReceiveBytes: 1024, verifySignature: true, powDifficulty: 3 } }
  });
  const streams = streamPair();
  t.after(() => { for (const stream of streams) stream.destroy(); });
  const muxes = streams.map(stream => Protomux.from(stream));
  const sessions = [legacy, current].map(({ sc }, i) => {
    const conn = { remotePublicKey: signer.publicKey, userData: muxes[i] };
    sc._openChannelForConnection(conn, sc.channels.get('room'));
    return sc.connections.get(conn).get('room');
  });
  assert.deepEqual(await Promise.all(sessions.map(r => r.channel.fullyOpened())), [true, true]);
  const relay = port(current.sc);
  const accepted = legacy.sc._buildPayload('room', 'fits');
  muxes[0].cork();
  sessions[0].message.send(legacy.sc._buildPayload('room', 'X'.repeat(1536)));
  sessions[0].message.send(accepted);
  sessions[0].message.send(accepted);
  muxes[0].uncork();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(current.delivered.map(d => d.payload.message), ['fits']);
  assert.equal(relay.sent.length, 1);
  assert.ok(current.sc.broadcast('room', 'reply'));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(legacy.delivered.map(d => d.payload.message), ['reply']);
});
