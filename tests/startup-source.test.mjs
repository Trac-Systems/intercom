import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const indexSource = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const packageLock = JSON.parse(fs.readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));

test('startup passes the persisted MSB wallet into MainSettlementBus', () => {
  assert.match(indexSource, /const msbWallet = await loadOrCreateWallet\(msbConfig\.keyPairPath, walletOptions\);/);
  assert.match(indexSource, /new MainSettlementBus\(msbConfig, msbWallet\)/);
  assert.doesNotMatch(indexSource, /new MainSettlementBus\(msbConfig\);/);
});

test('sample timer is opt-in and does not write on default startup', () => {
  assert.match(indexSource, /const timerEnabled = parseBool\(timerEnabledRaw, false\);/);
  assert.match(indexSource, /if \(timerEnabled && admin && admin\.value === peer\.wallet\.publicKey && peer\.base\.writable\)/);
});

test('startup awaits sidechannel and owns the service lifetime', () => {
  assert.match(indexSource, /globalThis\.Bare\?\.argv/);
  assert.match(indexSource, /toArgMap\(bareArgv\.slice/);
  assert.match(indexSource, /await sidechannel\.start\(\);/);
  assert.doesNotMatch(indexSource, /sidechannel\s*\.\s*start\(\)\s*\.\s*then/);
  assert.match(indexSource, /const lifetime = new Promise/);
  assert.match(indexSource, /Pear\.teardown\(shutdown\)/);
  assert.match(indexSource, /await peer\.close\?\.\(\);/);
  assert.match(indexSource, /await msb\.close\?\.\(\);/);
  assert.match(indexSource, /await lifetime;/);
});

test('intercom depends on pinned trac-peer and patched released trac-msb', () => {
  assert.equal(packageJson.dependencies['hyperschema'], '1.17.1');
  assert.equal(packageJson.dependencies['trac-peer'], 'github:Trac-Systems/trac-peer#bbac60c7c07f66d4e599d36b4d8dcef860c409b8');
  assert.equal(packageJson.dependencies['trac-msb'], 'github:Trac-Systems/main_settlement_bus#208c90bd31e53e05762f37e6911e5f98e20774c1');
  assert.equal(packageLock.packages['node_modules/hyperschema'].version, '1.17.1');
  assert.equal(
    packageLock.packages['node_modules/trac-peer'].resolved,
    'git+ssh://git@github.com/Trac-Systems/trac-peer.git#bbac60c7c07f66d4e599d36b4d8dcef860c409b8'
  );
  assert.equal(
    packageLock.packages['node_modules/trac-msb'].resolved,
    'git+ssh://git@github.com/Trac-Systems/main_settlement_bus.git#208c90bd31e53e05762f37e6911e5f98e20774c1'
  );
  // trac-peer must pin the same trac-msb, or npm nests a second copy (see the hyperdht test below)
  assert.equal(packageLock.packages['node_modules/trac-peer'].dependencies['trac-msb'],
    'github:Trac-Systems/main_settlement_bus#208c90bd31e53e05762f37e6911e5f98e20774c1');
});

test('the Hypercore stall fix is applied at install time and re-applied by every root install', () => {
  // trac-msb and trac-peer patch their Hypercore copies from their own postinstall; npm only runs those when the
  // package itself is (re)installed, so the root postinstall re-applies them (idempotent) on every npm install/ci.
  assert.equal(packageLock.packages['node_modules/trac-msb'].hasInstallScript, true);
  assert.equal(packageLock.packages['node_modules/trac-peer'].hasInstallScript, true);
  assert.equal(packageLock.packages[''].hasInstallScript, true);
  assert.match(packageJson.scripts.postinstall, /node_modules\/trac-msb\/scripts\/hypercore-stallfix\/apply\.mjs/);
  assert.match(packageJson.scripts.postinstall, /node_modules\/trac-peer\/scripts\/hypercore-stallfix\/apply\.mjs/);
});

test('the tree resolves one hyperdht, at or past the null node-id guard', () => {
  // hyperdht 6.29.4 gated its persistent request dispatcher on the node id
  // (holepunchto/hyperdht#242). Before that, an inbound UNANNOUNCE arriving while
  // the node was ephemeral reached `onunannounce` with a null `dht.id`, which
  // sodium dereferences in C — a long-running peer aborted every few days.
  //
  // Both Trac pins carry this transitively, and they have to agree: trac-peer
  // depends on trac-msb at its own sha, so bumping one pin and not the other
  // installs a SECOND, nested trac-msb with the old hyperdht underneath it. The
  // lockfile reads as fixed while the peer keeps crashing on the nested copy.
  assert.equal(packageLock.packages['node_modules/hyperdht'].version, '6.29.6');
  const nested = Object.keys(packageLock.packages).filter(
    (key) => key !== 'node_modules/hyperdht' && key.endsWith('/hyperdht')
  );
  assert.deepEqual(nested, [], `hyperdht must resolve to a single copy, found: ${nested.join(', ')}`);
  const buses = Object.keys(packageLock.packages).filter((key) => key.endsWith('/trac-msb'));
  assert.deepEqual(buses, ['node_modules/trac-msb'],
    `trac-msb must resolve to a single copy, found: ${buses.join(', ')}`);
});
