/**
 * Small deterministic hashing and randomness for the live features. PURE: no imports, no I/O.
 *
 * The hashes are change detectors (a structure or a seating plan someone else edited since you read
 * it), never security: anyone can compute them. The PRNG makes draws repeatable in tests and previews;
 * the server draws real seats with crypto randomness instead.
 */

/** 32-bit FNV-1a of a string's UTF-16 code units. */
export function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** fnv1a32 as 8 lower-case hex digits, e.g. "811c9dc5" for "". */
export function fnv1aHex(input: string): string {
  return fnv1a32(input).toString(16).padStart(8, "0");
}

/** A pseudo-random number generator: each call returns a number in [0, 1). The same seed gives the same sequence. */
export type Rng = () => number;

/** mulberry32: a fast seeded PRNG, good enough to shuffle and draw seats in tests and previews. */
export function mulberry32(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A whole number in [0, size) from `rng`; a bad generator's 1, negative or NaN is clamped, never out of range. */
export function randomIndex(rng: Rng, size: number): number {
  if (!(size >= 1)) throw new RangeError("randomIndex needs a size of at least 1");
  const index = Math.floor(rng() * size);
  return Number.isFinite(index) ? Math.min(Math.max(index, 0), size - 1) : 0;
}
