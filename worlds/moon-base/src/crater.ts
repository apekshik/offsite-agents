// The crater: the floor, four printed risers stepping up to the rim, the terraces between them
// with a berm along each edge, the rim plain rolling away into hills, the switchback ramps
// between the tiers and the ice pit cut into the floor. All of it one profile swept round the
// crater (a ring of vertices per point of the profile), so the terraces stay true circles except
// where a building is dug into a riser: there the riser gives way to the building's straight
// front (dims.ts riserAt).

import * as THREE from "three";
import {
  BERM, FLOOR_R, LANDING, PIT, PLAIN_R, RAMP, RAMPS, RISE, RISER_R, ROAD, TIER_Y, dugAt, riserAt, wrap, type Ramp,
} from "./dims.ts";
import { angleOf, arc, cap, deg, polar, type P2 } from "./kit.ts";
import { rail, type Base } from "./parts.ts";
import { pathLight } from "./furniture.ts";

const TAU = Math.PI * 2;

/** The angle a ramp's landing ends at (it climbs from foot to top, then runs on flat for LANDING m). */
export function landingEnd(r: Ramp): number {
  const dir = Math.sign(r.top - r.foot);
  return r.top + (dir * LANDING) / (RISER_R[r.k]! - RAMP.w / 2);
}

/** Where a ramp's surface is at angle a: its height, or null off its span. */
export function rampHeight(r: Ramp, a: number): number | null {
  const end = landingEnd(r);
  const lo = Math.min(r.foot, end), hi = Math.max(r.foot, end);
  const x = r.foot + wrap(a - r.foot);
  if (x < lo - 1e-9 || x > hi + 1e-9) return null;
  const u = Math.min(1, Math.abs(x - r.foot) / Math.abs(r.top - r.foot));
  return TIER_Y[r.k]! + RISE * u;
}

/** Whether the berm on tier k + 1's edge (above riser k) is left open at angle a: a ramp's way off its landing. */
function bermGap(k: number, a: number): boolean {
  for (const r of RAMPS) {
    if (r.k !== k) continue;
    const end = landingEnd(r), m = 1.2 / RISER_R[k]!;
    const lo = Math.min(r.top, end) - m, hi = Math.max(r.top, end) + m;
    const x = lo + wrap(a - lo);
    if (x >= lo && x <= hi) return true;
  }
  return false;
}

/** The angles the crater's rings are sampled at: every degree, plus the edges of anything that cuts them. */
function angles(): number[] {
  const set = new Set<number>();
  const add = (a: number) => set.add(Math.round(wrap(a) * 1e6) / 1e6);
  for (let i = 0; i < 360; i++) add(deg(i) - Math.PI);
  for (const r of RAMPS) {
    const end = landingEnd(r), m = 1.2 / RISER_R[r.k]!;
    const lo = Math.min(r.top, end) - m, hi = Math.max(r.top, end) + m;
    add(lo); add(hi);
  }
  return [...set].sort((a, b) => a - b);
}

interface Seg { pts: (a: number) => [number, number][]; }

/**
 * The profile at angle a, inside out, as runs of (r, y): each riser and the terrace above it
 * (its berm, then the flat), and the rim plain. Every angle has the same number of points.
 */
function profile(a: number): [number, number][][] {
  const runs: [number, number][][] = [];
  for (let k = 0; k < 4; k++) {
    const R = riserAt(k, a), y0 = TIER_Y[k]!, y1 = TIER_Y[k + 1]!;
    const next = k < 3 ? riserAt(k + 1, a) : PLAIN_R;
    const bh = bermGap(k, a) ? 0.0 : BERM.h;
    runs.push([[R, y0], [R, y1 + bh]]); // the riser, up to the berm's top
    runs.push([[R, y1 + bh], [R + BERM.d, y1 + bh], [R + BERM.d + 0.35, y1]]); // over the berm
    runs.push([[R + BERM.d + 0.35, y1], [next, y1]]); // the terrace
  }
  return runs;
}

/** The hills beyond the rim plain: a few broad swells. */
export function hillY(r: number, a: number): number {
  const k = THREE.MathUtils.smoothstep(r, PLAIN_R, 520);
  const swell = 20 + 9 * Math.sin(3 * a + 1.1) + 5 * Math.sin(7 * a + 2.3) + 3 * Math.sin(13 * a + 0.4);
  const near = 2.5 * Math.sin(5 * a + r * 0.02) * THREE.MathUtils.smoothstep(r, PLAIN_R, PLAIN_R + 60);
  return TIER_Y[4]! + k * swell + near;
}

export function buildCrater(s: Base) {
  const A = angles();
  const terrain = new THREE.BufferGeometry();
  const pos: number[] = [], nor: number[] = [], idx: number[] = [];
  const colPos: number[] = [];
  const profiles = A.map((a) => profile(a));
  const runCount = profiles[0]!.length;
  for (let ri = 0; ri < runCount; ri++) {
    const npts = profiles[0]![ri]!.length;
    for (let pi = 0; pi + 1 < npts; pi++) {
      const base = pos.length / 3;
      for (let ai = 0; ai < A.length; ai++) {
        const a = A[ai]!, run = profiles[ai]![ri]!;
        const [r0, y0] = run[pi]!, [r1, y1] = run[pi + 1]!;
        const [x0, z0] = polar(a, r0), [x1, z1] = polar(a, r1);
        pos.push(x0, y0, z0, x1, y1, z1);
        // The profile's normal: its tangent turned toward the crater's centre and up.
        let tr = r1 - r0, ty = y1 - y0;
        const l = Math.hypot(tr, ty) || 1;
        tr /= l; ty /= l;
        const nr = -ty, ny = tr;
        const rx = Math.sin(a), rz = -Math.cos(a);
        nor.push(rx * nr, ny, rz * nr, rx * nr, ny, rz * nr);
      }
      for (let ai = 0; ai < A.length; ai++) {
        const aj = (ai + 1) % A.length;
        const a0 = A[ai]!, a1 = A[aj]! + (aj === 0 ? TAU : 0);
        const mid = (a0 + a1) / 2;
        // A dug building's front stands where its riser would be.
        if (ri % 3 === 0 && dugAt(ri / 3, mid)) continue;
        const p = base + ai * 2, q = base + aj * 2;
        // Quad (p, p+1, q+1, q): p and q on the inner edge.
        idx.push(p, q, q + 1, p, q + 1, p + 1);
      }
    }
  }
  terrain.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  terrain.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  terrain.setIndex(idx);
  fixWinding(terrain);
  s.pile.add("ground", terrain);
  s.col.add(terrain);
  void colPos;

  // The floor: a disc with the pit cut out of it.
  const edge: P2[] = A.map((a) => polar(a, riserAt(0, a)));
  const hole: P2[] = arc(PIT.x, PIT.z, PIT.r, 0, TAU, TAU / 64).slice(0, -1);
  const floor = cap(edge, 0, false, [hole]);
  s.pile.add("ground", floor);
  s.col.add(floor);

  // The hills: a broad apron from the rim plain's edge out to the horizon.
  const hills = new THREE.BufferGeometry();
  const HR = [PLAIN_R, 165, 185, 215, 260, 320, 400, 500, 650, 850, 1100];
  const hp: number[] = [], hi: number[] = [];
  const NA = 180;
  for (let i = 0; i < HR.length; i++) for (let j = 0; j <= NA; j++) {
    const a = (j / NA) * TAU, r = HR[i]!;
    const [x, z] = polar(a, r);
    hp.push(x, hillY(r, a), z);
  }
  for (let i = 0; i + 1 < HR.length; i++) for (let j = 0; j < NA; j++) {
    const p = i * (NA + 1) + j, q = p + NA + 1;
    hi.push(p, q + 1, q, p, p + 1, q + 1);
  }
  hills.setAttribute("position", new THREE.Float32BufferAttribute(hp, 3));
  hills.setIndex(hi);
  hills.computeVertexNormals();
  fixWinding(hills);
  s.pile.add("ground", hills);
  // You can walk out onto the plain, but not off into the hills: an invisible ring stops you.
  s.col.add(new THREE.CylinderGeometry(205, 205, 60, 64, 1, true).translate(0, TIER_Y[4]! + 20, 0));
  {
    // The near hills are walkable up to that ring.
    const near = new THREE.BufferGeometry();
    near.setAttribute("position", new THREE.Float32BufferAttribute(hp.slice(0, 3 * (NA + 1) * 4), 3));
    near.setIndex(hi.slice(0, 6 * NA * 3));
    s.col.add(near);
  }

  for (const r of RAMPS) buildRamp(s, r);
  buildPit(s);
  roads(s, A);
}

/** Every triangle's winding made to agree with its vertex normals (so front faces face out). */
export function fixWinding(g: THREE.BufferGeometry) {
  const p = g.attributes.position!, n = g.attributes.normal!, index = g.index!;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), f = new THREE.Vector3(), nn = new THREE.Vector3();
  for (let i = 0; i < index.count; i += 3) {
    const ia = index.getX(i), ib = index.getX(i + 1), ic = index.getX(i + 2);
    a.fromBufferAttribute(p, ia); b.fromBufferAttribute(p, ib); c.fromBufferAttribute(p, ic);
    f.subVectors(b, a).cross(c.sub(a));
    nn.fromBufferAttribute(n, ia);
    if (f.dot(nn) < 0) { index.setX(i + 1, ic); index.setX(i + 2, ib); }
  }
}

// ---------- ramps ----------

function buildRamp(s: Base, r: Ramp) {
  const R = RISER_R[r.k]!, rin = R - RAMP.w, rmid = R - RAMP.w / 2;
  const y0 = TIER_Y[r.k]!, y1 = TIER_Y[r.k + 1]!;
  const end = landingEnd(r), dir = Math.sign(r.top - r.foot);
  const n = Math.max(8, Math.ceil(Math.abs(end - r.foot) / deg(0.8)));
  const top = new THREE.BufferGeometry(), side = new THREE.BufferGeometry();
  const tp: number[] = [], ti: number[] = [], sp: number[] = [], si: number[] = [];
  const heights: number[] = [];
  for (let i = 0; i <= n; i++) {
    const a = r.foot + ((end - r.foot) * i) / n;
    const h = rampHeight(r, a) ?? y0;
    heights.push(h);
    const [xi, zi] = polar(a, rin), [xo, zo] = polar(a, R - 0.02);
    tp.push(xi, h + 0.03, zi, xo, h + 0.03, zo);
    sp.push(xi, y0, zi, xi, h + 0.03, zi);
  }
  for (let i = 0; i < n; i++) {
    const p = i * 2, q = p + 2;
    ti.push(p, q, q + 1, p, q + 1, p + 1);
    si.push(p, q, q + 1, p, q + 1, p + 1);
  }
  top.setAttribute("position", new THREE.Float32BufferAttribute(tp, 3));
  top.setIndex(ti);
  top.computeVertexNormals();
  orient(top, new THREE.Vector3(0, 1, 0));
  side.setAttribute("position", new THREE.Float32BufferAttribute(sp, 3));
  side.setIndex(si);
  side.computeVertexNormals();
  orientInward(side);
  s.pile.add("pad", top);
  s.pile.add("printed", side);
  s.col.add(top);
  s.col.add(side);
  // The landing's far end: a printed wall down to the terrace below, a rail across its top.
  const [ex0, ez0] = polar(end, rin), [ex1, ez1] = polar(end, R);
  const endWall = new THREE.BufferGeometry();
  endWall.setAttribute("position", new THREE.Float32BufferAttribute([ex0, y0, ez0, ex1, y0, ez1, ex1, y1, ez1, ex0, y1, ez0], 3));
  endWall.setIndex([0, 1, 2, 0, 2, 3]);
  endWall.computeVertexNormals();
  // Face away from the ramp (along the way it climbs).
  const away = new THREE.Vector3(Math.cos(end) * dir, 0, Math.sin(end) * dir);
  orient(endWall, away);
  s.pile.add("printed", endWall);
  s.col.add(endWall);
  // Rails: along the open side from where it's worth having one, and across the landing's end.
  const railPts: P2[] = [];
  const from = Math.floor(n * 0.12);
  for (let i = from; i <= n; i++) railPts.push(polar(r.foot + ((end - r.foot) * i) / n, rin + 0.12));
  for (let i = from; i < n; i += 1) {
    const a = r.foot + ((end - r.foot) * i) / n, b = r.foot + ((end - r.foot) * (i + 1)) / n;
    const [xa, za] = polar(a, rin + 0.12), [xb, zb] = polar(b, rin + 0.12);
    const ha = heights[i]!, hb = heights[i + 1]!;
    s.pile.rod("orange", new THREE.Vector3(xa, ha + 1.0, za), new THREE.Vector3(xb, hb + 1.0, zb), 0.04, 6);
    if (i % 3 === 0) s.pile.rod("orange", new THREE.Vector3(xa, ha, za), new THREE.Vector3(xa, ha + 1.0, za), 0.035, 6);
    // A barrier above the slope for the captain.
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([xa, ha, za, xb, hb, zb, xb, hb + 1.1, zb, xa, ha + 1.1, za], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    s.col.add(g);
  }
  rail(s.pile, s.col, [polar(end, rin + 0.12), polar(end, R - 0.1)], y1, { every: 1.5 });
  // Lamps along the rail.
  for (let i = from + 2; i <= n; i += 7) {
    const a = r.foot + ((end - r.foot) * i) / n, [x, z] = polar(a, rin + 0.12), h = heights[i]!;
    s.pile.cyl("lamp", x, h + 1.0, z, 0.07, 0.12, 8);
    s.halos.push({ x, y: h + 1.18, z, color: "#ffb15c", size: 0.45, mode: "night" });
  }

  // The walking graph: off the foot, up the slope, onto the landing, off it onto the terrace.
  const footA = r.foot - (dir * 1.2) / rmid;
  const [fx, fz] = polar(footA, rmid);
  const ids = [s.plan.node(`${r.id}:foot`, fx, y0, fz)];
  const steps = Math.ceil(RAMP.len / 8);
  for (let i = 1; i < steps; i++) {
    const a = r.foot + ((r.top - r.foot) * i) / steps;
    const [x, z] = polar(a, rmid);
    ids.push(s.plan.node(`${r.id}:${i}`, x, rampHeight(r, a)!, z));
  }
  const la = (r.top + end) / 2;
  const [tx, tz] = polar(la, rmid);
  ids.push(s.plan.node(`${r.id}:top`, tx, y1, tz));
  const [ox, oz] = polar(la, R + ROAD);
  ids.push(s.plan.node(`${r.id}:exit`, ox, y1, oz));
  s.plan.link(...ids);
}

function orient(g: THREE.BufferGeometry, want: THREE.Vector3) {
  const p = g.attributes.position!, index = g.index!;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), f = new THREE.Vector3();
  for (let i = 0; i < index.count; i += 3) {
    a.fromBufferAttribute(p, index.getX(i)); b.fromBufferAttribute(p, index.getX(i + 1)); c.fromBufferAttribute(p, index.getX(i + 2));
    f.subVectors(b, a).cross(c.sub(a));
    if (f.dot(want) < 0) { const t = index.getX(i + 1); index.setX(i + 1, index.getX(i + 2)); index.setX(i + 2, t); }
  }
  g.computeVertexNormals();
}

/** Faces turned toward the crater's centre (a ramp's open side). */
function orientInward(g: THREE.BufferGeometry) {
  const p = g.attributes.position!, index = g.index!;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), f = new THREE.Vector3(), m = new THREE.Vector3();
  for (let i = 0; i < index.count; i += 3) {
    a.fromBufferAttribute(p, index.getX(i)); b.fromBufferAttribute(p, index.getX(i + 1)); c.fromBufferAttribute(p, index.getX(i + 2));
    m.copy(a).add(b).add(c).divideScalar(3);
    f.subVectors(b, a).cross(c.clone().sub(a));
    if (f.x * -m.x + f.z * -m.z < 0) { const t = index.getX(i + 1); index.setX(i + 1, index.getX(i + 2)); index.setX(i + 2, t); }
  }
  g.computeVertexNormals();
}

// ---------- the pit ----------

/** The pit's own polar frame: angle round its centre (map angles), radius from it. */
const pitAt = (a: number, r: number): P2 => { const [x, z] = polar(a, r); return [PIT.x + x, PIT.z + z]; };
/** The ramp down into the pit: from the floor at PIT_RAMP.a0, round the wall, to the bottom at a1. */
export const PIT_RAMP = { a0: deg(150), a1: deg(150 + 175), w: 2.6 };
/** Where the gantry bridge leaves the pit's edge for the rig, and how far out it goes. */
export const GANTRY = { a: deg(-20), len: 8.5, w: 2.4 };

function pitWallR(a: number, y: number): number {
  const n = Math.sin(a * 7 + y * 0.9) * 0.35 + Math.sin(a * 17 + y * 2.3) * 0.18 + Math.sin(a * 3 - y * 0.4) * 0.3;
  return PIT.r + 0.25 + n * THREE.MathUtils.smoothstep(-y, 0.4, 2.0);
}

function buildPit(s: Base) {
  // The wall: rough rock, inward facing, from the floor down to the ice.
  const NA = 96, ys = [0, -0.6, -2.2, -4, -5.8, -7.5, PIT.y];
  const wall = new THREE.BufferGeometry();
  const wp: number[] = [], wi: number[] = [], wn: number[] = [];
  for (let i = 0; i < ys.length; i++) for (let j = 0; j <= NA; j++) {
    const a = (j / NA) * TAU, y = ys[i]!;
    const r = i === 0 ? PIT.r : pitWallR(a, y);
    const [x, z] = pitAt(a, r);
    wp.push(x, y, z);
    wn.push(-Math.sin(a), 0, Math.cos(a));
  }
  for (let i = 0; i + 1 < ys.length; i++) for (let j = 0; j < NA; j++) {
    const p = i * (NA + 1) + j, q = p + NA + 1;
    wi.push(p, q, q + 1, p, q + 1, p + 1);
  }
  wall.setAttribute("position", new THREE.Float32BufferAttribute(wp, 3));
  wall.setAttribute("normal", new THREE.Float32BufferAttribute(wn, 3));
  wall.setIndex(wi);
  fixWinding(wall);
  wall.computeVertexNormals();
  s.pile.add("rock", wall);
  s.col.add(wall);
  // The bottom: ice, glowing.
  const bottom = cap(arc(PIT.x, PIT.z, PIT.r + 1.2, 0, TAU, TAU / 48).slice(0, -1), PIT.y, false);
  s.pile.add("iceFloor", bottom);
  s.col.add(bottom);

  // The ramp down: a shelf round the wall.
  const { a0, a1, w } = PIT_RAMP;
  const n = 60, rOut = PIT.r - 0.05, rIn = PIT.r - w;
  const top = new THREE.BufferGeometry(), side = new THREE.BufferGeometry();
  const tp: number[] = [], ti: number[] = [], sp: number[] = [], si: number[] = [];
  const h = (u: number) => PIT.y * Math.min(1, u * 1.08);
  for (let i = 0; i <= n; i++) {
    const u = i / n, a = a0 + (a1 - a0) * u, y = h(u);
    const [xi, zi] = pitAt(a, rIn), [xo, zo] = pitAt(a, rOut + 0.4);
    tp.push(xi, y + 0.02, zi, xo, y + 0.02, zo);
    sp.push(xi, PIT.y, zi, xi, y + 0.02, zi);
  }
  for (let i = 0; i < n; i++) { const p = i * 2, q = p + 2; ti.push(p, q, q + 1, p, q + 1, p + 1); si.push(p, q, q + 1, p, q + 1, p + 1); }
  top.setAttribute("position", new THREE.Float32BufferAttribute(tp, 3));
  top.setIndex(ti);
  top.computeVertexNormals();
  orient(top, new THREE.Vector3(0, 1, 0));
  side.setAttribute("position", new THREE.Float32BufferAttribute(sp, 3));
  side.setIndex(si);
  side.computeVertexNormals();
  {
    // The shelf's open side faces the middle of the pit.
    const p = side.attributes.position!, index = side.index!;
    const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), f = new THREE.Vector3(), m = new THREE.Vector3();
    for (let i = 0; i < index.count; i += 3) {
      A.fromBufferAttribute(p, index.getX(i)); B.fromBufferAttribute(p, index.getX(i + 1)); C.fromBufferAttribute(p, index.getX(i + 2));
      m.copy(A).add(B).add(C).divideScalar(3);
      f.subVectors(B, A).cross(C.clone().sub(A));
      if (f.x * (PIT.x - m.x) + f.z * (PIT.z - m.z) < 0) { const t = index.getX(i + 1); index.setX(i + 1, index.getX(i + 2)); index.setX(i + 2, t); }
    }
    side.computeVertexNormals();
  }
  s.pile.add("pad", top);
  s.pile.add("rock", side);
  s.col.add(top);
  s.col.add(side);
  const railRun: P2[] = [];
  for (let i = 4; i <= n; i++) railRun.push(pitAt(a0 + ((a1 - a0) * i) / n, rIn + 0.1));
  for (let i = 0; i + 1 < railRun.length; i++) {
    const u0 = (i + 4) / n, u1 = (i + 5) / n;
    const [xa, za] = railRun[i]!, [xb, zb] = railRun[i + 1]!;
    s.pile.rod("orange", new THREE.Vector3(xa, h(u0) + 1.0, za), new THREE.Vector3(xb, h(u1) + 1.0, zb), 0.04, 6);
    if (i % 3 === 0) s.pile.rod("orange", new THREE.Vector3(xa, h(u0), za), new THREE.Vector3(xa, h(u0) + 1.0, za), 0.035, 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([xa, h(u0), za, xb, h(u1), zb, xb, h(u1) + 1.1, zb, xa, h(u0) + 1.1, za], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    s.col.add(g);
  }
  // A rail round the rim, open where the ramp starts and where the gantry goes out.
  const gaps = [[a0 - deg(14), a0 + deg(8)], [GANTRY.a - deg(6), GANTRY.a + deg(6)]];
  let cur: P2[] = [];
  const rims: P2[][] = [];
  for (let j = 0; j <= 96; j++) {
    const a = (j / 96) * TAU;
    const open = gaps.some(([g0, g1]) => wrap(a - g0!) >= 0 && wrap(a - g0!) <= g1! - g0!);
    if (open) { if (cur.length > 1) rims.push(cur); cur = []; continue; }
    cur.push(pitAt(a, PIT.r + 0.35));
  }
  if (cur.length > 1) rims.push(cur);
  for (const run of rims) rail(s.pile, s.col, run, 0, { every: 2.2 });

  // Walking: round the top of the pit, down the ramp, out onto the ice.
  const ids: string[] = [];
  const top0 = pitAt(a0 - deg(8), PIT.r + 2.2);
  ids.push(s.plan.node("pit:top", top0[0], 0, top0[1]));
  const steps = 7;
  for (let i = 0; i <= steps; i++) {
    const u = 0.04 + (0.88 * i) / steps, a = a0 + (a1 - a0) * u;
    const [x, z] = pitAt(a, PIT.r - w / 2);
    ids.push(s.plan.node(`pit:r${i}`, x, h(u), z));
  }
  const [bx, bz] = pitAt(a1 + deg(9), PIT.r - w / 2 - 0.3);
  ids.push(s.plan.node("pit:bottom", bx, PIT.y, bz));
  s.plan.link(...ids);
  const [cx2, cz2] = pitAt(a1 + deg(55), PIT.r - 5.5);
  s.plan.node("pit:ice", cx2, PIT.y, cz2);
  s.plan.link("pit:bottom", "pit:ice");
  s.marks.set("pit-ramp", ids.map((id) => new THREE.Vector3(...s.plan.at(id))));
}

// ---------- roads round the terraces ----------

/** Nav nodes round each terrace's road, every few degrees, and path lights along each berm. */
function roads(s: Base, A: number[]) {
  for (let k = 1; k <= 4; k++) {
    const y = TIER_Y[k]!, inner = RISER_R[k - 1]!;
    const r = inner + ROAD;
    const step = k === 4 ? 5 : 6;
    const ids: string[] = [];
    for (let d = -180; d < 180; d += step) {
      const a = deg(d);
      // A building dug into the riser below pushes the road out a little.
      const rr = riserAt(k - 1, a) + ROAD;
      const [x, z] = polar(a, rr);
      ids.push(s.plan.node(`t${k}:${d}`, x, y, z));
    }
    // The ramps up from this terrace and the ramps arriving on it join its road.
    for (const r of RAMPS) {
      if (r.k === k) ids.push(`${r.id}:foot`);
      if (r.k + 1 === k) ids.push(`${r.id}:exit`);
    }
    s.open.push({ ids, reach: 14 });
    // Path lights on the berm, every 9 m.
    const n = Math.round((TAU * inner) / 9);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU - Math.PI;
      if (bermGap(k - 1, a)) continue;
      const R = riserAt(k - 1, a) + BERM.d / 2;
      const [x, z] = polar(a, R);
      s.props.put(pathLight, x, y + BERM.h, z, -a);
      s.halos.push({ x, y: y + BERM.h + 0.62, z, color: "#ffb35a", size: 0.5, mode: "night" });
      if (i % 2 === 0) {
        const [px, pz] = polar(a, R + 1.6);
        s.pools.push({ x: px, y, z: pz, r: 1.5, k: 0.45 });
      }
    }
  }
  void A;
  void FLOOR_R;
  void angleOf;
}
