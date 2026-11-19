// R2 review proofs. Each test asserts the behaviour the feature should have.
// A failing test documents an open R2 finding; see report-R2.md.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import module, { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import c from 'compact-encoding';
import Sidechannel from '../../features/sidechannel/index.js';
import { ManagedSidechannel as Managed } from '../../features/sidechannel/managed.js';
import { SeenCache } from '../../features/sidechannel/seen.js';
import { peer, port, wallet } from '../helpers/sidechannel-wire.mjs';

const author = await wallet();
const reader = await wallet();
const sender = peer(Sidechannel, author).sc;
const launcher = new URL('../../index.js', import.meta.url);
const bundledBare = createRequire(import.meta.resolve('bare-sidecar'))('./lib/bare');
// The launcher's own limiter defaults (64,000 B/s, 256,000 B burst).
const launcherRate = { rateBytesPerSecond: 64000, rateBurstBytes: 256000 };

function scratch(t, prefix) {
  const directory = fs.mkdtempSync(fileURLToPath(new URL(`./.${prefix}-`, import.meta.url)));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

// R2-01 part A. Evaluate the launcher's two shutdown-hook guards, verbatim,
// after loading every launcher import under the bundled Bare sidecar binary.
test('R2-01 the bundled Bare launcher installs a shutdown hook that can release the writer lock', t => {
  const source = fs.readFileSync(launcher, 'utf8');
  const imports = source.match(/^import .+ from '[^']+';$/gm).map(line =>
    line.replace(/from '(\.\/[^']+)'/, (_, s) => 'from ' + JSON.stringify(new URL(s, launcher).href)));
  const pear = source.match(/^if \((typeof Pear !== 'undefined' && Pear\.teardown)\) Pear\.teardown\(shutdown\);$/m);
  // seenPersistence is a managed option, so evaluate the guard with a selection set.
  const binding = source.match(/^const signalProcess = .+;$/m);
  const signals = source.match(/^if \((typeof signalProcess !== 'undefined' && signalProcess\.once)\) \{$/m);
  assert.ok(pear && binding && signals, 'locate the launcher shutdown guards');
  const directory = scratch(t, 'runtime-r2');
  const entry = path.join(directory, 'guards.mjs');
  fs.writeFileSync(entry, [...imports, 'const selection = {};', binding[0],
    `console.log(JSON.stringify({ teardown: !!(${pear[1]}), signals: !!(${signals[1]}) }));`,
    'Bare.exit(0);'].join('\n'));
  const run = spawnSync(bundledBare, [entry], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe', 'pipe'], timeout: 20000 });
  assert.equal(run.status, 0, run.stderr);
  const guards = JSON.parse(run.stdout.trim().split('\n').at(-1));
  t.diagnostic('launcher guards under bundled Bare: ' + JSON.stringify(guards));
  assert.ok(guards.teardown || guards.signals, 'no shutdown path runs sidechannel.stop() under bundled Bare');
});

// R2-01 part B. bare-sidecar's destroy() is `_process.kill()` (SIGTERM).
test('R2-01 a persistent peer restarts after the runner stops its Bare process with SIGTERM', async t => {
  const directory = scratch(t, 'seen-r2');
  fs.chmodSync(directory, 0o700);
  const holder = fileURLToPath(new URL('./r2-bare-holder.mjs', import.meta.url));
  const child = spawn(bundledBare, [holder, directory], { stdio: ['ignore', 'pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', d => { stderr += d; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('holder did not start: ' + stderr)), 20000);
    child.stdout.on('data', d => { if (String(d).includes('ready')) { clearTimeout(timer); resolve(); } });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`holder exited ${code}: ${stderr}`)); });
  });
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  child.kill('SIGTERM');
  t.diagnostic('holder exit: ' + JSON.stringify(await exited));
  t.diagnostic('lock left behind: ' + fs.existsSync(path.join(directory, '.writer.lock')));
  const { sc } = peer(Managed, reader, { seenPersistence: { directory } });
  try {
    await sc.start();
  } finally {
    await sc.stop().catch(() => {});
  }
});

// R2-02. Ten connections each stay within their own 1 MiB/s allowance with
// small rejected frames. One honest neighbour sends ten signed quotes a second.
test('R2-02 an honest neighbour keeps its admission while other connections exhaust theirs', t => {
  const { sc, delivered } = peer(Managed, reader, {
    ...launcherRate, channelOptions: { room: { verifySignature: true } }
  });
  let now = 10_000;
  sc._now = () => now;
  const attackers = Array.from({ length: 10 }, () => port(sc));
  const honest = port(sc);
  const junk = c.encode(c.json, { id: 'junk', channel: 'room', message: 'x' });
  let sent = 0;
  for (let tick = 0; tick < 500; tick++, now += 10) {
    for (const input of attackers) for (let i = 0; i < 2; i++) input.receive(junk);
    if (tick % 10 === 0) {
      honest.inject(sender._buildPayload('room', 'quote ' + tick));
      sent++;
    }
  }
  t.diagnostic(`honest delivered ${delivered.length} of ${sent} over 5 s`);
  assert.ok(delivered.length >= sent * 0.9, `honest delivered ${delivered.length} of ${sent}`);
});

// R2-03. Hyperswarm's default connection cap is 64. Three connections send 64
// small validly signed frames each, within every per-connection allowance.
test('R2-03 relay load from three peers cannot silently suppress the node\'s own broadcast, welcome and relays', async t => {
  const ownerKey = reader.publicKey.toString('hex');
  const body = { channel: 'room', issuedAt: 123, ownerPubKey: ownerKey, text: 'hello', version: 1 };
  const welcome = { payload: body, sig: reader.sign(Buffer.from(JSON.stringify(body))).toString('hex') };
  const { sc } = peer(Managed, reader, {
    ...launcherRate, ownerKeys: { room: ownerKey }, welcomeByChannel: { room: welcome },
    channelOptions: { room: { verifySignature: true } }
  });
  const now = 10_000;
  sc._now = () => now;
  const ports = Array.from({ length: 64 }, () => port(sc));
  await new Promise(resolve => setImmediate(resolve));
  const total = () => ports.reduce((n, p) => n + p.sent.length, 0);
  for (const p of ports) p.sent.length = 0; // discard the welcomes sent on open
  for (let a = 0; a < 3; a++) {
    for (let i = 0; i < 64; i++) ports[a].inject(sender._buildPayload('room', `relay load ${a}.${i}`));
  }
  const before = total();
  const reported = sc.broadcast('room', 'own quote');
  const own = total() - before;
  const honest = sender._buildPayload('room', 'honest relay');
  ports[10].inject(honest);
  const relayed = total() - before - own;
  const late = port(sc);
  await new Promise(resolve => setImmediate(resolve));
  t.diagnostic(JSON.stringify({ relayLoadSends: before, reported, ownSends: own, honestRelays: relayed, welcomeOnNewSession: late.sent.length }));
  assert.ok(!reported || own > 0, 'broadcast() reported success but sent to no peer');
  assert.ok(relayed > 0, 'an admitted honest message was relayed to no peer');
  assert.equal(late.sent.length, 1, 'a new session never receives the owner welcome (no retry)');
});

// R2-04. 0.0.11's bridge delivered `payload?.message ?? payload` on the
// release path. The launcher still wires the release Sidechannel to it.
test('R2-04 the release-path SC-Bridge event is unchanged from 0.0.11 when the envelope has no message', async t => {
  if (typeof module.registerHooks !== 'function') return t.skip('module.registerHooks unavailable');
  module.registerHooks({
    resolve(specifier, context, next) {
      return specifier === 'bare-ws' ? { url: 'stub:bare-ws', shortCircuit: true } : next(specifier, context);
    },
    load(url, context, next) {
      return url === 'stub:bare-ws'
        ? { format: 'module', shortCircuit: true, source: 'export default { Server: class {} };' }
        : next(url, context);
    }
  });
  const Bridge = (await import('../../features/sc-bridge/index.js')).default;
  const bridge = new Bridge({}, {});
  const events = [];
  bridge.clients.add({ ready: true, socket: { write(data) { events.push(JSON.parse(data)); } } });
  const envelope = { type: 'sidechannel', id: 'a:1:x', channel: 'room', from: 'a', origin: 'a', ts: 1, ttl: 3, note: 'n' };
  bridge.handleSidechannelMessage('room', envelope, null); // release onMessage arity
  assert.deepEqual(events[0].message, envelope);
});

// R2-05. A transient forward clock step followed by correction.
test('R2-05 a corrected forward clock step keeps hourly receipt coverage after restart', t => {
  const hour = 3_600_000;
  const key = n => n.toString(16).padStart(64, '0');
  const options = directory => ({ directory, hours: 3, maxFileBytes: 64 }); // two receipts per hour file
  function run(directory, jump) {
    const base = 1000 * hour;
    const cache = new SeenCache(100, 1000, options(directory));
    cache.remember(key(1), base);
    if (jump) cache.remember(key(2), base + 9000 * hour); // e.g. a bad RTC read, then NTP
    cache.remember(key(3), base + 1 * hour);
    cache.remember(key(4), base + 2 * hour);
    cache.remember(key(5), base + 2 * hour);
    cache.close();
    const restarted = new SeenCache(100, 1000, options(directory));
    const retained = restarted.has(key(3), base + 2 * hour);
    const files = fs.readdirSync(directory).filter(name => name.endsWith('.bin'));
    restarted.close();
    return { retained, files };
  }
  const control = run(scratch(t, 'seen-r2'), false);
  const jumped = run(scratch(t, 'seen-r2'), true);
  t.diagnostic(JSON.stringify({ control, jumped }));
  assert.equal(control.retained, true);
  assert.equal(jumped.retained, true, 'a receipt from one hour ago, inside 3 h retention, was lost');
});

// R2-02 (second proof). The release limiter's block should stop a peer from
// spending shared capacity. Admission charges both token buckets first.
test('R2-02 a connection blocked by the byte limiter stops spending the shared admission budget', t => {
  const { sc } = peer(Managed, reader, { ...launcherRate, channelOptions: { room: { verifySignature: true } } });
  const now = 10_000;
  sc._now = () => now;
  const attacker = port(sc);
  const big = c.encode(c.json, { id: 'big', channel: 'room', message: 'x'.repeat(200_000) });
  for (let i = 0; i < 4; i++) attacker.receive(big); // three strikes: blocked
  const [connection] = sc.connections.keys();
  assert.ok(sc._isBlocked(connection));
  const before = sc.globalAdmission.tokens;
  const small = c.encode(c.json, { id: 'small', channel: 'room', message: 'x' });
  for (let i = 0; i < 10; i++) attacker.receive(small);
  t.diagnostic(`shared tokens before ${before}, after ${sc.globalAdmission.tokens}`);
  assert.equal(sc.globalAdmission.tokens, before);
});

// R2-06. Receipts hash the whole effective policy. A looser size limit is not
// an admission-strength change, yet it reopens replay of retained messages.
test('R2-06 an unrelated policy edit keeps verified receipts across restart', async t => {
  const directory = scratch(t, 'seen-r2');
  const config = maxReceiveBytes => ({
    seenPersistence: { directory }, channelOptions: { room: { verifySignature: true, maxReceiveBytes } }
  });
  const original = sender._buildPayload('room', 'retained quote');
  const first = peer(Managed, reader, config(65_536));
  await first.sc.start();
  port(first.sc).inject(original);
  await first.sc.stop();
  const next = peer(Managed, reader, config(131_072));
  await next.sc.start();
  port(next.sc).inject(original);
  await next.sc.stop();
  t.diagnostic(`deliveries before ${first.delivered.length}, after edit ${next.delivered.length}`);
  assert.equal(first.delivered.length, 1);
  assert.equal(next.delivered.length, 0, 'a retained, verified message was delivered again');
});

// R2-03 (second proof). Protomux reports mux-wide backpressure through
// channel.drained, which is common while cores replicate on a new connection.
// 0.0.11 queues the welcome; the managed path skips it and never retries.
test('R2-03 a session that opens under transient backpressure still receives the owner welcome', async t => {
  const ownerKey = reader.publicKey.toString('hex');
  const body = { channel: 'room', issuedAt: 123, ownerPubKey: ownerKey, text: 'hello', version: 1 };
  const welcome = { payload: body, sig: reader.sign(Buffer.from(JSON.stringify(body))).toString('hex') };
  const { sc } = peer(Managed, reader, {
    ownerKeys: { room: ownerKey }, welcomeByChannel: { room: welcome },
    channelOptions: { room: { verifySignature: true } }
  });
  const wire = port(sc);
  const [records] = sc.connections.values();
  const session = records.get('room').channel;
  session.drained = false; // the mux is still flushing replication data
  await new Promise(resolve => setImmediate(resolve));
  session.drained = true; // 'drain' fires
  await new Promise(resolve => setTimeout(resolve, 50));
  sc.broadcast('room', 'after drain');
  const controls = wire.sent.map(bytes => c.decode(c.json, bytes).message?.control ?? 'content');
  t.diagnostic('frames on the session: ' + JSON.stringify(controls));
  assert.ok(controls.includes('welcome'), 'the welcome was skipped and never resent');
});

// R2-08. 0.0.11 and its launcher accept any global difficulty. Persistence
// moves every channel onto the bounded miner, which fails closed above 16.
test('R2-08 persistence rejects an inherited global difficulty it can never satisfy at construction', t => {
  const directory = scratch(t, 'seen-r2');
  let sc;
  const create = () => { sc = peer(Managed, reader, { powEnabled: true, powDifficulty: 18, seenPersistence: { directory } }).sc; };
  try {
    assert.throws(create);
  } finally {
    if (sc) {
      t.diagnostic('constructed; broadcast returns ' + sc.broadcast('room', 'quote'));
      sc.stop();
    }
  }
});
