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
  assert.match(indexSource, /await sidechannel\.start\(\);/);
  assert.doesNotMatch(indexSource, /sidechannel\s*\.\s*start\(\)\s*\.\s*then/);
  assert.match(indexSource, /const lifetime = new Promise/);
  assert.match(indexSource, /Pear\.teardown\(shutdown\)/);
  assert.match(indexSource, /await peer\.close\?\.\(\);/);
  assert.match(indexSource, /await msb\.close\?\.\(\);/);
  assert.match(indexSource, /await lifetime;/);
});

test('intercom depends on released trac-peer and trac-msb tags', () => {
  assert.equal(packageJson.dependencies['hyperschema'], '1.17.1');
  assert.equal(packageJson.dependencies['trac-peer'], 'github:Trac-Systems/trac-peer#v0.4.6');
  assert.equal(packageJson.dependencies['trac-msb'], 'github:Trac-Systems/main_settlement_bus#v0.2.19');
  assert.equal(packageLock.packages['node_modules/hyperschema'].version, '1.17.1');
  assert.equal(
    packageLock.packages['node_modules/trac-peer'].resolved,
    'git+ssh://git@github.com/Trac-Systems/trac-peer.git#64b8f401c13ee4e65ee3a29596f6517681e0879e'
  );
  assert.equal(
    packageLock.packages['node_modules/trac-msb'].resolved,
    'git+ssh://git@github.com/Trac-Systems/main_settlement_bus.git#3c0ec414dba8722806cf60f1781bd59803ba9f38'
  );
});
