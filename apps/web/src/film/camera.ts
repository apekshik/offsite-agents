// Camera moves for the film, as pure functions of a shot's progress (0..1). The runner resolves
// targets (slots, crew) to points and applies the pose to the game's camera every frame.

export type Vec3 = [number, number, number];

/** Where the camera is, what it looks at, and its vertical field of view (degrees). */
export interface Pose {
  pos: Vec3;
  at: Vec3;
  fov?: number;
}

export type Ease = "linear" | "in" | "out" | "inOut" | "gentle";

/** Eases u (0..1). "gentle": mostly constant speed, with soft starts and stops (good for long dollies). */
export function ease(u: number, kind: Ease = "inOut"): number {
  const x = Math.min(1, Math.max(0, u));
  switch (kind) {
    case "linear": return x;
    case "in": return x * x * x;
    case "out": return 1 - (1 - x) ** 3;
    case "inOut": return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
    case "gentle": {
      // A trapezoid speed profile: accelerate over the first 20%, coast, decelerate over the last 20%.
      const a = 0.2, v = 1 / (1 - a);
      if (x < a) return (v * x * x) / (2 * a);
      if (x > 1 - a) return 1 - (v * (1 - x) ** 2) / (2 * a);
      return v * (x - a / 2);
    }
  }
}

const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
export const lerp3 = (a: Vec3, b: Vec3, u: number): Vec3 => [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];

/** Catmull–Rom through points; u runs over the whole curve by arc length, so the speed is even. */
export function spline(points: Vec3[], u: number): Vec3 {
  if (points.length === 1) return points[0]!;
  if (points.length === 2) return lerp3(points[0]!, points[1]!, u);
  const segs = tables(points);
  const total = segs.reduce((a, t) => a + t.at(-1)!, 0) || 1;
  let d = Math.min(1, Math.max(0, u)) * total;
  let i = 0;
  while (i < segs.length - 1 && d > segs[i]!.at(-1)!) { d -= segs[i]!.at(-1)!; i++; }
  // Within the segment: invert its arc-length table.
  const tab = segs[i]!;
  let j = 1;
  while (j < tab.length - 1 && tab[j]! < d) j++;
  const k = tab[j]! > tab[j - 1]! ? (j - 1 + (d - tab[j - 1]!) / (tab[j]! - tab[j - 1]!)) / (tab.length - 1) : 0;
  return segment(points, i, Math.min(1, Math.max(0, k)));
}

const SAMPLES = 48;

/** Each segment's cumulative length at SAMPLES + 1 evenly spaced parameters. */
function tables(points: Vec3[]): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const tab = [0];
    let prev = points[i]!;
    for (let s = 1; s <= SAMPLES; s++) {
      const q = segment(points, i, s / SAMPLES);
      tab.push(tab[s - 1]! + Math.hypot(q[0] - prev[0], q[1] - prev[1], q[2] - prev[2]));
      prev = q;
    }
    out.push(tab);
  }
  return out;
}

function segment(points: Vec3[], i: number, t: number): Vec3 {
  const p0 = points[Math.max(0, i - 1)]!, p1 = points[i]!, p2 = points[i + 1]!, p3 = points[Math.min(points.length - 1, i + 2)]!;
  return catmull(p0, p1, p2, p3, t);
}

function catmull(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, t: number): Vec3 {
  const t2 = t * t, t3 = t2 * t;
  const out: Vec3 = [0, 0, 0];
  for (let j = 0; j < 3; j++) {
    out[j] = 0.5 * ((2 * p1[j]!) + (-p0[j]! + p2[j]!) * t + (2 * p0[j]! - 5 * p1[j]! + 4 * p2[j]! - p3[j]!) * t2 + (-p0[j]! + 3 * p1[j]! - 3 * p2[j]! + p3[j]!) * t3);
  }
  return out;
}

/** A dolly through poses: positions and look-at points each follow their own smooth curve. */
export function dolly(poses: Pose[], u: number, kind: Ease = "gentle"): Pose {
  const k = ease(u, kind);
  const fovs = poses.map((p) => p.fov ?? 50);
  const fi = k * (fovs.length - 1), f0 = Math.floor(fi), f1 = Math.min(fovs.length - 1, f0 + 1);
  return {
    pos: spline(poses.map((p) => p.pos), k),
    at: spline(poses.map((p) => p.at), k),
    fov: lerp(fovs[f0]!, fovs[f1]!, ease(fi - f0, "inOut")),
  };
}

export interface Orbit {
  /** Degrees round the centre: 0 is +z of it, 90 is +x. */
  from: number;
  to: number;
  radius: number;
  radiusTo?: number;
  /** Metres above the centre. */
  height: number;
  heightTo?: number;
  /** Look this far above the centre. */
  lookUp?: number;
  fov?: number;
  ease?: Ease;
}

/** Round a point, at a radius and height (both may change over the shot). */
export function orbit(centre: Vec3, o: Orbit, u: number): Pose {
  const k = ease(u, o.ease ?? "gentle");
  const a = (lerp(o.from, o.to, k) * Math.PI) / 180;
  const r = lerp(o.radius, o.radiusTo ?? o.radius, k), h = lerp(o.height, o.heightTo ?? o.height, k);
  return {
    pos: [centre[0] + Math.sin(a) * r, centre[1] + h, centre[2] + Math.cos(a) * r],
    at: [centre[0], centre[1] + (o.lookUp ?? 0), centre[2]],
    fov: o.fov ?? 50,
  };
}

/** A crane: straight up (or down) at one spot, tilting to keep the subject framed. */
export function crane(base: Vec3, subject: Vec3, from: number, to: number, fov = 50): Pose[] {
  return [
    { pos: [base[0], base[1] + from, base[2]], at: subject, fov },
    { pos: [base[0], base[1] + to, base[2]], at: subject, fov },
  ];
}

/**
 * Critically damped smoothing toward a moving target (for following someone walking): no
 * overshoot, frame-rate independent. halfLife in seconds.
 */
export function damp(current: Vec3, target: Vec3, halfLife: number, dt: number): Vec3 {
  if (halfLife <= 0) return target;
  const k = 1 - Math.pow(2, -dt / halfLife);
  return lerp3(current, target, k);
}

/** Yaw (radians, 0 = +z) that looks from a toward b. */
export const yawTo = (a: Vec3, b: Vec3) => Math.atan2(b[0] - a[0], b[2] - a[2]);

/** The shortest way to turn from angle a to angle b. */
export const turn = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
