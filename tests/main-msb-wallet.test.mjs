import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mainSource = fs.readFileSync(path.join(repoRoot, 'index.js'), 'utf8');

test('main peer starts MSB with its persisted wallet', () => {
  assert.match(mainSource, /const loadOrCreateWallet = async \(keyPairPath, walletOptions\) => \{/);
  assert.match(mainSource, /wallet\.importFromFile\(keyPairPath, b4a\.alloc\(0\)\);/);
  assert.match(mainSource, /const msbWallet = await loadOrCreateWallet\(msbConfig\.keyPairPath, walletOptions\);/);
  assert.match(mainSource, /new MainSettlementBus\(msbConfig, msbWallet\)/);
  assert.doesNotMatch(mainSource, /new MainSettlementBus\(msbConfig\);/);
});
