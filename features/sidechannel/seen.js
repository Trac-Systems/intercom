import crypto from 'crypto';
import b4a from 'b4a';
import fs from 'fs';
import path from 'path';
import { integer } from './channel-options.js';

const HOUR = 3_600_000;
const HASH_BYTES = 32;
const MAX_IDS = 20_000;

// Scope new caches to the transport channel. A public channel cannot reserve
// IDs on a channel with stronger admission requirements.
export function seenKey(channel, id) {
  if (typeof id !== 'string' || !id || id.length > 512 || b4a.byteLength(id) > 512) return null;
  return crypto.createHash('sha256').update(JSON.stringify([channel, id])).digest('hex');
}

function readRange(file, offset, length) {
  const fd = fs.openSync(file, 'r');
  try {
    const data = b4a.alloc(length);
    let read = 0;
    while (read < length) {
      const count = fs.readSync(fd, data, read, length - read, offset + read);
      if (!count) throw new Error('Seen file changed during read');
      read += count;
    }
    return data;
  } finally {
    fs.closeSync(fd);
  }
}

// A private directory per running peer. Files contain only consecutive SHA-256
// digests. The active file compacts atomically when full, keeping its newer half.
class HourFiles {
  constructor(config) {
    if (typeof config?.directory !== 'string' || !config.directory.trim()) throw new TypeError('Expected seenPersistence.directory');
    this.directory = config.directory;
    this.hours = integer(config.hours ?? 3, 'hours', 1, 24);
    const bytes = integer(config.maxFileBytes ?? 65_536, 'maxFileBytes', HASH_BYTES, 262_144);
    this.capacity = Math.floor(bytes / HASH_BYTES) * HASH_BYTES;
    this.hour = null;
  }

  file(hour) { return path.join(this.directory, `seen-${hour}.bin`); }

  rotate(hour, ids, maxIds) {
    if (hour === this.hour) return;
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const oldest = hour - this.hours + 1;
    const files = [];
    const dir = fs.opendirSync(this.directory);
    try {
      let entries = 0;
      for (let entry; (entry = dir.readSync());) {
        if (++entries > 64) throw new Error('Use a dedicated seenPersistence directory');
        const match = /^seen-(\d{1,12})\.bin$/.exec(entry.name);
        if (!match || !entry.isFile()) continue;
        const n = Number(match[1]);
        if (n < oldest || n > hour) fs.unlinkSync(this.file(n));
        else files.push(n);
      }
    } finally {
      dir.closeSync();
    }

    ids.clear();
    this.bytes = 0;
    // Read newest tails first so startup never reads more than maxIds records.
    const recent = [];
    let remaining = maxIds;
    for (const n of files.sort((a, b) => b - a)) {
      const file = this.file(n);
      const size = fs.statSync(file).size;
      const aligned = size - size % HASH_BYTES;
      const keep = Math.min(this.capacity, aligned);
      if (size !== keep) {
        // Recover a torn last append, or keep the newest tail after a cap reduction.
        this.replace(file, readRange(file, aligned - keep, keep));
      }
      if (n === hour) this.bytes = keep;
      const length = Math.min(remaining * HASH_BYTES, keep);
      if (!length) continue;
      recent.push([n, readRange(file, keep - length, length)]);
      remaining -= length / HASH_BYTES;
    }
    for (const [n, data] of recent.reverse()) {
      for (let i = 0; i < data.length; i += HASH_BYTES) {
        const key = b4a.toString(data, 'hex', i, i + HASH_BYTES);
        ids.delete(key);
        ids.set(key, n * HOUR);
      }
    }
    this.hour = hour;
  }

  replace(file, data) {
    const temp = path.join(this.directory, 'seen-compact.tmp');
    fs.writeFileSync(temp, data, { mode: 0o600 });
    fs.renameSync(temp, file);
  }

  append(key) {
    const file = this.file(this.hour);
    const hash = b4a.from(key, 'hex');
    if (this.bytes + HASH_BYTES > this.capacity) {
      const keep = Math.floor(this.capacity / (2 * HASH_BYTES)) * HASH_BYTES;
      const tail = readRange(file, this.bytes - keep, keep);
      this.replace(file, b4a.concat([tail, hash]));
      this.bytes = keep + HASH_BYTES;
    } else {
      fs.appendFileSync(file, hash, { mode: 0o600 });
      this.bytes += HASH_BYTES;
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

  has(key, now) {
    this.prepare(now);
    return this.ids.has(key);
  }

  remember(key, now) {
    if (!key || !this.limit || this.has(key, now)) return;
    this.files?.append(key);
    this.ids.set(key, now);
    if (this.ids.size > this.limit) this.ids.delete(this.ids.keys().next().value);
  }
}
