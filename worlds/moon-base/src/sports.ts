// The sports dome: a long glass capsule on the upper terrace, north-east, over a court with
// glowing lines and a hoop at each end, a bench along the far side for anyone watching. In a
// sixth of a gee everyone dunks. The terrace's road runs through it along the near side, so the
// ring stays whole.

import * as THREE from "three";
import { SPORTS, TIER_Y } from "./dims.ts";
import { HOOP, bench, hoop } from "./furniture.ts";
import { Frame, faceOut, polar, type P2 } from "./kit.ts";
import type { Base } from "./parts.ts";

/** The court, in the dome's frame (x along the dome, z out from the crater). */
export const COURT = { half: 9.6, z0: -2.1, z1: 3.0 };
const MID = SPORTS.len / 2 - SPORTS.half; // half the straight part

export function sportsFrame(): Frame {
  const [cx, cz] = polar(SPORTS.a, SPORTS.r);
  return new Frame(cx, cz, SPORTS.a);
}

/** The point on the dome's footprint `k` of the way round (a stadium: two straights, two round ends). */
function rim(t: number): { x: number; z: number; mx: number } {
  // Perimeter parameter t in [0, 1): along +z side, round the +x end, back along -z side, round the -x end.
  const R = SPORTS.half, L = 2 * MID, P = 2 * L + 2 * Math.PI * R;
  let d = ((t % 1) + 1) % 1 * P;
  if (d < L) return { x: -MID + d, z: R, mx: -MID + d };
  d -= L;
  if (d < Math.PI * R) { const a = d / R; return { x: MID + R * Math.sin(a), z: R * Math.cos(a), mx: MID }; }
  d -= Math.PI * R;
  if (d < L) return { x: MID - d, z: -R, mx: MID - d };
  d -= L;
  const a = d / R;
  return { x: -MID - R * Math.sin(a), z: -R * Math.cos(a), mx: -MID };
}

/** Whether a point of the dome's shell is in a doorway (an end, on the road's side). */
function inDoor(x: number, z: number, y: number) {
  return Math.abs(x) > MID + 2.2 && z < -2.2 && z > -5.6 && y < 2.9;
}

export function buildSports(s: Base) {
  const f = sportsFrame();
  const { pile, inner, col, plan, innerProps } = s;
  const Y = TIER_Y[3]!, H = SPORTS.h;
  // The shell: each rim point rises over to the straight spine down the middle.
  const NU = 72, NV = 9;
  const gp: number[] = [], gi: number[] = [];
  const pts: { x: number; z: number; y: number }[] = [];
  for (let i = 0; i <= NU; i++) {
    const r = rim(i / NU);
    for (let j = 0; j <= NV; j++) {
      const th = (j / NV) * (Math.PI / 2);
      const x = r.mx + (r.x - r.mx) * Math.cos(th), z = r.z * Math.cos(th), y = Y + 0.4 + H * Math.sin(th);
      pts.push({ x, z, y });
      const v = f.v(x, y, z);
      gp.push(v.x, v.y, v.z);
    }
  }
  for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) {
    const p = i * (NV + 1) + j, q = p + NV + 1;
    const c = pts[p]!;
    if (inDoor(c.x, c.z, c.y - Y)) continue;
    gi.push(p, q, q + 1, p, q + 1, p + 1);
  }
  const shell = new THREE.BufferGeometry();
  shell.setAttribute("position", new THREE.Float32BufferAttribute(gp, 3));
  shell.setIndex(gi);
  // Out from the spine down the middle of the dome (in its frame: x along it, clamped to the straight part).
  faceOut(shell, (m) => { const dx = m.x - f.cx, dz = m.z - f.cz; const along = Math.max(-MID, Math.min(MID, dx * f.right[0] + dz * f.right[1])); return f.v(along, Y, 0); });
  pile.add("sportsGlass", shell);
  // Its frame: ribs over the top every few metres of rim, a ring at the springing.
  for (let i = 0; i < NU; i += 3) for (let j = 0; j < NV; j++) {
    const a = pts[i * (NV + 1) + j]!, b = pts[i * (NV + 1) + j + 1]!;
    if (inDoor(a.x, a.z, a.y - Y)) continue;
    pile.rod("white", f.v(a.x, a.y, a.z), f.v(b.x, b.y, b.z), 0.08, 5);
  }
  for (const j of [0, 4]) for (let i = 0; i < NU; i++) {
    const a = pts[i * (NV + 1) + j]!, b = pts[(i + 1) * (NV + 1) + j]!;
    if (inDoor(a.x, a.z, a.y - Y)) continue;
    pile.rod("white", f.v(a.x, a.y, a.z), f.v(b.x, b.y, b.z), j ? 0.07 : 0.12, 5);
  }
  // A printed plinth round its foot, open at the doors; colliders the same.
  const foot: P2[][] = [];
  let run: P2[] = [];
  for (let i = 0; i <= NU; i++) {
    const r = rim(i / NU);
    if (inDoor(r.x, r.z, 0)) { if (run.length > 1) foot.push(run); run = []; continue; }
    run.push([r.x, r.z]);
  }
  if (run.length > 1) foot.push(run);
  for (const r of foot) {
    for (let i = 0; i + 1 < r.length; i++) {
      const [x0, z0] = r[i]!, [x1, z1] = r[i + 1]!;
      f.box(pile, "printed", Math.min(x0, x1) - 0.05, Y, Math.min(z0, z1) - 0.05, Math.max(x0, x1) + 0.05, Y + 0.45, Math.max(z0, z1) + 0.05);
    }
    col.wall(f.run(r), Y, Y + 3.0, 0.4);
  }
  // A coarse collider for the glass higher up, so nobody leaps out through it.
  {
    const cp: number[] = [], ci: number[] = [];
    const CU = 36, CV = 5;
    for (let i = 0; i <= CU; i++) {
      const r = rim(i / CU);
      for (let j = 0; j <= CV; j++) {
        const th = 0.25 + (j / CV) * (Math.PI / 2 - 0.25);
        const v = f.v(r.mx + (r.x - r.mx) * Math.cos(th) * 0.97, Y + 0.4 + H * Math.sin(th) - 0.1, r.z * Math.cos(th) * 0.97);
        cp.push(v.x, v.y, v.z);
      }
    }
    for (let i = 0; i < CU; i++) for (let j = 0; j < CV; j++) { const p = i * (CV + 1) + j, q = p + CV + 1; ci.push(p, q, q + 1, p, q + 1, p + 1); }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(cp, 3));
    g.setIndex(ci);
    col.add(g);
  }
  // Door frames at both ends.
  for (const sx of [-1, 1]) {
    const x = sx * (MID + 3.6);
    for (const z of [-2.3, -4.6]) pile.rod("white", f.v(x, Y, z), f.v(x, Y + 2.9, z), 0.1, 6);
    pile.rod("orange", f.v(x, Y + 2.9, -2.3), f.v(x, Y + 2.9, -4.6), 0.08, 6);
  }

  // The floor: the court, its lines, and the walkway along the near side.
  {
    const fp: number[] = [];
    const NF = 36;
    for (let i = 0; i < NF; i++) {
      const a = rim(i / NF), b = rim((i + 1) / NF);
      const c = f.v(0, Y + 0.02, 0), p = f.v(a.x * 0.99, Y + 0.02, a.z * 0.99), q = f.v(b.x * 0.99, Y + 0.02, b.z * 0.99);
      fp.push(c.x, c.y, c.z, p.x, p.y, p.z, q.x, q.y, q.z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(fp, 3));
    g.computeVertexNormals();
    if (g.attributes.normal!.getY(0) < 0) {
      const P = g.attributes.position!;
      for (let i = 0; i < P.count; i += 3) { const x = P.getX(i + 1), y = P.getY(i + 1), z = P.getZ(i + 1); P.setXYZ(i + 1, P.getX(i + 2), P.getY(i + 2), P.getZ(i + 2)); P.setXYZ(i + 2, x, y, z); }
      g.computeVertexNormals();
    }
    inner.add("floor", g);
  }
  f.box(inner, "court", -COURT.half, Y + 0.02, COURT.z0, COURT.half, Y + 0.06, COURT.z1);
  const line = (x0: number, z0: number, x1: number, z1: number) => f.box(inner, "courtLine", Math.min(x0, x1) - 0.04, Y + 0.06, Math.min(z0, z1) - 0.04, Math.max(x0, x1) + 0.04, Y + 0.075, Math.max(z0, z1) + 0.04);
  line(-COURT.half, COURT.z0, COURT.half, COURT.z0);
  line(-COURT.half, COURT.z1, COURT.half, COURT.z1);
  line(-COURT.half, COURT.z0, -COURT.half, COURT.z1);
  line(COURT.half, COURT.z0, COURT.half, COURT.z1);
  line(0, COURT.z0, 0, COURT.z1);
  const zc = (COURT.z0 + COURT.z1) / 2;
  const circle = new THREE.RingGeometry(1.52, 1.62, 48).rotateX(-Math.PI / 2).translate(0, Y + 0.068, zc);
  circle.deleteAttribute("uv");
  inner.add("courtLine", f.geom(circle));
  for (const sx of [-1, 1]) {
    line(sx * COURT.half, zc - 1.8, sx * (COURT.half - 4.2), zc - 1.8);
    line(sx * COURT.half, zc + 1.8, sx * (COURT.half - 4.2), zc + 1.8);
    line(sx * (COURT.half - 4.2), zc - 1.8, sx * (COURT.half - 4.2), zc + 1.8);
  }
  // A hoop at each end, facing in.
  for (const sx of [-1, 1]) {
    const [hx, hz] = f.at(sx * (COURT.half + 1.3), zc);
    innerProps.put(hoop, hx, Y, hz, f.dir(-sx, 0));
    col.cyl(hx, Y, hz, 0.45, 3.4, 8);
  }
  s.marks.set("hoops", [-1, 1].map((sx) => f.v(sx * (COURT.half + 1.3 - HOOP.out), Y + HOOP.y, zc)));
  // A bench along the far side, for watching.
  const benches = [-6.5, -2.2, 2.2, 6.5];
  for (const x of benches) {
    const [bx, bz] = f.at(x, COURT.z1 + 0.95);
    innerProps.put(bench, bx, Y, bz, f.dir(0, -1));
    f.cbox(col, x - 1.5, Y, COURT.z1 + 0.65, x + 1.5, Y + 0.45, COURT.z1 + 1.25);
  }
  // Light: cool and bright over the court, and the dome glowing after dark.

  // Slots: shooting hoops on the court (low gravity), a seat on the bench to watch.
  const ids: string[] = [];
  const play: [number, number][] = [[-7.0, zc - 0.8], [-4.2, zc + 1.4], [-1.6, zc - 1.2], [1.8, zc + 1.1], [4.6, zc - 1.3], [7.2, zc + 0.6]];
  play.forEach(([x, z], i) => {
    const [px, pz] = f.at(x, z);
    const toward = x < 0 ? -1 : 1;
    plan.slot("gym", `court-${i + 1}`, [px, Y, pz], f.dir(toward, zc - z + 0.001), { tags: ["sports-dome", "low-g", "leisure", "indoors", "place:in the sports dome", "pastime:shooting hoops"] });
    if (i % 2 === 0) ids.push(plan.node(`court:${i}`, px + 0.0, Y, pz));
  });
  benches.forEach((x, i) => {
    const [bx, bz] = f.at(x + (i % 2 ? 0.7 : -0.7), COURT.z1 + 0.92);
    plan.slot("deck-chair", `stand-${i + 1}`, [bx, Y, bz], f.dir(0, -1), { seat: 0.45, tags: ["sports-dome", "leisure", "indoors", "place:in the sports dome", "pastime:watching the game"] });
    const [nx, nz] = f.at(x + (i % 2 ? 0.7 : -0.7), COURT.z1 - 0.4);
    ids.push(plan.node(`stand:${i}`, nx, Y, nz));
  });
  // The road through: in at each end, along the near side.
  for (const sx of [-1, 1]) {
    const [ox, oz] = f.at(sx * (MID + 6.6), -3.4);
    ids.push(plan.node(`sports:${sx > 0 ? "e" : "w"}-out`, ox, Y, oz));
    const [ix, iz] = f.at(sx * (MID + 1.6), -3.4);
    ids.push(plan.node(`sports:${sx > 0 ? "e" : "w"}-in`, ix, Y, iz));
  }
  for (const x of [-6, 0, 6]) { const [wx, wz] = f.at(x, -3.5); ids.push(plan.node(`sports:walk${x}`, wx, Y, wz)); }
  s.open.push({ ids, reach: 12 });
}
