import fs from 'fs';
import path from 'path';

const APP_KEY = 'expense_split_v1';

const normalizeText = (value) => String(value || '').trim();

const normalizeMember = (value) => normalizeText(value).toLowerCase();

const parseMembers = (value) => {
  const values = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];
  const dedup = new Set();
  const members = [];
  for (const raw of values) {
    const member = normalizeMember(raw);
    if (!member || dedup.has(member)) continue;
    dedup.add(member);
    members.push(member);
  }
  return members;
};

const parseAmountToCents = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(String(value).replace(/,/g, ''));
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.round(numeric * 100);
};

const formatCents = (cents) => (Number(cents || 0) / 100).toFixed(2);

class ExpenseSplit {
  constructor(peer, config = {}) {
    this.peer = peer;
    this.sidechannel = config.sidechannel || null;
    this.defaultChannel =
      typeof config.defaultChannel === 'string' && config.defaultChannel.trim()
        ? config.defaultChannel.trim()
        : '0000intercom';
    this.debug = config.debug === true;
    this.persistencePath =
      typeof config.persistencePath === 'string' && config.persistencePath.trim()
        ? config.persistencePath.trim()
        : null;
    this.rooms = new Map();
    this._loadLocalSnapshots();
  }

  attachSidechannel(sidechannel) {
    this.sidechannel = sidechannel;
  }

  resolveChannel(channel) {
    const target = normalizeText(channel);
    return target || this.defaultChannel;
  }

  getRoom(channel) {
    const key = this.resolveChannel(channel);
    if (!this.rooms.has(key)) {
      this.rooms.set(key, {
        events: [],
        txSeen: new Set(),
      });
    }
    return this.rooms.get(key);
  }

  createTxId() {
    const pub = this.peer?.wallet?.publicKey;
    const key =
      typeof pub === 'string' && pub.length > 0 ? pub.slice(0, 12) : Math.random().toString(16).slice(2, 14);
    return `${key}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
  }

  normalizeEvent(event) {
    if (!event || typeof event !== 'object') return null;
    const txId = normalizeText(event.txId);
    const payer = normalizeMember(event.payer);
    const amountCents = Number.parseInt(event.amountCents, 10);
    const split = parseMembers(event.split);
    if (!txId || !payer || !Number.isSafeInteger(amountCents) || amountCents <= 0 || split.length === 0) {
      return null;
    }
    const note = normalizeText(event.note);
    const ts = Number.isFinite(event.ts) ? Number(event.ts) : Date.now();
    const by = event.by ?? null;
    return {
      txId,
      payer,
      amountCents,
      split,
      note,
      ts,
      by,
    };
  }

  addEvent(channel, event) {
    const normalized = this.normalizeEvent(event);
    if (!normalized) {
      return { ok: false, error: 'Invalid expense event payload.' };
    }
    const room = this.getRoom(channel);
    if (room.txSeen.has(normalized.txId)) {
      return { ok: true, duplicate: true, event: normalized };
    }
    room.txSeen.add(normalized.txId);
    room.events.push(normalized);
    this._saveLocalSnapshots();
    if (this.debug) {
      console.log(
        `[expense-split:${this.resolveChannel(channel)}] +${formatCents(normalized.amountCents)} by ${normalized.payer}`
      );
    }
    return { ok: true, duplicate: false, event: normalized };
  }

  handleSidechannelMessage(channel, payload) {
    const message = payload?.message;
    if (!message || typeof message !== 'object' || message.app !== APP_KEY) return false;

    if (message.type === 'expense_add') {
      this.addEvent(channel, message.event);
      return true;
    }

    if (message.type === 'expense_clear') {
      const target = this.resolveChannel(channel);
      this.rooms.delete(target);
      if (this.debug) console.log(`[expense-split:${target}] ledger cleared`);
      return true;
    }

    return false;
  }

  addExpense(input = {}) {
    const channel = this.resolveChannel(input.channel);
    const payer = normalizeMember(input.payer);
    if (!payer) return { ok: false, error: 'Missing payer.' };

    const amountCents = parseAmountToCents(input.amount);
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
      return { ok: false, error: 'Invalid amount. Use a positive number.' };
    }

    const split = parseMembers(input.split);
    if (split.length === 0) {
      return { ok: false, error: 'Missing split members. Use comma-separated names.' };
    }
    if (!split.includes(payer)) split.unshift(payer);

    const note = normalizeText(input.note);
    const event = {
      txId: this.createTxId(),
      payer,
      amountCents,
      split,
      note,
      ts: Date.now(),
      by: this.peer?.wallet?.address ?? null,
    };

    const local = this.addEvent(channel, event);
    if (!local.ok) return local;

    let broadcasted = false;
    if (this.sidechannel && typeof this.sidechannel.broadcast === 'function') {
      try {
        if (typeof this.sidechannel.addChannel === 'function') {
          this.sidechannel.addChannel(channel).catch(() => {});
        }
        broadcasted = this.sidechannel.broadcast(channel, {
          app: APP_KEY,
          type: 'expense_add',
          event,
        });
      } catch (_e) {
        broadcasted = false;
      }
    }

    return { ok: true, channel, event, broadcasted };
  }

  clearChannel(channel, options = {}) {
    const target = this.resolveChannel(channel);
    this.rooms.delete(target);
    this._saveLocalSnapshots();

    const shouldBroadcast = options.broadcast !== false;
    if (
      shouldBroadcast &&
      this.sidechannel &&
      typeof this.sidechannel.broadcast === 'function'
    ) {
      try {
        this.sidechannel.broadcast(target, {
          app: APP_KEY,
          type: 'expense_clear',
          ts: Date.now(),
          by: this.peer?.wallet?.address ?? null,
        });
      } catch (_e) {}
    }

    return { ok: true, channel: target };
  }

  normalizeSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return null;
    const channel = this.resolveChannel(snapshot.channel);
    const sourceEvents = Array.isArray(snapshot.events) ? snapshot.events : [];
    const events = [];
    const txSeen = new Set();
    for (const raw of sourceEvents) {
      const normalized = this.normalizeEvent(raw);
      if (!normalized || txSeen.has(normalized.txId)) continue;
      txSeen.add(normalized.txId);
      events.push(normalized);
    }
    events.sort((a, b) => a.ts - b.ts);
    return {
      channel,
      version: Number.isSafeInteger(snapshot.version) ? snapshot.version : 1,
      events,
    };
  }

  exportRoom(channel) {
    const target = this.resolveChannel(channel);
    const events = this.list(target);
    return {
      channel: target,
      version: 1,
      events: events.map((event) => ({ ...event })),
    };
  }

  importRoom(snapshot, options = {}) {
    const normalized = this.normalizeSnapshot(snapshot);
    if (!normalized) {
      return { ok: false, error: 'Invalid snapshot.' };
    }
    const replace = options.replace === true;
    const room = this.getRoom(normalized.channel);
    if (replace) {
      room.events = [];
      room.txSeen = new Set();
    }
    let added = 0;
    for (const event of normalized.events) {
      if (room.txSeen.has(event.txId)) continue;
      room.txSeen.add(event.txId);
      room.events.push(event);
      added += 1;
    }
    room.events.sort((a, b) => a.ts - b.ts);
    this._saveLocalSnapshots();
    return {
      ok: true,
      channel: normalized.channel,
      added,
      total: room.events.length,
    };
  }

  list(channel) {
    const target = this.resolveChannel(channel);
    const room = this.rooms.get(target);
    if (!room) return [];
    return room.events.slice().sort((a, b) => a.ts - b.ts);
  }

  balances(channel) {
    const events = this.list(channel);
    const map = new Map();

    for (const event of events) {
      const members = Array.isArray(event.split) ? event.split : [];
      if (members.length === 0) continue;
      const baseShare = Math.floor(event.amountCents / members.length);
      const remainder = event.amountCents - baseShare * members.length;

      members.forEach((member, idx) => {
        const share = baseShare + (idx < remainder ? 1 : 0);
        const prev = map.get(member) || 0;
        map.set(member, prev - share);
      });

      const payerPrev = map.get(event.payer) || 0;
      map.set(event.payer, payerPrev + event.amountCents);
    }

    return Array.from(map.entries())
      .map(([member, cents]) => ({ member, cents }))
      .sort((a, b) => a.member.localeCompare(b.member));
  }

  settlements(channel) {
    const balances = this.balances(channel);
    const creditors = balances
      .filter((entry) => entry.cents > 0)
      .map((entry) => ({ ...entry }))
      .sort((a, b) => b.cents - a.cents);
    const debtors = balances
      .filter((entry) => entry.cents < 0)
      .map((entry) => ({ member: entry.member, cents: Math.abs(entry.cents) }))
      .sort((a, b) => b.cents - a.cents);

    const settlements = [];
    let i = 0;
    let j = 0;
    while (i < debtors.length && j < creditors.length) {
      const debtor = debtors[i];
      const creditor = creditors[j];
      const amountCents = Math.min(debtor.cents, creditor.cents);
      if (amountCents > 0) {
        settlements.push({
          from: debtor.member,
          to: creditor.member,
          amountCents,
        });
      }
      debtor.cents -= amountCents;
      creditor.cents -= amountCents;
      if (debtor.cents === 0) i += 1;
      if (creditor.cents === 0) j += 1;
    }
    return settlements;
  }

  summary(channel) {
    const target = this.resolveChannel(channel);
    const events = this.list(target);
    const balances = this.balances(target);
    const settlements = this.settlements(target);
    const totalCents = events.reduce((sum, item) => sum + item.amountCents, 0);
    return {
      channel: target,
      eventCount: events.length,
      totalCents,
      balances,
      settlements,
    };
  }

  formatAmount(cents) {
    return formatCents(cents);
  }

  getLocalSnapshot(channel) {
    const target = this.resolveChannel(channel);
    const room = this.rooms.get(target);
    if (!room || !Array.isArray(room.events) || room.events.length === 0) return null;
    return this.exportRoom(target);
  }

  _serializeLocalSnapshots() {
    const rooms = [];
    for (const key of this.rooms.keys()) {
      const snapshot = this.exportRoom(key);
      if (snapshot.events.length === 0) continue;
      rooms.push(snapshot);
    }
    return {
      version: 1,
      updatedAt: Date.now(),
      rooms,
    };
  }

  _saveLocalSnapshots() {
    if (!this.persistencePath) return;
    try {
      fs.mkdirSync(path.dirname(this.persistencePath), { recursive: true });
      fs.writeFileSync(this.persistencePath, `${JSON.stringify(this._serializeLocalSnapshots())}\n`, 'utf8');
    } catch (_e) {}
  }

  _loadLocalSnapshots() {
    if (!this.persistencePath) return;
    try {
      if (!fs.existsSync(this.persistencePath)) return;
      const raw = fs.readFileSync(this.persistencePath, 'utf8');
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const rooms = Array.isArray(parsed?.rooms) ? parsed.rooms : [];
      for (const snapshot of rooms) {
        this.importRoom(snapshot, { replace: true });
      }
    } catch (_e) {}
  }
}

export default ExpenseSplit;
