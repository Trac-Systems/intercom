// R3 fixture: run a launcher (candidate `index.js` or the frozen 0.0.11 copy)
// through its whole startup path with stubbed network modules, then print the
// constructed Sidechannel, its config, the SC-Bridge output and the signal
// hooks as one canonical JSON line.
// Usage: node r3-launcher-run.mjs <candidate|release> [launcher args...]
import module from 'node:module';

module.register(new URL('./r3-launcher-hooks.mjs', import.meta.url));
const variant = process.argv[2];
process.argv.splice(2, 1);
const state = globalThis.__r3 = {};
const Release = (await import('../../features/sidechannel/index.js')).default;
const launcher = new URL('../../index.js', import.meta.url).href + (variant === 'release' ? '?release' : '');
import(launcher).catch(error => {
  console.error(error);
  process.exit(2);
});
const deadline = Date.now() + 20_000;
while (!state.terminal) {
  if (Date.now() > deadline) throw new Error('launcher did not reach the terminal');
  await new Promise(resolve => setTimeout(resolve, 10));
}

function canonical(value, seen = new Set()) {
  if (value === undefined) return '<undefined>';
  if (typeof value === 'function') return `<fn ${value.length}> ${value.toString()}`;
  if (typeof value === 'bigint') return `<bigint ${value}>`;
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '<cycle>';
  seen.add(value);
  try {
    if (Buffer.isBuffer(value) || value instanceof Uint8Array) return `<bytes ${Buffer.from(value).toString('hex')}>`;
    if (value instanceof Map) return { '<map>': [...value].map(([k, v]) => [canonical(k, seen), canonical(v, seen)]) };
    if (value instanceof Set) return { '<set>': [...value].map(v => canonical(v, seen)) };
    if (Array.isArray(value)) return value.map(v => canonical(v, seen));
    const out = { '<class>': value.constructor?.name ?? null };
    for (const key of Object.keys(value).sort()) out[key] = canonical(value[key], seen);
    return out;
  } finally {
    seen.delete(value);
  }
}

const sc = state.sidechannel;
const { peer: _peer, config, ...fields } = sc;
const bridge = state.bridge ?? null;
const events = [];
if (bridge) {
  bridge.clients.add({
    ready: true, channels: null, filter: bridge.defaultFilter,
    socket: { write: data => events.push(JSON.parse(data)) }
  });
}
// The release bridge fills a missing ts with Date.now().
Date.now = () => 1_700_000_000_000;
const deliveries = [
  { channel: 'alpha', id: 'm1', from: 'aa', message: 'needle in message', ttl: 2, ts: 5 },
  { channel: 'alpha', id: 'm2', from: 'aa', message: { nested: 'needle' }, sig: 'ss', ttl: 1 },
  { channel: 'alpha', id: 'm3', from: 'needle-only-in-from' },
  { channel: 'alpha', id: 'm4', message: null, signature: 'needle-sig', relayedBy: 'rr' },
  { channel: 'beta', id: 'm5', message: 'no match here', origin: 'oo' },
  'needle as a bare string'
];
const callback = sc.onMessage;
const calls = [];
for (const payload of deliveries) {
  if (typeof callback === 'function') calls.push(canonical(callback('alpha', payload, { remotePublicKey: Buffer.alloc(32, 3) })));
}
const result = {
  releaseClass: sc.constructor === Release,
  className: sc.constructor.name,
  started: state.started ?? 0,
  config: canonical(config),
  fields: canonical(fields),
  callbackReturns: calls,
  bridgeEvents: events,
  bridgeServer: bridge ? canonical(bridge.server?.options) : null,
  signals: Object.fromEntries(['SIGHUP', 'SIGINT', 'SIGTERM'].map(name => [name, process.listenerCount(name)]))
};
console.log('R3RESULT ' + JSON.stringify(result));
process.exit(0);
