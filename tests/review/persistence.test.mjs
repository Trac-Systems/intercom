import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import Candidate from '../../features/sidechannel/index.js';
import { SeenCache } from '../../features/sidechannel/seen.js';
import { peer, port, wallet } from '../helpers/sidechannel-wire.mjs';

const hour = 3600000;
const key = value => createHash('sha256').update(value).digest('hex');
const signer = await wallet();

function privateDirectory(t) {
  const prefix = fileURLToPath(new URL('./.seen-', import.meta.url));
  const directory = fs.mkdtempSync(prefix);
  t.after(() => fs.rmSync(directory, { force: true, recursive: true }));
  return directory;
}

test('a two-second wall-clock correction across midnight preserves a recent receipt', t => {
  const directory = privateDirectory(t);
  const cache = new SeenCache(10, 120000, { directory, hours: 3 });
  const midnight = Date.UTC(2026, 0, 2);
  const receipt = key('one ordinary receipt');
  cache.remember(receipt, midnight + 1000);
  assert.ok(cache.has(receipt, midnight + 1000));
  assert.ok(cache.has(receipt, midnight - 1000));
  assert.ok(cache.has(receipt, midnight + 2000));
});

test('normal forward rotation expires exactly the oldest hour after restarting', t => {
  const directory = privateDirectory(t);
  const config = { directory, hours: 2, maxFileBytes: 96 };
  const cache = new SeenCache(3, 120000, config);
  const a = key('first receipt');
  const b = key('second receipt');
  cache.remember(a, 10 * hour);
  cache.remember(b, 11 * hour);
  const restarted = new SeenCache(3, 120000, config);
  assert.ok(restarted.has(a, 11 * hour + 20));
  assert.ok(restarted.has(b, 12 * hour));
  assert.equal(restarted.has(a, 12 * hour), false);
  assert.deepEqual(fs.readdirSync(directory), ['seen-11.bin']);
  assert.equal(fs.statSync(path.join(directory, 'seen-11.bin')).size, 32);
});

test('an unavailable append prevents delivery and a successful retry delivers exactly once', t => {
  const directory = privateDirectory(t);
  const { sc, delivered } = peer(Candidate, signer, {
    seenPersistence: { directory },
    channelOptions: { room: { verifySignature: true } }
  });
  const incoming = port(sc);
  const relay = port(sc);
  const payload = sc._buildPayload('room', { value: 7 });
  const files = sc.protectedSeen.files;
  const fault = Object.assign(new Error('test storage full'), { code: 'ENOSPC' });
  const append = t.mock.method(files, 'append', () => { throw fault; });
  assert.throws(() => incoming.inject(payload), error => error === fault);
  assert.deepEqual([delivered.length, relay.sent.length, sc.protectedSeen.ids.size], [0, 0, 0]);
  append.mock.restore();
  incoming.inject(payload);
  incoming.inject(payload);
  assert.deepEqual([delivered.length, relay.sent.length, sc.protectedSeen.ids.size], [1, 1, 1]);
});
