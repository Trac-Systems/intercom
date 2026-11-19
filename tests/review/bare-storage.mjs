import fs from 'fs';
import c from 'compact-encoding';
import PeerWallet from 'trac-wallet';
import Release from '../fixtures/sidechannel-0.0.11.js';
import Candidate from '../../features/sidechannel/managed.js';
import { seenKey } from '../../features/sidechannel/seen.js';

const wallet = new PeerWallet({});
await wallet.ready;
await wallet.generateKeyPair();
const config = {
  channels: ['room'],
  channelOptions: { room: { verifySignature: true, powDifficulty: 5 } },
  seenPersistence: { directory: Bare.argv[2], hours: 2, maxFileBytes: 64 }
};
const peer = { wallet, swarm: { on() {}, join() {}, flush() {} } };
const sc = new Candidate(peer, config);
const release = new Release({ wallet }, { powEnabled: true, powDifficulty: 5 });
const now = 36000000;
sc._now = () => now;
await sc.start();
let conflict = false;
try {
  await new Candidate(peer, config).start();
} catch (error) {
  conflict = error.code === 'EEXIST';
}
if (!conflict) throw new Error('The second Bare writer must encounter the existing lock');
const keys = [];
for (const text of ['first', 'second', 'third']) {
  const frame = c.decode(c.json, c.encode(c.json, sc._buildPayload('room', text)));
  if (!release._checkPow(frame, 'room') || !release._verifySig(frame, frame.from)) {
    throw new Error('The release verifier rejected the typed wire frame');
  }
  sc._rememberOutbound(frame);
  keys.push(seenKey(frame, sc.channels.get('room').scope, true));
}
await sc.stop();
const restarted = new Candidate({ wallet }, config);
const retained = keys.map(key => restarted.protectedSeen.has(key, now));
const bytes = fs.statSync(config.seenPersistence.directory + '/seen-10.bin').size;
await restarted.stop();
console.log(JSON.stringify({ retained, bytes, version: Bare.versions.bare }));
Bare.exit(0);
