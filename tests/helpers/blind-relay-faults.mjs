import b4a from 'b4a';
const path = stream => ({ id: stream.id, remoteId: stream.remoteId, remotePort: stream.remotePort,
  remoteHost: stream.remoteHost, localPort: stream.localPort, localHost: stream.localHost });
// Test-only transport fault and raw forwarding audit; never installed by index.js. `markers` are plaintext strings the
// relay must never see in the bytes it forwards.
export function relayFaults(peer, isolatedKey, { capture = false, markers = [] } = {}) {
  const swarm = peer.swarm, self = swarm.keyPair.publicKey.toString('hex');
  const stats = { blocked: 0, direct: [], relayed: [], paths: [], ciphertextBytes: 0, plaintextMatches: 0, forwarding: [] };
  const firewall = swarm.server.firewall;
  const connect = swarm.dht.connect;
  swarm.dht.connect = function (remote, options = {}) {
    if (options.keyPair === swarm.keyPair && (self === isolatedKey || remote.toString('hex') === isolatedKey)) {
      // A relay request alone still permits HyperDHT's direct/LAN fast paths.
      options = { ...options, localConnection: false, fastOpen: false, holepunch: () => false };
    }
    return connect.call(this, remote, options);
  };
  swarm.server.firewall = function (remote, payload, address) {
    if ((self === isolatedKey || remote.toString('hex') === isolatedKey) && !payload?.relayThrough) {
      stats.blocked++; return true;
    }
    return firewall.call(this, remote, payload, address);
  };
  if (self === isolatedKey) {
    swarm.dht.remoteAddress = () => null;
    swarm.server._shareLocalAddress = false;
    swarm.server._neverPunch = true;
  }
  swarm.on('connection', connection => {
    const record = () => stats.paths.push({ peer: connection.remotePublicKey.toString('hex'), ...path(connection.rawStream) });
    record(); connection.rawStream.on('remote-changed', record);
    const relay = peer.blindRelay?.routes.get(connection) || peer.blindRelay?.rawRoutes.get(connection.rawStream);
    (relay ? stats.relayed : stats.direct).push(connection.remotePublicKey.toString('hex'));
  });
  if (capture) {
    const create = swarm.dht.createRawStream;
    swarm.dht.createRawStream = function (options) {
      const stream = create.call(this, options);
      // Only blind-relay server streams invoke relayTo. The bytes here precede endpoint Noise decryption.
      stream.relayTo = destination => {
        const link = { id: stream.id, destinationId: destination.id, bytes: 0 };
        stats.forwarding.push(link);
        const connected = () => Object.assign(link, path(stream));
        if (stream.connected) connected(); else stream.once('connect', connected);
        let tail = b4a.alloc(0);
        const forward = () => {
          stream.pipe(destination);
          stream.on('data', chunk => {
            link.bytes += chunk.length;
            stats.ciphertextBytes += chunk.length;
            const bytes = b4a.concat([tail, b4a.from(chunk)]);
            for (const marker of markers) {
              if (b4a.indexOf(bytes, b4a.from(marker)) >= 0) stats.plaintextMatches++;
            }
            tail = bytes.subarray(Math.max(0, bytes.length - 64));
          });
        };
        if (destination.connected) forward(); else destination.once('connect', forward);
        stream.once('close', () => destination.off('connect', forward));
        return stream;
      };
      return stream;
    };
  }
  return () => ({ ...stats, relay: peer.blindRelay?.stats() });
}
