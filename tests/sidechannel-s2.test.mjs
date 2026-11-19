import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import Sidechannel from '../features/sidechannel/index.js';
import * as managed from '../features/sidechannel/managed.js';
import { receiveEncoding } from '../features/sidechannel/channel-options.js';
import { peer, port, wallet } from './helpers/sidechannel-wire.mjs';

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
