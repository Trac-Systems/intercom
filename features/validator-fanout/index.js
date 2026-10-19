// trac-msb hands each operation to one random validator and only tries another when that one answers with an
// error. A validator that answers OK and then never appends the operation loses it: the peer drops it after
// maxTxDelay (seen on mainnet 2026-10-19). Send every operation to up to `width` different validators at once,
// like the Trac wallet does. The MSB applies a transaction hash once; the others answer that it already exists.
export function fanOutValidatorSends(network, width = 3) {
  const orchestrator = network.validatorMessageOrchestrator;
  const manager = network.validatorConnectionManager;
  const send = orchestrator.send.bind(orchestrator);
  const pickRandomValidator = manager.pickRandomValidator.bind(manager);
  const pickRandomConnectedValidator = manager.pickRandomConnectedValidator.bind(manager);
  // The orchestrator picks its validator synchronously at the start of send(), so a pick forced around one
  // send() call reaches exactly that call.
  let forced = null;
  manager.pickRandomValidator = pool => forced !== null && pool.includes(forced) ? forced : pickRandomValidator(pool);
  manager.pickRandomConnectedValidator = () => forced ?? pickRandomConnectedValidator();
  orchestrator.send = (message, retries = 0) => {
    // The orchestrator's own retries go through this.send and keep its single-validator behaviour.
    if (retries > 0) return send(message, retries);
    const connected = manager.connectedValidators();
    if (connected.length <= 1) return send(message);
    const chosen = [...connected];
    for (let i = chosen.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [chosen[i], chosen[j]] = [chosen[j], chosen[i]];
    }
    const attempts = chosen.slice(0, width).map(validator => {
      forced = validator;
      try { return send(message); } finally { forced = null; }
    });
    return new Promise(resolve => {
      let left = attempts.length;
      const failed = () => { if (--left === 0) resolve(false); };
      for (const attempt of attempts) attempt.then(ok => ok ? resolve(true) : failed(), failed);
    });
  };
}
