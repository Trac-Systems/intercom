import assert from 'node:assert/strict';
import test from 'node:test';

import {
  legacyPearRunRequested,
  parsePearMajor,
  selectPearRunnerMode,
} from '../scripts/pear-runner.mjs';

test('pear runner parses Pear v2 and v3 versions', () => {
  assert.equal(parsePearMajor('v0.4000.key / v2.9.1'), 2);
  assert.equal(parsePearMajor('v0.4000.key / v3.0.0\nSemVer=3.0.0'), 3);
  assert.equal(parsePearMajor(JSON.stringify({ semver: '3.1.4' })), 3);
});

test('pear runner can identify legacy Pear v2 when explicitly requested', () => {
  assert.equal(selectPearRunnerMode('v0.4000.key / v2.9.1'), 'legacy');
  assert.equal(selectPearRunnerMode('v0.4000.key / v3.0.0'), 'module');
  assert.equal(selectPearRunnerMode(''), 'module');
});

test('pear runner does not opt into pear run without an explicit env flag', () => {
  assert.equal(legacyPearRunRequested({}), false);
  assert.equal(legacyPearRunRequested({ MAYHEM_INTERCOM_LEGACY_PEAR_RUN: '0' }), false);
  assert.equal(legacyPearRunRequested({ MAYHEM_INTERCOM_LEGACY_PEAR_RUN: '1' }), true);
  assert.equal(legacyPearRunRequested({ MAYHEM_INTERCOM_LEGACY_PEAR_RUN: 'true' }), true);
});
