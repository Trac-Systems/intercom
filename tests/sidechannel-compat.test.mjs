import test from 'node:test';
import assert from 'node:assert/strict';
import c from 'compact-encoding';
import Old from './fixtures/sidechannel-0.0.11.js';
import Current from '../features/sidechannel/index.js';
import { wallet, peer, port, frame } from './helpers/sidechannel-wire.mjs';

const alice = await wallet();
const bob = await wallet();
const timestamp = 1_700_000_000_000;

function exchange(Sender, Receiver, config = {}) {
  const { sc: sender } = peer(Sender, alice, config);
  const { sc: receiver, delivered } = peer(Receiver, bob, config);
  sender._now = receiver._now = () => timestamp;
  const outgoing = port(sender);
  const incoming = port(receiver, 'room', alice.publicKey);
  const relay = port(receiver);
  outgoing.destination = incoming;
  const originalRandom = Math.random;
  try {
    Math.random = () => 0.125;
    assert.equal(sender.broadcast('room', { text: 'hello 🐊', nested: [2, 1] }), true);
  } finally {
    Math.random = originalRandom;
  }
  incoming.receive(outgoing.sent[0]); // A duplicate must never be forwarded.
  return { outgoing, incoming, relay, delivered, receiver };
}

for (const [label, config] of [
  ['open', {}],
  ['global proof of work', { powEnabled: true, powDifficulty: 5 }],
  ['owner-only', { ownerWriteChannels: ['room'], ownerKeys: { room: alice.publicKey } }]
]) {
  test('0.0.11 wire, delivery and relay agree in both directions on ' + label, () => {
    const baseline = exchange(Old, Old, config);
    for (const [Sender, Receiver] of [[Old, Current], [Current, Old]]) {
      const { outgoing, incoming, relay, delivered } = exchange(Sender, Receiver, config);
      assert.equal(incoming.encoding, c.json);
      assert.deepEqual(outgoing.sent, baseline.outgoing.sent);
      assert.deepEqual(relay.sent, baseline.relay.sent);
      assert.deepEqual(delivered, baseline.delivered);
      assert.equal(delivered.length, 1);
      assert.equal(relay.sent.length, 1);
      assert.equal(frame(relay.sent[0]).ttl, 2);
      assert.equal(incoming.sent.length, 0);
      assert.ok(delivered[0].payload.sig);
    }
  });
}

test('unconfigured receives retain legacy checks, offsets and costs', () => {
  for (const Type of [Old, Current]) {
    const { sc, delivered } = peer(Type, bob, { maxMessageBytes: 1 });
    const incoming = port(sc);
    const relay = port(sc);
    const calls = [];
    for (const name of ['_checkInvite', '_checkPow', '_checkRate', '_verifySig', '_rememberSeen', '_relay']) {
      const original = sc[name].bind(sc);
      sc[name] = (...args) => { calls.push(name); return original(...args); };
    }
    const unsigned = { id: 'old-msg', channel: 'room', message: 'unsigned 🐊', ttl: 1 };
    incoming.inject(unsigned);
    incoming.inject(unsigned);
    assert.deepEqual(delivered.map(d => d.payload), [unsigned]);
    assert.equal(relay.sent.length, 1);
    assert.deepEqual(calls, [
      '_checkInvite', '_checkPow', '_checkRate', '_rememberSeen', '_relay',
      '_checkInvite', '_checkPow', '_checkRate', '_rememberSeen'
    ]);
    assert.equal(sc.broadcast('room', 'oversize'), false);
  }
});

test('unconfigured welcome/owner/rate drops keep their 0.0.11 seen-list decisions', () => {
  for (const Type of [Old, Current]) {
    for (const [config, remembered] of [
      [{ welcomeRequired: true }, true],
      [{ ownerWriteOnly: true, ownerKeys: { room: alice.publicKey } }, false],
      [{ rateBytesPerSecond: 1, rateBurstBytes: 1 }, false]
    ]) {
      const { sc, delivered } = peer(Type, bob, config);
      const incoming = port(sc);
      const relay = port(sc);
      incoming.inject({ id: 'denied', channel: 'room', message: 'test', ttl: 1 });
      assert.equal(sc.seen.has('denied'), remembered);
      assert.equal(delivered.length, 0);
      assert.equal(relay.sent.length, 0);
    }
  }
});
