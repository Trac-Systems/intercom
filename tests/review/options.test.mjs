import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import c from 'compact-encoding';
import Release from '../fixtures/sidechannel-0.0.11.js';
import Candidate from '../../features/sidechannel/managed.js';
import { channelPolicy, receiveEncoding } from '../../features/sidechannel/channel-options.js';
import { frame, peer, port, wallet } from '../helpers/sidechannel-wire.mjs';

const author = await wallet();
const reader = await wallet();

test('compact JSON byte limit includes each length prefix at both varint transitions', () => {
  for (const [jsonBytes, prefixBytes] of [[252, 1], [253, 3], [65535, 3], [65536, 5]]) {
    const payload = 'é' + 'x'.repeat(jsonBytes - 4);
    const encoded = c.encode(c.json, payload);
    assert.equal(encoded.byteLength, jsonBytes + prefixBytes);
    const offset = 7;
    const buffer = Buffer.concat([Buffer.alloc(offset), encoded, Buffer.alloc(5)]);
    function decode(limit) {
      const end = offset + encoded.byteLength;
      const state = { buffer, start: offset, end };
      const result = receiveEncoding(limit).decode(state);
      assert.equal(state.start, end);
      return result;
    }
    const accepted = decode(encoded.byteLength);
    assert.equal(accepted.payload, payload);
    assert.equal(accepted.bytes, encoded.byteLength);
    assert.equal(decode(encoded.byteLength - 1), null);
  }
});

test('both miners agree on the first v1 proof for ordinary Unicode and nested JSON', () => {
  const message = { z: [{ nonce: 10 }, 'é', null], a: 'line\n😀' };
  for (const bits of [4, 8, 12, 16]) {
    const release = peer(Release, author, { powEnabled: true, powDifficulty: bits }).sc;
    const candidate = peer(Candidate, reader, { channelOptions: { room: { powDifficulty: bits } } }).sc;
    const envelope = { id: 'sample', ts: 1700000000000, channel: 'room', from: 'author', origin: 'author', message };
    const oldFrame = { ...envelope };
    const newFrame = { ...envelope };
    release._attachPow(oldFrame);
    assert.equal(candidate._attachPow(newFrame), true);
    assert.deepEqual(c.encode(c.json, newFrame), c.encode(c.json, oldFrame));
    assert.ok(release._checkPow(newFrame, 'room'));
    assert.ok(candidate._checkPow(oldFrame, 'room'));
  }
});

test('the README inheritance rule allows per-KiB pricing with the global base', () => {
  const config = {
    powEnabled: true,
    powDifficulty: 3,
    channelOptions: { room: { powBitsPerKiB: 2 } }
  };
  const { sc } = peer(Candidate, author, config);
  assert.equal(sc._buildPayload('room', 'a'.repeat(1023)).pow.difficulty, 5);
});

test('a signed broadcast and a saved rebroadcast preserve content across ordinary authorized sessions', () => {
  const config = { channelOptions: { room: { verifySignature: true } } };
  const sender = peer(Candidate, author, config);
  const receiver = peer(Candidate, reader, config);
  const archive = peer(Candidate, reader, { ...config, relayTtl: 4 });
  const first = port(sender.sc);
  const incoming = port(receiver.sc);
  first.destination = incoming;
  assert.equal(sender.sc.broadcast('room', { items: [2, 3] }), true);
  const saved = receiver.delivered[0].payload;
  const outgoing = port(archive.sc);
  outgoing.destination = incoming;
  assert.equal(archive.sc.rebroadcast(saved), true);
  assert.deepEqual(frame(outgoing.sent[0]), { ...saved, ttl: 4 });
  assert.equal(receiver.delivered.length, 1);
});

test('rejoining a managed channel restores its inherited signed startup welcome', async t => {
  const key = author.publicKey.toString('hex');
  const payload = { channel: 'room', issuedAt: 123, ownerPubKey: key, text: 'hello', version: 1 };
  const welcome = { payload, sig: author.sign(Buffer.from(JSON.stringify(payload))).toString('hex') };
  const { sc, delivered } = peer(Candidate, reader, {
    welcomeRequired: true,
    ownerKeys: { room: key },
    welcomeByChannel: { room: welcome },
    channelOptions: { room: { verifySignature: true } }
  });
  await sc.start();
  t.after(() => sc.stop());
  assert.equal(sc.getWelcome('room'), welcome);
  assert.ok(await sc.removeChannel('room'));
  assert.ok(await sc.addChannel('room'));
  const sender = peer(Release, author);
  port(sender.sc).destination = port(sc);
  assert.ok(sender.sc.broadcast('room', 'first message after rejoin'));
  assert.deepEqual(delivered.map(d => d.payload.message), ['first message after rejoin']);
});

test('ordinary policy names and receive limits use UTF-8 and the documented upper bounds', () => {
  const atLimit = 'é'.repeat(128);
  assert.equal(channelPolicy(atLimit, { maxReceiveBytes: 1048576 }).maxReceiveBytes, 1048576);
  assert.throws(() => channelPolicy(atLimit + 'a', { maxReceiveBytes: 1024 }), RangeError);
  assert.throws(() => channelPolicy('room', { maxReceiveBytes: 1048577 }), RangeError);
});

test('restoring a startup policy on leave stays within the 256-policy budget', async t => {
  const channelOptions = Object.fromEntries(
    Array.from({ length: 256 }, (_, i) => ['group-' + i, { verifySignature: true }])
  );
  const { sc } = peer(Candidate, reader, { channels: [], channelOptions });
  await sc.start();
  t.after(() => sc.stop());
  assert.ok(await sc.addChannel('group-0', { verifySignature: false }));
  await sc.addChannel('seasonal', { verifySignature: true });
  assert.ok(await sc.removeChannel('group-0'));
  assert.equal(sc.channelPolicies.get('group-0')?.verifySignature, true);
  assert.ok(sc.channelPolicies.size <= 256, 'active policy count was ' + sc.channelPolicies.size);
});

test('the same author can sign nested application data with supported v1 key representations', () => {
  const sender = peer(Release, author).sc;
  const { sc, delivered } = peer(Candidate, reader, { channelOptions: { room: { verifySignature: true } } });
  const incoming = port(sc);
  const outgoing = port(sc);
  const forms = [author.publicKey.toString('hex').toUpperCase(), Buffer.from(author.publicKey).toJSON()];
  const message = { update: { fields: ['channel', 'from'], value: null } };
  for (const from of forms) {
    const payload = sender._buildPayload('room', message);
    payload.from = from;
    payload.origin = from;
    assert.ok(sender._attachSig(payload));
    incoming.inject(payload);
    incoming.inject(payload);
  }
  assert.deepEqual(delivered.map(event => event.payload.message), [message, message]);
  assert.equal(outgoing.sent.length, 2);
});

test('a managed service releases its swarm listener across stop and restart', async t => {
  async function listenerCounts(Type, config) {
    const { sc } = peer(Type, reader, config);
    const swarm = new EventEmitter();
    Object.assign(swarm, { connections: [], join() {}, flush() {} });
    sc.peer.swarm = swarm;
    const counts = [];
    for (let i = 0; i < 2; i++) {
      await sc.start();
      counts.push(swarm.listenerCount('connection'));
      await sc.stop();
      counts.push(swarm.listenerCount('connection'));
    }
    return counts;
  }
  const release = await listenerCounts(Release, {});
  const candidate = await listenerCounts(Candidate, { channelOptions: { room: { verifySignature: true } } });
  t.diagnostic(JSON.stringify({ release, candidate }));
  assert.deepEqual(candidate, [1, 0, 1, 0]);
});
