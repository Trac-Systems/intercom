import test from 'node:test';
import assert from 'node:assert/strict';
import c from 'compact-encoding';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Old from './fixtures/sidechannel-0.0.11.js';
import Current from '../features/sidechannel/managed.js';
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
  assert.equal(fs.readdirSync(directory).filter(name => name !== '.writer.lock').length, 2);
  for (const name of fs.readdirSync(directory).filter(name => name !== '.writer.lock')) {
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
  assert.equal(fs.readdirSync(directory).filter(name => name !== '.writer.lock').length, 2);
  await third.sc.stop();
});

test('rebroadcast preserves a signed envelope, resets TTL and respects receivers’ seen lists', () => {
  const { sc: sender } = peer(Current, bob, { relayTtl: 4 });
  const { sc, delivered } = peer(Current, bob, opts({ verifySignature: true }));
  let now = 10_000;
  sender._now = sc._now = () => now;
  const outgoing = port(sender);
  outgoing.destination = port(sc);
  const relay = port(sc);
  const received = author._buildPayload('room', { value: 42 });
  const existing = Object.freeze({ ...received, ttl: 0, relayedBy: 'previous' });
  assert.equal(sender.rebroadcast(existing), true);
  assert.equal(sender.rebroadcast(existing), false);
  assert.equal(existing.ttl, 0);
  assert.deepEqual(outgoing.sent.map(frame), [{ ...existing, ttl: 4 }]);
  assert.deepEqual([delivered.length, relay.sent.length], [1, 1]);
  assert.equal(sender.rebroadcast({ ...existing, sig: undefined }), false);
  assert.equal(sender.rebroadcast({ ...existing, message: 'changed' }), false);
  assert.equal(sender.rebroadcast(author._buildPayload('room', { control: 'auth' })), false);
  assert.equal(sender.rebroadcast(author._buildPayload('unknown', 'content')), false);
  assert.equal(outgoing.sent.length, 1);
  now += 120_001;
  assert.equal(sender.rebroadcast(existing), true);
  assert.deepEqual([delivered.length, relay.sent.length], [2, 2]);
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

test('leave during an active policy join retires its discovery and pending callbacks', async () => {
  const { sc } = peer(Current, bob, { channels: [] });
  await sc.start();
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const left = [];
  sc.peer.swarm.flush = () => pending;
  sc.peer.swarm.leave = topic => left.push(topic);
  const join = sc.addChannel('changing', { verifySignature: true });
  const entry = sc.channels.get('changing');
  const leave = sc.removeChannel('changing');
  release();
  assert.equal(await leave, true);
  assert.equal(await join, false);
  assert.deepEqual(left, [entry.topic]);
  assert.equal(entry.announced, false);
});

test('validated channels scope identical IDs to their authors, and wait for a welcome before recording', () => {
  const config = opts({ verifySignature: true, welcomeRequired: true, ownerKey: alice.publicKey });
  const { sc, delivered } = peer(Current, bob, config);
  const incoming = port(sc);
  const relay = port(sc);
  const first = author._buildPayload('room', 'author A');
  incoming.inject(first);
  assert.equal(relay.sent.length, 0);
  const body = { channel: 'room', issuedAt: 1, ownerPubKey: alice.publicKey.toString('hex'), text: '', version: 1 };
  const welcome = { payload: body, sig: alice.sign(Buffer.from(JSON.stringify(body))).toString('hex') };
  incoming.inject(author._buildPayload('room', { control: 'welcome', welcome }));
  incoming.inject(first);
  const second = { ...sc._buildPayload('room', 'author B'), id: first.id };
  sc._attachSig(second);
  incoming.inject(second);
  assert.deepEqual(delivered.map(d => d.payload.message), ['author A', 'author B']);
  assert.equal(relay.sent.length, 2);
});

test('rebroadcast honors owner and invite policies including expired peer access', () => {
  const { sc } = peer(Current, bob, {
    inviteRequired: true, inviterKeys: [bob.publicKey], ...opts({ ownerKey: alice.publicKey, ownerWriteOnly: true })
  });
  const peerPort = port(sc, 'room', alice.publicKey);
  const signed = author._buildPayload('room', 'owner content');
  assert.equal(sc.rebroadcast(signed), false);
  sc._rememberInvite('room', alice.publicKey.toString('hex'), sc._now() + 60_000);
  assert.equal(sc.rebroadcast(sc._buildPayload('room', 'listener')), false);
  assert.equal(sc.rebroadcast(signed), true);
  sc._now = () => Date.now() + 120_000;
  assert.equal(sc.rebroadcast(signed), false);
  assert.equal(peerPort.sent.length, 1);
});

test('option receive and send reject excessive nesting without consuming a valid ID', () => {
  const { sc, delivered } = peer(Current, bob, opts({ verifySignature: true, powDifficulty: 0 }));
  const incoming = port(sc);
  const relay = port(sc);
  let deep = null;
  for (let i = 0; i < 80; i++) deep = [deep];
  const signed = author._buildPayload('room', null);
  incoming.inject({ ...signed, message: deep });
  assert.equal(sc.broadcast('room', deep), false);
  incoming.inject(signed);
  assert.deepEqual([delivered.length, relay.sent.length], [1, 1]);
});

test('recent IDs loaded from multiple hours obey maxSeen and recover a partial trailing record', async t => {
  const directory = fs.mkdtempSync(path.join(process.cwd(), '.seen-test-'));
  t.after(() => fs.rmSync(directory, { force: true, recursive: true }));
  const config = { seenPersistence: { directory, hours: 3, maxFileBytes: 128 } };
  let now = 3_600_000 * 20;
  const first = peer(Current, bob, config).sc;
  first._now = () => now;
  await first.start();
  const incoming = port(first);
  const payloads = Array.from({ length: 3 }, (_, i) => author._buildPayload('room', i));
  for (const payload of payloads) {
    incoming.inject(payload);
    now += 3_600_000;
  }
  await first.stop();
  now -= 3_600_000;
  const newest = path.join(directory, fs.readdirSync(directory).filter(name => name !== '.writer.lock').sort().at(-1));
  fs.appendFileSync(newest, Buffer.from([0, 1, 2]));
  const { sc, delivered } = peer(Current, bob, { ...config, maxSeen: 2 });
  sc._now = () => now;
  await sc.start();
  const input = port(sc);
  input.inject(payloads[1]);
  input.inject(payloads[2]);
  assert.equal(delivered.length, 0);
  assert.equal(fs.statSync(newest).size, 32);
  input.inject(payloads[0]);
  assert.equal(delivered.length, 1);
  await sc.stop();
});

test('hour files recover an interrupted compaction and a smaller configured capacity on restart', async t => {
  const directory = fs.mkdtempSync(path.join(process.cwd(), '.seen-test-'));
  t.after(() => fs.rmSync(directory, { force: true, recursive: true }));
  const config = { seenPersistence: { directory, maxFileBytes: 128 } };
  const first = peer(Current, bob, config).sc;
  first._now = () => 1_700_000_000_000;
  await first.start();
  const incoming = port(first);
  const payloads = Array.from({ length: 4 }, (_, i) => author._buildPayload('room', i));
  for (const p of payloads) incoming.inject(p);
  await first.stop();
  fs.writeFileSync(path.join(directory, 'seen-compact.tmp'), Buffer.alloc(19));
  const { sc, delivered } = peer(Current, bob, { seenPersistence: { directory, maxFileBytes: 64 } });
  sc._now = first._now;
  await sc.start();
  const reopened = port(sc);
  reopened.inject(payloads[2]);
  reopened.inject(payloads[3]);
  assert.equal(delivered.length, 0);
  reopened.inject(payloads[0]);
  assert.equal(delivered.length, 1);
  const files = fs.readdirSync(directory).filter(name => name !== '.writer.lock');
  assert.equal(files.length, 1);
  assert.equal(fs.statSync(path.join(directory, files[0])).size, 64);
  await sc.stop();
});

test('launcher options select only the new feature settings and reject malformed configuration', async () => {
  const { launcherOptions } = await import('../features/sidechannel/channel-options.js');
  assert.deepEqual(launcherOptions(undefined), {});
  const config = opts({ verifySignature: true });
  assert.deepEqual(launcherOptions(JSON.stringify(config)), config);
  const { sc, delivered } = peer(Current, bob, launcherOptions(JSON.stringify(config)));
  const incoming = port(sc);
  incoming.inject({ id: 'without-signature', channel: 'room', message: 'test' });
  assert.equal(delivered.length, 0);
  for (const value of ['[1]', 'null', 'invalid', '{"channelOption":{}}', ' '.repeat(1_048_577)]) {
    assert.throws(() => launcherOptions(value));
  }
});

test('an application can edit its delivered copy without changing the signed relay', () => {
  const { sc } = peer(Current, bob, { ...opts({ verifySignature: true }),
    onMessage(_channel, payload) { payload.message.rows[0] = 'local'; } });
  const input = port(sc);
  const relay = port(sc);
  const original = author._buildPayload('room', { rows: ['wire'] });
  input.inject(original);
  const forwarded = frame(relay.sent[0]);
  assert.deepEqual(forwarded.message, original.message);
  assert.equal(author._verifySig(forwarded, original.from), true);
});

test('oversize decoding checks the backing length without reading JSON bytes', () => {
  const { sc } = peer(Current, bob, opts({ maxReceiveBytes: 8 }));
  const codec = port(sc).encoding;
  let reads = 0;
  const state = { start: 3, end: 12, buffer: { byteLength: 12, get 3() { reads++; throw new Error('unexpected byte read'); } } };
  assert.equal(codec.decode(state), null);
  assert.equal(reads, 0);
  assert.equal(state.start, state.end);
});

test('bounded mining serializes each canonical field once across decimal nonce widths', async () => {
  const { mine } = await import('../features/sidechannel/pow.js');
  const payload = { channel: 'room', from: 'a', origin: 'a', id: 'work', ts: 100, message: 'sample' };
  const serialized = [];
  const ok = mine(payload, { powDifficulty: 12 }, value => { serialized.push(value); return JSON.stringify(value); });
  assert.ok(ok);
  assert.deepEqual(serialized.sort(), ['sample', 'room', 'a', 'a', 'work', 100].sort());
  assert.deepEqual(payload.pow, { nonce: 3237, difficulty: 12 });
  const { sc } = peer(Old, bob, { powEnabled: true, powDifficulty: 12 });
  assert.equal(sc._checkPow(payload, 'room'), true);
});

test('requiring signatures also fails a local send when the wallet cannot sign', () => {
  const { sc } = peer(Current, null, opts({ verifySignature: true }));
  const outgoing = port(sc);
  assert.equal(sc.broadcast('room', 'test'), false);
  assert.equal(outgoing.sent.length, 0);
});

test('the first runtime policy join opens existing swarm connections for passive reception', async () => {
  const { sc, delivered } = peer(Current, bob, { channels: [] });
  let receive;
  const session = {
    addMessage({ encoding, onmessage }) {
      receive = bytes => onmessage(c.decode(encoding, bytes));
      return { send() {} };
    },
    open() {}, fullyOpened: async () => true, close() {}
  };
  sc.peer.swarm.connections.push({ remotePublicKey: alice.publicKey, userData: { createChannel: () => session } });
  await sc.start();
  assert.equal(await sc.addChannel('passive', { verifySignature: true }), true);
  assert.equal(typeof receive, 'function');
  receive(c.encode(c.json, author._buildPayload('passive', 'first')));
  assert.equal(delivered.length, 1);
  await sc.stop();
});

test('an opted-in peer bounds total memberships, including ordinary joins and implicit broadcast joins', async () => {
  const channels = Array.from({ length: 256 }, (_, i) => 'room-' + i);
  const config = { channels, channelOptions: { 'room-0': { verifySignature: true } } };
  const { sc } = peer(Current, bob, config);
  await sc.start();
  assert.equal(await sc.addChannel('extra'), false);
  assert.equal(sc.broadcast('extra', 'hello'), false);
  assert.equal(await sc.removeChannel('room-1'), true);
  assert.equal(await sc.addChannel('extra'), true);
  assert.throws(() => peer(Current, bob, { ...config, channels: [...channels, 'extra'] }));
  await sc.stop();
});

test('effective PoW caps at 16 bits and an exhausted mining budget leaves no partial proof', async () => {
  const { mine } = await import('../features/sidechannel/pow.js');
  const payload = { id: 'work-cap', channel: 'room', from: 'a', origin: 'a', ts: 100, message: 'x'.repeat(1024) };
  assert.equal(mine(payload, { powDifficulty: 15, powBitsPerKiB: 16 }, JSON.stringify), true);
  assert.equal(payload.pow.difficulty, 16);
  const reference = peer(Old, bob, { powEnabled: true, powDifficulty: 16 }).sc;
  assert.ok(reference._checkPow(payload, 'room'));

  // A long immutable suffix still has to be hashed per nonce, even on Node.
  // This fixed vector has no acceptable nonce within the 256 MiB hash budget.
  const limited = { id: 'budget', channel: 'room', from: 'a', origin: 'x'.repeat(700000), message: 'sample', ts: 100 };
  assert.equal(mine(limited, { powDifficulty: 16 }, JSON.stringify), false);
  assert.equal(limited.pow, undefined);

  const { sc } = peer(Current, bob, { ...opts({ verifySignature: true }), powEnabled: true, powDifficulty: 17 });
  const outgoing = port(sc);
  assert.equal(sc.broadcast('room', 'over inherited work bound'), false);
  assert.equal(outgoing.sent.length, 0);
});

test('persistent startup loads the newest 20,000 hashes even with a larger legacy maxSeen', async t => {
  const directory = fs.mkdtempSync(path.join(process.cwd(), '.seen-test-'));
  t.after(() => fs.rmSync(directory, { force: true, recursive: true }));
  // Each fixture record is a distinct 32-byte digest-sized value.
  function record(i) {
    const hash = Buffer.alloc(32);
    hash.writeUInt32BE(i, 0);
    return hash;
  }
  for (let hour = 1; hour <= 3; hour++) {
    const data = Buffer.alloc(7000 * 32);
    for (let i = 0; i < 7000; i++) record((hour - 1) * 7000 + i).copy(data, i * 32);
    fs.writeFileSync(path.join(directory, 'seen-' + hour + '.bin'), data);
  }
  const { sc } = peer(Current, bob, { maxSeen: 100_000, seenPersistence: { directory, hours: 3, maxFileBytes: 262_144 } });
  sc._now = () => 3 * 3_600_000;
  await sc.start();
  assert.equal(sc.protectedSeen.ids.size, 20_000);
  assert.equal(sc.protectedSeen.has(record(999).toString('hex'), sc._now()), false);
  assert.equal(sc.protectedSeen.has(record(1000).toString('hex'), sc._now()), true);
  await sc.stop();
});
