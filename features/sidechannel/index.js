import Feature from 'trac-peer/src/artifacts/feature.js';
import b4a from 'b4a';
import c from '../../node_modules/compact-encoding/index.js';
import crypto from 'crypto';
import PeerWallet from 'trac-wallet';

// Join topics must be deterministic and collision-resistant.
// The previous implementation (alloc(32).fill(name)) could collide for different names.
const toTopic = (name) =>
  crypto.createHash('sha256').update(`sidechannel:${normalizeChannel(name)}`).digest();
const toProtocol = (name) => `sidechannel/${name}`;

const stableStringify = (value) => {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
};

const sha256Hex = (input) => crypto.createHash('sha256').update(input).digest('hex');

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

const countLeadingZeroBits = (hex) => {
  let bits = 0;
  for (let i = 0; i < hex.length; i += 1) {
    const nibble = Number.parseInt(hex[i], 16);
    if (nibble === 0) {
      bits += 4;
      continue;
    }
    // Count leading zeros in this nibble.
    for (let mask = 8; mask > 0; mask >>= 1) {
      if (nibble & mask) return bits;
      bits += 1;
    }
  }
  return bits;
};

class Sidechannel extends Feature {
  constructor(peer, config = {}) {
    super(peer, config);
    this.key = 'sidechannel';
    this.channels = new Map();
    this.connections = new Map();
    this.rateLimits = new Map();
    this.started = false;
    this._dhtBootPromise = null;
    this.onMessage = typeof config.onMessage === 'function' ? config.onMessage : null;
    this.debug = config.debug === true;
    this.maxMessageBytes = Number.isSafeInteger(config.maxMessageBytes)
      ? config.maxMessageBytes
      : 1_000_000;
    this.entryChannel = typeof config.entryChannel === 'string' ? config.entryChannel : null;
    this.allowRemoteOpen = config.allowRemoteOpen !== false;
    this.autoJoinOnOpen = config.autoJoinOnOpen === true;
    this.relayEnabled = config.relayEnabled !== false;
    this.relayTtl = Number.isSafeInteger(config.relayTtl) ? config.relayTtl : 3;
    this.maxSeen = Number.isSafeInteger(config.maxSeen) ? config.maxSeen : 5000;
    this.seenTtlMs = Number.isSafeInteger(config.seenTtlMs) ? config.seenTtlMs : 120_000;
    this.rateBytesPerSecond = Number.isSafeInteger(config.rateBytesPerSecond)
      ? config.rateBytesPerSecond
      : 64_000;
    this.rateBurstBytes = Number.isSafeInteger(config.rateBurstBytes)
      ? config.rateBurstBytes
      : 256_000;
    this.maxStrikes = Number.isSafeInteger(config.maxStrikes) ? config.maxStrikes : 3;
    this.strikeWindowMs = Number.isSafeInteger(config.strikeWindowMs) ? config.strikeWindowMs : 5000;
    this.blockMs = Number.isSafeInteger(config.blockMs) ? config.blockMs : 30_000;
    this.seen = new Map();
    this.powEnabled = config.powEnabled === true;
    this.powDifficulty = Number.isInteger(config.powDifficulty) ? config.powDifficulty : 0;
    this.powRequireEntry = config.powRequireEntry === true;
    this.powRequiredChannels = Array.isArray(config.powRequiredChannels)
      ? new Set(config.powRequiredChannels.map((c) => String(c)))
      : null;
    this.inviteRequired = config.inviteRequired === true;
    this.inviteRequiredChannels = Array.isArray(config.inviteRequiredChannels)
      ? new Set(config.inviteRequiredChannels.map((c) => String(c)))
      : null;
    this.inviteRequiredPrefixes = Array.isArray(config.inviteRequiredPrefixes)
      ? config.inviteRequiredPrefixes.map((c) => String(c))
      : null;
    const inviterKeys = Array.isArray(config.inviterKeys)
      ? config.inviterKeys
          .map((value) => normalizeKeyHex(value))
          .filter((value) => value && value.length > 0)
      : [];
    if (this.inviteRequired && inviterKeys.length === 0) {
      const selfKey = normalizeKeyHex(this.peer?.wallet?.publicKey);
      if (selfKey) inviterKeys.push(selfKey);
    }
    this.inviterKeys = inviterKeys.length > 0 ? new Set(inviterKeys) : null;
    this.inviteTtlMs = Number.isSafeInteger(config.inviteTtlMs) ? config.inviteTtlMs : 0;
    this.invitedPeers = new Map();
    this.localInvites = new Map();
    // Stores the last accepted invite object (for auth handshakes).
    this.localInviteObjects = new Map();
    this.ownerWriteOnly = config.ownerWriteOnly === true;
    this.ownerWriteChannels = Array.isArray(config.ownerWriteChannels)
      ? new Set(config.ownerWriteChannels.map((c) => normalizeChannel(c)))
      : null;
    this.welcomeRequired = config.welcomeRequired !== false;
    this.ownerKeys = new Map();
    const ownerEntries = config.ownerKeys instanceof Map
      ? Array.from(config.ownerKeys.entries())
      : Array.isArray(config.ownerKeys)
        ? config.ownerKeys
        : config.ownerKeys && typeof config.ownerKeys === 'object'
          ? Object.entries(config.ownerKeys)
          : [];
    for (const entry of ownerEntries) {
      const [channel, key] = Array.isArray(entry) ? entry : [];
      const normalizedChannel = normalizeChannel(channel);
      const normalizedKey = normalizeKeyHex(key);
      if (normalizedChannel && normalizedKey) this.ownerKeys.set(normalizedChannel, normalizedKey);
    }
    this.defaultOwnerKey = normalizeKeyHex(config.defaultOwnerKey);
    this.welcomeByChannel = new Map();
    const welcomeEntries = config.welcomeByChannel instanceof Map
      ? Array.from(config.welcomeByChannel.entries())
      : Array.isArray(config.welcomeByChannel)
        ? config.welcomeByChannel
        : config.welcomeByChannel && typeof config.welcomeByChannel === 'object'
          ? Object.entries(config.welcomeByChannel)
          : [];
    for (const entry of welcomeEntries) {
      const [channel, welcome] = Array.isArray(entry) ? entry : [];
      const normalizedChannel = normalizeChannel(channel);
      if (normalizedChannel && welcome) {
        this.welcomeByChannel.set(normalizedChannel, welcome);
      }
    }
    this.welcomedChannels = new Set();
    for (const [channel, welcome] of this.welcomeByChannel.entries()) {
      this._verifyWelcome(welcome, channel, null);
    }
    const selfKey = normalizeKeyHex(this.peer?.wallet?.publicKey);
    if (selfKey) {
      for (const [channel, key] of this.ownerKeys.entries()) {
        if (key === selfKey) this._rememberWelcome(channel);
      }
      if (this.defaultOwnerKey && this.defaultOwnerKey === selfKey && this.entryChannel) {
        this._rememberWelcome(this.entryChannel);
      }
    }

    const initial = Array.isArray(config.channels) ? config.channels : [];
    for (const name of initial) this._registerChannel(name);
  }

  _now() {
    return Date.now();
  }

  _isEntry(channel) {
    const normalized = normalizeChannel(channel);
    const entry = this.entryChannel ? normalizeChannel(this.entryChannel) : '';
    return normalized.length > 0 && entry.length > 0 && normalized === entry;
  }

  _getRemoteKey(connection) {
    return normalizeKeyHex(connection?.remotePublicKey) || 'unknown';
  }

  _purgeSeen(now) {
    const cutoff = now - this.seenTtlMs;
    for (const [id, ts] of this.seen) {
      if (ts < cutoff) this.seen.delete(id);
      else break;
    }
  }

  _rememberSeen(id, now) {
    if (!id) return false;
    if (this.seen.has(id)) return true;
    this.seen.set(id, now);
    if (this.seen.size > this.maxSeen) {
      const oldest = this.seen.keys().next().value;
      if (oldest) this.seen.delete(oldest);
    }
    this._purgeSeen(now);
    return false;
  }

  _getLimiter(connection) {
    let state = this.rateLimits.get(connection);
    if (!state) {
      const now = this._now();
      state = {
        tokens: this.rateBurstBytes,
        lastRefill: now,
        strikes: 0,
        strikeResetAt: now + this.strikeWindowMs,
        blockedUntil: 0,
      };
      this.rateLimits.set(connection, state);
    }
    return state;
  }

  _isBlocked(connection) {
    const state = this.rateLimits.get(connection);
    if (!state) return false;
    return this._now() < state.blockedUntil;
  }

  _checkRate(connection, bytes) {
    if (this.rateBytesPerSecond <= 0) return true;
    const state = this._getLimiter(connection);
    const now = this._now();
    if (now < state.blockedUntil) return false;

    if (now > state.strikeResetAt) {
      state.strikes = 0;
      state.strikeResetAt = now + this.strikeWindowMs;
    }

    const elapsedMs = now - state.lastRefill;
    if (elapsedMs > 0) {
      const refill = (elapsedMs / 1000) * this.rateBytesPerSecond;
      state.tokens = Math.min(this.rateBurstBytes, state.tokens + refill);
      state.lastRefill = now;
    }

    if (bytes > state.tokens) {
      state.strikes += 1;
      if (state.strikes >= this.maxStrikes) {
        state.blockedUntil = now + this.blockMs;
        if (this.debug) {
          console.log(`[sidechannel] rate-limit block ${this._getRemoteKey(connection)} for ${this.blockMs}ms`);
        }
      }
      return false;
    }

    state.tokens -= bytes;
    return true;
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
      ttl: this.relayTtl,
    };
    if (invite) payload.invite = invite;
    this._attachPow(payload);
    // Message-level signatures allow receivers to enforce "owner-only write" even when
    // messages are relayed (the transport peer can be a relay, not the original sender).
    this._attachSig(payload);
    return payload;
  }

  requestOpen(newChannel, viaChannel = null, invite = null, welcome = null) {
    const target = String(newChannel || '').trim();
    if (!target) return false;
    const via = String(viaChannel || this.entryChannel || '').trim();
    if (!via) return false;
    if (invite) this._acceptLocalInvite(invite, target);
    const inviteWelcome = invite?.welcome;
    const desiredWelcome = welcome || inviteWelcome;
    if (desiredWelcome) this._verifyWelcome(desiredWelcome, target, null);
    return this.broadcast(via, {
      control: 'open_channel',
      channel: target,
      invite: invite || undefined,
      welcome: desiredWelcome || undefined,
    });
  }

  _relay(channel, payload, originConnection) {
    if (!this.relayEnabled) return;
    const control = payload?.message?.control;
    // Never relay handshake/control messages; they are for direct neighbor authorization.
    if (control === 'auth' || control === 'welcome') return;
    const ttl = Number.isFinite(payload?.ttl) ? payload.ttl : 0;
    if (ttl <= 0) return;
    const relayed = {
      ...payload,
      ttl: ttl - 1,
      relayedBy: normalizeKeyHex(this.peer?.wallet?.publicKey) ?? null,
    };
    for (const [connection, perConn] of this.connections.entries()) {
      if (connection === originConnection) continue;
      if (!this._remoteAuthorized(channel, connection)) continue;
      const record = perConn.get(channel);
      if (record?.message) {
        record.message.send(relayed);
      }
    }
  }

  _powRequired(channel) {
    if (!this.powEnabled || this.powDifficulty <= 0) return false;
    if (this.powRequiredChannels) return this.powRequiredChannels.has(channel);
    if (this.powRequireEntry) return channel === this.entryChannel;
    return true;
  }

  _inviteRequired(channel) {
    if (this._isEntry(channel)) return false;
    if (!this.inviteRequired) return false;
    const hasList = this.inviteRequiredChannels || this.inviteRequiredPrefixes;
    if (this.inviteRequiredChannels && this.inviteRequiredChannels.has(channel)) return true;
    if (this.inviteRequiredPrefixes) {
      for (const prefix of this.inviteRequiredPrefixes) {
        if (prefix && channel.startsWith(prefix)) return true;
      }
    }
    // If the caller configured a list/prefix set, invites are only required for those entries.
    if (hasList) return false;
    return true;
  }

  _ownerWriteOnly(channel) {
    if (this._isEntry(channel)) return false;
    if (this.ownerWriteOnly) return true;
    if (this.ownerWriteChannels) return this.ownerWriteChannels.has(normalizeChannel(channel));
    return false;
  }

  _getInviteMap(channel) {
    if (!this.invitedPeers.has(channel)) this.invitedPeers.set(channel, new Map());
    return this.invitedPeers.get(channel);
  }

  _isInvited(channel, pubkey) {
    const map = this.invitedPeers.get(channel);
    if (!map) return false;
    const expiresAt = map.get(pubkey);
    if (!Number.isFinite(expiresAt)) {
      map.delete(pubkey);
      return false;
    }
    if (expiresAt <= this._now()) {
      map.delete(pubkey);
      return false;
    }
    return true;
  }

  _rememberInvite(channel, pubkey, expiresAt) {
    if (!Number.isFinite(expiresAt)) return;
    const map = this._getInviteMap(channel);
    map.set(pubkey, expiresAt);
  }

  _rememberLocalInvite(channel, expiresAt) {
    if (!Number.isFinite(expiresAt)) return;
    this.localInvites.set(normalizeChannel(channel), expiresAt);
  }

  _isLocallyInvited(channel) {
    const key = normalizeChannel(channel);
    const expiresAt = this.localInvites.get(key);
    if (!Number.isFinite(expiresAt)) {
      this.localInvites.delete(key);
      return false;
    }
    if (expiresAt <= this._now()) {
      this.localInvites.delete(key);
      return false;
    }
    return true;
  }

  _normalizeInvitePayload(payload) {
    return {
      channel: String(payload?.channel ?? ''),
      inviteePubKey: normalizeKeyHex(payload?.inviteePubKey) || '',
      inviterPubKey: normalizeKeyHex(payload?.inviterPubKey) || '',
      inviterAddress: payload?.inviterAddress ?? null,
      issuedAt: Number(payload?.issuedAt),
      expiresAt: Number(payload?.expiresAt),
      nonce: String(payload?.nonce ?? ''),
      version: Number.isFinite(payload?.version) ? Number(payload.version) : 1,
    };
  }

  _verifyInviteForKey(invite, channel, inviteeKey) {
    if (!invite || typeof invite !== 'object') return false;
    const payload = invite.payload && typeof invite.payload === 'object' ? invite.payload : invite;
    const sigHex = invite.sig || invite.signature;
    if (typeof sigHex !== 'string' || sigHex.length === 0) return false;
    const normalized = this._normalizeInvitePayload(payload);
    if (normalized.channel !== String(channel)) return false;
    if (normalized.inviteePubKey !== inviteeKey) return false;
    if (!normalized.inviterPubKey || normalized.inviterPubKey.length === 0) return false;
    if (this.inviterKeys && !this.inviterKeys.has(normalized.inviterPubKey)) return false;
    if (!Number.isFinite(normalized.issuedAt) || !Number.isFinite(normalized.expiresAt)) return false;
    if (normalized.expiresAt <= this._now()) return false;
    const message = stableStringify(normalized);
    let sigBuf = null;
    let pubBuf = null;
    try {
      sigBuf = b4a.from(sigHex, 'hex');
      pubBuf = b4a.from(normalized.inviterPubKey, 'hex');
    } catch (_e) {
      return false;
    }
    if (!PeerWallet.verify(sigBuf, b4a.from(message), pubBuf)) return false;
    return normalized;
  }

  _verifyInvite(invite, channel, connection) {
    const remoteKey = this._getRemoteKey(connection);
    const normalized = this._verifyInviteForKey(invite, channel, remoteKey);
    if (!normalized) return false;
    this._rememberInvite(channel, remoteKey, normalized.expiresAt);
    return true;
  }

  _acceptLocalInvite(invite, channel) {
    const selfKey = normalizeKeyHex(this.peer?.wallet?.publicKey);
    if (!selfKey) return false;
    const normalized = this._verifyInviteForKey(invite, channel, selfKey);
    if (!normalized) return false;
    this._rememberLocalInvite(channel, normalized.expiresAt);
    this.localInviteObjects.set(normalizeChannel(channel), invite);
    const embeddedWelcome = invite?.welcome;
    if (embeddedWelcome) {
      this._verifyWelcome(embeddedWelcome, channel, null);
    }
    return true;
  }

  _checkInvite(payload, channel, connection) {
    if (!this._inviteRequired(channel)) return true;
    const selfKey = normalizeKeyHex(this.peer?.wallet?.publicKey);
    const selfIsInviter = this.inviterKeys && selfKey && this.inviterKeys.has(selfKey);
    if (!selfIsInviter && !this._isLocallyInvited(channel)) return false;
    const remoteKey = this._getRemoteKey(connection);
    if (this.inviterKeys && this.inviterKeys.has(remoteKey)) return true;
    if (this._isInvited(channel, remoteKey)) return true;
    const invite = payload?.invite || payload?.message?.invite;
    if (invite && this._verifyInvite(invite, channel, connection)) return true;
    return false;
  }

  _normalizeWelcomePayload(payload) {
    return {
      channel: normalizeChannel(payload?.channel),
      ownerPubKey: normalizeKeyHex(payload?.ownerPubKey) || '',
      text: String(payload?.text ?? ''),
      issuedAt: Number(payload?.issuedAt),
      version: Number.isFinite(payload?.version) ? Number(payload.version) : 1,
    };
  }

  _getOwnerKey(channel) {
    const normalized = normalizeChannel(channel);
    if (this.ownerKeys.has(normalized)) return this.ownerKeys.get(normalized);
    return this.defaultOwnerKey;
  }

  _welcomeRequired(channel) {
    if (this._isEntry(channel)) return false;
    if (!this.welcomeRequired) return false;
    return true;
  }

  _isWelcomed(channel) {
    return this.welcomedChannels.has(normalizeChannel(channel));
  }

  _rememberWelcome(channel) {
    this.welcomedChannels.add(normalizeChannel(channel));
  }

  _verifyWelcome(welcome, channel, connection) {
    if (!welcome || typeof welcome !== 'object') return false;
    const payload = welcome.payload && typeof welcome.payload === 'object' ? welcome.payload : welcome;
    const sigHex = welcome.sig || welcome.signature;
    if (typeof sigHex !== 'string' || sigHex.length === 0) return false;
    const normalized = this._normalizeWelcomePayload(payload);
    if (normalized.channel !== normalizeChannel(channel)) return false;
    const ownerKey = this._getOwnerKey(channel);
    if (!ownerKey || normalized.ownerPubKey !== ownerKey) return false;
    if (!Number.isFinite(normalized.issuedAt)) return false;
    const message = stableStringify(normalized);
    let sigBuf = null;
    let pubBuf = null;
    try {
      sigBuf = b4a.from(sigHex, 'hex');
      pubBuf = b4a.from(ownerKey, 'hex');
    } catch (_e) {
      return false;
    }
    if (!PeerWallet.verify(sigBuf, b4a.from(message), pubBuf)) return false;
    this._rememberWelcome(channel);
    // Persist the verified welcome in-memory so the owner can auto-send it to new connections
    // without requiring a restart (welcome is still bound to the configured owner key).
    this.welcomeByChannel.set(normalizeChannel(channel), welcome);
    return true;
  }

  _isWelcomeMessage(payload) {
    return payload?.message?.control === 'welcome';
  }

  _extractWelcome(payload) {
    if (!payload || typeof payload !== 'object') return null;
    return (
      payload?.message?.welcome ||
      payload?.welcome ||
      payload?.invite?.welcome ||
      payload?.message?.invite?.welcome ||
      null
    );
  }

  _getConfiguredWelcome(channel) {
    return this.welcomeByChannel.get(normalizeChannel(channel)) || null;
  }

  getWelcome(channel) {
    return this._getConfiguredWelcome(channel);
  }

  _powBase(payload, nonce) {
    return stableStringify({
      id: payload?.id ?? null,
      channel: payload?.channel ?? null,
      from: payload?.from ?? null,
      origin: payload?.origin ?? null,
      message: payload?.message ?? null,
      ts: payload?.ts ?? null,
      nonce,
    });
  }

  _attachPow(payload) {
    const channel = payload?.channel ?? '';
    if (!this._powRequired(channel)) return;
    const difficulty = this.powDifficulty;
    let nonce = 0;
    while (true) {
      const hash = sha256Hex(this._powBase(payload, nonce));
      if (countLeadingZeroBits(hash) >= difficulty) {
        payload.pow = { nonce, difficulty };
        return;
      }
      nonce += 1;
    }
  }

  _checkPow(payload, channel) {
    if (!this._powRequired(channel)) return true;
    const pow = payload?.pow;
    if (!pow || typeof pow.nonce !== 'number') return false;
    const difficulty = this.powDifficulty;
    if (!Number.isInteger(difficulty) || difficulty <= 0) return false;
    const hash = sha256Hex(this._powBase(payload, pow.nonce));
    return countLeadingZeroBits(hash) >= difficulty;
  }

  _sigPayload(payload) {
    // Normalize to JSON-compatible data so the signature base matches what receivers
    // observe after compact-encoding's JSON roundtrip.
    let message = null;
    try {
      message = JSON.parse(JSON.stringify(payload?.message ?? null));
    } catch (_e) {
      message = null;
    }

    return {
      kind: 'sidechannel_message_v1',
      id: payload?.id ?? null,
      channel: payload?.channel ?? null,
      from: normalizeKeyHex(payload?.from) ?? null,
      origin: normalizeKeyHex(payload?.origin) ?? null,
      ts: payload?.ts ?? null,
      message,
    };
  }

  _sigBase(payload) {
    return stableStringify(this._sigPayload(payload));
  }

  _attachSig(payload) {
    if (!payload || typeof payload !== 'object') return false;
    if (!this.peer?.wallet || typeof this.peer.wallet.sign !== 'function') return false;
    const msg = this._sigBase(payload);
    let sig = null;
    try {
      sig = this.peer.wallet.sign(b4a.from(msg));
    } catch (_e) {
      return false;
    }
    let sigHex = '';
    if (typeof sig === 'string') {
      sigHex = sig.trim();
    } else if (sig && sig.length > 0) {
      sigHex = b4a.toString(sig, 'hex');
    }
    if (!sigHex) return false;
    payload.sig = sigHex.toLowerCase();
    if (this.debug) {
      const control = payload?.message?.control;
      if (control !== 'auth' && control !== 'welcome') {
        const hash = sha256Hex(msg);
        console.log(
          `[sidechannel:${payload?.channel ?? 'unknown'}] sign hash=${hash} sigLen=${payload.sig.length}`
        );
      }
    }
    return true;
  }

  _verifySig(payload, pubkeyHex) {
    const sigHex = payload?.sig || payload?.signature;
    if (typeof sigHex !== 'string' || sigHex.length === 0) return false;
    if (typeof pubkeyHex !== 'string' || pubkeyHex.length === 0) return false;
    let sigBuf = null;
    let pubBuf = null;
    try {
      sigBuf = b4a.from(sigHex, 'hex');
      pubBuf = b4a.from(String(pubkeyHex).trim().toLowerCase(), 'hex');
    } catch (_e) {
      return false;
    }
    const msg = this._sigBase(payload);
    return PeerWallet.verify(sigBuf, b4a.from(msg), pubBuf);
  }

  _registerChannel(name) {
    const channel = String(name || '').trim();
    if (!channel) return null;
    if (this.channels.has(channel)) return this.channels.get(channel);
    if (this._inviteRequired(channel)) {
      const selfKey = normalizeKeyHex(this.peer?.wallet?.publicKey);
      const selfIsInviter = this.inviterKeys && selfKey && this.inviterKeys.has(selfKey);
      if (!selfIsInviter && !this._isLocallyInvited(channel)) {
        console.log(`[sidechannel:${channel}] join denied (invite required).`);
        return null;
      }
    }
    const entry = {
      name: channel,
      topic: toTopic(channel),
      protocol: toProtocol(channel)
    };
    this.channels.set(channel, entry);
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
    this._rememberSeen(payload.id, this._now());
    record.message.send(payload);
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
    this._rememberSeen(payload.id, this._now());
    record.message.send(payload);
    record.authSent = true;
  }

  _remoteAuthorized(channel, connection) {
    if (!this._inviteRequired(channel)) return true;
    const remoteKey = this._getRemoteKey(connection);
    if (this.inviterKeys && this.inviterKeys.has(remoteKey)) return true;
    return this._isInvited(channel, remoteKey);
  }

  _openChannelForConnection(connection, entry) {
    const mux = connection.userData;
    if (!mux || typeof mux.createChannel !== 'function') {
      const tries = (connection.__sidechannelMuxTries || 0) + 1;
      connection.__sidechannelMuxTries = tries;
      if (tries <= 5) {
        setTimeout(() => this._openChannelForConnection(connection, entry), 50);
      } else if (this.debug) {
        console.log(`[sidechannel:${entry.name}] mux not ready for connection.`);
      }
      return;
    }

    let perConn = this.connections.get(connection);
    if (!perConn) {
      perConn = new Map();
      this.connections.set(connection, perConn);
    }
    if (perConn.has(entry.name)) return;
    if (!perConn._paired) perConn._paired = new Set();
    // Track open retries per connection+channel to avoid infinite retry loops
    // when the remote peer hasn't joined/paired the protocol yet.
    if (!perConn._openRetries) perConn._openRetries = new Map();
    if (!perConn._paired.has(entry.protocol)) {
      perConn._paired.add(entry.protocol);
      if (typeof mux.pair === 'function') {
        mux.pair({ protocol: entry.protocol }, () => {
          this._openChannelForConnection(connection, entry);
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
      onclose() {}
    });
    if (!channel) {
      if (this.debug) {
        console.log(`[sidechannel:${entry.name}] channel already open or closed.`);
      }
      return;
    }

    const message = channel.addMessage({
      encoding: c.json,
      onmessage: (payload) => {
        if (this._isBlocked(connection)) return;
        let payloadJson = null;
        try {
          payloadJson = JSON.stringify(payload);
        } catch (_e) {
          return;
        }
        const payloadBytes = b4a.byteLength(payloadJson, 'utf8');
        if (this.debug) {
          console.log(
            `[sidechannel:${entry.name}] recv ${payloadBytes} bytes from ${this._getRemoteKey(connection)}`
          );
        }
        if (!this._checkInvite(payload, entry.name, connection)) {
          if (this.debug) {
            console.log(`[sidechannel:${entry.name}] drop (invite) from ${this._getRemoteKey(connection)}`);
          }
          return;
        }
        if (!this._checkPow(payload, entry.name)) {
          if (this.debug) {
            console.log(`[sidechannel:${entry.name}] drop (invalid pow) from ${this._getRemoteKey(connection)}`);
          }
          return;
        }
        if (!this._checkRate(connection, payloadBytes)) {
          if (this.debug) {
            console.log(`[sidechannel:${entry.name}] drop (rate limit) from ${this._getRemoteKey(connection)}`);
          }
          return;
        }

        // Allow a minimal auth handshake even on owner-only channels so invite-only + owner-only
        // channels can authorize listeners without giving them write access.
        const controlEarly = payload?.message?.control;
        const isAuthControl = controlEarly === 'auth';
        const isWelcomeControl = controlEarly === 'welcome';
        if (this._ownerWriteOnly(entry.name) && !isAuthControl && !isWelcomeControl) {
          const ownerKey = this._getOwnerKey(entry.name);
          const author = normalizeKeyHex(payload?.from);
          // NOTE: payload.from is user-supplied; verify message signature to prevent spoofing.
          const sigOk = ownerKey ? this._verifySig(payload, ownerKey) : false;
          if (!ownerKey || !author || author !== ownerKey || !sigOk) {
            if (this.debug) {
              const sigHex = payload?.sig || payload?.signature || '';
              const hash = sha256Hex(this._sigBase(payload));
              console.log(
                `[sidechannel:${entry.name}] drop (owner-only) author=${author} owner=${ownerKey} sigOk=${sigOk} sigLen=${sigHex.length} hash=${hash} fromRemote=${this._getRemoteKey(connection)}`
              );
            }
            return;
          }
        }
        const payloadId =
          payload?.id ?? `${payload?.from ?? 'unknown'}:${payload?.ts ?? 0}:${payload?.channel ?? entry.name}`;
        const now = this._now();
        if (this._rememberSeen(payloadId, now)) {
          if (this.debug) {
            console.log(`[sidechannel:${entry.name}] drop (duplicate) ${payloadId}`);
          }
          return;
        }
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
            return;
          }
        } else if (isWelcome) {
          if (this.debug) {
            console.log(`[sidechannel:${entry.name}] drop (missing welcome) from ${this._getRemoteKey(connection)}`);
          }
          return;
        }
        if (this._welcomeRequired(entry.name) && !this._isWelcomed(entry.name) && !welcomeOk) {
          if (this.debug) {
            console.log(`[sidechannel:${entry.name}] drop (awaiting welcome) from ${this._getRemoteKey(connection)}`);
          }
          return;
        }
        if (control === 'open_channel' && this.allowRemoteOpen && typeof requestedChannel === 'string') {
          const target = requestedChannel.trim();
          if (target.length > 0) {
            const welcome = payload?.message?.welcome || payload?.message?.invite?.welcome;
            if (welcome) {
              if (!this._verifyWelcome(welcome, target, connection)) {
                if (this.debug) {
                  console.log(`[sidechannel] open denied (welcome) for ${target} from ${this._getRemoteKey(connection)}`);
                }
                return;
              }
            } else if (this._welcomeRequired(target)) {
              if (this.debug) {
                console.log(
                  `[sidechannel] open denied (missing welcome) for ${target} from ${this._getRemoteKey(connection)}`
                );
              }
              return;
            }
            if (this._inviteRequired(target)) {
              const invite = payload?.message?.invite;
              if (!invite || !this._verifyInvite(invite, target, connection)) {
                if (this.debug) {
                  console.log(`[sidechannel] open denied (invite) for ${target} from ${this._getRemoteKey(connection)}`);
                }
                return;
              }
            }
            if (this.autoJoinOnOpen) {
              this.addChannel(target).catch(() => {});
              console.log(`[sidechannel] auto-joined channel: ${target}`);
            } else {
              console.log(`[sidechannel] channel request received: ${target}`);
            }
          }
        } else {
          // Avoid spamming logs for handshake control messages.
          if (control === 'auth') return;
          if (this.onMessage) {
            this.onMessage(entry.name, payload, connection);
          } else {
            const from = payload?.from ?? 'unknown';
            const msg = payload?.message ?? payload;
            console.log(`[sidechannel:${entry.name}] ${from}:`, msg);
          }
        }
        this._relay(entry.name, payload, connection);
      }
    });

    const record = { channel, message, retries: 0, authSent: false };
    perConn.set(entry.name, record);

    channel.open();
    channel
      .fullyOpened()
      .then((opened) => {
        if (this.debug) {
          console.log(
            `[sidechannel:${entry.name}] channel open=${opened} for ${this._getRemoteKey(connection)}`
          );
        }
        if (opened) {
          if (perConn._openRetries) perConn._openRetries.delete(entry.name);
          this._sendWelcome(record, entry, connection);
          this._sendAuth(record, entry);
          return;
        }
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
          setTimeout(() => this._openChannelForConnection(connection, entry), 100 * retryCount);
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

  async addChannel(name) {
    const entry = this._registerChannel(name);
    if (!entry) return false;
    if (this.started && this.peer?.swarm) {
      this.peer.swarm.join(entry.topic, { server: true, client: true });
      {
        const flushTimeoutMs = 10_000;
        const flushP = Promise.resolve()
          .then(() => this.peer.swarm.flush())
          .catch(() => {});
        await Promise.race([flushP, new Promise((resolve) => setTimeout(resolve, flushTimeoutMs))]);
      }

      for (const connection of this.connections.keys()) {
        this._openChannelForConnection(connection, entry);
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
    for (const [, perConn] of this.connections.entries()) {
      const record = perConn.get(entry.name);
      if (record) {
        try {
          record?.channel?.close?.();
        } catch (_e) {}
        perConn.delete(entry.name);
      }
      try {
        perConn?._openRetries?.delete?.(entry.name);
      } catch (_e) {}
      try {
        perConn?._paired?.delete?.(entry.protocol);
      } catch (_e) {}
    }

    const normalized = normalizeChannel(entry.name);

    // Drop in-memory per-channel state to avoid unbounded growth from ephemeral channels.
    this.channels.delete(entry.name);
    this.invitedPeers.delete(entry.name);
    this.localInvites.delete(normalized);
    this.localInviteObjects.delete(normalized);
    this.welcomeByChannel.delete(normalized);
    this.welcomedChannels.delete(normalized);

    // Best-effort: stop swarm discovery for the topic if supported.
    if (this.started && this.peer?.swarm) {
      try {
        if (typeof this.peer.swarm.leave === 'function') {
          this.peer.swarm.leave(entry.topic);
        }
      } catch (_e) {}
      try {
        if (typeof this.peer.swarm.flush === 'function') {
          const flushTimeoutMs = 10_000;
          const flushP = Promise.resolve()
            .then(() => this.peer.swarm.flush())
            .catch(() => {});
          await Promise.race([flushP, new Promise((resolve) => setTimeout(resolve, flushTimeoutMs))]);
        }
      } catch (_e) {}
    }

    return true;
  }

  acceptInvite(name, invite = null, welcome = null) {
    const channel = String(name || '').trim();
    if (!channel) return false;
    if (invite) {
      this._acceptLocalInvite(invite, channel);
      if (invite?.welcome) {
        this._verifyWelcome(invite.welcome, channel, null);
      }
    }
    if (welcome) {
      this._verifyWelcome(welcome, channel, null);
    }
    return true;
  }

  broadcast(name, message, options = {}) {
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
    this._rememberSeen(payload.id, this._now());
    for (const [connection, perConn] of this.connections.entries()) {
      if (!allowUnauthedSend && !this._remoteAuthorized(channel, connection)) {
        if (this.debug) {
          console.log(`[sidechannel:${channel}] skip (unauthorized) ${this._getRemoteKey(connection)}`);
        }
        continue;
      }
      const record = perConn.get(channel);
      if (record?.message) {
        if (!record.channel?.opened) {
          record.channel
            ?.fullyOpened()
            .then((opened) => {
              if (opened) record.message.send(payload);
            })
            .catch(() => {});
        } else {
          record.message.send(payload);
        }
      } else if (this.debug) {
        console.log(`[sidechannel:${channel}] no message session for connection.`);
      }
    }
    return true;
  }

  async start() {
    if (this.started) return;
    if (!this.peer?.swarm) {
      throw new Error('Sidechannel requires peer.swarm to be initialized.');
    }

    // Hyperswarm can accept `join()` calls before the DHT is fully bootstrapped.
    // In practice this can lead to missed announces/lookups and permanent
    // non-discovery until restart. `fullyBootstrapped()` is the authoritative
    // readiness barrier, so wait for it before joining any sidechannel topic.
    const dht = this.peer.swarm.dht;
    let bootPromise = null;
    if (dht && typeof dht.fullyBootstrapped === 'function') {
      if (this.debug) console.log('[sidechannel] waiting for DHT bootstrap...');
      bootPromise = Promise.resolve()
        .then(() => dht.fullyBootstrapped())
        .catch(() => {});
      await bootPromise;
    }
    this._dhtBootPromise = bootPromise;

    this.peer.swarm.on('connection', (connection) => {
      if (this._isBlocked(connection)) return;
      for (const entry of this.channels.values()) {
        this._openChannelForConnection(connection, entry);
      }

      connection.on('close', () => {
        this.connections.delete(connection);
      });
    });

    for (const entry of this.channels.values()) {
      this.peer.swarm.join(entry.topic, { server: true, client: true });
    }
    // Flush can hang in degraded networks. Bound the wait so the app can keep running.
    {
      const flushTimeoutMs = 10_000;
      const flushP = Promise.resolve()
        .then(() => this.peer.swarm.flush())
        .catch(() => {});
      await Promise.race([flushP, new Promise((resolve) => setTimeout(resolve, flushTimeoutMs))]);
    }
    this.started = true;

    if (this.peer.swarm.connections) {
      for (const connection of this.peer.swarm.connections) {
        for (const entry of this.channels.values()) {
          this._openChannelForConnection(connection, entry);
        }
      }
    }
  }

  async stop() {
    this.started = false;
    this._dhtBootPromise = null;
    this.connections.clear();
  }
}

export default Sidechannel;
