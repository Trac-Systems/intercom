import assert from 'node:assert/strict';
import fs from 'node:fs';
import c from 'compact-encoding';
import { Duplex } from 'node:stream';
import test from 'node:test';
import Protomux from 'protomux';
import Old from './fixtures/sidechannel-0.0.11.js';
import Current from '../features/sidechannel/managed.js';
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

test('a failed receipt append leaves another protocol on the same mux usable', async t => {
  const signer = await wallet();
  const directory = fs.mkdtempSync('./.seen-test-');
  const sender = peer(Old, signer);
  const receiver = peer(Current, signer, { seenPersistence: { directory } });
  const streams = streamPair();
  t.after(async () => {
    await receiver.sc.stop();
    for (const stream of streams) stream.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const muxes = streams.map(stream => Protomux.from(stream));
  const sessions = [sender.sc, receiver.sc].map((sc, i) => {
    const connection = { remotePublicKey: signer.publicKey, userData: muxes[i] };
    sc._openChannelForConnection(connection, sc.channels.get('room'));
    return sc.connections.get(connection).get('room');
  });
  const other = muxes.map(mux => mux.createChannel({ protocol: 'test-status' }));
  const received = [];
  const status = other.map(ch => ch.addMessage({ encoding: c.string, onmessage: value => received.push(value) }));
  other.forEach(ch => ch.open());
  assert.ok((await Promise.all([...sessions.map(s => s.channel), ...other].map(ch => ch.fullyOpened()))).every(Boolean));
  const fault = t.mock.method(receiver.sc.protectedSeen.files, 'append', () => { throw new Error('offline storage'); });
  const payload = sender.sc._buildPayload('room', 'sample');
  sessions[0].message.send(payload);
  status[0].send('ready');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(receiver.delivered.length, 0);
  assert.deepEqual(received, ['ready']);
  fault.mock.restore();
  sessions[0].message.send(payload);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(receiver.delivered.length, 1);
});
