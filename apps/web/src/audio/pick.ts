// Which variation plays, how far it's detuned, whether a gull calls this half-second: random in
// the game, and in deterministic mode (the film rig) a pure function of a seed, the sound and the
// time, so a re-render sounds the same.

/** FNV-1a over the parts, as an unsigned 32-bit number. */
export function hash32(...parts: (string | number)[]): number {
  let h = 2166136261;
  for (const p of parts) {
    const s = String(p);
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    h = Math.imul(h ^ 0x7c, 16777619); // a separator, so ("ab", "c") differs from ("a", "bc")
  }
  // A final mix, so nearby inputs spread over the range.
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}

/** A number in [0, 1) from the parts. */
export const unit = (...parts: (string | number)[]) => hash32(...parts) / 4294967296;

export interface Deterministic {
  seed: number;
  /** The film's time, in seconds. Variations are keyed on it (to the millisecond). */
  clock: () => number;
}

export class Picker {
  private readonly last = new Map<string, number>();
  private readonly det: Deterministic | null;
  private readonly random: () => number;
  constructor(det: Deterministic | null = null, random: () => number = Math.random) {
    this.det = det;
    this.random = random;
  }

  get deterministic(): boolean { return this.det !== null; }

  /** Seconds: the film's clock in deterministic mode, else the page's. */
  now(): number {
    return this.det ? this.det.clock() : (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;
  }

  private u(key: string, salt: string | number): number {
    if (!this.det) return this.random();
    return unit(this.det.seed, key, salt, Math.round(this.det.clock() * 1000));
  }

  /** Which of n variations: seeded, or random without playing the same one twice running. */
  variation(key: string, n: number): number {
    if (n <= 1) return 0;
    if (this.det) return Math.floor(this.u(key, "v") * n);
    const prev = this.last.get(key);
    let i = Math.floor(this.random() * (prev === undefined ? n : n - 1));
    if (prev !== undefined && i >= prev) i++;
    this.last.set(key, i);
    return i;
  }

  /** A pitch offset in cents, within ±spread. */
  detune(key: string, spread: number): number {
    return spread ? (this.u(key, "d") * 2 - 1) * spread : 0;
  }

  /** A number in [0, 1) for a key and a time slot (the same slot always gives the same number when seeded). */
  slot(key: string, slot: number): number {
    return this.det ? unit(this.det.seed, key, slot) : this.random();
  }
}
