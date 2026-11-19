import Sidechannel from './index.js';
import b4a from 'b4a';
import c from '../../node_modules/compact-encoding/index.js';
import crypto from 'crypto';
import { boundedValue, channelPolicy, launcherOptions, receiveEncoding, MAX_CHANNELS, MAX_DIFFICULTY, MAX_FRAME_BYTES } from './channel-options.js';
import { SeenCache, seenKey } from './seen.js';
import { mine, verifyWork } from './pow.js';

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

  _rememberOutbound(payload) {
    const now = this._now();
    if (this.seenPersistence != null || this.channelPolicies?.has(payload.channel)) {
      this.protectedSeen.remember(seenKey(payload), now);
    } else {
      this._rememberSeen(payload.id, now);
    }
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
    if ((this.seenPersistence != null || this.channelPolicies?.has(channel)) && !boundedValue(payload)) return null;
    if (this._attachPow(payload) === false) return null;
    // Message-level signatures allow receivers to enforce "owner-only write" even when
    // messages are relayed (the transport peer can be a relay, not the original sender).
    const signed = this._attachSig(payload);
    if (!signed && this.channelPolicies?.get(channel)?.verifySignature) return null;
    return payload;
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
    if (existing) return stableStringify(policy) === stableStringify(previous) ? existing : null;
    if (this.channels.size >= MAX_CHANNELS) return null;
    // Startup keys always occupy their slot, even during a disabled override.
    if (policy && !previous && !this.startupPolicies.has(channel)) {
      let reserved = this.startupPolicies.size;
      for (const key of this.channelPolicies.keys()) if (!this.startupPolicies.has(key)) reserved++;
      if (reserved >= MAX_CHANNELS) return null;
    }
    const entry = super._registerChannel(channel);
    if (!entry) return null;
    if (policy) this.channelPolicies.set(channel, policy);
    else this.channelPolicies.delete(channel);
    const owner = this._getOwnerKey(channel);
    const welcome = policy?.welcome ?? this.configuredWelcomes.get(channel);
    const learned = this.welcomeByChannel.get(channel);
    this.welcomedChannels.delete(channel);
    this.welcomeByChannel.delete(channel);
    try {
      if (welcome && !this._verifyWelcome(welcome, channel, null) && policy?.welcome) {
        throw new Error('Invalid configured welcome');
      }
      if (!this._isWelcomed(channel) && learned) this._verifyWelcome(learned, channel, null);
    } catch {
      this.channels.delete(channel);
      if (previous) this.channelPolicies.set(channel, previous);
      else this.channelPolicies.delete(channel);
      return null;
    }
    if (owner && owner === normalizeKeyHex(this.peer?.wallet?.publicKey)) this._rememberWelcome(channel);
    entry.managed = !!policy || this.seenPersistence != null;
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
    this._rememberOutbound(payload);
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
    if (!payload) return;
    this._rememberOutbound(payload);
    record.message.send(payload);
    record.authSent = true;
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

  _openChannelForConnection(connection, entry) {
    if ((entry.managed || this.channelPolicies?.has(entry.name)) && this.channels.get(entry.name) !== entry) return;
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

    const deliver = (payload, action, acceptedKey, json) => {
      if (acceptedKey) this.protectedSeen.remember(acceptedKey, this._now());
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
        const copy = acceptedKey ? JSON.parse(json) : payload;
        this.onMessage(entry.name, copy, connection);
      } else {
        const from = payload?.from ?? 'unknown';
        const msg = payload?.message ?? payload;
        console.log(`[sidechannel:${entry.name}] ${from}:`, msg);
      }
      this._relay(entry.name, payload, connection);
    };

    const legacyReceive = (payload) => {
      if (this.channelPolicies?.has(entry.name) && this.channels.get(entry.name) !== entry) return;
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
            const hash = crypto.createHash('sha256').update(this._sigBase(payload)).digest('hex');
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
      const action = this._deliveryAction(payload, entry, connection, false);
      if (action !== false) deliver(payload, action, null);
    };

    const policy = this.channelPolicies?.get(entry.name);
    const protectedChannel = !!policy || this.seenPersistence != null;
    const limit = policy?.maxReceiveBytes ?? MAX_FRAME_BYTES;
    const message = channel.addMessage(protectedChannel ? {
      encoding: receiveEncoding(limit),
      onmessage: (frame) => {
        if (!frame || this.channels.get(entry.name) !== entry || this._isBlocked(connection)) return;
        if (this.connections.get(connection)?.get(entry.name)?.channel !== channel) return;
        const { payload, bytes } = frame;
        if (payload?.channel !== entry.name) return;
        const key = seenKey(payload);
        if (!key || this.protectedSeen.has(key, this._now()) || bytes > limit) return;
        if (!boundedValue(payload)) return;
        let action;
        try {
          const control = payload.message?.control;
          const ownerOnly = this._ownerWriteOnly(entry.name) && control !== 'auth' && control !== 'welcome';
          if (ownerOnly || policy?.verifySignature) {
            const author = normalizeKeyHex(payload.from);
            if (ownerOnly && author !== this._getOwnerKey(entry.name)) return;
            if (!this._validAuthorSignature(payload, author)) return;
          }
          if (!this._checkPow(payload, entry.name)) return;
          if (!this._checkRate(connection, bytes) || !this._checkInvite(payload, entry.name, connection)) return;
          action = this._deliveryAction(payload, entry, connection, true);
        } catch {
          // Legacy invite/welcome normalizers can reject malformed JSON field types.
          return;
        }
        if (action !== false) deliver(payload, action, key, frame.json);
      }
    } : { encoding: c.json, onmessage: legacyReceive });

    const record = { channel, message, retries: 0, authSent: false };
    perConn.set(entry.name, record);

    channel.open();
    channel
      .fullyOpened()
      .then((opened) => {
        if ((entry.managed || this.channelPolicies?.has(entry.name)) &&
            (this.channels.get(entry.name) !== entry || perConn.get(entry.name) !== record)) return;
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

  _announceChannel(entry) {
    if (!entry) return Promise.resolve(false);
    if (entry.announced) return Promise.resolve(true);
    if (entry._announcing) return entry._announcing;
    if (!this.peer?.swarm) return Promise.resolve(false);
    const announcing = (async () => {
      try {
        this.peer.swarm.join(entry.topic, { server: true, client: true });
        if (entry.managed) entry.discoveryJoined = true;
        await this._flushSwarm();
        if (entry.managed && (this.channels.get(entry.name) !== entry || !this.started)) return false;
        this._markAnnounced(entry, true);
        return true;
      } catch (err) {
        if (this.debug) {
          console.log(`[sidechannel:${entry.name}] announce failed: ${err?.message ?? err}`);
        }
        return false;
      } finally {
        entry._announcing = null;
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
    if (!announced || (entry.managed && this.channels.get(entry.name) !== entry)) return false;

    for (const connection of this.connections.keys()) {
      this._openChannelForConnection(connection, entry);
    }
    // A passive peer may have established transport connections before it had
    // any sidechannel, so those connections have no sidechannel records yet.
    if (entry.managed && this.peer.swarm.connections) {
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
        if (entry.managed) connection.userData?.unpair?.({ protocol: entry.protocol });
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
    let envelope;
    try {
      if (!boundedValue(payload)) return false;
      // Snapshot the actual wire representation. Only TTL is renewed, and
      // neither the original caller's object nor its nested content is mutated.
      const json = JSON.stringify({ ...payload, ttl: this.relayTtl });
      const bytes = b4a.byteLength(json);
      const size = { end: bytes };
      c.uint.preencode(size, bytes);
      if (bytes > this.maxMessageBytes || size.end > MAX_FRAME_BYTES) return false;
      envelope = JSON.parse(json);
      if (envelope.channel !== channel || !seenKey(envelope) || !boundedValue(envelope)) return false;
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
    for (const [connection, perConn] of this.connections) {
      const record = perConn.get(channel);
      if (!record?.channel?.opened || record.channel.closed || !this._remoteAuthorized(channel, connection)) continue;
      if (!sent) this._rememberOutbound(envelope);
      record.message.send(envelope);
      sent = true;
    }
    return sent;
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
    this._rememberOutbound(payload);
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

  async _start() {
    if (!this.peer?.swarm) {
      throw new Error('Sidechannel requires peer.swarm to be initialized.');
    }

    // Hyperswarm can accept `join()` calls before the DHT is fully bootstrapped.
    // In practice this can lead to missed announces/lookups and permanent
    // non-discovery until restart. `fullyBootstrapped()` is the authoritative
    // readiness barrier, so wait for it before joining any sidechannel topic.
    if (this.seenPersistence != null) this.protectedSeen.prepare(this._now());
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

    const round = [];
    for (const entry of this.channels.values()) {
      this.peer.swarm.join(entry.topic, { server: true, client: true });
      if (entry.managed) entry.discoveryJoined = true;
      round.push(entry);
    }
    await this._flushSwarm();
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
    if (this.seenPersistence != null) this.protectedSeen.reset();
    // Nothing is on the swarm any more: drop announced state (a later start()
    // re-announces from scratch) and release pending waiters with a truthful
    // "not joined" instead of leaving them hanging.
    for (const entry of this.channels.values()) this._markAnnounced(entry, false);
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
