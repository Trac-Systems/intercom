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
  assert.equal(packageJson.dependencies['trac-peer'], 'github:Trac-Systems/trac-peer#e4b52ad1e5d3f48aea06f5e19a3830685dcfa441');
  assert.equal(packageJson.dependencies['trac-msb'], 'github:Trac-Systems/main_settlement_bus#ea72a9c82a85059c014387cb21f759d2419bed3c');
  assert.equal(packageLock.packages['node_modules/hyperschema'].version, '1.17.1');
  assert.equal(
    packageLock.packages['node_modules/trac-peer'].resolved,
    'git+ssh://git@github.com/Trac-Systems/trac-peer.git#e4b52ad1e5d3f48aea06f5e19a3830685dcfa441'
  );
  assert.equal(
    packageLock.packages['node_modules/trac-msb'].resolved,
    'git+ssh://git@github.com/Trac-Systems/main_settlement_bus.git#ea72a9c82a85059c014387cb21f759d2419bed3c'
  );
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
