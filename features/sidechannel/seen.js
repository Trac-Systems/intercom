import crypto from 'crypto';
import b4a from 'b4a';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { integer } from './channel-options.js';

const HOUR = 3_600_000;
const HASH_BYTES = 32;
const MAX_IDS = 20_000;

// Scope new caches to the transport channel. A public channel cannot reserve
// IDs on a channel with stronger admission requirements.
export function seenKey(payload, scope, verified) {
  const { channel, id } = payload;
  if (typeof id !== 'string' || !id || id.length > 512 || b4a.byteLength(id) > 512) return null;
  const from = payload.from;
  // Version 1 emits hex. Also accept the JSON Buffer representation recognized
  // by the legacy signer. Isolate transport handshakes from application IDs.
  let author = '';
  if (typeof from === 'string' && from.length <= 128) author = from.trim().toLowerCase();
  else if (from?.type === 'Buffer' && Array.isArray(from.data) && from.data.length === 32) {
    if (!from.data.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255)) return null;
    author = b4a.toString(b4a.from(from.data), 'hex');
  } else if (from != null) return null;
  const control = payload.message?.control;
  const kind = control === 'auth' || control === 'welcome' ? control : '';
  return crypto.createHash('sha256').update(JSON.stringify(['receipt-v2', scope, verified, channel, author, kind, id])).digest('hex');
}

function sameFile(expected, actual) {
  return expected && actual && expected.dev === actual.dev && expected.ino === actual.ino;
}

function readRange(fd, offset, length) {
  const data = b4a.alloc(length);
  let read = 0;
  while (read < length) {
    const count = fs.readSync(fd, data, read, length - read, offset + read);
    if (!count) throw new Error('Seen file changed during read');
    read += count;
  }
  return data;
}

// The bundled Bare fs omits O_EXCL and O_NOFOLLOW from its JS constants.
// Use the platform open(2) flags there. Fail closed on unsupported runtimes.
function safeFlags() {
  const { O_EXCL, O_NOFOLLOW, O_NONBLOCK } = fs.constants;
  if (O_EXCL && O_NOFOLLOW && O_NONBLOCK) return { exclusive: O_EXCL, safe: O_NOFOLLOW | O_NONBLOCK };
  switch (os.platform()) {
    case 'darwin': return { exclusive: 0x800, safe: 0x100 | 0x4 };
    case 'linux': return { exclusive: 0x80, safe: 0x20000 | 0x800 };
    default: throw new Error('Private seen storage requires safe POSIX open flags');
  }
}

class HourFiles {
  constructor(config) {
    if (typeof config?.directory !== 'string' || !config.directory.trim()) throw new TypeError('Expected seenPersistence.directory');
    for (const key of Object.keys(config)) {
      if (!['directory', 'hours', 'maxFileBytes'].includes(key)) throw new TypeError(`Unknown seenPersistence option: ${key}`);
    }
    this.directory = path.resolve(config.directory);
    this.hours = integer(config.hours ?? 3, 'hours', 1, 24);
    const bytes = integer(config.maxFileBytes ?? 65_536, 'maxFileBytes', HASH_BYTES, 262_144);
    this.capacity = Math.floor(bytes / HASH_BYTES) * HASH_BYTES;
    this.flags = safeFlags();
    this.uid = globalThis.process?.geteuid?.() ?? os.userInfo().uid;
    this.lockPath = path.join(this.directory, '.writer.lock');
    this.lock = null;
    this.hour = null;
    this.highWater = 0;
    this.active = null;
  }

  file(hour) { return path.join(this.directory, `seen-${hour}.bin`); }

  checkDirectory() {
    const stat = fs.lstatSync(this.directory);
    if (!stat.isDirectory() || stat.uid !== this.uid || (stat.mode & 0o077) ||
        (this.lock && !sameFile(this.parent, stat))) throw new Error('Expected a private, owner-only seen directory');
    if (this.lock && !sameFile(this.lock, fs.lstatSync(this.lockPath))) throw new Error('Seen writer lock changed');
    return stat;
  }

  acquire() {
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    this.parent = this.checkDirectory();
    // mkdir is exclusive on both supported runtimes. Never steal a stale lock.
    fs.mkdirSync(this.lockPath, { mode: 0o700 });
    this.lock = fs.lstatSync(this.lockPath);
    this.checkDirectory();
  }

  close() {
    if (this.lock) {
      this.checkDirectory();
      fs.rmdirSync(this.lockPath);
      this.lock = null;
    }
    this.hour = null;
    this.active = null;
  }

  regular(file) {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== this.uid) throw new Error('Expected an owned regular seen file');
    return stat;
  }

  open(file, flags, expected) {
    this.checkDirectory();
    const fd = fs.openSync(file, flags | this.flags.safe, 0o600);
    try {
      const stat = this.regular(file);
      if (!sameFile(stat, fs.fstatSync(fd)) || (expected && !sameFile(stat, expected))) {
        throw new Error('Seen file identity changed');
      }
      this.checkDirectory();
      return fd;
    } catch (error) {
      fs.closeSync(fd);
      throw error;
    }
  }

  replace(file, data, expected) {
    const temp = path.join(this.directory, 'seen-compact-' + crypto.randomBytes(16).toString('hex') + '.tmp');
    const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | this.flags.exclusive;
    const fd = this.open(temp, flags);
    try {
      if (fs.writeSync(fd, data, 0, data.length, 0) !== data.length) throw new Error('Incomplete compaction');
      this.checkDirectory();
      if (!sameFile(this.regular(file), expected) || !sameFile(this.regular(temp), fs.fstatSync(fd))) {
        throw new Error('Seen file changed before compaction');
      }
      fs.renameSync(temp, file);
      return fs.fstatSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  }

  rotate(observed, ids, maxIds) {
    if (this.hour !== null && observed <= this.hour) return;
    const acquiring = !this.lock;
    if (acquiring) this.acquire();
    try {
      this.reload(observed, ids, maxIds);
    } catch (error) {
      if (acquiring) this.close();
      throw error;
    }
  }

  reload(observed, ids, maxIds) {
    this.checkDirectory();
    const files = [];
    const cleanup = [];
    const dir = fs.opendirSync(this.directory);
    try {
      let count = 0;
      for (let entry; (entry = dir.readSync());) {
        if (++count > 64) throw new Error('Use a dedicated seenPersistence directory');
        const match = /^seen-(0|[1-9]\d{0,11})\.bin$/.exec(entry.name);
        const file = path.join(this.directory, entry.name);
        if (match) files.push({ hour: Number(match[1]), file, stat: this.regular(file) });
        else if (/^seen-compact(?:-[0-9a-f]{32})?\.tmp$/.test(entry.name)) cleanup.push({ file, stat: this.regular(file) });
      }
    } finally {
      dir.closeSync();
    }
    files.sort((a, b) => b.hour - a.hour);
    const hour = Math.max(observed, this.highWater, files[0]?.hour ?? 0);
    let remaining = maxIds;
    let active = null;
    const recent = [];
    for (const item of files) {
      const { file, stat } = item;
      if (item.hour <= hour - this.hours) {
        // A regressed clock may load receipts but may never prune buckets.
        if (observed >= hour) cleanup.push(item);
        continue;
      }
      const aligned = stat.size - stat.size % HASH_BYTES;
      const keep = Math.min(this.capacity, aligned);
      const fd = this.open(file, fs.constants.O_RDONLY, stat);
      try {
        if (stat.size !== keep) item.stat = this.replace(file, readRange(fd, aligned - keep, keep), stat);
        const length = Math.min(remaining * HASH_BYTES, keep);
        if (length) recent.push([item.hour, readRange(fd, aligned - length, length)]);
        remaining -= length / HASH_BYTES;
      } finally {
        fs.closeSync(fd);
      }
      if (item.hour === hour) active = item.stat;
    }
    for (const { file, stat } of cleanup) {
      this.checkDirectory();
      if (!sameFile(stat, this.regular(file))) throw new Error('Seen file changed before cleanup');
      fs.unlinkSync(file);
    }
    ids.clear();
    for (const [n, data] of recent.reverse()) {
      for (let i = 0; i < data.length; i += HASH_BYTES) {
        const key = b4a.toString(data, 'hex', i, i + HASH_BYTES);
        ids.delete(key);
        ids.set(key, n * HOUR);
      }
    }
    this.active = active;
    this.hour = this.highWater = hour;
  }

  append(key) {
    const file = this.file(this.hour);
    const hash = b4a.from(key, 'hex');
    const flags = fs.constants.O_RDWR | (this.active ? 0 : fs.constants.O_CREAT | this.flags.exclusive);
    const fd = this.open(file, flags, this.active);
    try {
      const stat = fs.fstatSync(fd);
      if (stat.size !== (this.active?.size ?? 0)) throw new Error('Seen file size changed');
      if (stat.size + HASH_BYTES > this.capacity) {
        const keep = Math.floor(this.capacity / (2 * HASH_BYTES)) * HASH_BYTES;
        this.active = this.replace(file, b4a.concat([readRange(fd, stat.size - keep, keep), hash]), stat);
      } else {
        if (fs.writeSync(fd, hash, 0, HASH_BYTES, stat.size) !== HASH_BYTES) throw new Error('Incomplete seen record');
        this.active = fs.fstatSync(fd);
      }
    } finally {
      fs.closeSync(fd);
    }
  }
}

export class SeenCache {
  constructor(maxSeen, ttlMs, persistence) {
    this.limit = Math.min(MAX_IDS, Math.max(0, maxSeen));
    this.ttlMs = ttlMs;
    this.ids = new Map();
    this.files = persistence == null ? null : new HourFiles(persistence);
  }

  prepare(now) {
    if (this.files) {
      this.files.rotate(Math.floor(now / HOUR), this.ids, this.limit);
    } else {
      for (const [id, time] of this.ids) {
        if (time >= now - this.ttlMs) break;
        this.ids.delete(id);
      }
    }
  }

  close() {
    this.files?.close();
    this.ids.clear();
  }

  has(key, now) {
    this.prepare(now);
    return this.ids.has(key);
  }

  remember(key, now) {
    if (!key || !this.limit || this.has(key, now)) return;
    if (this.files) {
      try {
        this.files.append(key);
      } catch (error) {
        this.files.hour = null; // Re-scan and recover any partial append on retry.
        throw error;
      }
    }
    this.ids.set(key, now);
    if (this.ids.size > this.limit) this.ids.delete(this.ids.keys().next().value);
  }
}
