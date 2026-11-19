import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const launcher = new URL('../../index.js', import.meta.url);
const requireSidecar = createRequire(import.meta.resolve('bare-sidecar'));
const bundledBare = requireSidecar('./lib/bare');
const options = { channelOptions: { quotes: { verifySignature: true } } };

// Exercise the actual imports and configuration expressions under the same
// sidecar binary and IPC setup as the launcher. Only those declarations enter
// the probe. No peer, MSB, discovery, wallet or production store is started.
function configurationProbe(t) {
  const source = fs.readFileSync(launcher, 'utf8');
  const imports = source.match(/^import .+ from '[^']+';$/gm);
  assert.ok(imports?.length);
  const relocated = imports.map(line => line.replace(/from '(\.\/[^']+)'/, (_, specifier) => {
    return 'from ' + JSON.stringify(new URL(specifier, launcher).href);
  }));
  const declarations = [
    /^const getIntercomRuntime = \(\) => \{[\s\S]*?^\};/m,
    /^const \{ env, storeLabel, flags \} = getIntercomRuntime\(\);$/m,
    /^const rawSidechannelOptions =[\s\S]*?;$/m,
    /^const selection =[\s\S]*?;$/m,
    /^const SidechannelType = .*;$/m
  ].map(pattern => {
    const match = source.match(pattern);
    assert.ok(match, 'locate the launcher configuration declaration');
    return match[0].replace(/import\('([.][^']+)'\)/g, (_, specifier) =>
      'import(' + JSON.stringify(new URL(specifier, launcher).href) + ')');
  });
  const directory = fs.mkdtempSync(fileURLToPath(new URL('./.runtime-', import.meta.url)));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const entry = path.join(directory, 'probe.mjs');
  fs.writeFileSync(entry, [...relocated, ...declarations,
    'console.log(JSON.stringify({ version: Bare.versions.bare, options: selection?.options, plain: SidechannelType === Sidechannel }));',
    'Bare.exit(0);'
  ].join('\n'));
  return entry;
}

function runBundled(entry, args, setting) {
  const env = { ...process.env };
  if (setting === undefined) delete env.SIDECHANNEL_OPTIONS;
  else env.SIDECHANNEL_OPTIONS = setting;
  const run = spawnSync(bundledBare, [entry, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe', 'pipe'], timeout: 10000,
    env
  });
  assert.ifError(run.error);
  assert.equal(run.status, 0, run.stderr);
  const last = run.stdout.trim().split('\n').at(-1);
  return JSON.parse(last);
}

test('the bundled launcher selects the identical release constructor with no effective options', t => {
  const entry = configurationProbe(t);
  for (const setting of [undefined, '', '{}', '{"seenPersistence":false,"channelOptions":{"room":{"verifySignature":false}}}']) {
    assert.equal(runBundled(entry, [], setting).plain, true);
  }
});

test('bundled Bare selects the supplied JSON CLI option', t => {
  const result = runBundled(configurationProbe(t), ['--sidechannel-options', JSON.stringify(options)], '{"channelOptions":{"unused":{"powDifficulty":1}}}');
  t.diagnostic('bundled Bare ' + result.version);
  assert.equal(result.plain, false);
  assert.deepEqual(result.options, options);
});

test('bundled Bare selects the documented environment-only configuration', t => {
  const result = runBundled(configurationProbe(t), [], JSON.stringify(options));
  t.diagnostic('bundled Bare ' + result.version);
  assert.equal(result.plain, false);
  assert.deepEqual(result.options, options);
});

test('bundled Bare verifies v1 work and signatures and reloads a compacted hour', t => {
  const directory = fs.mkdtempSync(fileURLToPath(new URL('./.storage-', import.meta.url)));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const probe = fileURLToPath(new URL('./bare-storage.mjs', import.meta.url));
  const result = runBundled(probe, [directory], '');
  assert.deepEqual(result.retained, [false, true, true]);
  assert.equal(result.bytes, 64);
});

test('installed system Bare gives the same import outcome for release and candidate', t => {
  const version = spawnSync('bare', ['--version'], { encoding: 'utf8', timeout: 10000 });
  if (version.error?.code === 'ENOENT') return t.skip('system Bare is unavailable');
  assert.ifError(version.error);
  assert.equal(version.status, 0, version.stderr);
  function load(relative) {
    const entry = fileURLToPath(new URL(relative, import.meta.url));
    const run = spawnSync('bare', [entry], { encoding: 'utf8', timeout: 10000 });
    assert.ifError(run.error);
    return { status: run.status, error: run.stderr.trim().split('\n')[0] };
  }
  const release = load('../fixtures/sidechannel-0.0.11.js');
  const candidate = load('../../features/sidechannel/index.js');
  t.diagnostic('system Bare ' + version.stdout.trim() + ' ' + JSON.stringify(release));
  assert.deepEqual(candidate, release);
});
