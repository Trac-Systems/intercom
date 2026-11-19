import Sidechannel from './index.js';
import b4a from 'b4a';
import c from '../../node_modules/compact-encoding/index.js';
import crypto from 'crypto';
import { boundedValue, channelPolicy, launcherOptions, receiveEncoding, MAX_CHANNELS, MAX_DIFFICULTY, MAX_FRAME_BYTES } from './channel-options.js';
import { SeenCache, seenKey } from './seen.js';
import { mine, verifyWork } from './pow.js';

const MAX_HOPS = 8;
const MAX_METADATA_BYTES = 16 * 1024;
const MAX_PENDING_FRAMES = 64;
const REPLAY_WINDOW_MS = 1_000;
const MIN_ADMISSION_COST = 16 * 1024;
const MIN_FORWARD_COST = 1024;
const GLOBAL_ADMISSION_BYTES = 8 * MAX_FRAME_BYTES;
// Own frames and handshakes wait behind mux backpressure, per connection.
export const BACKLOG_FRAMES = 256;
export const BACKLOG_BYTES = 2 * MAX_FRAME_BYTES;
export const TOTAL_BACKLOG_BYTES = 8 * MAX_FRAME_BYTES;

// One second of burst capacity. A backwards clock step grants no refill. A
// fair share shrinks when connections arrive, so clamp to the current size.
function refill(bucket, capacity, now) {
  if (bucket.time === undefined) {
    bucket.time = now;
    bucket.tokens = capacity;
  } else if (now > bucket.time) {
    bucket.tokens += (now - bucket.time) * capacity / 1000;
    bucket.time = now;
  }
  bucket.tokens = Math.min(capacity, bucket.tokens);
}

function spend(bucket, capacity, cost, now) {
  refill(bucket, capacity, now);
  if (cost > bucket.tokens) return false;
  bucket.tokens -= cost;
  return true;
}

// Each connection may always spend its fair share of an instance budget.
// That spending also draws the shared pool, into a debt of at most one pool,
// so the long-run total stays at the pool rate. Spending beyond the share
// borrows only tokens the pool still holds. Returns the plan or null.
function fairPlan(fair, pool, share, capacity, cost, now) {
  refill(fair, share, now);
  refill(pool, capacity, now);
  if (cost <= fair.tokens && pool.tokens - cost >= -capacity) return 'fair';
  return cost <= pool.tokens ? 'pool' : null;
}

function charge(plan, fair, pool, cost) {
  pool.tokens -= cost;
  if (plan === 'fair') fair.tokens -= cost;
}

function metadataFits(payload) {
  const { message, ...metadata } = payload;
  return b4a.byteLength(JSON.stringify(metadata)) <= MAX_METADATA_BYTES;
}

function frameBytes(payload) {
  if (!metadataFits(payload)) return Infinity;
  const bytes = b4a.byteLength(JSON.stringify(payload));
  const size = { end: bytes };
  c.uint.preencode(size, bytes);
  return size.end;
}

const HANDSHAKE = Symbol('handshake');

const stableStringify = (value) => {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
};

const normalizeKeyHex = (value) => {
  if (!value) return null;
  if (b4a.isBuffer(value)) return b4a.toString(value, 'hex');
  if (typeof value === 'string') return value.trim().toLowerCase();
  // JSON.stringify(Buffer.from(...)) yields { type: 'Buffer', data: [...] }.
  // Sidechannels use `c.json` encoding, so decode-side keys can arrive in this form.
  if (typeof value === 'object' && value.type === 'Buffer' && Array.isArray(value.data)) {
    try {
      return b4a.toString(b4a.from(value.data), 'hex');
    } catch (_e) {
      return null;
    }
  }
  return String(value).trim().toLowerCase();
};

const normalizeChannel = (value) => String(value || '').trim();

export { Sidechannel };

export class ManagedSidechannel extends Sidechannel {
  constructor(peer, config = {}) {
    // Register after policy validation. The release constructor initializes
    // the wallet, legacy settings and configured welcome map.
    super(peer, { ...config, channels: [] });
    this.config = config;
    this.admission = new WeakMap();
    this.globalAdmission = {};
    this.forwarding = new WeakMap();
    this.forwardBudget = {};
    this.replayBudget = {};
    this.recentReplays = new Map();
    this.backlogBytes = 0;
    // Cumulative send outcomes. Own frames include handshakes. Relays and
    // explicit rebroadcasts are best effort; skipped copies are counted.
    this.traffic = {
      ownSent: 0, ownQueued: 0, ownDropped: 0,
      relaySent: 0, relayDropped: 0, rebroadcastSent: 0, rebroadcastDropped: 0
    };
    this.pendingBytes = 0;
    this.pendingFrames = 0;
    this.waits = new Set();
    this.generation = 0;
    this.stopped = false;
    this.storageWarningAt = -Infinity;
    this.configuredWelcomes = new Map(this.welcomeByChannel);
    this.channelPolicies = new Map();
    const options = config.channelOptions;
    if (options !== undefined) {
      if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Expected channelOptions map');
      for (const [name, value] of options instanceof Map ? options : Object.entries(options)) {
        const channel = normalizeChannel(name);
        const policy = channelPolicy(channel, value);
        if (!policy) continue;
        if (this.channelPolicies.has(channel) || this.channelPolicies.size >= MAX_CHANNELS) {
          throw new RangeError('Duplicate channel policy or too many channels');
        }
        this.channelPolicies.set(channel, policy);
      }
    }
    this.startupPolicies = new Map(this.channelPolicies);
    this.seenPersistence = config.seenPersistence === false ? null : config.seenPersistence;
    // The bounded miner fails closed above 16 bits. Refuse a configuration
    // that would start and then drop every frame on a managed channel.
    const initial = Array.isArray(config.channels) ? config.channels.map(normalizeChannel) : [];
    for (const channel of new Set([...this.channelPolicies.keys(), ...(this.seenPersistence != null ? initial : [])])) {
      if (channel && this._boundedPowPolicy(channel)?.powDifficulty > MAX_DIFFICULTY) {
        throw new RangeError(`Effective PoW difficulty for ${channel} exceeds ${MAX_DIFFICULTY} on a managed channel`);
      }
    }
    this.protectedSeen = new SeenCache(this.maxSeen, this.seenTtlMs, this.seenPersistence);
    this.welcomedChannels.clear();
    this.welcomeByChannel.clear();
    for (const [channel, policy] of this.channelPolicies) {
      if (policy.welcome && !this._verifyWelcome(policy.welcome, channel, null)) {
        throw new TypeError(`Invalid configured welcome for ${channel}`);
      }
    }
    for (const name of Array.isArray(config.channels) ? config.channels : []) {
      if (!this.channels.has(normalizeChannel(name)) && this.channels.size >= MAX_CHANNELS) {
        throw new RangeError(`At most ${MAX_CHANNELS} joined channels with sidechannel options`);
      }
      this._registerChannel(name);
    }
  }

  // A verified receipt records that this author signed this ID on this
  // channel, which no policy edit changes. Unverified claims stay scoped to
  // the whole effective policy, so they never carry over to stronger rules.
  _receiptKey(entry, payload, verified) {
    return seenKey(payload, verified ? entry.scope : entry.claimScope, verified);
  }

  _rememberOutbound(payload) {
    const entry = this.channels.get(payload.channel);
    if (entry?.managed) {
      const verified = this._validAuthorSignature(payload, normalizeKeyHex(payload.from));
      if (!verified && this.channelPolicies.get(entry.name)?.verifySignature) return false;
      return this._storeReceipt(this._receiptKey(entry, payload, verified));
    }
    this._rememberSeen(payload.id, this._now());
    return true;
  }

  _storageFault(error) {
    const now = this._now();
    if (now >= this.storageWarningAt + 30_000) {
      this.storageWarningAt = now;
      console.warn('[sidechannel] seen storage unavailable:', error?.message ?? error);
    }
  }

  _storeReceipt(key) {
    try {
      this.protectedSeen.remember(key, this._now());
      return true;
    } catch (error) {
      this._storageFault(error);
      return false;
    }
  }

  _alreadySeen(key) {
    try {
      return this.protectedSeen.has(key, this._now());
    } catch (error) {
      this._storageFault(error);
      return true;
    }
  }

  // The share of an instance budget guaranteed to each connection.
  _fairShare(capacity) {
    return Math.min(MAX_FRAME_BYTES, capacity / Math.max(1, this.connections.size));
  }

  // Order: the release block, the per-connection ceiling, then the fair share
  // or shared pool, then the release byte limiter. A rejected frame spends
  // nothing, so a blocked or saturated connection takes no shared capacity.
  _admit(connection, bytes) {
    if (this._isBlocked(connection)) return false;
    const now = this._now();
    let local = this.admission.get(connection);
    if (!local) this.admission.set(connection, local = { ceiling: {}, fair: {} });
    const cost = Math.max(MIN_ADMISSION_COST, Math.min(bytes, MAX_FRAME_BYTES));
    refill(local.ceiling, MAX_FRAME_BYTES, now);
    if (cost > local.ceiling.tokens) return false;
    const plan = fairPlan(local.fair, this.globalAdmission, this._fairShare(GLOBAL_ADMISSION_BYTES),
      GLOBAL_ADMISSION_BYTES, cost, now);
    if (!plan || !this._checkRate(connection, bytes)) return false;
    local.ceiling.tokens -= cost;
    charge(plan, local.fair, this.globalAdmission, cost);
    return true;
  }

  // Relays are charged to the connection they came from, so a few busy
  // neighbours cannot use up forwarding for everyone else. Explicit
  // rebroadcasts (no origin) borrow from the shared pool only.
  _chargeForward(origin, bytes) {
    const now = this._now();
    const cost = Math.max(MIN_FORWARD_COST, bytes);
    if (!origin) return spend(this.forwardBudget, GLOBAL_ADMISSION_BYTES, cost, now);
    let fair = this.forwarding.get(origin);
    if (!fair) this.forwarding.set(origin, fair = {});
    const plan = fairPlan(fair, this.forwardBudget, this._fairShare(GLOBAL_ADMISSION_BYTES), GLOBAL_ADMISSION_BYTES, cost, now);
    if (plan) charge(plan, fair, this.forwardBudget, cost);
    return !!plan;
  }

  _buildPayload(channel, message, invite = null) {
    const ts = this._now();
    // Encode keys as hex strings, not Buffers, because we transmit payloads via JSON encoding.
    const from = normalizeKeyHex(this.peer?.wallet?.publicKey) ?? null;
    const id = `${from ?? 'anon'}:${ts}:${Math.random().toString(36).slice(2, 10)}`;
    const payload = {
      type: 'sidechannel',
      id,
      channel,
      from,
      origin: from,
      message,
      ts,
      ttl: this.channels.get(channel)?.managed ? this._hopLimit() : this.relayTtl,
    };
    if (invite) payload.invite = invite;
    if ((this.seenPersistence != null || this.channelPolicies?.has(channel)) && !boundedValue(payload)) return null;
    if (this._attachPow(payload) === false) return null;
    // Message-level signatures allow receivers to enforce "owner-only write" even when
    // messages are relayed (the transport peer can be a relay, not the original sender).
    const signed = this._attachSig(payload);
    if (!signed && this.channelPolicies?.get(channel)?.verifySignature) return null;
    return payload;
  }

  _hopLimit() {
    return Math.max(0, Math.min(MAX_HOPS, this.relayTtl));
  }

  // kind is 'own' (broadcast), 'handshake' (welcome/auth), 'relay' or
  // 'rebroadcast'. Own frames and handshakes on a managed session queue in
  // order behind backpressure and report whether they were sent or queued.
  // Relays and rebroadcasts are skipped while the session is busy and are
  // charged to the forwarding budget; both outcomes are counted.
  _sendFrame(record, payload, bytes, kind = 'relay', origin = null) {
    const own = kind === 'own' || kind === 'handshake';
    const perConn = record?.perConn;
    if (!perConn || !record.channel?.opened || record.channel.closed || (record.managed && bytes > MAX_FRAME_BYTES)) {
      return this._skipped(own ? 'own' : kind);
    }
    if (perConn.backlog.length) this._flushBacklog(perConn);
    const busy = record.channel.drained === false || perConn.backlog.length > 0;
    if (!own) {
      if (busy || !this._chargeForward(origin, bytes)) return this._skipped(kind);
    } else if (busy && record.managed) {
      return this._enqueue(perConn, record, payload, bytes, kind === 'handshake');
    }
    record.message.send(payload);
    this.traffic[own ? 'ownSent' : kind + 'Sent']++;
    return true;
  }

  _skipped(kind) {
    this.traffic[kind + 'Dropped']++;
    return false;
  }

  // Handshakes are at most two per session and only need the per-connection
  // bound. A handshake that does not fit is rebuilt once the backlog drains.
  _enqueue(perConn, record, payload, bytes, handshake) {
    if (perConn.backlog.length >= BACKLOG_FRAMES || perConn.backlogBytes + bytes > BACKLOG_BYTES ||
        (!handshake && this.backlogBytes + bytes > TOTAL_BACKLOG_BYTES)) {
      if (handshake) perConn.handshakes.add(record);
      return this._skipped('own');
    }
    perConn.backlog.push({ record, payload, bytes });
    perConn.backlogBytes += bytes;
    this.backlogBytes += bytes;
    this.traffic.ownQueued++;
    return true;
  }

  _flushBacklog(perConn) {
    const queue = perConn.backlog;
    while (queue.length) {
      const item = queue[0];
      const { record } = item;
      const live = perConn.get(record.name) === record && record.channel.opened && !record.channel.closed;
      if (live && record.channel.drained === false) return;
      queue.shift();
      perConn.backlogBytes -= item.bytes;
      this.backlogBytes -= item.bytes;
      if (!live) {
        this.traffic.ownDropped++;
        continue;
      }
      record.message.send(item.payload);
      this.traffic.ownSent++;
    }
    const retry = [...perConn.handshakes];
    perConn.handshakes.clear();
    for (const record of retry) {
      if (perConn.get(record.name) !== record || record.channel.closed) continue;
      this._sendWelcome(record, record.entry, record.connection);
      this._sendAuth(record, record.entry);
    }
  }

  // Drop queued frames that match, e.g. one session on leave or all on close.
  _purgeBacklog(perConn, match = () => true) {
    const kept = [];
    for (const item of perConn.backlog) {
      if (!match(item.record)) {
        kept.push(item);
        continue;
      }
      perConn.backlogBytes -= item.bytes;
      this.backlogBytes -= item.bytes;
      this.traffic.ownDropped++;
    }
    perConn.backlog = kept;
    for (const record of perConn.handshakes) if (match(record)) perConn.handshakes.delete(record);
  }

  _relay(channel, payload, origin) {
    if (!this.channels.get(channel)?.managed) return super._relay(channel, payload, origin);
    if (!this.relayEnabled || !Number.isSafeInteger(payload.ttl)) return;
    const hops = Math.min(payload.ttl, this._hopLimit());
    if (hops <= 0) return;
    const relayed = { ...payload, ttl: hops - 1, relayedBy: normalizeKeyHex(this.peer?.wallet?.publicKey) };
    const bytes = frameBytes(relayed);
    if (bytes > MAX_FRAME_BYTES) return;
    for (const [connection, records] of this.connections) {
      if (connection !== origin && this._remoteAuthorized(channel, connection) && records.has(channel)) {
        this._sendFrame(records.get(channel), relayed, bytes, 'relay', origin);
      }
    }
  }

  _ownerWriteOnly(channel) {
    if (this._isEntry(channel)) return false;
    return this.channelPolicies?.get(channel)?.ownerWriteOnly ?? super._ownerWriteOnly(channel);
  }

  _getOwnerKey(channel) {
    return this.channelPolicies?.get(normalizeChannel(channel))?.ownerKey ?? super._getOwnerKey(channel);
  }

  _welcomeRequired(channel) {
    if (this._isEntry(channel)) return false;
    return this.channelPolicies?.get(channel)?.welcomeRequired ?? super._welcomeRequired(channel);
  }

  _boundedPowPolicy(channel) {
    const policy = this.channelPolicies?.get(channel);
    if (policy?.powDifficulty !== undefined) return policy;
    if (!policy && this.seenPersistence == null) return null;
    return { powBitsPerKiB: policy?.powBitsPerKiB, powDifficulty: this._powRequired(channel) ? this.powDifficulty : 0 };
  }

  _attachPow(payload) {
    const channel = payload?.channel ?? '';
    const policy = this._boundedPowPolicy(channel);
    if (policy) {
      if (policy.powDifficulty > MAX_DIFFICULTY) return false;
      if (!policy.powDifficulty && !policy.powBitsPerKiB) return true;
      try {
        return mine(payload, policy, stableStringify);
      } catch {
        return false;
      }
    }
    return super._attachPow(payload);
  }

  _checkPow(payload, channel) {
    const policy = this._boundedPowPolicy(channel);
    if (policy) {
      if (policy.powDifficulty > MAX_DIFFICULTY) return false;
      if (!policy.powDifficulty && !policy.powBitsPerKiB) return true;
      return verifyWork(payload, policy, stableStringify);
    }
    return super._checkPow(payload, channel);
  }

  _validAuthorSignature(payload, author) {
    const sig = payload?.sig || payload?.signature;
    if (typeof author !== 'string' || !/^[0-9a-f]{64}$/.test(author)) return false;
    if (typeof sig !== 'string' || !/^[0-9a-f]{128}$/i.test(sig)) return false;
    try {
      return this._verifySig(payload, author);
    } catch {
      return false;
    }
  }

  _registerChannel(name, options) {
    const channel = normalizeChannel(name);
    if (!channel || b4a.byteLength(channel) > 256) return null;
    const existing = this.channels.get(channel);
    const previous = this.channelPolicies.get(channel);
    let policy = previous;
    if (options !== undefined) {
      if (!options || typeof options !== 'object' || Array.isArray(options)) return null;
      try {
        policy = channelPolicy(channel, { ...this.startupPolicies.get(channel), ...options });
      } catch {
        return null;
      }
    }
    if (existing && options === undefined) return existing;
    if (existing) return stableStringify(policy) === stableStringify(previous) ? existing : null;
    if (this.channels.size >= MAX_CHANNELS) return null;
    // Startup keys always occupy their slot, even during a disabled override.
    if (policy && !previous && !this.startupPolicies.has(channel)) {
      let reserved = this.startupPolicies.size;
      for (const key of this.channelPolicies.keys()) if (!this.startupPolicies.has(key)) reserved++;
      if (reserved >= MAX_CHANNELS) return null;
    }
    // A managed join above the bounded miner's limit would drop every frame.
    const difficulty = policy?.powDifficulty ?? (this._powRequired(channel) ? this.powDifficulty : 0);
    if ((policy || this.seenPersistence != null) && difficulty > MAX_DIFFICULTY) return null;
    const entry = super._registerChannel(channel);
    if (!entry) return null;
    if (policy) this.channelPolicies.set(channel, policy);
    else this.channelPolicies.delete(channel);
    const owner = this._getOwnerKey(channel);
    const welcome = policy?.welcome ?? this.configuredWelcomes.get(channel);
    const learned = this.welcomeByChannel.get(channel);
    const wasWelcomed = this.welcomedChannels.has(channel);
    this.welcomedChannels.delete(channel);
    this.welcomeByChannel.delete(channel);
    try {
      if (welcome && !this._verifyWelcome(welcome, channel, null) && policy?.welcome) {
        throw new Error('Invalid configured welcome');
      }
      if (!this._isWelcomed(channel) && learned) this._verifyWelcome(learned, channel, null);
    } catch {
      this.channels.delete(channel);
      if (learned) this.welcomeByChannel.set(channel, learned);
      if (wasWelcomed) this.welcomedChannels.add(channel);
      if (previous) this.channelPolicies.set(channel, previous);
      else this.channelPolicies.delete(channel);
      return null;
    }
    if (owner && owner === normalizeKeyHex(this.peer?.wallet?.publicKey)) this._rememberWelcome(channel);
    entry.managed = !!policy || this.seenPersistence != null;
    if (entry.managed) {
      const effective = {
        policy, owner, ownerOnly: this._ownerWriteOnly(channel), welcome: this._welcomeRequired(channel),
        requireInvite: this._inviteRequired(channel), inviters: [...(this.inviterKeys ?? [])].sort(),
        pow: this._boundedPowPolicy(channel), configuredWelcome: welcome,
        allowRemoteOpen: this.allowRemoteOpen
      };
      // Verified receipts keep one scope; unverified claims use the policy.
      // The channel, author, handshake kind and ID are part of every key.
      entry.scope = 'verified';
      entry.claimScope = crypto.createHash('sha256').update(stableStringify(effective)).digest('hex');
    }
    return entry;
  }

  _sendWelcome(record, entry, connection) {
    const welcome = this._getConfiguredWelcome(entry.name);
    if (!welcome) return;
    const ownerKey = this._getOwnerKey(entry.name);
    const selfKey = normalizeKeyHex(this.peer?.wallet?.publicKey);
    if (!ownerKey || !selfKey || ownerKey !== selfKey) return;
    // For invite-only channels, don't send plaintext control payloads to unauthorized peers.
    if (connection && this._inviteRequired(entry.name)) {
      const remoteKey = this._getRemoteKey(connection);
      const remoteIsInviter = this.inviterKeys && this.inviterKeys.has(remoteKey);
      if (!remoteIsInviter && !this._isInvited(entry.name, remoteKey)) return;
    }
    if (!record?.message) return;
    const payload = this._buildPayload(entry.name, { control: 'welcome', welcome });
    if (!payload) return;
    if (!this._rememberOutbound(payload)) return;
    if (entry.managed) this._sendFrame(record, payload, frameBytes(payload), 'handshake');
    else record.message.send(payload);
  }

  _sendAuth(record, entry) {
    if (!record?.message || record.authSent) return;
    if (!this._inviteRequired(entry.name)) return;
    const selfKey = normalizeKeyHex(this.peer?.wallet?.publicKey);
    const selfIsInviter = this.inviterKeys && selfKey && this.inviterKeys.has(selfKey);
    if (selfIsInviter) return;
    if (!this._isLocallyInvited(entry.name)) return;
    const invite = this.localInviteObjects.get(normalizeChannel(entry.name));
    if (!invite) return;
    const payload = this._buildPayload(entry.name, {
      control: 'auth',
      invite,
    });
    if (!payload) return;
    if (!this._rememberOutbound(payload)) return;
    if (entry.managed) record.authSent = this._sendFrame(record, payload, frameBytes(payload), 'handshake');
    else {
      record.message.send(payload);
      record.authSent = true;
    }
  }

  _allowChannelRequest(target, payload, connection) {
    const welcome = payload?.message?.welcome || payload?.message?.invite?.welcome;
    if (welcome) {
      if (!this._verifyWelcome(welcome, target, connection)) {
        if (this.debug) {
          console.log(`[sidechannel] open denied (welcome) for ${target} from ${this._getRemoteKey(connection)}`);
        }
        return false;
      }
    } else if (this._welcomeRequired(target)) {
      if (this.debug) {
        console.log(
          `[sidechannel] open denied (missing welcome) for ${target} from ${this._getRemoteKey(connection)}`
        );
      }
      return false;
    }
    if (this._inviteRequired(target)) {
      const invite = payload?.message?.invite;
      if (!invite || !this._verifyInvite(invite, target, connection)) {
        if (this.debug) {
          console.log(`[sidechannel] open denied (invite) for ${target} from ${this._getRemoteKey(connection)}`);
        }
        return false;
      }
    }
    return true;
  }

  _deliveryAction(payload, entry, connection, ownerChecked) {
    const control = payload?.message?.control;
    const requestedChannel = payload?.message?.channel;
    const isWelcome = this._isWelcomeMessage(payload);
    const embeddedWelcome = this._extractWelcome(payload);
    let welcomeOk = false;
    if (embeddedWelcome) {
      welcomeOk = this._verifyWelcome(embeddedWelcome, entry.name, connection);
      if (!welcomeOk && isWelcome) {
        if (this.debug) {
          console.log(`[sidechannel:${entry.name}] drop (invalid welcome) from ${this._getRemoteKey(connection)}`);
        }
        return false;
      }
    } else if (isWelcome) {
      if (this.debug) {
        console.log(`[sidechannel:${entry.name}] drop (missing welcome) from ${this._getRemoteKey(connection)}`);
      }
      return false;
    }
    if (this._welcomeRequired(entry.name) && !this._isWelcomed(entry.name) && !welcomeOk) {
      if (this.debug) {
        console.log(`[sidechannel:${entry.name}] drop (awaiting welcome) from ${this._getRemoteKey(connection)}`);
      }
      return false;
    }
    const openRequest = control === 'open_channel' && this.allowRemoteOpen && typeof requestedChannel === 'string';
    const target = openRequest && requestedChannel.trim();
    if (target && !this._allowChannelRequest(target, payload, connection)) return false;

    // Handshakes can establish access but never dispatch content. Legacy
    // owner-only delivery also retains its second signature check here.
    const handshake = control === 'auth' || control === 'welcome';
    if (!ownerChecked && !openRequest && !handshake && this._ownerWriteOnly(entry.name)) {
      const ownerKey = this._getOwnerKey(entry.name);
      const author = normalizeKeyHex(payload?.from);
      if (!ownerKey || !author || author !== ownerKey || !this._verifySig(payload, ownerKey)) {
        if (this.debug) {
          console.log(`[sidechannel:${entry.name}] drop (owner-only content) from ${this._getRemoteKey(connection)}`);
        }
        return false;
      }
    }

    if (handshake) return HANDSHAKE;
    return openRequest ? target : null;
  }

  // The inherited invite and welcome verifiers update access maps. Roll back
  // those specific entries if a later gate or the receipt write fails.
  _accessCheckpoint(payload, channel, connection) {
    if (!this._extractWelcome(payload) && !payload.invite && !payload.message?.invite) return null;
    const remote = this._getRemoteKey(connection);
    const names = new Set([channel]);
    if (payload.message?.control === 'open_channel' && typeof payload.message.channel === 'string') {
      names.add(normalizeChannel(payload.message.channel));
    }
    const saved = [...names].map(name => ({
      name, welcomed: this.welcomedChannels.has(name), welcome: this.welcomeByChannel.get(name),
      invited: this.invitedPeers.get(name)?.get(remote), hadMap: this.invitedPeers.has(name)
    }));
    return () => {
      for (const { name, welcomed, welcome, invited, hadMap } of saved) {
        if (!welcomed) this.welcomedChannels.delete(name);
        if (welcome) this.welcomeByChannel.set(name, welcome);
        else this.welcomeByChannel.delete(name);
        if (!hadMap) this.invitedPeers.delete(name);
        else if (invited === undefined) this.invitedPeers.get(name).delete(remote);
        else this.invitedPeers.get(name).set(remote, invited);
      }
    };
  }

  _takeQueue(record) {
    for (const item of record.pending) this.pendingBytes -= item.bytes;
    this.pendingFrames -= record.pending.length;
    return record.pending.splice(0);
  }

  _releaseConnection(connection) {
    const records = this.connections.get(connection);
    if (!records) return;
    this.connections.delete(connection);
    this.rateLimits.delete(connection);
    this.admission.delete(connection);
    connection.removeListener?.('close', records.onClose);
    for (const timer of records.timers.values()) clearTimeout(timer);
    for (const protocol of records._paired) {
      try { connection.userData?.unpair?.({ protocol }); } catch { /* The mux may already be destroyed. */ }
    }
    this._purgeBacklog(records);
    for (const record of records.values()) {
      this._takeQueue(record);
      try { record.channel.close(); } catch { /* The transport is closing. */ }
    }
  }

  _deliver(entry, connection, payload, action, content, envelope) {
    if (action === HANDSHAKE) return;
    if (typeof action === 'string') {
      const target = action;
      if (target) {
        if (this.autoJoinOnOpen) {
          this.addChannel(target).catch(() => {});
          console.log(`[sidechannel] auto-joined channel: ${target}`);
        } else {
          console.log(`[sidechannel] channel request received: ${target}`);
        }
      }
    } else if (this.onMessage) {
      // The application owns its delivered copy. Keep the admitted content
      // for relay even when a callback edits nested objects synchronously.
      this.onMessage(entry.name, content, connection, envelope);
    } else {
      const from = payload?.from ?? 'unknown';
      const msg = payload?.message ?? null;
      console.log(`[sidechannel:${entry.name}] ${from}:`, msg);
    }
    this._relay(entry.name, payload, connection);
  }

  _receiveLegacy(entry, connection, payload) {
    if (this._isBlocked(connection)) return;
    let content, envelope, action;
    try {
      const json = JSON.stringify(payload);
      if (!this._checkInvite(payload, entry.name, connection) || !this._checkPow(payload, entry.name) ||
          !this._checkRate(connection, b4a.byteLength(json))) return;
      const control = payload?.message?.control;
      const ownerOnly = this._ownerWriteOnly(entry.name) && control !== 'auth' && control !== 'welcome';
      if (ownerOnly) {
        const owner = this._getOwnerKey(entry.name);
        if (!owner || normalizeKeyHex(payload?.from) !== owner || !this._verifySig(payload, owner)) return;
      }
      const id = payload?.id ?? `${payload?.from ?? 'unknown'}:${payload?.ts ?? 0}:${payload?.channel ?? entry.name}`;
      if (this._rememberSeen(id, this._now())) return;
      action = this._deliveryAction(payload, entry, connection, false);
      if (action === false) return;
      if (action === null && this.onMessage) {
        envelope = JSON.parse(json);
        content = { ...this._sigPayload(envelope), verified: ownerOnly };
      }
    } catch {
      return;
    }
    this._deliver(entry, connection, payload, action, content, envelope);
  }

  _receiveManaged(entry, connection, frame, policy) {
    const { payload } = frame;
    if (payload?.channel !== entry.name) return;
    const control = payload.message?.control;
    const ownerOnly = this._ownerWriteOnly(entry.name) && control !== 'auth' && control !== 'welcome';
    const required = ownerOnly || policy?.verifySignature;
    const signed = !!(payload.sig || payload.signature);
    let key = this._receiptKey(entry, payload, true);
    if (!key || this._alreadySeen(key)) return;
    if (!signed) {
      if (required) return;
      key = this._receiptKey(entry, payload, false);
      if (this._alreadySeen(key)) return;
    }
    if (!boundedValue(payload) || !metadataFits(payload)) return;
    let verified = false;
    let content, envelope, action;
    let undo;
    try {
      if (signed) {
        const author = normalizeKeyHex(payload.from);
        if (ownerOnly && author !== this._getOwnerKey(entry.name)) return;
        verified = this._validAuthorSignature(payload, author);
        if (!verified) {
          if (required) return;
          key = this._receiptKey(entry, payload, false);
          if (this._alreadySeen(key)) return;
        }
      }
      if (!this._checkPow(payload, entry.name)) return;
      undo = this._accessCheckpoint(payload, entry.name, connection);
      if (!this._checkInvite(payload, entry.name, connection)) return;
      action = this._deliveryAction(payload, entry, connection, true);
      if (action === false) return;
      if (action === null && this.onMessage) {
        envelope = JSON.parse(frame.json);
        content = { ...this._sigPayload(envelope), verified };
      }
      if (!this._storeReceipt(key)) return;
      undo = null;
    } catch {
      return;
    } finally {
      undo?.();
    }
    this._deliver(entry, connection, payload, action, content, envelope);
  }

  // remoteOpen is set when the remote peer opens this protocol. Protomux
  // rejects that open as soon as the pair callback returns without a local
  // channel, so cancel a pending local retry instead of waiting. A closed
  // session (left by a remote leave or a rejected open) is replaced on every
  // open: a local send right after the peer rejoins must open a new session
  // and queue there rather than stop at the closed record.
  _openChannelForConnection(connection, entry, remoteOpen = false) {
    if (this.stopped || this.channels.get(entry.name) !== entry || connection.destroyed) return;
    let perConn = this.connections.get(connection);
    if (!perConn) {
      perConn = new Map();
      perConn.timers = new Map();
      perConn._paired = new Set();
      perConn._openRetries = new Map();
      perConn.backlog = [];
      perConn.backlogBytes = 0;
      perConn.handshakes = new Set();
      perConn.onClose = () => this._releaseConnection(connection);
      this.connections.set(connection, perConn);
      connection.on?.('close', perConn.onClose);
    }
    if (remoteOpen) {
      clearTimeout(perConn.timers.get(entry));
      perConn.timers.delete(entry);
    }
    const previous = perConn.get(entry.name);
    if (previous?.channel?.closed) {
      perConn.delete(entry.name);
      this._takeQueue(previous);
      this._purgeBacklog(perConn, record => record === previous);
    }
    if (perConn.has(entry.name) || perConn.timers.has(entry)) return;
    const isCurrent = () => this.connections.get(connection) === perConn && this.channels.get(entry.name) === entry;
    const retry = delay => {
      perConn.timers.set(entry, setTimeout(() => {
        perConn.timers.delete(entry);
        if (isCurrent()) this._openChannelForConnection(connection, entry);
      }, delay));
    };
    const mux = connection.userData;
    if (!mux || typeof mux.createChannel !== 'function') {
      const tries = perConn._openRetries.get(entry.name)?.count ?? 0;
      if (tries < 5) {
        perConn._openRetries.set(entry.name, { count: tries + 1, lastAt: this._now() });
        retry(50);
      }
      return;
    }
    if (!perConn._paired.has(entry.protocol)) {
      perConn._paired.add(entry.protocol);
      if (typeof mux.pair === 'function') {
        mux.pair({ protocol: entry.protocol }, () => {
          if (isCurrent()) this._openChannelForConnection(connection, entry, true);
        });
      }
    }

    if (this.debug) {
      const remoteKey = connection?.remotePublicKey
        ? b4a.toString(connection.remotePublicKey, 'hex')
        : 'unknown';
      console.log(`[sidechannel:${entry.name}] opening channel for ${remoteKey}`);
    }

    const channel = mux.createChannel({
      protocol: entry.protocol,
      onopen() {},
      onclose() {},
      // Protomux calls this on every local channel when the stream drains.
      ondrain: () => {
        if (this.connections.get(connection) === perConn) this._flushBacklog(perConn);
      }
    });
    if (!channel) {
      if (this.debug) {
        console.log(`[sidechannel:${entry.name}] channel already open or closed.`);
      }
      return;
    }

    const active = () => isCurrent() && perConn.get(entry.name)?.channel === channel;
    const policy = this.channelPolicies.get(entry.name);
    const message = channel.addMessage(entry.managed ? {
      encoding: receiveEncoding(policy?.maxReceiveBytes ?? MAX_FRAME_BYTES,
        bytes => active() && this._admit(connection, bytes)),
      onmessage: frame => {
        if (frame && active()) this._receiveManaged(entry, connection, frame, policy);
      }
    } : {
      encoding: c.json,
      onmessage: payload => { if (active()) this._receiveLegacy(entry, connection, payload); }
    });

    const record = {
      channel, message, authSent: false, pending: [],
      name: entry.name, entry, connection, perConn, managed: !!entry.managed
    };
    perConn.set(entry.name, record);

    channel.open();
    channel
      .fullyOpened()
      .then((opened) => {
        if (!isCurrent() || perConn.get(entry.name) !== record) return;
        if (this.debug) {
          console.log(
            `[sidechannel:${entry.name}] channel open=${opened} for ${this._getRemoteKey(connection)}`
          );
        }
        if (opened) {
          if (perConn._openRetries) perConn._openRetries.delete(entry.name);
          this._sendWelcome(record, entry, connection);
          this._sendAuth(record, entry);
          for (const { payload, bytes, auth } of this._takeQueue(record)) {
            if (auth || this._remoteAuthorized(entry.name, connection)) this._sendFrame(record, payload, bytes, 'own');
            else this.traffic.ownDropped++;
          }
          return;
        }
        this._takeQueue(record);
        const now = this._now();
        const state = perConn._openRetries?.get(entry.name) || { count: 0, lastAt: 0 };
        // If the last attempt was a while ago, start a fresh retry burst.
        const baseCount = now - (state.lastAt || 0) > 2000 ? 0 : Number(state.count) || 0;
        const retryCount = baseCount + 1;
        if (perConn._openRetries) {
          perConn._openRetries.set(entry.name, { count: retryCount, lastAt: now });
        }
        if (retryCount <= 5) {
          try {
            record?.channel?.close?.();
          } catch (_e) {}
          perConn.delete(entry.name);
          retry(100 * retryCount);
          return;
        }
        if (this.debug) {
          console.log(`[sidechannel:${entry.name}] giving up (open retries exceeded) for ${this._getRemoteKey(connection)}`);
        }
        try {
          record?.channel?.close?.();
        } catch (_e) {}
        perConn.delete(entry.name);
      })
      .catch(() => {});
  }

  _announceChannel(entry) {
    if (!entry) return Promise.resolve(false);
    if (entry.announced) return Promise.resolve(true);
    if (entry._announcing) return entry._announcing;
    if (!this.peer?.swarm) return Promise.resolve(false);
    const generation = this.generation;
    const announcing = (async () => {
      try {
        this.peer.swarm.join(entry.topic, { server: true, client: true });
        entry.discoveryJoined = true;
        await this._flushSwarm();
        if (generation !== this.generation || this.channels.get(entry.name) !== entry || !this.started) return false;
        this._markAnnounced(entry, true);
        return true;
      } catch (err) {
        if (this.debug) {
          console.log(`[sidechannel:${entry.name}] announce failed: ${err?.message ?? err}`);
        }
        return false;
      } finally {
        if (generation === this.generation) entry._announcing = null;
      }
    })();
    entry._announcing = announcing;
    return announcing;
  }

  async addChannel(name, options) {
    const entry = this._registerChannel(name, options);
    if (!entry) return false;
    if (entry.announced) return true;
    if (!this.peer?.swarm) return false;
    const announced = this.started
      ? await this._announceChannel(entry)
      : await this._whenAnnounced(entry);
    if (!announced || !this.started || this.channels.get(entry.name) !== entry) return false;

    for (const connection of this.connections.keys()) {
      this._openChannelForConnection(connection, entry);
    }
    // A passive peer may have established transport connections before it had
    // any sidechannel, so those connections have no sidechannel records yet.
    if (this.peer.swarm.connections) {
      for (const connection of this.peer.swarm.connections) {
        if (!this.connections.has(connection)) this._openChannelForConnection(connection, entry);
      }
    }
    return true;
  }

  async removeChannel(name) {
    const channel = String(name || '').trim();
    if (!channel) return false;
    if (this._isEntry(channel)) return false; // Entry rendezvous is global; do not leave it dynamically.
    const entry = this.channels.get(channel);
    if (!entry) return false;

    // Close mux protocol channels for this topic across all active connections.
    for (const [connection, perConn] of this.connections.entries()) {
      clearTimeout(perConn.timers.get(entry));
      perConn.timers.delete(entry);
      const record = perConn.get(entry.name);
      if (record) {
        this._takeQueue(record);
        this._purgeBacklog(perConn, queued => queued === record);
        try {
          record?.channel?.close?.();
        } catch (_e) {}
        perConn.delete(entry.name);
      }
      try {
        perConn?._openRetries?.delete?.(entry.name);
      } catch (_e) {}
      try {
        if (perConn._paired.has(entry.protocol)) connection.userData?.unpair?.({ protocol: entry.protocol });
        perConn?._paired?.delete?.(entry.protocol);
      } catch (_e) {}
    }

    const normalized = normalizeChannel(entry.name);

    // Release anyone waiting for this channel to be announced: it is going away,
    // so the answer is a definitive "not joined" rather than a hang.
    const wasAnnounced = entry.announced === true || entry.discoveryJoined === true;
    this._markAnnounced(entry, false);

    // Drop in-memory per-channel state to avoid unbounded growth from ephemeral channels.
    this.channels.delete(entry.name);
    if (this.channelPolicies) {
      const startup = this.startupPolicies?.get(normalized);
      if (startup) this.channelPolicies.set(normalized, startup);
      else this.channelPolicies.delete(normalized);
    }
    this.invitedPeers.delete(entry.name);
    this.localInvites.delete(normalized);
    this.localInviteObjects.delete(normalized);
    this.welcomeByChannel.delete(normalized);
    this.welcomedChannels.delete(normalized);

    // Best-effort: stop swarm discovery for the topic if supported. Leave only
    // what was actually announced — an unannounced topic was never on the swarm.
    if (wasAnnounced && this.peer?.swarm) {
      try {
        if (typeof this.peer.swarm.leave === 'function') {
          this.peer.swarm.leave(entry.topic);
        }
      } catch (_e) {}
      try {
        await this._flushSwarm();
      } catch (_e) {}
    }

    return true;
  }

  rebroadcast(payload) {
    const channel = payload?.channel;
    if (typeof channel !== 'string' || !this.channels.has(channel)) return false;
    const now = this._now();
    if (this.stopped || !spend(this.replayBudget, 16, 1, now)) return false;
    for (const [id, time] of this.recentReplays) {
      if (now - time < REPLAY_WINDOW_MS) break;
      this.recentReplays.delete(id);
    }
    let envelope, bytes, key;
    try {
      if (!boundedValue(payload)) return false;
      envelope = JSON.parse(JSON.stringify({ ...payload, ttl: this._hopLimit() }));
      key = this._receiptKey(this.channels.get(channel), envelope, true);
      if (!key || this.recentReplays.has(key) || envelope.channel !== channel || !boundedValue(envelope)) return false;
      bytes = frameBytes(envelope);
      if (bytes > MAX_FRAME_BYTES || b4a.byteLength(JSON.stringify(envelope)) > this.maxMessageBytes) return false;
      const control = envelope.message?.control;
      if (control === 'auth' || control === 'welcome') return false;
      const author = normalizeKeyHex(envelope.from);
      if (this._ownerWriteOnly(channel) && author !== this._getOwnerKey(channel)) return false;
      if (!this._validAuthorSignature(envelope, author) || !this._checkPow(envelope, channel)) return false;
    } catch {
      return false;
    }

    if (this._inviteRequired(channel)) {
      const self = normalizeKeyHex(this.peer?.wallet?.publicKey);
      if (!this.inviterKeys?.has(self) && !this._isLocallyInvited(channel)) return false;
    }
    let sent = false;
    let remembered = false;
    for (const [connection, perConn] of this.connections) {
      const record = perConn.get(channel);
      if (!record?.channel?.opened || record.channel.closed || !this._remoteAuthorized(channel, connection)) continue;
      if (!remembered) {
        if (!this._rememberOutbound(envelope)) return false;
        remembered = true;
      }
      if (this._sendFrame(record, envelope, bytes, 'rebroadcast')) sent = true;
    }
    if (sent) this.recentReplays.set(key, now);
    return sent;
  }

  broadcast(name, message, options = {}) {
    if (this.stopped) return false;
    const channel = String(name || '').trim();
    if (!channel) return false;
    const isAuthControl =
      message && typeof message === 'object' && String(message.control || '') === 'auth';
    const allowUnauthedSend = isAuthControl;
    if (this._ownerWriteOnly(channel) && !isAuthControl) {
      const ownerKey = this._getOwnerKey(channel);
      const selfKey = normalizeKeyHex(this.peer?.wallet?.publicKey);
      if (!ownerKey || !selfKey || ownerKey !== selfKey) return false;
    }
    if (options.invite) {
      this._acceptLocalInvite(options.invite, channel);
      if (options.invite?.welcome) {
        this._verifyWelcome(options.invite.welcome, channel, null);
      }
    }
    const entry = this._registerChannel(channel);
    if (!entry) return false;
    if (this.peer?.swarm?.connections) {
      for (const connection of this.peer.swarm.connections) {
        this._openChannelForConnection(connection, entry);
      }
    }
    const payload = this._buildPayload(channel, message, options.invite);
    if (!payload) return false;
    let payloadJson = null;
    try {
      payloadJson = JSON.stringify(payload);
    } catch (_e) {
      console.log(`[sidechannel:${channel}] message rejected (non-serializable payload).`);
      return false;
    }
    const payloadBytes = b4a.byteLength(payloadJson, 'utf8');
    if (payloadBytes > this.maxMessageBytes) {
      console.log(
        `[sidechannel:${channel}] message too large (${payloadBytes} bytes > ${this.maxMessageBytes}).`
      );
      return false;
    }
    if (this.debug) {
      console.log(`[sidechannel:${channel}] sending to ${this.connections.size} connections`);
    }
    const bytes = entry.managed ? frameBytes(payload) : payloadBytes;
    if ((entry.managed && bytes > MAX_FRAME_BYTES) || !this._rememberOutbound(payload)) return false;
    const snapshot = JSON.parse(payloadJson);
    // Report failure when there was at least one eligible session and none
    // of them sent or queued the frame. Partial skips are counted in traffic.
    let eligible = 0;
    let accepted = 0;
    for (const [connection, perConn] of this.connections.entries()) {
      if (!allowUnauthedSend && !this._remoteAuthorized(channel, connection)) {
        if (this.debug) {
          console.log(`[sidechannel:${channel}] skip (unauthorized) ${this._getRemoteKey(connection)}`);
        }
        continue;
      }
      const record = perConn.get(channel);
      if (!record?.message || record.channel.closed) continue;
      eligible++;
      if (record.channel.opened) {
        if (this._sendFrame(record, snapshot, bytes, 'own')) accepted++;
      } else if (this.pendingFrames < MAX_PENDING_FRAMES && this.pendingBytes + bytes <= MAX_FRAME_BYTES) {
        record.pending.push({ payload: snapshot, bytes, auth: allowUnauthedSend });
        this.pendingFrames++;
        this.pendingBytes += bytes;
        accepted++;
      } else {
        this.traffic.ownDropped++;
      }
    }
    return eligible === 0 || accepted > 0;
  }

  _waitFor(promise, timeout = 0) {
    return new Promise(resolve => {
      const done = () => {
        this.waits.delete(done);
        clearTimeout(timer);
        resolve();
      };
      const timer = timeout ? setTimeout(done, timeout) : null;
      this.waits.add(done);
      Promise.resolve(promise).then(done, done);
    });
  }

  async _flushSwarm() {
    if (this.peer.swarm?.flush) await this._waitFor(this.peer.swarm.flush(), 10_000);
  }

  start() {
    if (this._startPromise) return this._startPromise;
    if (this.started) return Promise.resolve();
    this.stopped = false;
    const generation = ++this.generation;
    const starting = this._start(generation).catch(async error => {
      if (generation === this.generation) await this.stop();
      throw error;
    }).finally(() => {
      if (this._startPromise === starting) this._startPromise = null;
    });
    this._startPromise = starting;
    return starting;
  }

  async _start(generation) {
    const swarm = this.peer?.swarm;
    if (!swarm) throw new Error('Sidechannel requires peer.swarm to be initialized.');
    if (this.seenPersistence != null) this.protectedSeen.prepare(this._now());
    if (swarm.dht?.fullyBootstrapped) await this._waitFor(swarm.dht.fullyBootstrapped());
    if (generation !== this.generation) return;
    this.onConnection = connection => {
      if (generation !== this.generation || this._isBlocked(connection)) return;
      for (const entry of this.channels.values()) this._openChannelForConnection(connection, entry);
    };
    swarm.on('connection', this.onConnection);
    this.listeningSwarm = swarm;

    const round = [];
    for (const entry of this.channels.values()) {
      this.peer.swarm.join(entry.topic, { server: true, client: true });
      entry.discoveryJoined = true;
      round.push(entry);
    }
    await this._flushSwarm();
    if (generation !== this.generation) return;
    for (const entry of round) {
      // removeChannel() may have dropped the entry mid-flush; do not resurrect it.
      if (this.channels.get(entry.name) === entry) this._markAnnounced(entry, true);
    }

    // `addChannel` does not join on its own until `started` flips, so a channel
    // registered while the flush above was in flight (a bridge `join` landing
    // mid-bootstrap) missed the join round and would stay
    // registered-but-never-announced — invisible to discovery until restart.
    // Flip readiness first, then re-scan for exactly those stragglers: after the
    // flip every later caller announces through the same idempotent path, and
    // the flip plus the re-scan below run in one synchronous step, so no
    // registration can slip between them.
    this.started = true;

    const stragglers = [];
    for (const entry of this.channels.values()) {
      if (entry.announced || entry._announcing) continue;
      stragglers.push(entry);
    }
    if (stragglers.length > 0) {
      await Promise.all(stragglers.map((entry) => this._announceChannel(entry)));
    }

    if (generation !== this.generation) return;
    if (this.peer.swarm.connections) {
      for (const connection of this.peer.swarm.connections) {
        for (const entry of this.channels.values()) {
          this._openChannelForConnection(connection, entry);
        }
      }
    }
  }

  async stop() {
    this.generation++;
    this.stopped = true;
    this.started = false;
    this._startPromise = null;
    this.listeningSwarm?.removeListener?.('connection', this.onConnection);
    this.listeningSwarm = this.onConnection = null;
    for (const done of this.waits) done();
    for (const connection of this.connections.keys()) this._releaseConnection(connection);
    this.rateLimits.clear();
    this.admission = new WeakMap();
    this.globalAdmission = {};
    this.forwarding = new WeakMap();
    this.forwardBudget = {};
    this.replayBudget = {};
    this.recentReplays.clear();
    for (const entry of this.channels.values()) {
      if (entry.discoveryJoined) {
        try { this.peer.swarm?.leave?.(entry.topic)?.catch?.(() => {}); } catch { /* Discovery may already be closed. */ }
      }
      entry.discoveryJoined = false;
      entry._announcing = null;
      this._markAnnounced(entry, false);
    }
    this.protectedSeen.close();
  }
}

export function selectOptions(raw) {
  const options = launcherOptions(raw);
  if (options.seenPersistence != null && options.seenPersistence !== false) return { Type: ManagedSidechannel, options };
  if (options.channelOptions === undefined) return null;
  const policies = options.channelOptions;
  if (!policies || typeof policies !== 'object' || Array.isArray(policies)) throw new TypeError('Expected channelOptions map');
  for (const [name, value] of Object.entries(policies)) {
    if (channelPolicy(normalizeChannel(name), value)) return { Type: ManagedSidechannel, options };
  }
  return null;
}

export default ManagedSidechannel;
