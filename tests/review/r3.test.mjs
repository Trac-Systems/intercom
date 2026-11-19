// R3 review proofs: release-path equivalence with no new option set. Each
// test asserts that an existing app sees exactly 0.0.11. A failing test
// documents an open R3 finding; see report-R3.md.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import module, { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// The bridges import `bare-ws`, a Bare addon; resolve it to the inert stub.
module.register(new URL('./r3-launcher-hooks.mjs', import.meta.url));
const CandidateBridge = (await import('../../features/sc-bridge/index.js')).default;
const ReleaseBridge = (await import('./fixtures/sc-bridge-0.0.11.js')).default;

const here = file => fileURLToPath(new URL(file, import.meta.url));
const bundledBare = createRequire(import.meta.resolve('bare-sidecar'))('./lib/bare');
const blob = file => {
  const data = fs.readFileSync(file);
  return crypto.createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');
};

function scratch(t, prefix) {
  const directory = fs.mkdtempSync(here(`./.${prefix}-`));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('R3 release sources: the Sidechannel class is 0.0.11 and the frozen launcher and bridge are origin/main', () => {
  assert.equal(blob(here('../../features/sidechannel/index.js')), '2e3c01455dc5f1d2ce941f35a31eb0e37d92e36b');
  assert.equal(blob(here('../fixtures/sidechannel-0.0.11.js')), '2e3c01455dc5f1d2ce941f35a31eb0e37d92e36b');
  assert.equal(blob(here('./fixtures/launcher-0.0.11.js')), 'babe901c9998c66409a9d5c0a5d48da462c243d9');
  assert.equal(blob(here('./fixtures/sc-bridge-0.0.11.js')), '0aadaa771dc718dab71e23819893d1a139e68ea2');
});

// Run the whole launcher startup path (real flag parsing, Sidechannel and
// SC-Bridge; stubbed MSB, peer, terminal and WebSocket server) for the
// candidate and the frozen 0.0.11 launcher, then compare everything built.
function launch(t, variant, args, env = {}) {
  const directory = scratch(t, 'launcher-r3');
  const run = spawnSync(process.execPath, [here('./r3-launcher-run.mjs'), variant,
    '--peer-stores-directory', path.join(directory, 'peer'), '--msb-stores-directory', path.join(directory, 'msb'), ...args], {
    encoding: 'utf8', timeout: 60_000, env: { ...process.env, SIDECHANNEL_OPTIONS: undefined, ...env }
  });
  assert.equal(run.status, 0, run.stderr);
  const line = run.stdout.split('\n').findLast(text => text.startsWith('R3RESULT '));
  assert.ok(line, run.stdout + run.stderr);
  return JSON.parse(line.slice('R3RESULT '.length));
}

const scenarios = {
  defaults: { args: [] },
  'bridge with legacy flags': {
    args: ['--sc-bridge', '1', '--sc-bridge-token', 'tok', '--sc-bridge-port', '0', '--sc-bridge-filter', 'needle',
      '--sidechannels', 'alpha,beta', '--sidechannel-pow-difficulty', '10', '--sidechannel-rate-bytes', '64000',
      '--sidechannel-max-bytes', '4096', '--sidechannel-owner-write-only', '1']
  },
  'bridge with channel filter': {
    args: ['--sc-bridge', '1', '--sc-bridge-token', 'tok', '--sc-bridge-port', '0', '--sc-bridge-filter', 'needle',
      '--sc-bridge-filter-channel', 'alpha', '--sidechannels', 'alpha']
  },
  quiet: { args: ['--sidechannel-quiet', '1'] },
  'empty SIDECHANNEL_OPTIONS': { args: ['--sc-bridge', '1', '--sc-bridge-token', 'tok', '--sc-bridge-port', '0'], env: { SIDECHANNEL_OPTIONS: '' } }
};

for (const [name, { args, env }] of Object.entries(scenarios)) {
  test(`R3 launcher with no option set builds the 0.0.11 objects (${name})`, t => {
    const release = launch(t, 'release', args, env);
    const candidate = launch(t, 'candidate', args, env);
    assert.equal(release.releaseClass, true);
    assert.equal(candidate.releaseClass, true);
    if (args.includes('--sc-bridge')) assert.ok(release.bridgeEvents.length > 0, 'the bridge emitted events');
    t.diagnostic(`bridge events: ${candidate.bridgeEvents.length}; signal hooks under Node: ${JSON.stringify(candidate.signals)}`);
    assert.deepEqual(candidate, release);
  });
}

test('R3 SC-Bridge three-argument deliveries match 0.0.11 for every filter mode', () => {
  const payloads = [
    { id: 'a', message: 'needle' }, { id: 'b', from: 'needle' }, { id: 'c', message: null, sig: 'needle' },
    { id: 'd', message: { k: 'needle' }, signature: 's', ttl: 0, ts: 0 }, 'needle', null, undefined, 7
  ];
  const now = Date.now;
  Date.now = () => 42;
  try {
    for (const config of [{}, { filter: 'needle' }, { filter: 'needle', filterChannels: ['x'] }, { filter: 'nomatch' }]) {
      const observe = Type => {
        const bridge = new Type({}, { token: 't', ...config });
        const out = [];
        bridge.clients.add({ ready: true, channels: null, filter: bridge.defaultFilter, socket: { write: d => out.push(d) } });
        for (const payload of payloads) bridge.handleSidechannelMessage('x', payload, {});
        return out;
      };
      assert.deepEqual(observe(CandidateBridge), observe(ReleaseBridge), JSON.stringify(config));
    }
  } finally {
    Date.now = now;
  }
});

// Under `npm start` the launcher runs in the bundled Bare. Load each
// launcher's imports, install its verbatim signal block with a recording
// shutdown, send the runner's SIGTERM and compare how the process ends.
function bareSignalRun(t, launcherFile) {
  const source = fs.readFileSync(launcherFile, 'utf8');
  const root = new URL('../../index.js', import.meta.url);
  const imports = source.match(/^import .+ from '[^']+';$/gm).map(line =>
    line.replace(/from '(\.\/[^']+)'/, (_, s) => 'from ' + JSON.stringify(new URL(s, root).href)));
  const block = source.match(/^if \(typeof process !== 'undefined' && process\.once\) \{\n[\s\S]*?\n\}$/m);
  assert.ok(block, 'locate the launcher signal block');
  const directory = scratch(t, 'signals-r3');
  const entry = path.join(directory, 'signals.mjs');
  fs.writeFileSync(entry, [...imports,
    "const shutdown = async () => { console.log('shutdown'); Bare.exit(0); };",
    block[0], "console.log('ready');", 'setInterval(() => {}, 1000);'].join('\n'));
  return new Promise((resolve, reject) => {
    const child = spawn(bundledBare, [entry], { stdio: ['ignore', 'pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stderr.on('data', d => { stderr += d; });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('no exit: ' + stderr)); }, 30_000);
    child.stdout.on('data', d => {
      stdout += d;
      if (String(d).includes('ready')) child.kill('SIGTERM');
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, shutdown: stdout.includes('shutdown') });
    });
  });
}

test('R3 under the bundled Bare a SIGTERM ends a release-path launcher exactly as 0.0.11 does', async t => {
  const release = await bareSignalRun(t, here('./fixtures/launcher-0.0.11.js'));
  const candidate = await bareSignalRun(t, here('../../index.js'));
  t.diagnostic(`0.0.11: ${JSON.stringify(release)}; candidate: ${JSON.stringify(candidate)}`);
  assert.deepEqual(candidate, release);
});
