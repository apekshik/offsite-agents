// Life round the ship: gulls wandering round it, each on its own loop, high and well off the
// rails, flapping now and then between glides; now and then one comes in and perches on the ship
// (the mast, a radome, an umbrella top, the bow rail, the ensign staff) for a while before flying
// off; and a pod of dolphins that every so often comes to play alongside the bow, leaping out in
// arcs with a splash, then dives away.
//
// All of it is worked out from the shared clock alone (no state carried from frame to frame), so
// every viewer sees the same birds in the same places, and a reload mid-leap looks the same.
// Chunky and stylized, like the crew: four instanced draw calls in all.

import * as THREE from "three";
import type { Slot } from "@offsite/contracts";
import type { Ocean } from "@offsite/kit";
import { D2, D3, D5, WATERLINE } from "./dims.ts";
import { FORE } from "./foredeck.ts";
import { outline } from "./kit.ts";

const TAU = Math.PI * 2;
/** A stable pseudo-random number in [0, 1) for an integer and a salt. */
function hash(n: number, salt = 0): number {
  const x = Math.sin(n * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------- shapes ----------

/** Boxes and cones merged into one geometry, each part with its own vertex color. */
function parts(list: { geo: THREE.BufferGeometry; color: string; m?: THREE.Matrix4 }[]): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], col: number[] = [], index: number[] = [];
  const c = new THREE.Color(), v = new THREE.Vector3(), nm = new THREE.Matrix3();
  for (const { geo, color, m } of list) {
    const g = geo;
    const base = pos.length / 3;
    c.set(color).convertSRGBToLinear();
    const P = g.attributes.position!, N = g.attributes.normal!;
    if (m) nm.getNormalMatrix(m);
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i);
      if (m) v.applyMatrix4(m);
      pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(N, i);
      if (m) v.applyNormalMatrix(nm);
      nor.push(v.x, v.y, v.z);
      col.push(c.r, c.g, c.b);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) index.push(base + g.index.getX(i));
    else for (let i = 0; i < P.count; i++) index.push(base + i);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  out.setIndex(index);
  return out;
}
const M = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
const box = (x: number, y: number, z: number) => new THREE.BoxGeometry(x, y, z);

/** A gull's body, head to +z: white, a grey back and tail tip, a yellow beak, dark eyes. */
function gullBody(): THREE.BufferGeometry {
  return parts([
    { geo: box(0.26, 0.24, 0.62), color: "#f4f4f1", m: M(0, 0, 0, 0.05) },
    { geo: box(0.22, 0.2, 0.22), color: "#f7f7f4", m: M(0, 0.08, 0.38) },
    { geo: box(0.07, 0.06, 0.16), color: "#f2c230", m: M(0, 0.05, 0.56) },
    { geo: box(0.24, 0.04, 0.3), color: "#9aa3ad", m: M(0, 0.12, -0.02) },
    { geo: box(0.2, 0.05, 0.22), color: "#f4f4f1", m: M(0, 0.0, -0.38, -0.1) },
    { geo: box(0.2, 0.05, 0.07), color: "#2b2f35", m: M(0, -0.005, -0.5, -0.1) },
    { geo: box(0.235, 0.04, 0.04), color: "#1b1d22", m: M(0, 0.12, 0.44) },
  ]);
}
/** One wing, from the shoulder out along +x: grey, a white trailing edge, a black tip. */
function gullWing(): THREE.BufferGeometry {
  return parts([
    { geo: box(0.5, 0.04, 0.3), color: "#a3acb6", m: M(0.25, 0, 0) },
    { geo: box(0.44, 0.035, 0.22), color: "#a3acb6", m: M(0.7, 0, -0.03, 0, 0.12) },
    { geo: box(0.2, 0.03, 0.16), color: "#23262b", m: M(1.0, 0, -0.08, 0, 0.25) },
    { geo: box(0.9, 0.03, 0.06), color: "#f4f4f1", m: M(0.45, -0.005, -0.15) },
  ]);
}

/** A dolphin, nose to +z: grey-blue above, pale below, a dorsal fin, flippers and flukes. 2.4 m. */
function dolphinGeometry(): THREE.BufferGeometry {
  const profile: [number, number][] = [[1.25, 0], [1.2, 0.07], [1.0, 0.1], [0.85, 0.2], [0.55, 0.3], [0.1, 0.34], [-0.4, 0.29], [-0.8, 0.17], [-1.05, 0.09], [-1.15, 0.05]];
  const lathe = new THREE.LatheGeometry(profile.map(([z, r]) => new THREE.Vector2(r, z)), 14).rotateX(Math.PI / 2);
  // Shade it by height: dark back, pale belly.
  const g = parts([
    { geo: lathe, color: "#56708a" },
    { geo: new THREE.ConeGeometry(0.03, 0.42, 4).rotateX(-0.5), color: "#4c6680", m: M(0, 0.4, -0.12, -0.6, 0, 0, 1.4, 1, 4) },
    { geo: box(0.5, 0.04, 0.22), color: "#4c6680", m: M(0.28, -0.14, 0.4, 0, -0.5, -0.5) },
    { geo: box(0.5, 0.04, 0.22), color: "#4c6680", m: M(-0.28, -0.14, 0.4, 0, 0.5, 0.5) },
    { geo: box(0.36, 0.04, 0.22), color: "#4c6680", m: M(0.18, 0, -1.22, 0, -0.45, 0) },
    { geo: box(0.36, 0.04, 0.22), color: "#4c6680", m: M(-0.18, 0, -1.22, 0, 0.45, 0) },
  ]);
  const P = g.attributes.position!, C = g.attributes.color!;
  const belly = new THREE.Color("#d9e2e8").convertSRGBToLinear(), c = new THREE.Color();
  for (let i = 0; i < P.count; i++) {
    const y = P.getY(i), k = smooth(0.02, -0.18, y);
    c.setRGB(C.getX(i), C.getY(i), C.getZ(i)).lerp(belly, k * (Math.abs(P.getZ(i)) < 1.1 ? 1 : 0));
    C.setXYZ(i, c.r, c.g, c.b);
  }
  return g;
}

// ---------- the gulls ----------

/**
 * A gull wandering round the ship on a loop of its own: an ellipse well outside the rails (20–60 m
 * off them, and past the bow and the stern), its own height, speed, way round, drift and rhythm of
 * flapping. Nothing is shared, so they never fall into step.
 */
interface Wanderer { cx: number; cz: number; rx: number; rz: number; y: number; bob: number; w: number; phase: number; drift: number; flap: number; follow?: number }
const WANDERERS: Wanderer[] = Array.from({ length: 7 }, (_, i) => {
  const h = (k: number) => hash(i + 1, k);
  const rx = 40 + h(1) * 50, rz = 110 + h(2) * 50;
  const v = 8 + h(3) * 5; // m/s
  const perimeter = Math.PI * 2 * Math.sqrt((rx * rx + rz * rz) / 2);
  return {
    cx: (h(4) - 0.5) * 14, cz: (h(5) - 0.5) * 30, rx, rz,
    y: 26 + h(6) * 22, bob: 2 + h(7) * 5,
    w: ((Math.PI * 2 * v) / perimeter) * (h(8) < 0.5 ? -1 : 1),
    phase: h(9) * Math.PI * 2, drift: 0.006 + h(10) * 0.012, flap: 0.22 + h(11) * 0.2,
  };
});
// One bird works the wake, low, well astern of the swim platform.
WANDERERS.push({ cx: 0, cz: 126, rx: 22, rz: 16, y: 12, bob: 3, w: 0.36, phase: 1.3, drift: 0.011, flap: 0.31 });
// And one keeps loose company with another, a few seconds behind it and a little above.
WANDERERS.push({ ...WANDERERS[2]!, rx: WANDERERS[2]!.rx + 5, y: WANDERERS[2]!.y + 4, flap: 0.37, follow: 2.6 });

/** Perching: each of two channels brings a gull in now and then, sits it a while, sends it off. */
const PERCH = { every: 100, chance: 0.85, sitMin: 20, sitMax: 60, inS: 8, outS: 6, channels: 2 };
const GULLS = WANDERERS.length + PERCH.channels;
const GULL_SCALE = 1.1;

/** Somewhere a gull may sit: the point it stands on, and the way it faces out. */
export interface Perch { x: number; y: number; z: number; out: number }

/**
 * Places a gull may land on this ship: the mast's crossbar, the radome tops, the ensign staff, the
 * umbrella tops (read from the furniture), and the bow rail between the spots where people lean.
 * Anything within reach of a slot (a seat, a place to stand) is left out.
 */
export function perchesFor(ship: THREE.Object3D, slots: Slot[]): Perch[] {
  const mz = -24.6;
  const list: Perch[] = [
    { x: 1.7, y: D5 + 6.12, z: mz + 1.15, out: 0.3 },
    { x: -1.9, y: D5 + 6.12, z: mz + 1.15, out: -2.5 },
    { x: 3.5, y: D5 + 3.17, z: mz - 0.6, out: 1.4 },
    { x: -3.5, y: D5 + 3.17, z: mz - 0.6, out: -1.4 },
    { x: 0, y: D3 + 3.34, z: 48.05, out: 0 },
  ];
  // Umbrella tops.
  ship.traverse((o) => {
    const m = o as THREE.InstancedMesh;
    if (!m.isInstancedMesh || !m.name.startsWith("umbrella:")) return;
    if (m.name !== "umbrella:cushion") return;
    const at = new THREE.Matrix4(), v = new THREE.Vector3();
    for (let i = 0; i < m.count; i += 3) {
      m.getMatrixAt(i, at);
      v.setFromMatrixPosition(at);
      list.push({ x: v.x, y: v.y + 2.9, z: v.z, out: Math.PI / 2 });
    }
  });
  // The bow rail, round the stem.
  const edge = outline({ ...FORE, hw: (z) => Math.max(0, FORE.hw!(z) - 0.12), notches: [] }).filter(([, z]) => z < -60);
  edge.forEach(([x, z], i) => { if (i % 4 === 0) list.push({ x, y: D2 + 1.1, z, out: Math.atan2(x, z + 50) }); });
  return list.filter((p) => !slots.some((s) => Math.hypot(s.pos[0] - p.x, s.pos[2] - p.z) < 1.8 && p.y - s.pos[1] < 2.6));
}
// ---------- the dolphins ----------

const POD = 3;
const EVENT = { every: 40, jitter: 20, length: 16 }; // a visit starts every 20–60 s and lasts 16 s
const LEAP = { length: 1.4, height: 2.0, reach: 6.5, every: 2.8 };
const SPLASH_DROPS = 18;
const SPLASHES = POD * 2;

export interface Wildlife {
  root: THREE.Group;
  /** now: the shared clock (ms); t: the world's own seconds, which the sea's waves run on. */
  update(now: number, t: number): void;
  dispose(): void;
}

export function createWildlife(ocean: Ocean, perches: Perch[]): Wildlife {
  const root = new THREE.Group();
  root.name = "wildlife";
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 });
  const wingMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide });
  const dolphinMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.05 });
  const dropMat = new THREE.MeshStandardMaterial({ color: "#f4fbfc", roughness: 0.4, emissive: "#9fc9d2", emissiveIntensity: 0.25 });

  const bodyGeo = gullBody(), wingGeo = gullWing(), dolphinGeo = dolphinGeometry(), dropGeo = new THREE.IcosahedronGeometry(1, 0);
  const bodies = new THREE.InstancedMesh(bodyGeo, mat, GULLS);
  const wings = new THREE.InstancedMesh(wingGeo, wingMat, GULLS * 2);
  const dolphins = new THREE.InstancedMesh(dolphinGeo, dolphinMat, POD);
  const drops = new THREE.InstancedMesh(dropGeo, dropMat, SPLASHES * SPLASH_DROPS);
  for (const m of [bodies, wings, dolphins, drops]) {
    m.frustumCulled = false; // they range all round the ship
    m.castShadow = m !== drops;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    root.add(m);
  }
  bodies.name = "gulls"; wings.name = "gull-wings"; dolphins.name = "dolphins"; drops.name = "splashes";

  const m4 = new THREE.Matrix4(), w4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, "YXZ");
  const p = new THREE.Vector3(), s1 = new THREE.Vector3(1, 1, 1), zero = new THREE.Matrix4().makeScale(0, 0, 0);
  // The right wing is the left one turned over (so its tip still sweeps back), flapping the other way.
  const shoulderL = M(0.12, 0.06, 0.05), shoulderR = M(-0.12, 0.06, 0.05, 0, 0, Math.PI);
  const flapM = new THREE.Matrix4(), flapR = new THREE.Matrix4();

  const wingFold = new THREE.Matrix4().makeRotationY(1.45).multiply(new THREE.Matrix4().makeScale(0.55, 1, 1));
  const tan = new THREE.Vector3();

  /** Where a wanderer is at time s, into out; its velocity into vel. */
  function wander(g: Wanderer, s: number, out: THREE.Vector3, vel: THREE.Vector3) {
    const at = (t: number, o: THREE.Vector3) => {
      const th = g.phase + g.w * t;
      const cx = g.cx + Math.sin(t * g.drift) * 5, cz = g.cz + Math.cos(t * g.drift * 0.8 + g.phase) * 10;
      const breathe = 1 + 0.08 * Math.sin(t * g.drift * 3 + g.phase);
      const x = cx + Math.cos(th) * g.rx * breathe, z = cz + Math.sin(th) * g.rz * breathe;
      // Alongside the ship, never closer than ~20 m off the rails: pushed out smoothly.
      const k = 1 - smooth(78, 100, Math.abs(z)), xr = Math.sqrt(x * x + (k * 34) ** 2);
      return o.set(Math.sign(x || 1) * xr, g.y + Math.sin(t * 0.13 + g.phase * 2) * g.bob, z);
    };
    at(s, out);
    at(s + 0.25, vel).sub(out).multiplyScalar(4);
  }

  /** Sets gull i: position, velocity (for heading and bank), wing pose (0 glide .. flapping), folded. */
  function pose(i: number, pos: THREE.Vector3, vel: THREE.Vector3, flap: number, folded: boolean, yawOver?: number) {
    const yaw = yawOver ?? Math.atan2(vel.x, vel.z);
    const speed = Math.hypot(vel.x, vel.z);
    const climb = folded ? -0.12 : -Math.atan2(vel.y, Math.max(speed, 1)) * 0.8;
    const bank = folded ? 0 : THREE.MathUtils.clamp(-turnRate[i]! * 0.45, -0.7, 0.7);
    e.set(climb, yaw, bank);
    q.setFromEuler(e);
    m4.compose(pos, q, s1.set(GULL_SCALE, GULL_SCALE, GULL_SCALE));
    bodies.setMatrixAt(i, m4);
    if (folded) {
      w4.multiplyMatrices(m4, shoulderL).multiply(wingFold);
      wings.setMatrixAt(i * 2, w4);
      w4.multiplyMatrices(m4, shoulderR).multiply(wingFold);
      wings.setMatrixAt(i * 2 + 1, w4);
      return;
    }
    flapM.makeRotationZ(flap);
    flapR.makeRotationZ(-flap);
    w4.multiplyMatrices(m4, shoulderL).multiply(flapM);
    wings.setMatrixAt(i * 2, w4);
    w4.multiplyMatrices(m4, shoulderR).multiply(flapR);
    wings.setMatrixAt(i * 2 + 1, w4);
  }
  // How fast each gull's heading is turning, for its bank (worked out from a moment ahead).
  const turnRate = new Float32Array(GULLS);

  /** A glide broken by bouts of flapping, on the bird's own rhythm. */
  const flapAt = (s: number, rate: number, seed: number) => {
    const bout = smooth(0.3, 0.6, Math.sin(s * rate + seed * 5.1) + 0.25 * Math.sin(s * rate * 3.3 + seed));
    return bout * Math.sin(s * (7.5 + rate * 6) + seed * 3) * 0.7 + 0.08 + (1 - bout) * 0.04 * Math.sin(s * 1.7 + seed);
  };

  /** The perch visit under way on a channel at s: where, and when it lands and leaves. */
  function perchVisit(c: number, s: number): { p: Perch; land: number; leave: number; side: number; seed: number } | null {
    if (!perches.length) return null;
    const shift = (c * PERCH.every) / PERCH.channels;
    const k = Math.floor((s + shift) / PERCH.every);
    for (const kk of [k, k - 1]) {
      const seed = kk * 2 + c;
      if (hash(seed, 21) > PERCH.chance) continue;
      const land = kk * PERCH.every - shift + hash(seed, 22) * 20 + PERCH.inS;
      const leave = land + PERCH.sitMin + hash(seed, 23) * (PERCH.sitMax - PERCH.sitMin);
      if (s < land - PERCH.inS || s > leave + PERCH.outS) continue;
      // Channels take turns through the list, so they never pick the same perch.
      const n = perches.length, half = Math.max(1, Math.floor(n / 2));
      const idx = c === 0 ? Math.floor(hash(seed, 24) * half) : half + Math.floor(hash(seed, 24) * (n - half));
      const p = perches[Math.min(n - 1, idx)]!;
      return { p, land, leave, side: p.x !== 0 ? Math.sign(p.x) : hash(seed, 25) < 0.5 ? -1 : 1, seed };
    }
    return null;
  }

  // The way in and out: a curve from far out over the sea, up and to the side, down to the perch.
  const b0 = new THREE.Vector3(), b1 = new THREE.Vector3(), b2 = new THREE.Vector3(), b3 = new THREE.Vector3();
  function bezier(t: number, out: THREE.Vector3) {
    const u = 1 - t;
    return out.copy(b0).multiplyScalar(u * u * u).addScaledVector(b1, 3 * u * u * t).addScaledVector(b2, 3 * u * t * t).addScaledVector(b3, t * t * t);
  }
  function route(p: Perch, side: number, seed: number, leaving: boolean) {
    const a = leaving ? 0.5 + hash(seed, 26) * 0.6 : -0.4 - hash(seed, 27) * 0.6; // leave aft-ish, arrive from forward
    const dx = side * Math.cos(a), dz = Math.sin(a);
    b3.set(p.x, p.y, p.z);
    b2.set(p.x + dx * 4, p.y + 2.2, p.z + dz * 4);
    b1.set(p.x + dx * 28, p.y + 12, p.z + dz * 28);
    b0.set(p.x + dx * 120, p.y + 34, p.z + dz * 120);
  }

  function gulls(s: number) {
    const vel = new THREE.Vector3(), ahead = new THREE.Vector3(), aheadV = new THREE.Vector3();
    WANDERERS.forEach((g, i) => {
      const t = s - (g.follow ?? 0);
      wander(g, t, p, vel);
      wander(g, t + 0.5, ahead, aheadV);
      const h0 = Math.atan2(vel.x, vel.z), h1 = Math.atan2(aheadV.x, aheadV.z);
      turnRate[i] = Math.atan2(Math.sin(h1 - h0), Math.cos(h1 - h0)) * 2;
      pose(i, p, vel, flapAt(t, g.flap, i + 1), false);
    });
    for (let c = 0; c < PERCH.channels; c++) {
      const i = WANDERERS.length + c;
      const v = perchVisit(c, s);
      if (!v) { bodies.setMatrixAt(i, zero); wings.setMatrixAt(i * 2, zero); wings.setMatrixAt(i * 2 + 1, zero); continue; }
      const { p: pt, land, leave, side, seed } = v;
      const lift = 0.12 * GULL_SCALE + 0.03;
      if (s < land) {
        // Coming in: fast and gliding, slowing over the last stretch, a few hard flaps to settle.
        route(pt, side, seed, false);
        const x = 1 - (land - s) / PERCH.inS, u = 1 - Math.pow(1 - x, 1.8);
        bezier(u, p);
        bezier(Math.min(1, u + 0.02), tan);
        vel.subVectors(tan, p);
        if (vel.lengthSq() < 1e-6) vel.set(Math.sin(pt.out), 0, Math.cos(pt.out));
        p.y += lift * x;
        turnRate[i] = 0;
        const flap = x > 0.82 ? Math.sin(s * 22) * 0.9 + 0.3 : flapAt(s, 0.3, seed);
        pose(i, p, vel, flap, false);
      } else if (s <= leave) {
        // Sitting: wings folded, now and then turning to look about.
        const m = Math.floor((s - land) / 2.7), f = smooth(0, 0.35, (s - land) - m * 2.7);
        const look = (k: number) => (k < 0 ? 0 : (hash(seed * 31 + k, 28) - 0.5) * 1.6);
        const yaw = pt.out + look(m - 1) + (look(m) - look(m - 1)) * f;
        p.set(pt.x, pt.y + lift, pt.z);
        turnRate[i] = 0;
        pose(i, p, vel.set(0, 0, 1), 0, true, yaw);
      } else {
        // Off again: a burst of hard flaps, then away, gliding.
        route(pt, side, seed + 1, true);
        const x = (s - leave) / PERCH.outS, u = Math.pow(x, 1.6);
        bezier(1 - u, p);
        bezier(Math.max(0, 1 - u - 0.02), tan);
        vel.subVectors(tan, p);
        if (vel.lengthSq() < 1e-6) vel.set(Math.sin(pt.out), 0.5, Math.cos(pt.out));
        p.y += lift * (1 - x);
        turnRate[i] = 0;
        const flap = x < 0.3 ? Math.sin(s * 20) * 0.95 + 0.25 : flapAt(s, 0.3, seed);
        pose(i, p, vel, flap, false);
      }
    }
    bodies.instanceMatrix.needsUpdate = true;
    wings.instanceMatrix.needsUpdate = true;
  }

  // The visit under way at time s, if any: its start, which side, where along the bow.
  function visit(s: number): { k: number; start: number; side: number } | null {
    const k = Math.floor(s / EVENT.every);
    for (const kk of [k, k - 1]) {
      const start = kk * EVENT.every + hash(kk, 1) * EVENT.jitter;
      if (s >= start && s < start + EVENT.length) return { k: kk, start, side: hash(kk, 2) < 0.5 ? -1 : 1 };
    }
    return null;
  }

  let splashUsed = 0;
  function splash(x: number, y: number, z: number, age: number, seed: number) {
    if (splashUsed >= SPLASHES || age < 0 || age > 1.1) return;
    const base = splashUsed++ * SPLASH_DROPS;
    for (let d = 0; d < SPLASH_DROPS; d++) {
      const a = hash(seed * 31 + d, 3) * TAU, out = 0.8 + hash(seed * 31 + d, 4) * 2.2, up = 2.5 + hash(seed * 31 + d, 5) * 3.5;
      const px = x + Math.cos(a) * out * age, pz = z + Math.sin(a) * out * age + age * 2.0;
      const py = y + up * age - 4.9 * age * age;
      const size = (0.16 + hash(seed * 31 + d, 6) * 0.22) * (1 - age * 0.7);
      if (py < y - 0.2) { drops.setMatrixAt(base + d, zero); continue; }
      m4.compose(p.set(px, py, pz), q.identity(), s1.set(size, size, size));
      drops.setMatrixAt(base + d, m4);
    }
  }

  function pod(s: number, t: number) {
    splashUsed = 0;
    const v = visit(s);
    for (let j = 0; j < POD; j++) {
      if (!v) { dolphins.setMatrixAt(j, zero); continue; }
      const age = s - v.start;
      // Riding alongside the bow wave, drifting slowly aft relative to the ship, each a little apart.
      const zBase = -40 + j * 3.4 + age * 0.9 + Math.sin(age * 0.7 + j) * 1.2;
      const xBase = v.side * (WATERLINE.halfBeam(Math.max(WATERLINE.bow, zBase)) + 9.5 + j * 2.2 + Math.sin(age * 0.5 + j * 2) * 0.6);
      const surf = ocean.heightAt(xBase, zBase, t);
      // Up from the deep at the start, down again at the end; just under the surface between,
      // the fin showing; and now and then a leap.
      const depth = -0.42 - 3.5 * (1 - smooth(0, 1.5, age)) - 4 * smooth(EVENT.length - 2.2, EVENT.length, age);
      let y = surf + depth, z = zBase, pitch = 0;
      const lt = age - 1.6 - j * 0.55;
      const n = Math.floor(lt / LEAP.every), u = (lt - n * LEAP.every) / LEAP.length;
      const leaping = lt >= 0 && n < 4 && u >= 0 && u <= 1 && hash(v.k * 7 + j * 3 + n, 7) > 0.2;
      if (leaping) {
        y = surf - 0.6 + (LEAP.height + 0.6) * 4 * u * (1 - u);
        z = zBase - LEAP.reach * (u - 0.5);
        const dy = (LEAP.height + 0.6) * 4 * (1 - 2 * u) / LEAP.length, dz = LEAP.reach / LEAP.length;
        pitch = 0.7 * Math.atan2(dy, dz); // a little flatter than the arc: it reads as a leap, not a fall
      } else {
        pitch = Math.sin(age * 3 + j) * 0.06;
      }
      // Splashes where it leaves the water and where it goes back in.
      if (lt >= 0 && n < 4 && hash(v.k * 7 + j * 3 + n, 7) > 0.2) {
        const tUp = n * LEAP.every + 0.14 * LEAP.length, tDown = n * LEAP.every + 0.86 * LEAP.length;
        splash(xBase, surf, zBase + LEAP.reach * 0.36, lt - tUp, v.k * 13 + j * 5 + n);
        splash(xBase, surf, zBase - LEAP.reach * 0.36, lt - tDown, v.k * 17 + j * 3 + n + 99);
      }
      // Nose toward the bow (-z), pitched along the arc (a positive x turn dips the nose), rolling a little.
      e.set(-pitch, Math.PI, Math.sin(age * 1.3 + j) * 0.12);
      q.setFromEuler(e);
      m4.compose(p.set(xBase, y, z), q, s1.set(1.35, 1.35, 1.35)); // a chunky 3.2 m, to read from the decks
      dolphins.setMatrixAt(j, m4);
    }
    for (let i = splashUsed * SPLASH_DROPS; i < SPLASHES * SPLASH_DROPS; i++) drops.setMatrixAt(i, zero);
    dolphins.instanceMatrix.needsUpdate = true;
    drops.instanceMatrix.needsUpdate = true;
  }

  return {
    root,
    update(now, t) {
      const s = now / 1000;
      gulls(s);
      pod(s, t);
    },
    dispose() {
      for (const g of [bodyGeo, wingGeo, dolphinGeo, dropGeo]) g.dispose();
      for (const m of [mat, wingMat, dolphinMat, dropMat]) m.dispose();
    },
  };
}
