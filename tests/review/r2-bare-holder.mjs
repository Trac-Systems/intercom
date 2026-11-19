// R2 fixture: hold a managed receipt store under the bundled Bare runtime the
// way the launcher does after `await sidechannel.start()`, then wait for the
// supervisor's signal. The launcher itself installs no Bare signal handler.
import PeerWallet from 'trac-wallet';
import { ManagedSidechannel } from '../../features/sidechannel/managed.js';

const wallet = new PeerWallet({});
await wallet.ready;
await wallet.generateKeyPair();
const swarm = { on() {}, removeListener() {}, join() {}, leave() {}, flush() {}, connections: [] };
const sc = new ManagedSidechannel({ wallet, swarm }, {
  channels: ['room'],
  seenPersistence: { directory: Bare.argv[2] }
});
await sc.start();
console.log('ready');
setInterval(() => {}, 1000);
