import test from 'node:test';
import assert from 'node:assert/strict';
import c from 'compact-encoding';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Old from './fixtures/sidechannel-0.0.11.js';
import Current from '../features/sidechannel/index.js';
import { wallet, peer, port, frame } from './helpers/sidechannel-wire.mjs';

const alice = await wallet();
const bob = await wallet();
const author = peer(Old, alice).sc;
const opts = room => ({ channelOptions: { room } });

test('per-channel signatures authenticate the author across relays and protect the accepted id', () => {
  const { sc, delivered } = peer(Current, bob, { channels: ['room', 'other'], ...opts({ verifySignature: true }) });
  const incoming = port(sc);
  const relay = port(sc);
  const other = port(sc, 'other');
  const payload = author._buildPayload('room', { text: '🐊' });
  for (const invalid of [
    { ...payload, sig: undefined }, { ...payload, sig: '01' },
    { ...payload, from: bob.publicKey.toString('hex') }, { ...payload, message: 'different' },
    author._buildPayload('other', 'wrong channel')
  ]) incoming.inject(invalid);
  assert.deepEqual([delivered.length, relay.sent.length], [0, 0]);
  other.inject({ ...payload, channel: 'other', sig: undefined });
  incoming.inject(payload);
  incoming.inject(payload);
  assert.deepEqual(delivered.map(d => d.channel), ['other', 'room']);
  assert.equal(relay.sent.length, 1);
  assert.equal(frame(relay.sent[0]).sig, payload.sig);
});

test('receive ceiling uses exact compact frame length before decode, accepts the boundary', () => {
  const payload = author._buildPayload('room', 'utf8 🐊');
  const bytes = c.encode(c.json, payload);
  const { sc, delivered } = peer(Current, bob, opts({ maxReceiveBytes: bytes.length }));
  const incoming = port(sc);
  const relay = port(sc);
  // Whitespace is part of the wire frame, even though JSON.stringify would discard it.
  incoming.receive(c.encode(c.string, ' ' + JSON.stringify(payload)));
  incoming.receive(c.encode(c.string, ' '.repeat(bytes.length) + 'invalid-json'));
  assert.deepEqual([delivered.length, relay.sent.length], [0, 0]);
  incoming.receive(bytes);
  assert.deepEqual([delivered.length, relay.sent.length], [1, 1]);
});

test('selected channels check duplicate, signature and PoW before remembering, delivery and relay', () => {
  const events = [];
  const { sc } = peer(Current, bob, { ...opts({ verifySignature: true, powDifficulty: 5 }),
    onMessage() { events.push('deliver'); } });
  const incoming = port(sc);
  const relay = port(sc);
  for (const [method, label] of [['_verifySig', 'signature'], ['_checkPow', 'pow'], ['_relay', 'relay']]) {
    const original = sc[method].bind(sc);
    sc[method] = (...args) => { events.push(label); return original(...args); };
  }
  const sender = peer(Old, alice, { powEnabled: true, powDifficulty: 5 }).sc;
  const payload = sender._buildPayload('room', 'from old');
  incoming.inject({ ...payload, sig: undefined });
  assert.ok(!events.includes('pow'));
  events.length = 0;
  incoming.inject({ ...payload, pow: undefined });
  assert.deepEqual(events, ['signature', 'pow']);
  events.length = 0;
  incoming.inject(payload);
  incoming.inject(payload);
  assert.deepEqual(events, ['signature', 'pow', 'deliver', 'relay']);
  assert.equal(relay.sent.length, 1);
});

test('configured PoW matches the legacy first nonce, encoding and verifier both ways', () => {
  const old = peer(Old, alice, { powEnabled: true, powDifficulty: 7 }).sc;
  const { sc: current, delivered } = peer(Current, bob, opts({ powDifficulty: 7 }));
  const incoming = port(current);
  const relay = port(current);
  const payload = old._buildPayload('room', { msg: '🍋', nested: { nonce: 0, origin: 'é' } });
  const candidate = { ...payload };
  delete candidate.pow;
  current._attachPow(candidate);
  assert.deepEqual(candidate.pow, payload.pow);
  assert.deepEqual(c.encode(c.json, { ...payload, pow: candidate.pow }), c.encode(c.json, payload));
  assert.equal(old._checkPow(candidate, 'room'), true);
  incoming.inject(payload);
  const outgoing = port(current);
  const legacy = peer(Old, alice, { powEnabled: true, powDifficulty: 7 });
  outgoing.destination = port(legacy.sc);
  assert.equal(current.broadcast('room', ['new → old', { nonce: 123 }]), true);
  assert.equal(legacy.delivered.length, 1);
  assert.equal(delivered.length, 1);
  assert.equal(relay.sent.length, 2);
});

test('PoW prices additional started KiB of canonical UTF-8 message bytes and checks actual work', () => {
  const config = opts({ powDifficulty: 3, powBitsPerKiB: 2 });
  const { sc: sender } = peer(Current, alice, config);
  const { sc, delivered } = peer(Current, bob, config);
  const incoming = port(sc);
  const relay = port(sc);
  for (const [message, bits] of [['x'.repeat(1022), 3], ['é'.repeat(512), 5], ['🐊'.repeat(512), 7]]) {
    const payload = sender._buildPayload('room', message);
    assert.equal(payload.pow.difficulty, bits);
    let nonce = 0;
    while (crypto.createHash('sha256').update(author._powBase(payload, nonce)).digest()[0] < 128) nonce++;
    incoming.inject({ ...payload, pow: { nonce, difficulty: bits + 1 } });
    incoming.inject(payload);
  }
  assert.deepEqual([delivered.length, relay.sent.length], [3, 3]);
});

test('bounded persistent hashes survive restart, rotate by hour and exclude rejected ids', async t => {
  const directory = fs.mkdtempSync(path.join(process.cwd(), '.seen-test-'));
  t.after(() => fs.rmSync(directory, { force: true, recursive: true }));
  let now = 1_700_000_000_000;
  const config = { ...opts({ verifySignature: true }), maxSeen: 2, seenPersistence: { directory, hours: 2, maxFileBytes: 64 } };
  async function session() {
    const { sc, delivered } = peer(Current, bob, config);
    sc._now = () => now;
    await sc.start();
    return { sc, delivered, incoming: port(sc), relay: port(sc) };
  }
  const payloads = Array.from({ length: 5 }, (_, i) => author._buildPayload('room', 'persistent-' + i));
  const first = await session();
  first.incoming.inject({ ...payloads[3], message: 'invalid' });
  for (const p of payloads.slice(0, 3)) first.incoming.inject(p);
  assert.equal(first.relay.sent.length, 3);
  await first.sc.stop();
  const second = await session();
  second.incoming.inject(payloads[2]);
  second.incoming.inject(payloads[1]);
  assert.equal(second.delivered.length, 0);
  second.incoming.inject(payloads[0]); // oldest evicted from the full hour
  second.incoming.inject(payloads[3]); // a rejected copy was never remembered
  assert.equal(second.relay.sent.length, 2);
  now += 3_600_000;
  second.incoming.inject(payloads[4]);
  assert.equal(fs.readdirSync(directory).length, 2);
  for (const name of fs.readdirSync(directory)) {
    const bytes = fs.readFileSync(path.join(directory, name));
    assert.ok(bytes.length <= 64);
    assert.ok(!bytes.includes(Buffer.from(payloads[3].id)));
    assert.ok(!bytes.includes(Buffer.from('persistent-')));
  }
  now += 3_600_000;
  await second.sc.stop();
  const third = await session();
  third.incoming.inject(payloads[4]);
  third.incoming.inject(payloads[3]); // expired oldest hour
  assert.deepEqual(third.delivered.map(d => d.payload.id), [payloads[3].id]);
  assert.equal(fs.readdirSync(directory).length, 2);
  await third.sc.stop();
});

test('rebroadcast preserves a signed envelope, resets TTL and respects receivers’ seen lists', () => {
  const { sc: sender } = peer(Current, bob, { relayTtl: 4 });
  const { sc, delivered } = peer(Current, bob, opts({ verifySignature: true }));
  const outgoing = port(sender);
  outgoing.destination = port(sc);
  const relay = port(sc);
  const received = author._buildPayload('room', { value: 42 });
  const existing = Object.freeze({ ...received, ttl: 0, relayedBy: 'previous' });
  assert.equal(sender.rebroadcast(existing), true);
  assert.equal(sender.rebroadcast(existing), true);
  assert.equal(existing.ttl, 0);
  assert.deepEqual(outgoing.sent.map(frame), Array(2).fill({ ...existing, ttl: 4 }));
  assert.deepEqual([delivered.length, relay.sent.length], [1, 1]);
  assert.equal(sender.rebroadcast({ ...existing, sig: undefined }), false);
  assert.equal(sender.rebroadcast({ ...existing, message: 'changed' }), false);
  assert.equal(sender.rebroadcast(author._buildPayload('room', { control: 'auth' })), false);
  assert.equal(sender.rebroadcast(author._buildPayload('unknown', 'content')), false);
  assert.equal(outgoing.sent.length, 2);
});

test('runtime join installs owner, welcome, size, signature and PoW before opening and forgets options on leave', async () => {
  const { sc, delivered } = peer(Current, bob);
  await sc.start();
  const ownerKey = alice.publicKey.toString('hex');
  const body = { channel: 'live', ownerPubKey: ownerKey, text: 'hello', issuedAt: Date.now(), version: 1 };
  const welcome = { payload: body, sig: alice.sign(Buffer.from(JSON.stringify(body, Object.keys(body).sort()))).toString('hex') };
  const policy = { ownerKey, ownerWriteOnly: true, welcomeRequired: true, welcome,
    verifySignature: true, powDifficulty: 4, maxReceiveBytes: 2048 };
  assert.equal(await sc.addChannel('live', { ...policy, welcome: { ...welcome, sig: '00' } }), false);
  assert.equal(sc.channels.has('live'), false);
  assert.equal(await sc.addChannel('live', policy), true);
  assert.deepEqual(sc.getWelcome('live'), welcome);
  assert.equal(sc.broadcast('live', 'not owner'), false);
  const incoming = port(sc, 'live');
  const relay = port(sc, 'live');
  const owner = peer(Old, alice, { powEnabled: true, powDifficulty: 4 }).sc;
  incoming.inject(author._buildPayload('live', 'missing work'));
  incoming.inject(owner._buildPayload('live', 'x'.repeat(2048)));
  incoming.inject(owner._buildPayload('live', 'owner'));
  assert.deepEqual([delivered.length, relay.sent.length], [1, 1]);
  assert.equal(await sc.removeChannel('live'), true);
  assert.equal(await sc.addChannel('live'), true);
  assert.equal(sc.getWelcome('live'), null);
  assert.equal(sc.broadcast('live', 'open again'), true);
  await sc.stop();
});

test('option bounds reject excessive difficulty, bytes, persistence and channel count', async () => {
  for (const policy of [{ powDifficulty: 17 }, { powBitsPerKiB: -1 }, { maxReceiveBytes: 0 },
    { maxReceiveBytes: 1_048_577 }, { verifySignature: 'yes' }]) {
    assert.throws(() => peer(Current, bob, opts(policy)));
  }
  for (const settings of [{ hours: 25 }, { maxFileBytes: 262145 }]) {
    assert.throws(() => peer(Current, bob, { seenPersistence: { directory: '.', ...settings } }));
  }
  const { sc } = peer(Current, bob, { channels: [] });
  await sc.start();
  for (let i = 0; i < 256; i++) assert.ok(await sc.addChannel('ch-' + i, { verifySignature: true }));
  assert.equal(await sc.addChannel('overflow', { verifySignature: true }), false);
  assert.equal(await sc.removeChannel('ch-0'), true);
  assert.equal(await sc.addChannel('overflow', { verifySignature: true }), true);
  await sc.stop();
});
