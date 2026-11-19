// R3 fixture: inert stand-ins for the launcher's network-facing modules. The
// launcher's flag parsing, the Sidechannel class and the SC-Bridge are real.
// One module instance per stubbed specifier (?which=...).
import path from 'node:path';

const which = new URL(import.meta.url).searchParams.get('which');
const state = globalThis.__r3 ??= {};

export const ENV = { MAINNET: 'mainnet' };

export function createConfig(_env, options) {
  const keyPairPath = path.join(options.storesDirectory, options.storeName, 'db', 'keypair.json');
  if (which === 'msb-env') {
    return {
      ...options, keyPairPath, bootstrap: Buffer.alloc(32, 1), channel: Buffer.from('r3-msb-channel'),
      addressPrefix: 'trac', derivationPath: null
    };
  }
  return { ...options, keyPairPath };
}

export class Feature {
  constructor(peer, config) { this.peer = peer; this.config = config; }
}
export class Contract {}
export class Protocol {}

export class Wallet {
  constructor(options) { this.options = options; this.publicKey = 'ab'.repeat(32); this.address = null; }
}

// Captures the objects the launcher hands to the peer and keeps start() offline.
export class Peer {
  constructor(options) {
    this.options = options;
    this.config = { bootstrap: Buffer.alloc(32, 2) };
    this.wallet = options.wallet;
    this.writerLocalKey = 'cd'.repeat(32);
    this.base = { key: Buffer.alloc(32, 2), writable: false, view: { get: async () => null } };
  }
  async ready() {}
  async close() {}
  set sidechannel(value) {
    state.sidechannel = value;
    value.start = async () => { state.started = (state.started ?? 0) + 1; };
  }
  get sidechannel() { return state.sidechannel; }
  set scBridge(value) { state.bridge = value; }
  get scBridge() { return state.bridge; }
}

export class MainSettlementBus {
  constructor() {
    this.network = {
      validatorMessageOrchestrator: { send: async () => true },
      validatorConnectionManager: {
        pickRandomValidator: () => null, pickRandomConnectedValidator: () => null, connectedValidators: () => []
      }
    };
  }
  async ready() {}
  async close() {}
}

export class Terminal {
  async start() {
    state.terminal = true;
    return { close() {} };
  }
}

class Server {
  constructor(options) { this.options = options; }
  on() { return this; }
  once() { return this; }
  close(cb) { cb?.(); }
}
export default { Server };
