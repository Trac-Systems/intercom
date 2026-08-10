// Regression test for the bootstrap-window join race.
//
// The SC-Bridge WS server accepts clients (index.js) BEFORE `sidechannel.start()`
// resolves, so a client can send `join` while start() is still inside its
// awaited `swarm.flush()` (bounded at 10s, and preceded by the DHT bootstrap
// wait). In that window `sidechannel.started` is still false, so `addChannel`
// used to skip `swarm.join` entirely — while start()'s own join loop had already
// run. The topic therefore ended up registered but never announced: invisible to
// discovery until the process restarted. The bridge nevertheless answered
// `{type:'joined'}` immediately, so the client was told it had joined a channel
// no peer could find.
//
// The fix is a pair:
//   1. start() re-scans this.channels after the flush and announces whatever was
//      registered during the window (idempotent joins make this harmless).
//   2. addChannel resolves only once the topic is genuinely announced, so the
//      bridge's `joined` reply can no longer lie.
//
// These tests drive the real Sidechannel and the real ScBridge message handler
// against a swarm stub whose flush() is resolved by hand, which is what makes the
// window observable.

import test from 'node:test';
import assert from 'node:assert/strict';
import module from 'node:module';
import b4a from 'b4a';
import Sidechannel from '../features/sidechannel/index.js';

// features/sc-bridge pulls in `bare-ws`, which is a Bare/Pear addon and cannot be
// loaded by plain node. The bridge's WS server is irrelevant here — the test
// drives `_handleClientMessage` directly — so resolve that one specifier to a
// stub and load the real bridge module on top of it.
const loadScBridge = async () => {
  if (typeof module.registerHooks !== 'function') return null;
  module.registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === 'bare-ws') return { url: 'stub:bare-ws', shortCircuit: true };
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      if (url === 'stub:bare-ws') {
        return {
          format: 'module',
          shortCircuit: true,
          source: 'export default { Server: class {} };',
        };
      }
      return nextLoad(url, context);
    },
  });
  return (await import('../features/sc-bridge/index.js')).default;
};

// Let queued promise callbacks run. Every await point in the code under test is
// a promise chain, so a handful of macrotask turns settles everything that is
// not blocked on a pending flush.
const settle = async (turns = 12) => {
  for (let i = 0; i < turns; i++) await new Promise((resolve) => setImmediate(resolve));
};

// Swarm stub with a hand-controlled flush. `autoFlush` gives the fast path
// (flush resolves immediately, as it does on a healthy network).
function makeSwarm({ autoFlush = false } = {}) {
  const joined = [];
  const left = [];
  const flushes = [];
  const swarm = {
    connections: [],
    dht: null,
    join(topic) {
      joined.push(b4a.toString(topic, 'hex'));
    },
    leave(topic) {
      left.push(b4a.toString(topic, 'hex'));
    },
    flush() {
      if (autoFlush) {
        flushes.push({ resolve: () => {}, auto: true });
        return Promise.resolve();
      }
      let resolve = null;
      const promise = new Promise((r) => {
        resolve = r;
      });
      flushes.push({ resolve, auto: false });
      return promise;
    },
    on() {},
  };
  return { swarm, joined, left, flushes };
}

const makeSidechannel = (swarm, extra = {}) =>
  new Sidechannel(
    { wallet: null, swarm },
    {
      channels: ['boot'],
      powEnabled: false,
      inviteRequired: false,
      welcomeRequired: false,
      rateBytesPerSecond: 0,
      ...extra,
    }
  );

const topicOf = (sc, name) => b4a.toString(sc.channels.get(name).topic, 'hex');

test('join during a slow flush is announced after the flush, not left dead', async () => {
  const { swarm, joined, flushes } = makeSwarm();
  const sc = makeSidechannel(swarm);

  const startP = sc.start();
  await settle();

  // start() joined the pre-registered channel and is now parked on the flush.
  assert.equal(flushes.length, 1, 'start() should be waiting on its first flush');
  assert.equal(joined.length, 1, 'only the pre-registered channel joined so far');
  assert.equal(sc.started, false, 'readiness must not be claimed during the flush');

  // A client join lands inside the window.
  let resolved = null;
  const joinP = sc.addChannel('late').then((ok) => {
    resolved = ok;
    return ok;
  });
  await settle();

  assert.equal(resolved, null, 'addChannel must not resolve before the topic is announced');
  assert.equal(joined.length, 1, 'addChannel cannot join behind start(); it waits');
  assert.ok(sc.channels.has('late'), 'the channel is registered immediately');
  assert.notEqual(sc.channels.get('late').announced, true, 'registered is not announced');

  // Release the flush start() was parked on.
  flushes[0].resolve();
  await settle();

  // This is the whole point: the re-scan picked the late channel up.
  const lateTopic = topicOf(sc, 'late');
  assert.equal(joined.length, 2, 'the late channel must be joined by the post-flush re-scan');
  assert.ok(joined.includes(lateTopic), 'the late topic reached swarm.join');
  assert.equal(flushes.length, 2, 're-scan flushes its own join');
  assert.equal(resolved, null, 'still not announced until that flush completes');

  flushes[1].resolve();
  await settle();
  await startP;

  assert.equal(await joinP, true, 'addChannel resolves true once announced');
  assert.equal(sc.channels.get('late').announced, true);
  assert.equal(sc.started, true, 'readiness flips once every topic is announced');
});

test('the bridge sends joined only for a genuinely announced channel', async (t) => {
  const ScBridge = await loadScBridge();
  if (!ScBridge) {
    t.skip('node:module.registerHooks unavailable; cannot stub bare-ws');
    return;
  }
  const { swarm, flushes, joined } = makeSwarm();
  const sc = makeSidechannel(swarm);
  const bridge = new ScBridge({ wallet: null, swarm }, { requireAuth: false });
  bridge.attachSidechannel(sc);

  const startP = sc.start();
  await settle();
  assert.equal(flushes.length, 1);

  const writes = [];
  const client = {
    socket: {
      write(data) {
        writes.push(JSON.parse(data));
      },
    },
    ready: true,
    authed: true,
    filter: null,
    channels: null,
  };

  bridge._handleClientMessage(client, { id: 7, type: 'join', channel: 'late' });
  await settle();

  assert.deepEqual(writes, [], 'no reply at all while the topic is unannounced');

  flushes[0].resolve();
  await settle();
  assert.ok(joined.includes(topicOf(sc, 'late')), 're-scan announced the channel');
  assert.deepEqual(writes, [], 'still silent until the announce flush completes');

  flushes[1].resolve();
  await settle();
  await startP;

  assert.equal(writes.length, 1, 'exactly one reply');
  assert.deepEqual(writes[0], { id: 7, type: 'joined', channel: 'late', announced: true });
  assert.equal(sc.channels.get('late').announced, true, 'and it was true when sent');
});

test('the fast path is unchanged: join after start joins and flushes immediately', async () => {
  const { swarm, joined, flushes } = makeSwarm({ autoFlush: true });
  const sc = makeSidechannel(swarm);

  await sc.start();
  assert.equal(sc.started, true);
  assert.equal(joined.length, 1, 'pre-registered channel announced by start()');
  assert.equal(flushes.length, 1, 'no extra flush when there are no stragglers');

  assert.equal(await sc.addChannel('normal'), true);
  assert.ok(joined.includes(topicOf(sc, 'normal')), 'joined straight away');
  assert.equal(joined.length, 2);
  assert.equal(flushes.length, 2);

  // Re-joining an announced channel is a no-op, not a second announce.
  assert.equal(await sc.addChannel('normal'), true);
  assert.equal(joined.length, 2, 'no redundant swarm.join');
  assert.equal(flushes.length, 2, 'no redundant flush');
});

test('a channel removed while its join is pending resolves false, never hangs', async () => {
  const { swarm, flushes } = makeSwarm();
  const sc = makeSidechannel(swarm);

  const startP = sc.start();
  await settle();

  let resolved = null;
  const joinP = sc.addChannel('doomed').then((ok) => {
    resolved = ok;
    return ok;
  });
  await settle();
  assert.equal(resolved, null);

  await sc.removeChannel('doomed');
  assert.equal(await joinP, false, 'waiter released with a truthful negative');

  flushes[0].resolve();
  await settle();
  if (flushes[1]) flushes[1].resolve();
  await settle();
  await startP;
});

test('stop() releases pending joins and clears announced state', async () => {
  const { swarm, flushes } = makeSwarm();
  const sc = makeSidechannel(swarm);

  const startP = sc.start();
  await settle();

  const joinP = sc.addChannel('pending');
  await settle();

  await sc.stop();
  assert.equal(await joinP, false, 'pending join resolves false on stop');
  assert.equal(sc.channels.get('boot').announced, false, 'announced state cleared');

  flushes[0].resolve();
  await settle();
  if (flushes[1]) flushes[1].resolve();
  await settle();
  await startP;
});

test('concurrent start() calls share one bootstrap', async () => {
  const { swarm, joined, flushes } = makeSwarm();
  const sc = makeSidechannel(swarm);

  const first = sc.start();
  const second = sc.start();
  await settle();

  assert.equal(joined.length, 1, 'the second start() must not re-join');
  assert.equal(flushes.length, 1, 'nor re-flush');

  flushes[0].resolve();
  await settle();
  await Promise.all([first, second]);
  assert.equal(sc.started, true);
});
