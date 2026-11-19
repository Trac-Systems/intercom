// R3 module hooks. Network-facing launcher dependencies resolve to inert
// stubs. `index.js?release` loads the frozen 0.0.11 launcher in place of the
// candidate, so both resolve their relative imports from the repository root.
import fs from 'node:fs';

const stubs = new URL('./r3-launcher-stubs.mjs', import.meta.url).href;
const release = new URL('./fixtures/launcher-0.0.11.js', import.meta.url);
const candidate = new URL('../../index.js', import.meta.url).href;
const STUBBED = {
  'trac-peer': 'peer',
  'trac-msb/src/index.js': 'msb',
  'trac-msb/src/config/env.js': 'msb-env',
  'trac-peer/src/terminal/index.js': 'terminal',
  'bare-ws': 'ws'
};

export async function resolve(specifier, context, next) {
  if (Object.hasOwn(STUBBED, specifier)) {
    return { url: `${stubs}?which=${STUBBED[specifier]}`, format: 'module', shortCircuit: true };
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url === candidate + '?release') {
    return { format: 'module', source: fs.readFileSync(release, 'utf8'), shortCircuit: true };
  }
  return next(url, context);
}
