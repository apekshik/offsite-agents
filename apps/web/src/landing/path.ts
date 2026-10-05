// The landing page's camera: one long loop round the yacht at night, as a pure function of time.
// Keyframes are joined by a closed Hermite spline whose tangents account for each key's timing, so
// the camera never stops or jerks at a key: it drifts round, pushes in past the sun deck, pulls
// out over the stern and climbs back to the hero view it started from.
//
// Coordinates are the ship's frame (metres): the bow is toward -z, port is -x, the main deck is
// about y = 10, the sun deck y = 14.

export type Vec3 = [number, number, number];

export interface Key {
  pos: Vec3;
  at: Vec3;
  /** Vertical field of view, degrees. */
  fov: number;
  /** Seconds from this key to the next (the last one wraps to the first). */
  hold: number;
}

export interface Pose {
  pos: Vec3;
  at: Vec3;
  fov: number;
}

/** The loop. Key 0 is the hero (the poster frame): the bow three-quarter view from port. */
export const LANDING_KEYS: Key[] = [
  { pos: [-74, 30, -104], at: [2, 9, -6], fov: 38, hold: 13 },
  { pos: [-172, 24, -12], at: [0, 10, 6], fov: 34, hold: 13 },
  { pos: [-104, 28, 104], at: [0, 11, 28], fov: 40, hold: 11 },
  { pos: [-30, 30, 104], at: [0, 14, 40], fov: 44, hold: 9 },
  // The push in: low over the stern rail, along the sun deck past the bar and the hot tub.
  { pos: [-7, 19.5, 66], at: [0, 15.2, 36], fov: 54, hold: 8 },
  { pos: [-11, 19.2, 47], at: [2, 15, 24], fov: 56, hold: 8 },
  // Out over the starboard side and up.
  { pos: [34, 30, 34], at: [0, 13, 4], fov: 44, hold: 12 },
  { pos: [62, 44, -70], at: [0, 9, -12], fov: 40, hold: 13 },
  { pos: [-10, 56, -150], at: [0, 9, -10], fov: 38, hold: 12 },
];

/** How long one trip round the loop takes, seconds. */
export const loopSeconds = (keys: Key[] = LANDING_KEYS) => keys.reduce((s, k) => s + k.hold, 0);

/** Where each key sits on the loop's clock. */
function times(keys: Key[]): number[] {
  const out: number[] = [];
  let t = 0;
  for (const k of keys) { out.push(t); t += k.hold; }
  return out;
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

/** Velocity at key i (units a second): the chord between its neighbours over the time between them. */
function tangent(vals: number[], keys: Key[], i: number): number {
  const n = keys.length;
  const prev = mod(i - 1, n), next = mod(i + 1, n);
  const dt = keys[prev]!.hold + keys[i]!.hold;
  return (vals[next]! - vals[prev]!) / dt;
}

function hermite(p0: number, p1: number, m0: number, m1: number, h: number, s: number): number {
  const s2 = s * s, s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * p0 + (s3 - 2 * s2 + s) * h * m0 + (-2 * s3 + 3 * s2) * p1 + (s3 - s2) * h * m1;
}

/** The camera at time t (seconds, any value: it loops). */
export function poseAt(t: number, keys: Key[] = LANDING_KEYS): Pose {
  const total = loopSeconds(keys);
  const at = times(keys);
  const u = mod(t, total);
  let i = keys.length - 1;
  while (i > 0 && at[i]! > u) i--;
  const j = (i + 1) % keys.length;
  const h = keys[i]!.hold;
  const s = (u - at[i]!) / h;
  const channel = (get: (k: Key) => number) => {
    const vals = keys.map(get);
    return hermite(vals[i]!, vals[j]!, tangent(vals, keys, i), tangent(vals, keys, j), h, s);
  };
  const v3 = (get: (k: Key, c: number) => number): Vec3 => [channel((k) => get(k, 0)), channel((k) => get(k, 1)), channel((k) => get(k, 2))];
  return {
    pos: v3((k, c) => k.pos[c]!),
    at: v3((k, c) => k.at[c]!),
    fov: channel((k) => k.fov),
  };
}
