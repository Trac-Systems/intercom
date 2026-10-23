// A busy maker talks to several takers and the committee at once over each relay, so per-peer room is generous.
export const DEFAULTS = Object.freeze({
  maxSessions: 512,
  maxSessionsPerPeer: 64,
  maxClients: 1024,
  maxPending: 1024,
  rateBytesPerSecond: 8 * 1024 * 1024,
  rateBurstBytes: 16 * 1024 * 1024,
  idleTimeoutMs: 120_000,
  directTimeoutMs: 8_000,
  relayTimeoutMs: 20_000,
  sweepIntervalMs: 250,
});

export function relayKeys(values = []) {
  if (typeof values === 'string') values = values.split(',').filter((v) => v.trim());
  if (!Array.isArray(values)) throw new Error('Blind relay keys must be a comma-separated list.');
  return [...new Set(values.map((value) => {
    const key = String(value).trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(key)) throw new Error('Invalid blind relay public key.');
    return key;
  }))];
}

export function relayConfig(config = {}) {
  const result = { serve: config.serve === true, relays: relayKeys(config.relays) };
  for (const [key, fallback] of Object.entries(DEFAULTS)) {
    const value = config[key] ?? fallback;
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid blind relay ${key}.`);
    result[key] = value;
  }
  return result;
}

export function relayConfigFromFlags(flags) {
  const serve = flags['blind-relay-serve'];
  if (serve !== undefined && !['0', '1'].includes(String(serve))) {
    throw new Error('--blind-relay-serve must be 0 or 1.');
  }
  const config = { serve: String(serve) === '1', relays: flags['blind-relay'] ?? [] };
  for (const key of Object.keys(DEFAULTS)) {
    const flag = `blind-relay-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
    if (flags[flag] !== undefined) config[key] = Number(flags[flag]);
  }
  return relayConfig(config);
}
