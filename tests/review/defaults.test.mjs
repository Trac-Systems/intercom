import assert from 'node:assert/strict';
import test from 'node:test';
import c from 'compact-encoding';
import Release from '../fixtures/sidechannel-0.0.11.js';
import Candidate from '../../features/sidechannel/index.js';
import { frame, peer, port, wallet } from '../helpers/sidechannel-wire.mjs';

const signer = await wallet();

test('with options absent an ordinary delivery performs exactly the release policy work', t => {
  function observe(Type) {
    const { sc, delivered } = peer(Type, signer);
    const incoming = port(sc);
    const outgoing = port(sc);
    const reads = { channelPolicies: 0, seenPersistence: 0 };
    for (const name of Object.keys(reads)) {
      const value = sc[name];
      Object.defineProperty(sc, name, { get() { reads[name]++; return value; } });
    }
    const payload = { channel: 'room', id: 'receipt-1', message: { count: 1 }, ttl: 2 };
    incoming.inject(payload);
    assert.equal(incoming.encoding, c.json);
    assert.deepEqual(delivered.map(event => event.payload), [payload]);
    assert.equal(frame(outgoing.sent[0]).ttl, 1);
    return { ...reads };
  }
  const release = observe(Release);
  const candidate = observe(Candidate);
  t.diagnostic(JSON.stringify({ release, candidate }));
  assert.deepEqual(candidate, release);
});

test('legacy configured welcomes and the local wallet are consulted in release order', () => {
  function observe(Type) {
    const events = [];
    const localWallet = { get publicKey() { events.push('wallet'); return signer.publicKey; } };
    const key = signer.publicKey.toString('hex');
    const payload = { channel: 'room', issuedAt: 123, ownerPubKey: key, text: 'welcome', version: 1 };
    const signed = signer.sign(Buffer.from(JSON.stringify(payload))).toString('hex');
    const welcome = { payload, get sig() { events.push('welcome'); return signed; } };
    const { sc } = peer(Type, localWallet, { ownerKeys: { room: key }, welcomeByChannel: { room: welcome } });
    assert.equal(sc.getWelcome('room'), welcome);
    return events;
  }
  assert.deepEqual(observe(Candidate), observe(Release));
});

test('legacy application callback runs before relay and keeps ownership of its received object', () => {
  function observe(Type) {
    const events = [];
    let outgoing;
    const { sc } = peer(Type, signer, {
      onMessage(channel, payload) {
        assert.equal(outgoing.sent.length, 0);
        events.push(channel);
        payload.message.count++;
      }
    });
    const incoming = port(sc);
    outgoing = port(sc);
    const normal = { channel: 'room', id: 'receipt-2', message: { count: 2 }, ttl: 3 };
    incoming.inject(normal);
    incoming.inject(normal);
    assert.equal(outgoing.sent.length, 1);
    assert.equal(frame(outgoing.sent[0]).message.count, 3);
    assert.deepEqual(events, ['room']);
    return outgoing.sent;
  }
  assert.deepEqual(observe(Candidate), observe(Release));
});
