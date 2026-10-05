// Adapted from Ready Player One (github.com/apekshik/ready-player-one).
//
// A pose holds every joint angle the avatar's rig drives. Pairs are per side: [0] is the -x
// arm and leg (the avatar's right; it faces +z), [1] the +x one. y lowers or raises the whole
// body and sx, sz move the hips with the feet left where they were, all in hip heights, so a
// pose fits any body.
//
// Angles follow the rig: uaZ = side × raise (π/2 out level, ~2.7 up), uaX < 0 swings an arm
// forward, faX < 0 bends the elbow, thX < 0 lifts a knee, hpX > 0 tips the hips forward,
// hdX > 0 drops the chin.

export type Pair = [number, number];
export type Side = 0 | 1;
export const LR = [0, 1] as const;
export const SIDES = [-1, 1] as const;

export const PAIRED = ["thX", "thZ", "shX", "ftX", "uaX", "uaY", "uaZ", "faX", "faY", "faZ", "wrX", "wrZ"] as const;
export const SINGLE = ["hpX", "hpY", "hpZ", "chX", "chY", "chZ", "hdX", "hdY", "hdZ", "lift", "y", "sx", "sz"] as const;
export type PairedKey = (typeof PAIRED)[number];
export type SingleKey = (typeof SINGLE)[number];
export type Pose = Record<PairedKey, Pair> & Record<SingleKey, number>;

export function newPose(): Pose {
  const p = {} as Pose;
  for (const k of PAIRED) p[k] = [0, 0];
  for (const k of SINGLE) p[k] = 0;
  return p;
}

export function copyPose(out: Pose, a: Pose): Pose {
  for (const k of PAIRED) { out[k][0] = a[k][0]; out[k][1] = a[k][1]; }
  for (const k of SINGLE) out[k] = a[k];
  return out;
}

/** Moves out toward b by t (0..1), in place. */
export function mixPose(out: Pose, b: Pose, t: number): Pose {
  for (const k of PAIRED) { out[k][0] += (b[k][0] - out[k][0]) * t; out[k][1] += (b[k][1] - out[k][1]) * t; }
  for (const k of SINGLE) out[k] += (b[k] - out[k]) * t;
  return out;
}

/** Standing easy. */
export const REST = newPose();
for (const k of LR) {
  REST.shX[k] = 0.06;
  REST.uaZ[k] = SIDES[k] * 0.07;
  REST.faX[k] = -0.14;
}

// ---------- small maths ----------

export const TAU = Math.PI * 2;
export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
export const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const fr = (x: number) => x - Math.floor(x);
export const smooth = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
/** Frame-rate independent easing toward a target. */
export const damp = (v: number, target: number, rate: number, dt: number) => v + (target - v) * (1 - Math.exp(-rate * dt));
export const hash = (a: number, b = 0) => { const x = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return x - Math.floor(x); };
/** The short way round from a to b. */
export const angleDelta = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

// ---------- pose helpers ----------

/** 1 on the beat, falling away by the off-beat: a soft bounce, or (sharp) a hit. */
export function onBeat(x: number, sharp = 0.3) {
  const soft = 0.5 + 0.5 * Math.cos(TAU * x);
  const hit = Math.min(1, Math.exp(-x * 6) + Math.exp(-(1 - x) * 24));
  return lerp(soft, hit, sharp);
}
/** Bend leg k's knee by a, the foot kept flat. */
export function bend(p: Pose, k: Side, a: number) { p.thX[k] -= a; p.shX[k] += 2 * a; p.ftX[k] -= a; }
/** Move the hips (in hip heights) and leave the feet where they were. */
export function shift(p: Pose, dx: number, dz = 0) {
  p.sx += dx; p.sz += dz;
  for (const k of LR) { p.thZ[k] -= dx / 0.92; p.thX[k] += dz / 0.92; }
}
/** Tip the hips forward, the legs kept upright. */
export function tip(p: Pose, a: number) { p.hpX += a; p.thX[0] -= a; p.thX[1] -= a; }
/** Drop the body so the straighter leg's foot is on the floor; feet level. Call last. */
export function plant(p: Pose, flat: [boolean, boolean] = [true, true]) {
  let low = Infinity;
  for (const k of LR) {
    const th = p.thX[k] + p.hpX, sh = th + p.shX[k], ab = p.thZ[k] + p.hpZ;
    const drop = 0.92 * (1 - (0.512 * Math.cos(th) + 0.488 * Math.cos(sh)) * Math.cos(ab)) + SIDES[k] * 0.1 * Math.sin(p.hpZ);
    low = Math.min(low, drop);
    if (flat[k]) p.ftX[k] = -(p.thX[k] + p.hpX + p.shX[k]);
  }
  p.y -= low;
}
/** An arm, all at once. Y and Z angles mirror by side. */
export function arm(p: Pose, k: Side, uaX: number, uaZ: number, faX: number, faZ = 0, uaY = 0, faY = 0) {
  const s = SIDES[k];
  p.uaX[k] = uaX; p.uaY[k] = s * uaY; p.uaZ[k] = s * uaZ;
  p.faX[k] = faX; p.faY[k] = s * faY; p.faZ[k] = s * faZ;
}
/** A hand on the hip. */
export function onHip(p: Pose, k: Side) { arm(p, k, 0.15, 0.75, -0.3, -1.6); }
/** Mix arm k's angles toward another set (by t). */
export function armTo(p: Pose, k: Side, t: number, uaX: number, uaZ: number, faX: number, faZ = 0) {
  const s = SIDES[k];
  p.uaX[k] = lerp(p.uaX[k], uaX, t); p.uaZ[k] = lerp(p.uaZ[k], s * uaZ, t);
  p.faX[k] = lerp(p.faX[k], faX, t); p.faZ[k] = lerp(p.faZ[k], s * faZ, t);
}
/** Sitting with the hips at seat height h (metres) on a body whose standing hip height is hip. */
export function seat(p: Pose, h: number, hip: number, lean = 0) {
  for (const k of LR) {
    p.thX[k] = -Math.PI / 2 + 0.05 - lean; p.shX[k] = Math.PI / 2 - 0.05;
    p.ftX[k] = 0; p.thZ[k] = SIDES[k] * 0.06;
  }
  p.hpX = lean;
  p.y = (h + 0.1 - hip) / hip;
}
/** Holding a drink in hand k: glass at the chest, a sip now and then (t in seconds). */
export function holdDrink(p: Pose, k: Side, t: number, w = 1) {
  const c = fr(t / 12) * 12; // a sip every 12 s, about 1.5 s long
  const sip = smooth(0, 0.3, c - 9.5) * (1 - smooth(1.1, 1.5, c - 9.5));
  const s = SIDES[k];
  p.uaX[k] = lerp(p.uaX[k], lerp(-0.32, -0.95, sip), w);
  p.uaY[k] = lerp(p.uaY[k], 0, w);
  p.uaZ[k] = lerp(p.uaZ[k], s * lerp(0.12, 0.28, sip), w);
  p.faX[k] = lerp(p.faX[k], lerp(-1.5, -2.25, sip), w);
  p.faY[k] = lerp(p.faY[k], 0, w);
  p.faZ[k] = lerp(p.faZ[k], -s * 0.08, w);
  p.wrX[k] = lerp(p.wrX[k], 0.05, w);
  if (sip > 0) p.hdX -= 0.18 * sip * w;
}
