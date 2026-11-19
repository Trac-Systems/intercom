// S3: remote opens during a retry wait (B1), the own-send backlog (B2/R2-03),
// the recoverable writer lock (R2-01), corrected clock steps (R2-05) and
// per-architecture open flags (R2-07).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Duplex } from 'node:stream';
import test from 'node:test';
import Protomux from 'protomux';
import c from 'compact-encoding';
import Sidechannel from '../features/sidechannel/index.js';
import { ManagedSidechannel as Managed, BACKLOG_FRAMES } from '../features/sidechannel/managed.js';
import { SeenCache, openFlags } from '../features/sidechannel/seen.js';
import { peer, port, wallet, frame } from './helpers/sidechannel-wire.mjs';

const author = await wallet();
const reader = await wallet();
const sender = peer(Sidechannel, author).sc;
const tick = () => new Promise(resolve => setImmediate(resolve));

// writableHighWaterMark 1 with a deferred callback makes write() return false
// after one buffered frame, so Protomux reports backpressure and drains later.
function streamPair({ slow = false } = {}) {
  const streams = [0, 1].map(i => new Duplex({
    objectMode: true,
    writableHighWaterMark: slow ? 1 : 16,
    read() {},
    write(bytes, _encoding, done) {
      streams[1 - i].push(Buffer.from(bytes));
      if (slow) setImmediate(done);
      else done();
    }
  }));
  return streams;
}

function connect(t, a, b, options) {
  const streams = streamPair(options);
  t.after(() => { for (const stream of streams) stream.destroy(); });
  const muxes = streams.map(stream => Protomux.from(stream));
  return [a, b].map((sc, i) => ({ remotePublicKey: (i ? a : b).peer.wallet.publicKey, userData: muxes[i] }));
}

test('B1: a remote open during a pending local retry opens at once instead of being rejected', async t => {
  const policy = { channelOptions: { room: { maxReceiveBytes: 65536 } } };
  const early = peer(Managed, author, policy);
  const late = peer(Managed, reader, { ...policy, channels: ['lobby'] });
  const [toLate, toEarly] = connect(t, early.sc, late.sc);
  late.sc._openChannelForConnection(toEarly, late.sc.channels.get('lobby'));
  const room = early.sc.channels.get('room');
  early.sc._openChannelForConnection(toLate, room);
  // The late peer has no pairing for the room yet, so it rejects the open and
  // the early peer schedules its first retry (100 ms).
  for (let i = 0; i < 5 && !early.sc.connections.get(toLate).timers.has(room); i++) await tick();
  assert.ok(early.sc.connections.get(toLate).timers.has(room), 'a local retry is pending');
  const joined = late.sc._registerChannel('room');
  late.sc._openChannelForConnection(toEarly, joined);
  for (let i = 0; i < 5; i++) await tick();
  assert.equal(early.sc.connections.get(toLate).timers.size, 0, 'the pending retry was cancelled');
  assert.equal(early.sc.connections.get(toLate).get('room').channel.opened, true);
  assert.equal(late.sc.connections.get(toEarly).get('room').channel.opened, true);
  assert.ok(late.sc.broadcast('room', 'joined late'));
  await tick();
  assert.deepEqual(early.delivered.map(d => d.payload.message), ['joined late']);

  // A remote leave closes the session; the next remote open replaces it.
  await late.sc.removeChannel('room');
  for (let i = 0; i < 3; i++) await tick();
  assert.equal(early.sc.connections.get(toLate).get('room').channel.closed, true);
  late.sc._openChannelForConnection(toEarly, late.sc._registerChannel('room'));
  for (let i = 0; i < 5; i++) await tick();
  assert.equal(early.sc.connections.get(toLate).get('room').channel.opened, true);
  assert.ok(late.sc.broadcast('room', 'rejoined'));
  await tick();
  assert.deepEqual(early.delivered.map(d => d.payload.message), ['joined late', 'rejoined']);
  await Promise.all([early.sc.stop(), late.sc.stop()]);
});

test('B2: own broadcasts queue behind real Protomux backpressure and arrive complete and in order', async t => {
  const policy = { channelOptions: { room: { verifySignature: true } } };
  const a = peer(Managed, author, policy);
  const b = peer(Managed, reader, policy);
  const [toB, toA] = connect(t, a.sc, b.sc, { slow: true });
  a.sc._openChannelForConnection(toB, a.sc.channels.get('room'));
  b.sc._openChannelForConnection(toA, b.sc.channels.get('room'));
  for (let i = 0; i < 5; i++) await tick();
  const results = [];
  for (let i = 0; i < 48; i++) results.push(a.sc.broadcast('room', 'burst ' + i));
  assert.ok(results.every(Boolean));
  assert.ok(a.sc.traffic.ownQueued > 0, 'some frames waited for drain');
  for (let i = 0; i < 400 && b.delivered.length < 48; i++) await tick();
  assert.deepEqual(b.delivered.map(d => d.payload.message), Array.from({ length: 48 }, (_, i) => 'burst ' + i));
  assert.equal(a.sc.backlogBytes, 0);
  assert.equal(a.sc.traffic.ownDropped, 0);
  await Promise.all([a.sc.stop(), b.sc.stop()]);
});

// A connection whose sessions share one mux-wide drained flag.
function sharedMux(sc, remoteKey) {
  const mux = { drained: true, sessions: [] };
  mux.createChannel = ({ ondrain }) => {
    const session = {
      opened: true, closed: false, ondrain, sent: [],
      get drained() { return mux.drained; },
      open() {}, close() { this.closed = true; },
      fullyOpened() { return Promise.resolve(true); },
      addMessage({ encoding }) {
        return { send: payload => session.sent.push(c.decode(c.json, c.encode(encoding, payload))) };
      }
    };
    mux.sessions.push(session);
    return session;
  };
  mux.drain = () => {
    mux.drained = true;
    for (const session of mux.sessions) session.ondrain?.();
  };
  const connection = { remotePublicKey: remoteKey, userData: mux };
  return { mux, connection };
}

test('B2: the backlog is bounded, broadcast reports a full backlog, and relays are counted when skipped', async () => {
  const ownerKey = reader.publicKey.toString('hex');
  const body = { channel: 'news', issuedAt: 1, ownerPubKey: ownerKey, text: 'hi', version: 1 };
  const welcome = { payload: body, sig: reader.sign(Buffer.from(JSON.stringify(body))).toString('hex') };
  const { sc } = peer(Managed, reader, {
    channels: ['room', 'news'], ownerKeys: { news: ownerKey }, welcomeByChannel: { news: welcome },
    channelOptions: { room: { maxReceiveBytes: 65536 }, news: { verifySignature: true } }
  });
  const { mux, connection } = sharedMux(sc, author.publicKey);
  sc._openChannelForConnection(connection, sc.channels.get('room'));
  await tick();
  const [roomSession] = mux.sessions;
  mux.drained = false;
  for (let i = 0; i < BACKLOG_FRAMES; i++) assert.ok(sc.broadcast('room', i));
  assert.equal(sc.broadcast('room', 'overflow'), false, 'no eligible session took the frame');
  assert.equal(sc.traffic.ownDropped, 1);
  assert.equal(roomSession.sent.length, 0);

  // A session opened while this connection's backlog is full still gets its
  // owner welcome, after the queued frames, once the mux drains.
  sc._openChannelForConnection(connection, sc.channels.get('news'));
  await tick();
  const newsSession = mux.sessions[1];
  assert.equal(newsSession.sent.length, 0);

  // A relay on a busy connection is skipped and counted.
  const other = port(sc);
  other.inject({ id: 'relay-me', channel: 'room', ttl: 2, message: 'x' });
  assert.equal(sc.traffic.relayDropped, 1);

  mux.drain();
  assert.deepEqual(roomSession.sent.map(f => f.message), Array.from({ length: BACKLOG_FRAMES }, (_, i) => i));
  assert.deepEqual(newsSession.sent.map(f => f.message?.control), ['welcome']);
  assert.equal(sc.backlogBytes, 0);
  await sc.stop();
});

test('B2: a broadcast to sessions that are all busy and full reports failure; queued frames are released on close', async () => {
  const { sc } = peer(Managed, reader, { channelOptions: { room: { maxReceiveBytes: 65536 } } });
  const { mux, connection } = sharedMux(sc, author.publicKey);
  connection.listeners = [];
  connection.on = (event, fn) => { if (event === 'close') connection.listeners.push(fn); };
  connection.removeListener = () => {};
  sc._openChannelForConnection(connection, sc.channels.get('room'));
  await tick();
  mux.drained = false;
  assert.ok(sc.broadcast('room', 'queued'));
  assert.ok(sc.backlogBytes > 0);
  for (const fn of connection.listeners) fn();
  assert.equal(sc.backlogBytes, 0);
  assert.ok(sc.broadcast('room', 'no peers left'), 'no eligible session is not a failure');
  await sc.stop();
});

function scratch(t) {
  const directory = fs.mkdtempSync(path.join(process.cwd(), '.seen-test-'));
  fs.chmodSync(directory, 0o700);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function plantLock(directory, owner, name = '.writer.lock') {
  const lock = path.join(directory, name);
  fs.mkdirSync(lock, { mode: 0o700 });
  if (owner) {
    fs.writeFileSync(path.join(lock, 'owner'), JSON.stringify({
      version: 1, host: os.hostname(), process: 'earlier', token: 'planted', ...owner
    }), { mode: 0o600 });
  }
  return lock;
}

function exitedPid() {
  const child = spawnSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' });
  return Number(child.stdout.trim());
}

test('R2-01: a lock left by an exited process on this host is reclaimed, with leftovers', t => {
  const directory = scratch(t);
  plantLock(directory, { pid: exitedPid() });
  plantLock(directory, { pid: exitedPid() }, `.writer.lock-${'a'.repeat(32)}.stale`);
  plantLock(directory, { pid: process.pid, process: 'other' }, `.writer.lock-${'b'.repeat(32)}.tmp`);
  const cache = new SeenCache(10, 1000, { directory });
  cache.remember('01'.repeat(32), 5 * 3_600_000);
  const owner = JSON.parse(fs.readFileSync(path.join(directory, '.writer.lock', 'owner')));
  assert.equal(owner.pid, process.pid);
  assert.deepEqual(fs.readdirSync(directory).sort(), ['.writer.lock', 'seen-5.bin']);
  cache.close();
  assert.deepEqual(fs.readdirSync(directory), ['seen-5.bin']);
});

test('R2-01: a live, foreign, unidentified or same-process lock is never taken', t => {
  const directory = scratch(t);
  const attempt = () => {
    const cache = new SeenCache(10, 1000, { directory });
    cache.prepare(0);
    cache.close();
  };
  for (const [owner, pattern] of [
    [{ pid: process.ppid }, new RegExp(`process ${process.ppid}`)],
    [{ pid: exitedPid(), host: 'elsewhere.invalid' }, /elsewhere\.invalid/],
    [null, /unidentified/]
  ]) {
    const lock = plantLock(directory, owner);
    assert.throws(attempt, error => error.code === 'EEXIST' && pattern.test(error.message));
    assert.ok(fs.existsSync(lock));
    fs.rmSync(lock, { recursive: true });
  }
  const first = new SeenCache(10, 1000, { directory });
  first.prepare(0);
  assert.throws(attempt, error => error.code === 'EEXIST');
  first.close();
  assert.doesNotThrow(attempt);
});

test('R2-05: restart with the clock far behind the newest bucket moves its receipts to the observed hour', t => {
  const directory = scratch(t);
  const hour = 3_600_000;
  const options = { directory, hours: 3, maxFileBytes: 64 };
  const first = new SeenCache(10, 1000, options);
  first.remember('aa'.repeat(32), 20 * hour);
  first.remember('bb'.repeat(32), 21 * hour);
  first.close();
  const next = new SeenCache(10, 1000, options);
  assert.ok(next.has('aa'.repeat(32), 10 * hour));
  assert.ok(next.has('bb'.repeat(32), 10 * hour));
  next.remember('cc'.repeat(32), 10 * hour);
  assert.deepEqual(fs.readdirSync(directory).filter(name => name.endsWith('.bin')), ['seen-10.bin']);
  assert.equal(fs.statSync(path.join(directory, 'seen-10.bin')).size, 64); // Compacted on the third receipt.
  assert.equal(next.has('cc'.repeat(32), 13 * hour), false); // Ordinary retention from the observed hour.
  next.close();
});

test('R2-07: no-follow open flags come from the architecture when the runtime omits them', () => {
  const bare = { O_RDONLY: 0, O_CREAT: 0x40 };
  assert.deepEqual(openFlags(bare, 'linux', 'x64'), { exclusive: 0x80, safe: 0x20000 | 0x800 });
  assert.deepEqual(openFlags(bare, 'linux', 'arm64'), { exclusive: 0x80, safe: 0x8000 | 0x800 });
  assert.deepEqual(openFlags(bare, 'linux', 'arm'), { exclusive: 0x80, safe: 0x8000 | 0x800 });
  assert.deepEqual(openFlags(bare, 'linux', 'ppc64'), { exclusive: 0x80, safe: 0x8000 | 0x800 });
  assert.deepEqual(openFlags(bare, 'darwin', 'arm64'), { exclusive: 0x800, safe: 0x100 | 0x4 });
  for (const arch of ['mips', 'mipsel', 'sparc64', 'unknown']) assert.throws(() => openFlags(bare, 'linux', arch));
  assert.throws(() => openFlags(bare, 'win32', 'x64'));
  const full = { O_EXCL: 1, O_NOFOLLOW: 2, O_NONBLOCK: 4 };
  assert.deepEqual(openFlags(full, 'linux', 'mips'), { exclusive: 1, safe: 6 });
});

test('relay copies are charged to their origin, so one busy origin leaves forwarding for another', () => {
  const { sc } = peer(Managed, reader, { channelOptions: { room: { maxReceiveBytes: 1048576 } } });
  sc._now = () => 5000;
  const busy = port(sc);
  const quiet = port(sc);
  const outputs = Array.from({ length: 12 }, () => port(sc));
  const send = (input, id) => input.inject({ id, channel: 'room', ttl: 2, message: 'x'.repeat(100000) });
  // Ten admitted 100 KB frames to 13 destinations need about 13 MB of
  // forwarding; the busy origin gets its share plus the 8 MiB pool.
  for (let i = 0; i < 10; i++) send(busy, 'busy' + i);
  assert.ok(sc.traffic.relayDropped > 0);
  const before = outputs.reduce((n, p) => n + p.sent.length, 0);
  send(quiet, 'quiet');
  const after = outputs.reduce((n, p) => n + p.sent.length, 0);
  assert.ok(after - before >= 1, 'the quiet origin still forwards within its share');
  assert.equal(frame(outputs[0].sent.at(-1)).id, 'quiet');
});
