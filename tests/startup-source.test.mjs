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
  assert.equal(packageJson.dependencies['trac-peer'], 'github:Trac-Systems/trac-peer#b157f7e8ef59e705c0eb00060e3384fa2e2f8bc8');
  assert.equal(packageJson.dependencies['trac-msb'], 'github:Trac-Systems/main_settlement_bus#237ccca5f95918193bce25f3cab6909fe0cfc0f1');
  assert.equal(packageLock.packages['node_modules/hyperschema'].version, '1.17.1');
  assert.equal(
    packageLock.packages['node_modules/trac-peer'].resolved,
    'git+ssh://git@github.com/Trac-Systems/trac-peer.git#b157f7e8ef59e705c0eb00060e3384fa2e2f8bc8'
  );
  assert.equal(
    packageLock.packages['node_modules/trac-msb'].resolved,
    'git+ssh://git@github.com/Trac-Systems/main_settlement_bus.git#237ccca5f95918193bce25f3cab6909fe0cfc0f1'
  );
});
