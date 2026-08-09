// Regression test for the owner-write-only welcome-frame content-injection bug.
//
// On an owner-write-only channel the owner-signature gate is intentionally
// skipped for `auth` and `welcome` control frames (so listeners can authorize
// without write access). `auth` terminates with a return before the app handler,
// but `welcome` previously fell through to onMessage — so any peer holding the
// owner's (semi-public) signed welcome could set message.control = 'welcome' and
// inject spoofed-`from` content that other subscribers' apps received as if from
// the owner. The fix gives `welcome` the same terminal return as `auth` and adds
// a defense-in-depth owner-signature check on the content-dispatch path.
//
// This exercises the REAL message handler (the closure created in
// _openChannelForConnection) by feeding it crafted payloads through a fake mux,
// and asserts: (a) the welcome-frame injection is NOT dispatched, (b) a legit
// owner welcome still establishes channel access, (c) the owner can still write
// normally, (d) spoofed non-owner content is rejected. Uses only the sidechannel
// owner key + signatures — no subnet contract / writer / admin / MSB.

import test from 'node:test';
import assert from 'node:assert/strict';
import b4a from 'b4a';
import PeerWallet from 'trac-wallet';
import Sidechannel from '../features/sidechannel/index.js';

// module-private helper, copied so the test can build the welcome signature base
// exactly as _verifyWelcome does.
const stableStringify = (value) => {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
};

async function makeWallet() {
  const w = new PeerWallet({});
  await w.ready;
  if (!w.secretKey) { await w.generateKeyPair(null, null); await w.ready; }
  return w;
}
const peerStub = (wallet) => ({ wallet });
const toHex = (sig) => (typeof sig === 'string' ? sig : b4a.toString(sig, 'hex')).toLowerCase();

const CH = 'sig-owner-write';
const scConfig = (extra) => ({
  channels: [CH],
  ownerWriteChannels: [CH],
  powEnabled: false,
  inviteRequired: false,
  welcomeRequired: true,
  rateBytesPerSecond: 0, // disable the inbound limiter for the test
  ...extra,
});

// Fake mux/connection that captures the channel's onmessage handler and never
// "opens" (so no automatic welcome/auth is sent).
function fakeConn(remotePubHex) {
  const captured = {};
  const channel = {
    addMessage({ onmessage }) { captured.onmessage = onmessage; return { send() {} }; },
    open() {},
    fullyOpened() { return new Promise(() => {}); },
    close() {},
  };
  const mux = { createChannel() { return channel; }, pair() {} };
  const connection = { userData: mux, remotePublicKey: b4a.from(remotePubHex, 'hex') };
  return { connection, captured };
}

function makeOwnerWelcome(ownerSc, ownerWallet, ownerPubHex) {
  const wpayload = { channel: CH, ownerPubKey: ownerPubHex, text: 'welcome', issuedAt: Date.now(), version: 1 };
  const normalized = ownerSc._normalizeWelcomePayload(wpayload);
  const sig = ownerWallet.sign(b4a.from(stableStringify(normalized)));
  return { payload: wpayload, sig: toHex(sig) };
}

test('owner-write-only sidechannel: welcome-frame injection rejected; legit flows intact', async () => {
  const ownerWallet = await makeWallet();
  const recvWallet = await makeWallet();
  const attackerWallet = await makeWallet();
  const ownerPub = b4a.toString(ownerWallet.publicKey, 'hex'); // wallet.publicKey is a Buffer
  const ownerKeys = { [CH]: ownerPub };

  const ownerSc = new Sidechannel(peerStub(ownerWallet), scConfig({ ownerKeys }));
  const attackerSc = new Sidechannel(peerStub(attackerWallet), scConfig({ ownerKeys }));
  const dispatched = [];
  const recvSc = new Sidechannel(peerStub(recvWallet), scConfig({ ownerKeys, onMessage: (_n, p) => dispatched.push(p) }));

  const { connection, captured } = fakeConn(ownerPub);
  recvSc._openChannelForConnection(connection, { name: CH, protocol: `sidechannel/${CH}` });
  assert.equal(typeof captured.onmessage, 'function', 'message handler captured');

  const welcome = makeOwnerWelcome(ownerSc, ownerWallet, ownerPub);
  assert.equal(recvSc._verifyWelcome(welcome, CH, connection), true, 'test-built welcome verifies (sanity)');
  recvSc.welcomedChannels.delete(CH); // reset the side effect from the sanity check

  // (b) LEGIT owner welcome: establishes access, is NOT delivered as content.
  const legitWelcome = ownerSc._buildPayload(CH, { control: 'welcome', welcome });
  captured.onmessage(legitWelcome);
  assert.equal(recvSc._isWelcomed(CH), true, 'legit owner welcome established channel access');
  assert.equal(dispatched.length, 0, 'welcome frame not delivered to app as content');

  // (c) OWNER content: delivered normally.
  const ownerContent = ownerSc._buildPayload(CH, 'legit-signal');
  captured.onmessage(ownerContent);
  assert.equal(dispatched.length, 1, 'owner content delivered');
  assert.equal(dispatched[0].message, 'legit-signal');

  // (a) ATTACK (the regression): a welcome-control frame carrying spoofed content
  // plus the (semi-public) owner welcome, with from spoofed to the owner. Pre-fix
  // this reached onMessage (dispatched.length would become 2); post-fix the
  // terminal return keeps it out of the app.
  const attack = attackerSc._buildPayload(CH, { control: 'welcome', welcome, text: 'INJECTED', evil: true });
  attack.from = ownerPub;
  attack.origin = ownerPub;
  captured.onmessage(attack);
  assert.equal(dispatched.length, 1, 'welcome-frame content injection is NOT dispatched');

  // (d) SPOOFED non-owner content (from=owner but attacker signature): rejected by
  // the owner-write signature gate.
  const spoof = attackerSc._buildPayload(CH, 'spoofed-signal');
  spoof.from = ownerPub;
  spoof.origin = ownerPub;
  captured.onmessage(spoof);
  assert.equal(dispatched.length, 1, 'spoofed non-owner content rejected by owner-write gate');
});
