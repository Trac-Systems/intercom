import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import c from 'compact-encoding';
import { SeenCache } from '../features/sidechannel/seen.js';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import Sidechannel from '../features/sidechannel/index.js';
import * as managed from '../features/sidechannel/managed.js';
import { receiveEncoding } from '../features/sidechannel/channel-options.js';
import { peer, port, wallet, frame } from './helpers/sidechannel-wire.mjs';

const author = await wallet();
const reader = await wallet();
const Managed = managed.ManagedSidechannel;
const sender = peer(Sidechannel, author).sc;

test('the embedding module exports the release constructor and an opt-in subclass', () => {
  assert.equal(managed.Sidechannel, Sidechannel);
  assert.equal(Object.getPrototypeOf(Managed), Sidechannel);
  assert.deepEqual(fs.readFileSync(new URL('../features/sidechannel/index.js', import.meta.url)),
    fs.readFileSync(new URL('./fixtures/sidechannel-0.0.11.js', import.meta.url)));
});

test('verified admissions use distinct receipts across a policy change and restart', async t => {
  const directory = fs.mkdtempSync('./.seen-test-');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const config = { seenPersistence: { directory } };
  const first = peer(Managed, reader, config);
  await first.sc.start();
  const original = sender._buildPayload('room', 'one');
  const input = port(first.sc);
  input.inject({ ...original, sig: undefined });
  input.inject(original);
  assert.equal(first.delivered.length, 2);
  await first.sc.stop();
  const next = peer(Managed, reader, { ...config, channelOptions: { room: { verifySignature: true } } });
  await next.sc.start();
  port(next.sc).inject(original);
  assert.equal(next.delivered.length, 1);
  await next.sc.stop();
});

test('managed callbacks distinguish canonical content from envelope extensions', () => {
  let delivery;
  const { sc } = peer(Managed, reader, {
    channelOptions: { room: { verifySignature: true } },
    onMessage(channel, content, connection, envelope) { delivery = { channel, content, envelope }; }
  });
  const frame = { ...sender._buildPayload('room', null), extension: 'outer' };
  port(sc).inject(frame);
  assert.equal(delivery.content.verified, true);
  assert.equal(delivery.content.from, frame.from);
  assert.equal(delivery.content.message, null);
  assert.equal(Object.hasOwn(delivery.content, 'extension'), false);
  assert.deepEqual(delivery.envelope, frame);
});

test('cursor bounds use the supplied view, including its offset and length', () => {
  const buffer = Buffer.alloc(16).subarray(4, 8);
  for (const [start, end] of [[-1, 1], [0, 5], [1.5, 3], [3, 2], [0, Infinity]]) {
    assert.equal(receiveEncoding(64).decode({ buffer, start, end }), null);
  }
});

test('persistence requires a private directory and exclusive writer lifetime', async t => {
  const directory = fs.mkdtempSync('./.seen-test-');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const create = () => peer(Managed, reader, { seenPersistence: { directory } }).sc;
  fs.chmodSync(directory, 0o755);
  await assert.rejects(async () => create().start());
  fs.chmodSync(directory, 0o700);
  const first = create();
  await first.start();
  await assert.rejects(async () => create().start());
  await first.stop();
  const second = create();
  await second.start();
  await second.stop();
});

test('stop while bootstrap is pending cannot reattach a listener or announce a topic', async () => {
  const { sc } = peer(Managed, reader, { channelOptions: { room: { verifySignature: true } } });
  let ready;
  const pending = new Promise(resolve => { ready = resolve; });
  const swarm = new EventEmitter();
  let joins = 0;
  sc.peer.swarm = Object.assign(swarm, { dht: { fullyBootstrapped: () => pending }, join() { joins++; } });
  const start = sc.start();
  await Promise.resolve();
  await sc.stop();
  ready();
  await start;
  assert.equal(sc.started, false);
  assert.equal(joins, 0);
  assert.equal(swarm.listenerCount('connection'), 0);
});

test('rejected unsigned frames spend admission capacity before decode, per connection and per service', () => {
  const { sc, delivered } = peer(Managed, reader, { channelOptions: { room: { verifySignature: true } } });
  let now = 10000;
  sc._now = () => now;
  const unsigned = c.encode(c.json, { id: 'sample', channel: 'room', message: 'sample' });
  const signed = c.encode(c.json, sender._buildPayload('room', 'accepted after refill'));
  for (let n = 0; n < 8; n++) {
    const input = port(sc);
    for (let i = 0; i < 64; i++) {
      const decoded = c.decode(input.encoding, unsigned);
      assert.ok(decoded);
      input.onmessage(decoded);
    }
    assert.equal(c.decode(input.encoding, signed), null);
  }
  const fresh = port(sc);
  assert.equal(c.decode(fresh.encoding, signed), null);
  assert.equal(delivered.length, 0);
  now += 1000;
  fresh.receive(signed);
  assert.equal(delivered.length, 1);
});

test('size-only and ordinary channels report the trust actually established by the receiver', () => {
  const results = [];
  const { sc } = peer(Managed, reader, {
    channels: ['room', 'ordinary'], channelOptions: { room: { maxReceiveBytes: 4096 } },
    onMessage(channel, content) { results.push([channel, content.verified]); }
  });
  const payload = sender._buildPayload('room', 'sample');
  port(sc).inject({ ...payload, sig: undefined, verified: true });
  port(sc).inject(payload);
  port(sc, 'ordinary').inject({ id: 'ordinary', message: 'sample', verified: true });
  assert.deepEqual(results, [['room', false], ['room', true], ['ordinary', false]]);
});

test('rejoin under a different owner revalidates the saved welcome and restores it on return', async () => {
  const ownerKey = author.publicKey.toString('hex');
  const payload = { channel: 'room', issuedAt: 123, ownerPubKey: ownerKey, text: 'hello', version: 1 };
  const welcome = { payload, sig: author.sign(Buffer.from(JSON.stringify(payload))).toString('hex') };
  const { sc } = peer(Managed, null, {
    ownerKeys: { room: ownerKey }, welcomeByChannel: { room: welcome },
    channelOptions: { room: { verifySignature: true, welcomeRequired: true } }
  });
  await sc.start();
  await sc.removeChannel('room');
  assert.ok(await sc.addChannel('room', { ownerKey: reader.publicKey }));
  assert.equal(sc.getWelcome('room'), null);
  assert.equal(sc._isWelcomed('room'), false);
  await sc.removeChannel('room');
  assert.ok(await sc.addChannel('room'));
  assert.equal(sc.getWelcome('room'), welcome);
  await sc.stop();
});

test('a storage fault while receiving a welcome leaves the access gate closed until retry', async t => {
  const directory = fs.mkdtempSync('./.seen-test-');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const ownerKey = author.publicKey.toString('hex');
  const body = { channel: 'room', issuedAt: 123, ownerPubKey: ownerKey, text: 'hello', version: 1 };
  const welcome = { payload: body, sig: author.sign(Buffer.from(JSON.stringify(body))).toString('hex') };
  const { sc, delivered } = peer(Managed, reader, { seenPersistence: { directory },
    channelOptions: { room: { ownerKey, welcomeRequired: true, verifySignature: true } } });
  await sc.start();
  const input = port(sc);
  const control = sender._buildPayload('room', { control: 'welcome', welcome });
  const append = t.mock.method(sc.protectedSeen.files, 'append', () => { throw new Error('storage offline'); });
  input.inject(control);
  assert.equal(sc.getWelcome('room'), null);
  append.mock.restore();
  const content = sender._buildPayload('room', 'sample');
  input.inject(content);
  assert.equal(delivered.length, 0);
  input.inject(control);
  input.inject(content);
  assert.equal(delivered.length, 1);
  await sc.stop();
});

test('private store rejects linked directories, linked buckets and active file substitution', () => {
  const root = fs.mkdtempSync('./.seen-test-');
  try {
    const directory = path.join(root, 'private');
    fs.mkdirSync(directory, { mode: 0o700 });
    const other = path.join(root, 'other');
    const original = Buffer.alloc(32, 1);
    fs.writeFileSync(other, original);
    const store = directory => new SeenCache(4, 1000, { directory });
    const alias = path.join(root, 'alias');
    fs.symlinkSync(path.resolve(directory), alias, 'dir');
    assert.throws(() => store(alias).prepare(0));
    const bucket = path.join(directory, 'seen-0.bin');
    for (const link of [() => fs.symlinkSync(path.resolve(other), bucket), () => fs.linkSync(other, bucket)]) {
      link();
      assert.throws(() => store(directory).prepare(0));
      fs.unlinkSync(bucket);
    }
    const cache = store(directory);
    cache.remember('01'.repeat(32), 0);
    fs.renameSync(bucket, path.join(root, 'saved'));
    fs.copyFileSync(other, bucket);
    for (let attempt = 0; attempt < 2; attempt++) {
      assert.throws(() => cache.remember('02'.repeat(32), 0), /identity/);
    }
    assert.deepEqual(fs.readFileSync(bucket), original);
    assert.deepEqual(fs.readFileSync(other), original);
    cache.close();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('restart during a clock regression retains the newest bucket and a forward jump expires it', () => {
  const directory = fs.mkdtempSync('./.seen-test-');
  const hour = 3600000;
  const key = '12'.repeat(32);
  const create = () => new SeenCache(10, 1000, { directory, hours: 2 });
  try {
    const first = create();
    first.remember(key, 5 * hour);
    first.close();
    const second = create();
    assert.ok(second.has(key, 4 * hour));
    second.remember('34'.repeat(32), 4 * hour);
    assert.equal(fs.statSync(path.join(directory, 'seen-5.bin')).size, 64);
    assert.equal(second.has(key, 100 * hour), false);
    second.close();
    assert.deepEqual(fs.readdirSync(directory), []);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('managed relays clamp integral hops, enforce metadata and forwarding limits, and honor backpressure', () => {
  const { sc, delivered } = peer(Managed, reader, { relayTtl: 100, channelOptions: { room: { powDifficulty: 0 } } });
  let now = 1000;
  sc._now = () => now;
  const incoming = port(sc);
  const outgoing = port(sc);
  const [source, destination] = sc.connections.keys();
  const output = sc.connections.get(destination).get('room').channel;
  const send = (id, extra) => incoming.inject({ id, channel: 'room', message: '', ttl: 3, ...extra });
  send('cap', { ttl: 200 });
  assert.equal(frame(outgoing.sent[0]).ttl, 7);
  send('fraction', { ttl: 1.5 });
  output.drained = false;
  send('busy', {});
  output.drained = true;
  send('meta', { extension: 'x'.repeat(16 * 1024) });
  assert.equal(delivered.length, 3);
  assert.equal(outgoing.sent.length, 1);

  now += 1000;
  const large = { channel: 'room', id: 'large', ttl: 1, message: '' };
  large.message = 'x'.repeat(1048576 - Buffer.byteLength(JSON.stringify(large)) - 5);
  assert.equal(c.encode(c.json, large).byteLength, 1048576);
  incoming.inject(large); // Adding relayedBy would exceed the outbound frame cap.
  assert.equal(delivered.length, 4);
  assert.equal(outgoing.sent.length, 1);
  assert.ok(sc.connections.has(source));
});

test('pre-open sends have shared frame and byte limits and release queued content on close or stop', async () => {
  const { sc } = peer(Managed, reader, { channelOptions: { room: { maxReceiveBytes: 1048576 } } });
  const conn = new EventEmitter();
  let opened;
  let written = 0;
  const pending = new Promise(resolve => { opened = resolve; });
  const session = { opened: false, open() {}, close() {}, fullyOpened: () => pending,
    addMessage() { return { send() { written++; } }; } };
  conn.userData = { createChannel: () => session };
  sc._openChannelForConnection(conn, sc.channels.get('room'));
  const large = 'q'.repeat(550000);
  sc.broadcast('room', large);
  sc.broadcast('room', large);
  assert.equal(sc.pendingFrames, 1);
  for (let i = 0; i < 70; i++) sc.broadcast('room', i);
  assert.equal(sc.pendingFrames, 64);
  assert.ok(sc.pendingBytes <= 1048576);
  sc._getLimiter(conn);
  conn.emit('close');
  assert.deepEqual([sc.pendingFrames, sc.pendingBytes, sc.rateLimits.size, sc.connections.size], [0, 0, 0, 0]);
  assert.equal(conn.listenerCount('close'), 0);
  await sc.stop();
  opened(true);
  await pending;
  assert.equal(written, 0);
});

test('explicit replay has an aggregate attempt budget across distinct signed envelopes', () => {
  const { sc } = peer(Managed, reader, { channelOptions: { room: { verifySignature: true } } });
  let now = 10000;
  sc._now = () => now;
  const outgoing = port(sc);
  for (let i = 0; i < 16; i++) assert.ok(sc.rebroadcast(sender._buildPayload('room', i)));
  const next = sender._buildPayload('room', 'next');
  assert.equal(sc.rebroadcast(next), false);
  assert.equal(outgoing.sent.length, 16);
  now += 1000;
  assert.ok(sc.rebroadcast(next));
});

test('forwarding charges each destination against the instance byte budget', () => {
  const { sc } = peer(Managed, reader, { channelOptions: { room: { maxReceiveBytes: 1048576 } } });
  let now = 5000;
  sc._now = () => now;
  const incoming = port(sc);
  const outputs = Array.from({ length: 10 }, () => port(sc));
  const send = id => incoming.inject({ id, channel: 'room', ttl: 2, message: 'x'.repeat(950000) });
  send('first');
  const sent = outputs.flatMap(port => port.sent);
  assert.equal(sent.length, 8);
  const bytes = sent.reduce((total, buf) => total + buf.length, 0);
  assert.ok(bytes <= 8 * 1048576 && bytes + sent[0].length > 8 * 1048576);
  now += 1000;
  send('next');
  assert.equal(outputs.flatMap(port => port.sent).length, 16);
});
