import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fanOutValidatorSends } from '../features/validator-fanout/index.js';

// Mirrors trac-msb's MessageOrchestrator: the validator is picked synchronously at the start of send(),
// retries go through this.send with a retry count.
function fakeNetwork(validators, answer) {
  const sentTo = [];
  const manager = {
    connectedValidators: () => [...validators],
    pickRandomValidator: pool => pool[0],
    pickRandomConnectedValidator() { return this.pickRandomValidator(this.connectedValidators()); }
  };
  const orchestrator = {
    async send(message, retries = 0) {
      const validator = message.address ? manager.pickRandomValidator(manager.connectedValidators()) : manager.pickRandomConnectedValidator();
      sentTo.push({ validator, retries });
      await new Promise(resolve => setTimeout(resolve, 5));
      const result = await answer(validator, retries);
      if (result === 'retry') return this.send(message, retries + 1);
      return result;
    }
  };
  return { network: { validatorMessageOrchestrator: orchestrator, validatorConnectionManager: manager }, sentTo };
}

test('every operation goes to three different validators', async () => {
  const { network, sentTo } = fakeNetwork(['a', 'b', 'c', 'd', 'e'], () => true);
  fanOutValidatorSends(network);
  assert.equal(await network.validatorMessageOrchestrator.send({ address: 'x' }), true);
  assert.equal(sentTo.length, 3);
  assert.equal(new Set(sentTo.map(s => s.validator)).size, 3);
  assert.equal(await network.validatorMessageOrchestrator.send({}), true);
  assert.equal(new Set(sentTo.slice(3).map(s => s.validator)).size, 3);
});

test('one validator that accepts is enough; all failing is a failure', async () => {
  const one = fakeNetwork(['a', 'b', 'c'], validator => validator === 'c');
  fanOutValidatorSends(one.network);
  assert.equal(await one.network.validatorMessageOrchestrator.send({ address: 'x' }), true);
  const none = fakeNetwork(['a', 'b', 'c'], () => false);
  fanOutValidatorSends(none.network);
  assert.equal(await none.network.validatorMessageOrchestrator.send({ address: 'x' }), false);
});

test('retries keep the single-validator path and picks are not forced afterwards', async () => {
  const { network, sentTo } = fakeNetwork(['a', 'b', 'c', 'd'], (validator, retries) => retries === 0 && validator !== 'a' ? 'retry' : true);
  fanOutValidatorSends(network);
  assert.equal(await network.validatorMessageOrchestrator.send({ address: 'x' }), true);
  assert.equal(sentTo.filter(s => s.retries === 0).length, 3);
  assert.ok(sentTo.filter(s => s.retries === 1).every(s => s.validator === 'a'));
});

test('one or no connected validator falls back to the plain send', async () => {
  const { network, sentTo } = fakeNetwork(['a'], () => true);
  fanOutValidatorSends(network);
  assert.equal(await network.validatorMessageOrchestrator.send({ address: 'x' }), true);
  assert.deepEqual(sentTo, [{ validator: 'a', retries: 0 }]);
});

test('the peer startup fans out validator sends', () => {
  const source = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
  assert.match(source, /fanOutValidatorSends\(msb\.network\)/);
});

test('the real trac-msb orchestrator sends to the three forced validators', async () => {
  const { default: MessageOrchestrator } = await import('trac-msb/src/core/network/services/MessageOrchestrator.js');
  const sent = [];
  const protocolSession = { preferredProtocol: 'legacy', supportedProtocols: { LEGACY: 'legacy', V1: 'v1' } };
  const validators = ['a', 'b', 'c', 'd', 'e'].map(c => c.repeat(64));
  const manager = {
    connectedValidators: () => [...validators],
    pickRandomValidator: pool => pool[0],
    pickRandomConnectedValidator() { return this.pickRandomValidator(this.connectedValidators()); },
    getConnection: () => ({ protocolSession }),
    sendSingleMessage: async (message, validator) => { sent.push(validator); },
    incrementSentCount() {}, getSentCount: () => 0, remove() {}
  };
  const state = { waitForUnsigned: async () => true };
  const orchestrator = new MessageOrchestrator(manager, state, { maxRetries: 3, messageThreshold: 1000, messageValidatorResponseTimeout: 10, addressPrefix: 'trac' });
  fanOutValidatorSends({ validatorMessageOrchestrator: orchestrator, validatorConnectionManager: manager });
  assert.equal(await orchestrator.send({ type: 12, txo: { tx: 'f'.repeat(64) } }), true);
  assert.equal(sent.length, 3);
  assert.equal(new Set(sent).size, 3);
});

test('the peer waits up to ten minutes for the MSB to append a transaction', () => {
  const source = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
  assert.match(source, /maxTxDelay: 600/);
});
