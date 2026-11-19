import b4a from 'b4a';
import c from '../../node_modules/compact-encoding/index.js';

export const MAX_CHANNELS = 256;
export const MAX_FRAME_BYTES = 1_048_576;
export const MAX_DIFFICULTY = 16;
const keys = new Set([
  'verifySignature', 'maxReceiveBytes', 'powDifficulty', 'powBitsPerKiB',
  'ownerKey', 'ownerWriteOnly', 'welcomeRequired', 'welcome'
]);

export function integer(value, name, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

export function channelPolicy(name, options) {
  if (!name || b4a.byteLength(name) > 256) throw new RangeError('Channel name must fit in 256 bytes');
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Expected channel options');
  const policy = {};
  for (const key of Object.keys(options)) {
    if (!keys.has(key)) throw new TypeError(`Unknown channel option: ${key}`);
    const value = options[key];
    switch (key) {
      case 'verifySignature':
      case 'ownerWriteOnly':
      case 'welcomeRequired':
        if (typeof value !== 'boolean') throw new TypeError(`${key} must be boolean`);
        policy[key] = value;
        break;
      case 'maxReceiveBytes':
        policy[key] = integer(value, key, 1, MAX_FRAME_BYTES);
        break;
      case 'powDifficulty':
      case 'powBitsPerKiB':
        policy[key] = integer(value, key, 0, MAX_DIFFICULTY);
        break;
      case 'ownerKey': {
        const hex = b4a.isBuffer(value) ? b4a.toString(value, 'hex') : value;
        if (typeof hex !== 'string' || !/^[a-f0-9]{64}$/i.test(hex)) throw new TypeError('Invalid ownerKey');
        policy.ownerKey = hex.toLowerCase();
        break;
      }
      case 'welcome': {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected a signed welcome');
        if (!boundedValue(value)) throw new RangeError('Invalid welcome size or nesting');
        const json = JSON.stringify(value);
        if (!json || b4a.byteLength(json) > MAX_FRAME_BYTES) throw new RangeError('Invalid welcome size');
        policy.welcome = JSON.parse(json);
        break;
      }
    }
  }
  if (policy.verifySignature === false) delete policy.verifySignature;
  return Object.keys(policy).length ? policy : null;
}

// Protomux supplies the end of this individual message, including in a batch.
// The v1 ID is inside the JSON. Avoid even parsing it above the frame ceiling.
export function receiveEncoding(limit, admit) {
  return {
    preencode: c.json.preencode,
    encode: c.json.encode,
    decode(state) {
      const { start, end } = state;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) {
        admit?.(0);
        return null;
      }
      const bytes = end - start;
      // Charge the attempt before touching JSON, including ordinary rejected
      // and oversized frames. Never advance an invalid cursor past its view.
      const allowed = !admit || admit(bytes);
      const buffer = state.buffer;
      if (!buffer || !Number.isSafeInteger(buffer.byteLength) || end > buffer.byteLength) return null;
      state.start = end;
      if (!allowed || bytes > limit) return null;
      const child = { buffer, start, end };
      try {
        const length = c.uint.decode(child);
        if (length !== end - child.start) return null;
        const json = b4a.toString(child.buffer, 'utf8', child.start, end);
        return { bytes, json, payload: JSON.parse(json) };
      } catch {
        return null;
      }
    }
  };
}

// Bound recursion before canonicalization. The byte count at the codec is
// authoritative; this lower bound also stops local oversized inputs early.
export function boundedValue(value) {
  let budget = MAX_FRAME_BYTES;
  function visit(item, depth) {
    if (depth > 64 || --budget < 0) return false;
    if (typeof item === 'string') {
      budget -= item.length;
      return budget >= 0;
    }
    if (!item || typeof item !== 'object') return typeof item !== 'bigint';
    if (b4a.isBuffer(item)) {
      budget -= item.length;
      return budget >= 0;
    }
    if (Array.isArray(item)) {
      if (item.length > budget) return false;
      for (const child of item) if (!visit(child, depth + 1)) return false;
    } else {
      for (const key in item) {
        if (!Object.hasOwn(item, key)) continue;
        budget -= key.length;
        if (!visit(item[key], depth + 1)) return false;
      }
    }
    return true;
  }
  return visit(value, 0);
}

export function launcherOptions(raw) {
  if (raw === undefined || raw === '') return {};
  if (typeof raw !== 'string' || raw.length > MAX_FRAME_BYTES || b4a.byteLength(raw) > MAX_FRAME_BYTES) {
    throw new TypeError('sidechannel-options expects at most 1 MiB of JSON');
  }
  const config = JSON.parse(raw);
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new TypeError('Expected sidechannel-options object');
  for (const key of Object.keys(config)) {
    if (key !== 'channelOptions' && key !== 'seenPersistence') throw new TypeError(`Unknown sidechannel-options key: ${key}`);
  }
  return config;
}
