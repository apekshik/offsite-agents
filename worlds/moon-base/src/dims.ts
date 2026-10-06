// The crater's dimensions, in metres, after the masterplan (docs/art/moon-base/refs). North is -z
// (the far side of the crater in the masterplan), east is +x, the crater floor is y = 0. Angles
// run clockwise from north (kit.ts polar).
//
// Everything is derived from one hab module: a half-buried printed shell HAB.w wide along the
// ring and HAB.d deep. A terrace is as high as a hab and its mound of regolith (RISE), and as
// deep as a hab plus a road as wide as a hab is deep (TREAD). The floor is fifteen habs across.
//
//   rim plain  y 24   r > 96    solar fields, antennas, the lookout (north-west)
//   T3         y 18   r 84-96   the greenhouse (north), the sports dome (north-east), habs
//   T2         y 12   r 72-84   habs, the tower (west), tanks and radiators (east)
//   T1         y 6    r 60-72   habs, the work hall and crew quarters dug in behind (north-west)
//   floor      y 0    r < 60    the hub dome, three landing pads, the rover garage (south-east)
//   pit        y -9             the ice rig (south-west)

import { Frame, deg, polar } from "./kit.ts";

export const HAB = { w: 8, d: 6, h: 5.0 };
export const RISE = 6;
export const TREAD = 2 * HAB.d; // 12
export const FLOOR_R = (15 * HAB.w) / 2; // 60

/** Height of each level: the floor, the three terraces, the rim. */
export const TIER_Y = [0, RISE, 2 * RISE, 3 * RISE, 4 * RISE] as const;
/** Radius of each riser: riser k climbs from tier k (inside) to tier k + 1 (outside). */
export const RISER_R = [FLOOR_R, FLOOR_R + TREAD, FLOOR_R + 2 * TREAD, FLOOR_R + 3 * TREAD] as const;
export const RIM_R = RISER_R[3];
/** How far out the rim plain stays flat before it rolls away into hills. */
export const PLAIN_R = 150;
/** The berm along each terrace's edge: how deep (from the edge) and how high. */
export const BERM = { d: 0.9, h: 0.55 };
/** Where the road runs round each terrace: this far out from its edge. */
export const ROAD = 4;
/** Where hab shells stand on a terrace: their centre this far in from the riser behind them. */
export const HAB_IN = HAB.d / 2;

/** Ramps between tiers: as wide, and as long as a 1:6 climb of RISE needs. */
export const RAMP = { w: 4.5, len: RISE * 6 };

// ---------- where things are ----------

export const HUB = { x: 0, z: 4, r: 12, sill: 1.15, h: 8.8 };
/** The pads: the active one (new crew land here), and two with landers parked. */
export const PAD = { x: polar(deg(18), 36)[0], z: polar(deg(18), 36)[1], r: 8.5 };
export const PAD_W = { x: polar(deg(-92), 40)[0], z: polar(deg(-92), 40)[1], r: 9 };
export const PAD_SE = { x: polar(deg(146), 39)[0], z: polar(deg(146), 39)[1], r: 9 };
/** The ice pit, its rig and the conveyor up to the tanks. */
export const PIT = { x: polar(deg(-138), 37)[0], z: polar(deg(-138), 37)[1], r: 17, y: -9 };

/**
 * Buildings dug into a riser: a straight facade across the riser's arc from a0 to a1 (radians),
 * `depth` metres into the hill behind it. The riser's wall is left out there; the facade stands
 * on the chord between the arc's ends.
 */
export interface Dug { id: string; riser: number; a: number; w: number; depth: number }
export const WORK_HALL: Dug = { id: "work-hall", riser: 1, a: deg(-12), w: 36, depth: 20 };
export const QUARTERS: Dug = { id: "quarters", riser: 1, a: deg(-40), w: 14, depth: 10 };
export const GARAGE: Dug = { id: "garage", riser: 0, a: deg(120), w: 27, depth: 12 };
export const DUG = [WORK_HALL, QUARTERS, GARAGE];

/** Half the angle a dug building's facade spans. */
export const halfAngle = (d: Dug) => Math.asin(d.w / 2 / RISER_R[d.riser]!);
/** The facade's distance from the crater's centre (the chord's). */
export const chordD = (d: Dug) => RISER_R[d.riser]! * Math.cos(halfAngle(d));

/** The riser's radius at angle a: its circle, or a dug building's straight facade. */
export function riserAt(k: number, a: number): number {
  for (const d of DUG) {
    if (d.riser !== k) continue;
    const h = halfAngle(d), da = wrap(a - d.a);
    if (Math.abs(da) <= h) return chordD(d) / Math.cos(da);
  }
  return RISER_R[k]!;
}
/** Whether riser k is open (a dug building's front) at angle a. */
export function dugAt(k: number, a: number): Dug | null {
  for (const d of DUG) if (d.riser === k && Math.abs(wrap(a - d.a)) < halfAngle(d) - 1e-6) return d;
  return null;
}

/** How high a dug building's facade stands: up to the top of the berm on the terrace above it. */
export const facadeTop = (d: Dug) => TIER_Y[d.riser + 1]! + BERM.h + 0.05;

/** The frame of a dug building: its facade's middle, local z running into the hill; y is its tier's level. */
export function dugFrame(d: Dug): Frame & { y: number } {
  const [cx, cz] = polar(d.a, chordD(d));
  return Object.assign(new Frame(cx, cz, d.a), { y: TIER_Y[d.riser]! });
}

/**
 * The ramps: tier k's road climbs to tier k + 1 along the inside of riser k, from angle `foot`
 * to angle `top`. Two stacks of switchbacks, north-east and west, as the masterplan's roads go.
 */
export interface Ramp { id: string; k: number; foot: number; top: number }
const rampSpan = (k: number) => RAMP.len / (RISER_R[k]! - RAMP.w / 2);
function ramp(id: string, k: number, footDeg: number, dir: 1 | -1): Ramp {
  const foot = deg(footDeg);
  return { id, k, foot, top: foot + dir * rampSpan(k) };
}
export const RAMPS: Ramp[] = [
  ramp("ne0", 0, 30, 1), ramp("ne1", 1, 61, -1), ramp("ne2", 2, 33, 1), ramp("ne3", 3, 57, 1),
  ramp("w0", 0, -64, -1), ramp("w1", 1, -98, 1), ramp("w2", 2, -70, -1), ramp("w3", 3, -94, 1),
];
/** A landing at the top of each ramp, flat for this many metres. */
export const LANDING = 3.5;

/** Angles that fall within a ramp's footprint on tier k (with a margin in metres), for keeping things off it. */
export function onRamp(k: number, a: number, marginM = 0): Ramp | null {
  for (const r of RAMPS) {
    if (r.k !== k) continue;
    const m = marginM / RISER_R[k]!;
    const lo = Math.min(r.foot, r.top) - m, hi = Math.max(r.foot, r.top) + m;
    if (wrap(a - lo) >= 0 && wrap(a - lo) <= hi - lo) return r;
  }
  return null;
}

/** An angle brought into (-π, π]. */
export function wrap(a: number): number {
  let x = a % (Math.PI * 2);
  if (x > Math.PI) x -= Math.PI * 2;
  if (x <= -Math.PI) x += Math.PI * 2;
  return x;
}

// Buildings standing on the terraces and the rim.
/** The greenhouse: a long glass tunnel curving along T3, north. */
export const GREENHOUSE = { r: 92.5, a0: deg(-12), a1: deg(9), half: 3.5, h: 6.2 };
/** The sports dome: a glass capsule on T3, north-east. */
export const SPORTS = { a: deg(35), r: 90.5, len: 30, half: 5.1, h: 6.8 };
/** The lookout pavilion on the rim, north-west, facing Earth across the crater. */
export const LOOKOUT = { x: polar(deg(-56), 108)[0], z: polar(deg(-56), 108)[1], r: 7.2, h: 4.4 };
/** The tower: the lift and comms spine on T2, west. */
export const TOWER = { x: polar(deg(-40), 80.8)[0], z: polar(deg(-40), 80.8)[1], w: 5.2, top: 46 };

/** Where Earth hangs: north-east, low over the rim. Direction (unit) and how big it looks (radians across). */
export const EARTH = { az: deg(36), el: deg(11), size: deg(4.8) };
