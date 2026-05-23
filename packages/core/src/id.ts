import { randomBytes } from "node:crypto";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Generate a prefixed, ULID-shaped identifier (`<prefix>_<26-char ulid>`).
 * Time-ordered, collision-resistant, no external dependency.
 */
export function newId(prefix: string): string {
  if (!prefix || !/^[a-z0-9_]+$/.test(prefix)) {
    throw new Error(`newId: prefix must match /^[a-z0-9_]+$/, got "${prefix}"`);
  }
  return `${prefix}_${ulid()}`;
}

/** Current timestamp as an ISO-8601 string in UTC, millisecond precision. */
export function nowIso(): string {
  return new Date().toISOString();
}

function ulid(): string {
  const now = Date.now();
  return encodeTime(now, 10) + encodeRandom(16);
}

function encodeTime(time: number, length: number): string {
  let out = "";
  let t = time;
  for (let i = length - 1; i >= 0; i--) {
    const mod = t % 32;
    out = CROCKFORD[mod] + out;
    t = (t - mod) / 32;
  }
  return out;
}

function encodeRandom(length: number): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    const byte = bytes[i] ?? 0;
    out += CROCKFORD[byte % 32];
  }
  return out;
}
