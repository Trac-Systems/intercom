import b4a from 'b4a';
import crypto from 'crypto';
import { MAX_DIFFICULTY, MAX_FRAME_BYTES } from './channel-options.js';

const MAX_TRIES = 1_048_576;
const MAX_HASH_BYTES = 256 * 1024 * 1024;

// These are exactly the sorted keys in the v1 _powBase. Separate the top-level
// nonce structurally: user strings and nested objects can also contain "nonce".
function input(payload, policy, stringify) {
  const message = stringify(payload.message ?? null);
  const bytes = b4a.byteLength(message);
  const extraKiB = Math.max(0, Math.ceil(bytes / 1024) - 1);
  const bits = Math.min(MAX_DIFFICULTY, policy.powDifficulty + extraKiB * (policy.powBitsPerKiB ?? 0));
  const field = name => stringify(payload[name] ?? null);
  const prefix = b4a.from(`{"channel":${field('channel')},"from":${field('from')},"id":${field('id')},"message":${message},"nonce":`);
  const suffix = b4a.from(`,"origin":${field('origin')},"ts":${field('ts')}}`);
  if (prefix.length + suffix.length + 1 > MAX_FRAME_BYTES) return null;
  return { bits, prefix, suffix };
}

function sufficient(digest, target) {
  return digest[0] * 256 + digest[1] < target;
}

export function mine(payload, policy, stringify) {
  // Price and hash what a JSON receiver sees (e.g. Buffer.toJSON, omitted
  // undefined fields). Serialize the application content only before the loop.
  const message = JSON.parse(JSON.stringify(payload.message ?? null));
  const base = input({ ...payload, message }, policy, stringify);
  if (!base) return false;
  const { prefix, suffix, bits } = base;
  if (!bits) return true;

  const target = 2 ** (16 - bits);
  const template = crypto.createHash('sha256');
  const reusable = typeof template.copy === 'function' ? template.update(prefix) : null;
  const digits = b4a.allocUnsafe(String(MAX_TRIES - 1).length);
  // Bare's SHA-256 does not expose copy(). Bound that fallback by the actual
  // bytes per trial, including a block for padding.
  const cost = (reusable ? 0 : prefix.length) + digits.length + suffix.length + 64;
  const attempts = Math.min(MAX_TRIES, Math.floor((MAX_HASH_BYTES - prefix.length) / cost));
  for (let nonce = 0; nonce < attempts; nonce++) {
    let n = nonce;
    let offset = digits.length;
    do {
      digits[--offset] = 48 + n % 10;
      n = Math.floor(n / 10);
    } while (n);
    const hash = reusable ? reusable.copy() : crypto.createHash('sha256').update(prefix);
    const digest = hash.update(digits.subarray(offset)).update(suffix).digest();
    if (sufficient(digest, target)) {
      payload.pow = { nonce, difficulty: bits };
      return true;
    }
  }
  return false;
}

export function verifyWork(payload, policy, stringify) {
  const nonce = payload.pow?.nonce;
  const validNonce = Number.isSafeInteger(nonce) && nonce >= 0;
  if (policy.powDifficulty && !validNonce) return false;
  const base = input(payload, policy, stringify);
  if (!base) return false;
  if (!base.bits) return true;
  if (!validNonce) return false;
  const hash = crypto.createHash('sha256').update(base.prefix).update(String(nonce)).update(base.suffix);
  return sufficient(hash.digest(), 2 ** (16 - base.bits));
}
