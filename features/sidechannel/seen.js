import crypto from 'crypto';
import b4a from 'b4a';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { integer } from './channel-options.js';

const HOUR = 3_600_000;
const HASH_BYTES = 32;
const MAX_IDS = 20_000;
// A regression up to this many hours keeps writing to the newer bucket.
// Beyond it, newer buckets are treated as a corrected forward clock step.
const FUTURE_HOURS = 1;

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

// Linux O_NOFOLLOW differs by architecture (asm/fcntl.h). x86, RISC-V,
// s390x and LoongArch use the generic value. ARM and PowerPC use 0100000,
// where the generic value means O_LARGEFILE (arm) or O_DIRECT (powerpc).
const LINUX_NOFOLLOW = {
  x64: 0x20000, ia32: 0x20000, riscv64: 0x20000, s390x: 0x20000, loong64: 0x20000,
  arm: 0x8000, arm64: 0x8000, ppc: 0x8000, ppc64: 0x8000
};

// The bundled Bare fs omits O_EXCL and O_NOFOLLOW from its JS constants.
// Use the platform open(2) flags there. Fail closed on unlisted platforms
// and architectures (MIPS, SPARC, Alpha and PA-RISC use other values).
export function openFlags(constants = fs.constants, platform = os.platform(), arch = os.arch()) {
  const { O_EXCL, O_NOFOLLOW, O_NONBLOCK } = constants;
  if (O_EXCL && O_NOFOLLOW && O_NONBLOCK) return { exclusive: O_EXCL, safe: O_NOFOLLOW | O_NONBLOCK };
  if (platform === 'darwin') return { exclusive: 0x800, safe: 0x100 | 0x4 };
  if (platform === 'linux' && Object.hasOwn(LINUX_NOFOLLOW, arch)) {
    return { exclusive: 0x80, safe: LINUX_NOFOLLOW[arch] | 0x800 };
  }
  throw new Error('Private seen storage requires safe POSIX open flags');
}

// One random value per loaded module, i.e. per process. A lock that names
// this process ID with another value was left by an earlier process that had
// the same ID, as happens after a container restart.
const PROCESS_TOKEN = b4a.toString(crypto.randomBytes(16), 'hex');
const LOCK_LEFTOVER = /^\.writer\.lock-[0-9a-f]{32}\.(?:tmp|stale)$/;

function processId() {
  return globalThis.process?.pid ?? os.pid();
}

// Signal 0 checks for existence only. EPERM means the process exists.
function processAlive(pid) {
  try {
    if (globalThis.process?.kill) globalThis.process.kill(pid, 0);
    else os.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

function lockHeld(message) {
  const error = new Error('EEXIST: ' + message);
  error.code = 'EEXIST';
  return error;
}

function randomHex() {
  return b4a.toString(crypto.randomBytes(16), 'hex');
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
    this.flags = openFlags();
    this.uid = globalThis.process?.geteuid?.() ?? os.userInfo().uid;
    this.lockPath = path.join(this.directory, '.writer.lock');
    this.lock = null;
    this.directoryFd = null;
    this.hour = null;
    this.highWater = 0;
    this.active = null;
  }

  file(hour) { return path.join(this.directory, `seen-${hour}.bin`); }

  checkDirectory() {
    const stat = fs.lstatSync(this.directory);
    if (!stat.isDirectory() || stat.uid !== this.uid || (stat.mode & 0o077) ||
        (this.directoryFd !== null && !sameFile(fs.fstatSync(this.directoryFd), stat))) throw new Error('Expected a private, owner-only seen directory');
    if (this.lock && !sameFile(this.lock, fs.lstatSync(this.lockPath))) throw new Error('Seen writer lock changed');
    return stat;
  }

  acquire() {
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const parent = this.checkDirectory();
    this.directoryFd = fs.openSync(this.directory, fs.constants.O_RDONLY | this.flags.safe);
    try {
      if (!sameFile(parent, this.checkDirectory())) throw new Error('Seen directory changed before locking');
      this.lock = this.takeLock();
      this.checkDirectory();
    } catch (error) {
      fs.closeSync(this.directoryFd);
      this.directoryFd = null;
      this.lock = null;
      throw error;
    }
  }

  // The lock is a private directory holding an owner record. It is created
  // complete under a random name and renamed into place. A rename onto an
  // existing, non-empty lock fails on both supported runtimes, so the lock
  // is never visible without its owner. A lock is reclaimed only when its
  // record names this host and a process that no longer exists.
  takeLock() {
    for (let attempt = 0; attempt < 3; attempt++) {
      const token = randomHex();
      const owner = { version: 1, pid: processId(), host: os.hostname(), process: PROCESS_TOKEN, token };
      const temp = path.join(this.directory, `.writer.lock-${token}.tmp`);
      fs.mkdirSync(temp, { mode: 0o700 });
      let created;
      try {
        const data = b4a.from(JSON.stringify(owner));
        const fd = fs.openSync(path.join(temp, 'owner'), fs.constants.O_WRONLY | fs.constants.O_CREAT | this.flags.exclusive | this.flags.safe, 0o600);
        try {
          if (fs.writeSync(fd, data, 0, data.length, 0) !== data.length) throw new Error('Incomplete seen lock record');
        } finally {
          fs.closeSync(fd);
        }
        created = fs.lstatSync(temp);
        this.checkDirectory();
        if (!this.exists(this.lockPath)) {
          try {
            fs.renameSync(temp, this.lockPath);
          } catch (error) {
            if (!this.exists(this.lockPath)) throw error;
          }
        }
      } finally {
        if (this.exists(temp)) this.removeLock(temp);
      }
      let held;
      try {
        held = this.readLock(this.lockPath);
      } catch (error) {
        if (error?.code === 'ENOENT') continue; // Released meanwhile.
        throw error;
      }
      if (sameFile(held.stat, created)) return held.stat;
      if (!this.stale(held.owner)) {
        throw lockHeld(held.owner
          ? `seen directory is locked by process ${held.owner.pid} on ${held.owner.host}`
          : `seen directory has an unidentified writer lock; confirm the writer has stopped, then remove ${this.lockPath}`);
      }
      this.reclaim(held);
    }
    throw lockHeld('seen directory lock is contended');
  }

  exists(file) {
    try {
      fs.lstatSync(file);
      return true;
    } catch (error) {
      if (error?.code === 'ENOENT') return false;
      throw error;
    }
  }

  readLock(dir) {
    const stat = fs.lstatSync(dir);
    if (!stat.isDirectory() || stat.uid !== this.uid) return { stat, owner: null };
    let fd;
    try {
      fd = fs.openSync(path.join(dir, 'owner'), fs.constants.O_RDONLY | this.flags.safe);
    } catch {
      return { stat, owner: null };
    }
    try {
      const info = fs.fstatSync(fd);
      if (!info.isFile() || info.nlink !== 1 || info.uid !== this.uid || info.size > 1024) return { stat, owner: null };
      const owner = JSON.parse(b4a.toString(readRange(fd, 0, info.size)));
      const valid = owner?.version === 1 && Number.isSafeInteger(owner.pid) && owner.pid > 0 &&
        typeof owner.host === 'string' && typeof owner.process === 'string' && typeof owner.token === 'string';
      return { stat, owner: valid ? owner : null };
    } catch {
      return { stat, owner: null };
    } finally {
      fs.closeSync(fd);
    }
  }

  stale(owner) {
    if (!owner || owner.host !== os.hostname()) return false;
    if (owner.pid === processId()) return owner.process !== PROCESS_TOKEN;
    return !processAlive(owner.pid);
  }

  // Move the stale lock aside atomically, then confirm it is the one that was
  // inspected. If another process replaced it first, put that lock back.
  reclaim(held) {
    const trash = path.join(this.directory, `.writer.lock-${randomHex()}.stale`);
    try {
      fs.renameSync(this.lockPath, trash);
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    const moved = this.readLock(trash);
    if (!sameFile(moved.stat, held.stat) || moved.owner?.token !== held.owner.token) {
      try { fs.renameSync(trash, this.lockPath); } catch { /* The displaced owner fails closed. */ }
      throw lockHeld('seen directory lock changed during recovery');
    }
    this.removeLock(trash);
  }

  removeLock(dir) {
    const stat = fs.lstatSync(dir);
    if (!stat.isDirectory() || stat.uid !== this.uid) throw new Error('Expected an owned seen lock directory');
    const owner = path.join(dir, 'owner');
    if (this.exists(owner)) {
      if (!fs.lstatSync(owner).isFile()) throw new Error('Expected a regular seen lock record');
      fs.unlinkSync(owner);
    }
    fs.rmdirSync(dir);
  }

  close() {
    try {
      if (this.lock) {
        this.checkDirectory();
        // Release by rename first. An interrupted cleanup leaves only a
        // leftover name, never an ownerless lock.
        const trash = path.join(this.directory, `.writer.lock-${randomHex()}.stale`);
        fs.renameSync(this.lockPath, trash);
        this.removeLock(trash);
      }
    } finally {
      if (this.directoryFd !== null) fs.closeSync(this.directoryFd);
      this.directoryFd = null;
      this.lock = this.hour = this.active = null;
    }
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
    const temp = path.join(this.directory, 'seen-compact-' + b4a.toString(crypto.randomBytes(16), 'hex') + '.tmp');
    const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | this.flags.exclusive;
    const fd = this.open(temp, flags);
    try {
      if (fs.writeSync(fd, data, 0, data.length, 0) !== data.length) throw new Error('Incomplete compaction');
      this.checkDirectory();
      // Without an expected identity the target must not exist yet.
      const target = expected ? sameFile(this.regular(file), expected) : !this.exists(file);
      if (!target || !sameFile(this.regular(temp), fs.fstatSync(fd))) {
        throw new Error('Seen file changed before compaction');
      }
      const identity = fs.fstatSync(fd);
      fs.renameSync(temp, file);
      return identity;
    } catch (error) {
      this.checkDirectory();
      if (sameFile(this.regular(temp), fs.fstatSync(fd))) fs.unlinkSync(temp);
      throw error;
    } finally {
      fs.closeSync(fd);
    }
  }

  rotate(observed, ids, maxIds) {
    if (this.hour !== null && observed <= this.hour && observed + FUTURE_HOURS >= this.hour) return;
    const acquiring = !this.lock;
    if (acquiring) this.acquire();
    try {
      this.reload(observed, ids, maxIds);
    } catch (error) {
      if (acquiring) this.close();
      throw error;
    }
  }

  scan() {
    const files = [];
    const cleanup = [];
    const leftovers = [];
    const dir = fs.opendirSync(this.directory);
    try {
      let count = 0;
      for (let entry; (entry = dir.readSync());) {
        if (++count > 64) throw new Error('Use a dedicated seenPersistence directory');
        const match = /^seen-(0|[1-9]\d{0,11})\.bin$/.exec(entry.name);
        const file = path.join(this.directory, entry.name);
        if (match) files.push({ hour: Number(match[1]), file, stat: this.regular(file) });
        else if (/^seen-compact(?:-[0-9a-f]{32})?\.tmp$/.test(entry.name)) cleanup.push({ file, stat: this.regular(file) });
        else if (LOCK_LEFTOVER.test(entry.name)) leftovers.push(file);
      }
    } finally {
      dir.closeSync();
    }
    files.sort((a, b) => b.hour - a.hour);
    return { files, cleanup, leftovers };
  }

  // Lock names left by an interrupted acquire, release or recovery. Remove
  // only those whose owner record names a process that has exited.
  removeLeftover(dir) {
    try {
      const { owner } = this.readLock(dir);
      if (this.stale(owner)) this.removeLock(dir);
    } catch { /* Keep it for a later scan. */ }
  }

  // Move receipts from buckets ahead of the observed hour into that hour,
  // oldest first, so the newest receipts survive the file capacity. They then
  // age out with ordinary hourly retention.
  rehome(future, current, observed) {
    const parts = [];
    for (const item of [current, ...future.sort((a, b) => a.hour - b.hour)]) {
      if (!item) continue;
      const aligned = item.stat.size - item.stat.size % HASH_BYTES;
      const keep = Math.min(this.capacity, aligned);
      if (!keep) continue;
      const fd = this.open(item.file, fs.constants.O_RDONLY, item.stat);
      try {
        parts.push(readRange(fd, aligned - keep, keep));
      } finally {
        fs.closeSync(fd);
      }
    }
    const merged = b4a.concat(parts);
    if (merged.length) this.replace(this.file(observed), merged.subarray(Math.max(0, merged.length - this.capacity)), current?.stat);
    for (const { file, stat } of future) {
      this.checkDirectory();
      if (!sameFile(stat, this.regular(file))) throw new Error('Seen file changed before recovery');
      fs.unlinkSync(file);
    }
  }

  reload(observed, ids, maxIds) {
    this.checkDirectory();
    let { files, cleanup, leftovers } = this.scan();
    if (this.active && !sameFile(this.active, files.find(item => item.hour === this.highWater)?.stat)) {
      throw new Error('Active seen file identity changed');
    }
    for (const dir of leftovers) this.removeLeftover(dir);
    if (Math.max(this.highWater, files[0]?.hour ?? 0) > observed + FUTURE_HOURS) {
      this.rehome(files.filter(item => item.hour > observed), files.find(item => item.hour === observed), observed);
      this.highWater = 0;
      this.active = null;
      ({ files, cleanup } = this.scan());
    }
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
        if (stat.size !== keep) {
          item.stat = this.replace(file, readRange(fd, aligned - keep, keep), stat);
          if (sameFile(stat, this.active)) this.active = item.stat;
        }
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
      if (sameFile(stat, this.active)) this.active = null;
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
    this.hour = hour;
    this.highWater = hour;
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
