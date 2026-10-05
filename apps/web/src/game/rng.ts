// Seeded randomness for the director and the engine. Nothing in the game draws from Math.random:
// every choice is a hash of who it is about and which slice of time it is, so a film rig that
// fixes the clock gets the same crew doing the same things every run.

/** A stable 32-bit number from strings and numbers (FNV-1a over their text). */
export function hash(...parts: (string | number)[]): number {
  let h = 2166136261;
  for (const p of parts) {
    const s = typeof p === "number" ? String(Math.round(p * 1000) / 1000) : p;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    h = Math.imul(h ^ 0x2f, 16777619); // a separator, so ("ab", "c") isn't ("a", "bc")
  }
  // A final mix, so neighbouring inputs land far apart.
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15; h = Math.imul(h, 0x846ca68b); h ^= h >>> 16;
  return h >>> 0;
}

/** 0 ≤ x < 1 from the same parts. */
export const rand = (...parts: (string | number)[]) => hash(...parts) / 4294967296;

/** A stream of 0..1 numbers from one seed (mulberry32). */
export function stream(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A copy of xs in an order fixed by the seed. */
export function shuffled<T>(xs: readonly T[], seed: number): T[] {
  const out = [...xs], r = stream(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** One of xs, by the seed. */
export const pick = <T>(xs: readonly T[], seed: number): T => xs[seed % xs.length]!;
