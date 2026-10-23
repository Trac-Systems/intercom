import Feature from 'trac-peer/src/artifacts/feature.js';
import { Client, Server } from 'blind-relay';
import Protomux from 'protomux';
import b4a from 'b4a';
import { relayConfig, relayKeys } from './config.js';

const hex = (key) => b4a.toString(key, 'hex');
const failure = (message) => new Error(`Blind relay: ${message}`);

// All transport hooks below are instance-local and restored on stop. They target
// HyperDHT 6.29.6 / Hyperswarm 4.x / blind-relay 1.6.1; no dependency is patched.
export default class BlindRelay extends Feature {
  constructor(peer, config = {}) {
    super(peer, config);
    this.key = 'blind-relay';
    this.options = relayConfig(config);
    this.staticRelays = this.options.relays.slice();
    this.dynamicRelays = [];
    this.started = false;
    this.server = null;
    this.sessions = new Map();
    this.registrations = new Map();
    this.streams = new Map();
    this.attempts = new Map();
    this.routes = new WeakMap();
    this.rawRoutes = new WeakMap();
    this.clientConnections = new Set();
    this.controls = new Map();
    this.retryState = new WeakMap();
    this.generation = 0;
    this.counters = {
      direct_failures: 0, relay_attempts: 0, relay_connections: 0,
      sessions_rejected: 0, pairs_rejected: 0, rate_limited: 0,
      idle_closed: 0, bytes: 0, pairs_relayed: 0,
    };
    this.onConnection = (connection) => this._connection(connection);
  }

  async start() {
    if (this.started) return;
    const swarm = this.peer.swarm;
    if (!swarm?.dht || !swarm.server || !swarm.keyPair) {
      throw failure('requires an initialized peer swarm');
    }
    if (this.options.relays.includes(hex(swarm.keyPair.publicKey))) {
      throw failure('a peer cannot use itself as its relay');
    }
    if ((
      typeof swarm.dht.connect !== 'function'
      || typeof swarm.server.firewall !== 'function'
      || typeof swarm.server._relayConnection !== 'function'
    )) throw failure('unsupported HyperDHT transport');
    this.started = true;
    this.generation++;
    try {
      if (this.options.serve) {
        this.server = new Server({ createStream: (opts) => this._createStream(opts) });
      }
      this._installClient();
      swarm.on('connection', this.onConnection);
      for (const connection of swarm.connections) this._connection(connection);
      this.tokens = this.options.rateBurstBytes;
      this.lastSweep = Date.now();
      this.timer = setInterval(() => this._sweep(), this.options.sweepIntervalMs);
      this.timer.unref?.();
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  setRelays(keys) {
    const next = relayKeys(keys);
    const self = this.peer.swarm?.keyPair?.publicKey;
    const relays = [...new Set([...this.staticRelays, ...next])].filter(k => !self || k !== hex(self));
    this.dynamicRelays = next;
    this.options.relays = relays;
    return relays.slice();
  }

  _installClient() {
    const swarm = this.peer.swarm;
    const dht = swarm.dht;
    const server = swarm.server;
    this.originalConnect = dht.connect;
    this.originalRelayThrough = swarm.relayThrough;
    this.originalFirewall = server.firewall;
    this.originalRelayConnection = server._relayConnection;
    this.selectRelay = (force) => force && this.options.relays.length
      ? b4a.from(this.options.relays[0], 'hex')
      : null;
    swarm.relayThrough = this.selectRelay;
    this.connect = (remote, opts = {}) => {
      // HyperDHT uses its default identity for every relay control socket.
      // Share that socket so Hyperswarm does not evict it as a duplicate.
      if (opts.keyPair !== swarm.keyPair) {
        const control = !opts.keyPair && (this.options.relays.includes(hex(remote))
          || (this.options.serve && hex(remote) === hex(swarm.keyPair.publicKey)));
        return control ? this._controlConnection(remote, opts) : this.originalConnect.call(dht, remote, opts);
      }
      const info = swarm.peers.get(hex(remote));
      // Each destination starts at a random relay, so peers do not all crowd the first one in the shared list.
      const state = this.retryState.get(info) || { failures: 0, nextRelay: Math.floor(Math.random() * Math.max(1, this.options.relays.length)) };
      if (info) this.retryState.set(info, state);
      const relay = opts.relayThrough && this.options.relays.length
        ? b4a.from(this.options.relays[state.nextRelay++ % this.options.relays.length], 'hex')
        : null;
      const connection = this.originalConnect.call(dht, remote, { ...opts, relayThrough: relay });
      const generation = this.generation;
      this.routes.set(connection, relay ? hex(relay) : null);
      if (relay) this.counters.relay_attempts++;
      let opened = false;
      const clear = () => {
        clearTimeout(this.attempts.get(connection));
        this.attempts.delete(connection);
      };
      const retry = () => {
        if (!info || !this.started || generation !== this.generation) return;
        if (!relay && !opened) this.counters.direct_failures++;
        state.failures = relay ? state.failures + 1 : 0;
        // After trying the relay list, try direct again. Keep the native retry
        // queue alive even after a long outage, without a second dial loop.
        info.forceRelaying = !opened && state.failures < this.options.relays.length;
        info.attempts = 0;
      };
      connection.once('open', () => { opened = true; clear(); });
      connection.on('error', () => {});
      connection.once('close', () => { clear(); retry(); });
      const timeout = relay ? this.options.relayTimeoutMs : this.options.directTimeoutMs;
      this.attempts.set(connection, setTimeout(() => connection.destroy(failure('connection timeout')), timeout));
      return connection;
    };
    dht.connect = this.connect;
    this.firewall = async (remote, payload, address) => {
      if (await this.originalFirewall.call(server, remote, payload, address)) return true;
      const relay = payload?.relayThrough?.publicKey;
      return !!relay && !this.options.relays.includes(hex(relay)) && !(this.options.serve && hex(relay) === hex(swarm.keyPair.publicKey));
    };
    server.firewall = this.firewall;
    this.relayConnection = (handshake, relay, payload, noise) => {
      const key = relay || payload?.relayThrough?.publicKey;
      if (key && handshake.rawStream) this.rawRoutes.set(handshake.rawStream, hex(key));
      return this.originalRelayConnection.call(server, handshake, relay, payload, noise);
    };
    server._relayConnection = this.relayConnection;
  }

  _controlConnection(remote, opts) {
    const key = hex(remote);
    let state = this.controls.get(key);
    if (!state || state.connection.destroying || state.connection.destroyed || state.client.closed) {
      if (state) state.connection.destroy();
      const connection = this.originalConnect.call(this.peer.swarm.dht, remote, opts);
      connection.on('error', () => {});
      state = { connection, client: Client.from(connection, { id: connection.publicKey }), refs: 0 };
      this.controls.set(key, state);
      connection.once('close', () => { if (this.controls.get(key) === state) this.controls.delete(key); });
    }
    state.refs++;
    let released = false, token = null;
    const release = error => {
      if (released) return;
      released = true;
      Client._clients.delete(lease);
      if (--state.refs === 0) state.connection.destroy(error);
      else if (token && !state.client.closed) state.client.unpair(token);
    };
    // HyperDHT destroys its control handle when one pair closes. Keep the
    // shared socket and blind-relay client alive until the last pair releases it.
    const lease = new Proxy(state.connection, { get(target, property) {
      if (property === 'destroy') return release;
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    // Each handle owns one pairing, including cancellation before it completes.
    const client = new Proxy(state.client, { get(target, property) {
      if (property === 'pair') return (initiator, pairToken, stream) => {
        token = pairToken;
        return target.pair(initiator, pairToken, stream);
      };
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    Client._clients.set(lease, client);
    return lease;
  }

  _connection(connection) {
    const relay = this.routes.get(connection) || this.rawRoutes.get(connection.rawStream);
    if (relay) {
      this.routes.set(connection, relay);
      this.clientConnections.add(connection);
      this.counters.relay_connections++;
      // HyperDHT's relayed inbound path does not inherit connectionKeepAlive.
      // Explicit liveness bounds detect a vanished relay even on an idle peer.
      connection.setKeepAlive(Math.max(1, Math.min(5000, Math.floor(this.options.relayTimeoutMs / 3))));
      connection.setTimeout(this.options.relayTimeoutMs);
      connection.once('close', () => this.clientConnections.delete(connection));
    }
    if (!this.server || this.registrations.has(connection)) return;
    const mux = Protomux.from(connection);
    const onpair = (id) => {
      if (!this.started || !id || !b4a.equals(id, connection.remotePublicKey)) return;
      this._accept(connection, id);
    };
    mux.pair({ protocol: 'blind-relay' }, onpair);
    this.registrations.set(connection, mux);
    connection.once('close', () => this.registrations.delete(connection));
  }

  _accept(connection, id) {
    if (this.sessions.has(connection)) return;
    const peer = hex(connection.remotePublicKey);
    const samePeer = [...this.sessions.values()].filter((s) => s.peer === peer);
    if (this.sessions.size >= this.options.maxClients || samePeer.length >= this.options.maxSessionsPerPeer) {
      this.counters.sessions_rejected++;
      connection.destroy(failure('session limit'));
      return;
    }
    const session = this.server.accept(connection, { id });
    const state = { peer, session, connection, activity: Date.now(), pending: new Map() };
    this.sessions.set(connection, state);
    session.on('error', () => {});
    session.once('close', () => this.sessions.delete(connection));
    // 1.6.1 has no admission hook. Gate its decoded pair handler BEFORE it
    // allocates tokens or native streams, including repeated requests per mux.
    const onpair = session._pair.onmessage;
    session._pair.onmessage = (message, channel) => {
      if (session.closed || session._destroyed) return;
      const token = hex(message.token);
      const existing = this.server._pairing.get(token);
      if (existing?.links[+message.isInitiator]) return;
      const usage = [...this.sessions.values()].filter((s) => s.peer === peer)
        .reduce((n, s) => n + s.session._pairing.size + s.session._links.size, 0);
      const active = this.server.stats.pairings.active;
      if (session._links.has(token)
        || usage >= this.options.maxSessionsPerPeer
        || (!existing && this.server._pairing.size >= this.options.maxPending)
        || (existing && active >= this.options.maxSessions)) {
        // Ignore only this request: the asking side's attempt times out and moves on to its next relay. Destroying
        // the session dropped every link the peer already had on this relay, and they all came back at once.
        this.counters.pairs_rejected++;
        return;
      }
      state.activity = Date.now();
      state.pending.set(token, state.activity);
      onpair(message, channel);
    };
    session.on('pair', (initiator, token) => {
      state.pending.delete(hex(token));
      if (initiator) this.counters.pairs_relayed++;
    });
    const onunpair = session._unpair.onmessage;
    session._unpair.onmessage = (message, channel) => {
      onunpair(message, channel);
      // Cancellation can remove both sides of an unmatched token. Drop age
      // records immediately so a pair/unpair flood cannot grow this map.
      for (const other of this.sessions.values()) other.pending.delete(hex(message.token));
    };
  }

  _createStream(options) {
    const stream = this.peer.swarm.dht.createRawStream(options);
    const state = { stream, bytes: 0, activity: Date.now() };
    this.streams.set(stream, state);
    stream.on('error', () => {});
    stream.once('close', () => {
      this._measure(state, Date.now());
      this.streams.delete(stream);
    });
    return stream;
  }

  _measure(state, now) {
    // Received bytes count each forwarded byte once, unlike RX + TX on both
    // halves of a pair. Native UDX relayTo never decrypts the endpoint stream.
    const bytes = state.stream.bytesReceived;
    const delta = Math.max(0, bytes - state.bytes);
    if (delta) state.activity = now;
    state.bytes = bytes;
    this.counters.bytes += delta;
    this.tokens -= delta;
  }

  _sweep() {
    const now = Date.now();
    this.tokens = Math.min(this.options.rateBurstBytes,
      this.tokens + Math.max(0, now - this.lastSweep) * this.options.rateBytesPerSecond / 1000);
    this.lastSweep = now;
    for (const state of this.streams.values()) this._measure(state, now);
    if (this.tokens < 0) {
      this.counters.rate_limited++;
      for (const state of this.sessions.values()) state.session.destroy(failure('rate limit'));
      this.tokens = 0;
    }
    for (const state of this.sessions.values()) {
      let expired = false;
      for (const [token, created] of state.pending) {
        if (!state.session._pairing.has(token)) state.pending.delete(token);
        else if (now - created >= this.options.idleTimeoutMs) expired = true;
      }
      const active = [...state.session._links.values()].some((link) => {
        const stream = this.streams.get(link.stream);
        return stream && now - stream.activity < this.options.idleTimeoutMs;
      });
      for (const link of [...state.session._links.values()]) {
        const stream = this.streams.get(link.stream);
        if (stream && now - stream.activity >= this.options.idleTimeoutMs) {
          this.counters.idle_closed++;
          link.destroyPair(failure('idle timeout'));
        }
      }
      if (active) state.activity = now;
      if (expired || now - state.activity >= this.options.idleTimeoutMs) {
        this.counters.idle_closed++;
        state.session.destroy(failure('idle timeout'));
      }
    }
  }

  stats() {
    const { serve, relays, ...limits } = this.options;
    return {
      started: this.started, serving: serve,
      configured_relays: relays.slice(),
      sessions: this.sessions.size, active_pairs: this.server?.stats.pairings.active ?? 0,
      pending_pairs: this.server?._pairing.size ?? 0,
      peers_relayed: new Set([...this.sessions.values()]
        .filter((s) => s.session._links.size).map((s) => s.peer)).size,
      client_connections: this.clientConnections.size,
      limits,
      ...this.counters,
    };
  }

  async stop() {
    if (!this.started) return;
    this.started = false;
    clearInterval(this.timer);
    const swarm = this.peer.swarm;
    swarm.off('connection', this.onConnection);
    if (swarm.dht.connect === this.connect) swarm.dht.connect = this.originalConnect;
    if (swarm.relayThrough === this.selectRelay) swarm.relayThrough = this.originalRelayThrough;
    if (swarm.server.firewall === this.firewall) swarm.server.firewall = this.originalFirewall;
    if (swarm.server._relayConnection === this.relayConnection) swarm.server._relayConnection = this.originalRelayConnection;
    for (const info of swarm.peers.values()) {
      if (this.retryState.has(info)) info.forceRelaying = false;
    }
    this.retryState = new WeakMap();
    for (const [connection, timer] of this.attempts) {
      clearTimeout(timer);
      connection.destroy();
    }
    this.attempts.clear();
    for (const connection of this.clientConnections) connection.destroy();
    this.clientConnections.clear();
    for (const { connection } of this.controls.values()) connection.destroy();
    this.controls.clear();
    for (const mux of this.registrations.values()) mux.unpair({ protocol: 'blind-relay' });
    this.registrations.clear();
    for (const state of this.sessions.values()) state.session.destroy();
    if (this.server) await this.server.close();
    this.server = null;
    this.sessions.clear();
    for (const state of this.streams.values()) state.stream.destroy();
    this.streams.clear();
  }
}
