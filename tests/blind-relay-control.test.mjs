import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Client } from 'blind-relay';
import BlindRelay from '../features/blind-relay/index.js';

const key = n => Buffer.alloc(32, n);
function fixture() {
  const connections = [], swarm = new EventEmitter();
  const connect = (remote, options) => {
    const connection = new EventEmitter();
    Object.assign(connection, { publicKey: key(1), remotePublicKey: remote, options, userData: null,
      rawStream: {}, destroyed: false, destroying: false, write: () => true,
      setKeepAlive(ms) { this.keepAlive = ms; },
      destroy(error) {
        if (this.destroyed) return;
        this.destroyed = true;
        if (error) this.emit('error', error);
        this.emit('close');
      } });
    connections.push(connection); return connection;
  };
  Object.assign(swarm, { keyPair: { publicKey: key(2) }, connections: new Set(), peers: new Map(),
    dht: { connect }, server: { firewall: async () => false, _relayConnection() {} }, relayThrough: () => null });
  const feature = new BlindRelay({ swarm }, { relays: [key(3).toString('hex'), key(4).toString('hex')] });
  return { feature, swarm, connections, connect };
}

test('relay control handles share one identity and mux; releasing one cancels only its pairing', async t => {
  const { feature, swarm, connections } = fixture(); await feature.start(); t.after(() => feature.stop());
  const first = swarm.dht.connect(key(3)), second = swarm.dht.connect(key(3));
  assert.notEqual(first, second); assert.equal(connections.length, 1);
  assert.equal(first.rawStream, second.rawStream);
  first.setKeepAlive(1234); assert.equal(connections[0].keepAlive, 1234);
  const a = Client.from(first), b = Client.from(second);
  assert.equal(a.mux, b.mux);
  const requestA = a.pair(true, key(5), { id: 11 }), requestB = b.pair(true, key(6), { id: 12 });
  requestA.on('error', () => {}); requestB.on('error', () => {});
  const canceled = new Promise(resolve => requestA.once('close', resolve));
  first.destroy(); first.destroy();
  await canceled;
  assert.equal(connections[0].destroyed, false);
  assert.deepEqual([...b.requests].map(request => request.token), [key(6)]);
  second.destroy();
  assert.equal(connections[0].destroyed, true); assert.equal(feature.controls.size, 0);
});

test('failed control sockets reconnect, old handles cannot close replacements, and stop closes all sockets', async () => {
  const { feature, swarm, connections, connect } = fixture(); await feature.start();
  const first = swarm.dht.connect(key(3)), second = swarm.dht.connect(key(3));
  connections[0].destroy(new Error('relay lost'));
  const replacement = swarm.dht.connect(key(3));
  assert.equal(connections.length, 2); assert.notEqual(replacement.rawStream, first.rawStream);
  first.destroy(); second.destroy(); assert.equal(replacement.destroyed, false);
  swarm.dht.connect(key(4)); assert.equal(feature.controls.size, 2);
  await feature.stop(); await feature.stop();
  assert.ok(connections.every(connection => connection.destroyed));
  assert.equal(swarm.dht.connect, connect); assert.equal(feature.controls.size, 0);
});

test('unconfigured and explicitly keyed DHT connections retain their original behavior', async t => {
  const { feature, swarm, connections } = fixture(); await feature.start(); t.after(() => feature.stop());
  const options = { keyPair: { publicKey: key(7) } };
  const explicit = swarm.dht.connect(key(3), options), unrelated = swarm.dht.connect(key(8));
  assert.equal(explicit, connections[0]); assert.equal(unrelated, connections[1]);
  assert.equal(explicit.options, options); assert.equal(feature.controls.size, 0);
  explicit.destroy(); unrelated.destroy();
});

test('a rejected control channel is closed before creating a replacement socket', async t => {
  const { feature, swarm, connections } = fixture(); await feature.start(); t.after(() => feature.stop());
  const old = swarm.dht.connect(key(3));
  feature.controls.get(key(3).toString('hex')).client.destroy(new Error('session rejected'));
  const replacement = swarm.dht.connect(key(3));
  assert.equal(connections.length, 2); assert.equal(connections[0].destroyed, true);
  old.destroy(); assert.equal(replacement.destroyed, false); replacement.destroy();
});

test('a relay ignores a pairing over the per-peer limit and keeps the peer session with its links', () => {
  const { feature } = fixture();
  feature.options.maxSessionsPerPeer = 2; feature.started = true;
  const passed = [], session = new EventEmitter();
  Object.assign(session, { closed: false, _destroyed: false, _pairing: new Set(), _links: new Map(), destroyed: false,
    _pair: { onmessage: message => { passed.push(message); session._pairing.add(message.token.toString('hex')); } },
    _unpair: { onmessage: () => {} }, destroy() { this.destroyed = true; } });
  feature.server = { accept: () => session, _pairing: new Map(), stats: { pairings: { active: 0 } } };
  const connection = new EventEmitter(); connection.remotePublicKey = key(9);
  feature._accept(connection, key(9));
  for (const n of [1, 2, 3]) session._pair.onmessage({ token: key(10 + n), isInitiator: true });
  assert.equal(passed.length, 2, 'the third pairing is not passed on');
  assert.equal(session.destroyed, false, 'the session and its existing pairings stay');
  assert.equal(feature.counters.pairs_rejected, 1);
});
