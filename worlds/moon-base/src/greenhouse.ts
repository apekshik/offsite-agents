// The greenhouse: a long glass tunnel curving along the upper terrace on the north side, white
// arched ribs, shelves of greens three high down both sides under pink grow lights, a walkway
// down the middle, tanks of nutrient at one end. Crew come up here to tend the plants.

import * as THREE from "three";
import { GREENHOUSE, TIER_Y } from "./dims.ts";
import { bigCrate, growShelf } from "./furniture.ts";
import { deg, inward, polar, type P2 } from "./kit.ts";
import type { Base } from "./parts.ts";

const SPRING = 1.3;

/** A point of the tunnel: angle along it, offset across it (+ out from the crater), height. */
function at(a: number, off: number, y: number): THREE.Vector3 {
  const [x, z] = polar(a, GREENHOUSE.r + off);
  return new THREE.Vector3(x, y, z);
}

/** The arch's cross-section: offset across and height, from one foot over to the other. */
function section(n = 14): [number, number][] {
  const w = GREENHOUSE.half, h = GREENHOUSE.h;
  const out: [number, number][] = [[-w, 0], [-w, SPRING]];
  for (let i = 1; i < n; i++) {
    const t = Math.PI - (i / n) * Math.PI;
    out.push([w * Math.cos(t), SPRING + (h - SPRING) * Math.sin(t)]);
  }
  out.push([w, SPRING], [w, 0]);
  return out;
}

export function buildGreenhouse(s: Base) {
  const { pile, inner, col, plan, props, innerProps } = s;
  const Y = TIER_Y[3]!, { a0, a1, half } = GREENHOUSE;
  const sec = section();
  // The glass, swept along the arc (its ends are glass too, round a door).
  const N = 40;
  const gp: number[] = [], gi: number[] = [];
  for (let i = 0; i <= N; i++) {
    const a = a0 + ((a1 - a0) * i) / N;
    for (const [o, y] of sec) { const p = at(a, o, Y + 0.45 + y * (1 - 0.45 / GREENHOUSE.h)); gp.push(p.x, p.y, p.z); }
  }
  const M = sec.length;
  for (let i = 0; i < N; i++) for (let j = 0; j + 1 < M; j++) {
    if (j === 0 || j === M - 2) continue; // the low walls are printed, not glass
    const p = i * M + j, q = p + M;
    gi.push(p, q, q + 1, p, q + 1, p + 1);
  }
  const glass = new THREE.BufferGeometry();
  glass.setAttribute("position", new THREE.Float32BufferAttribute(gp, 3));
  glass.setIndex(gi);
  glass.computeVertexNormals();
  pile.add("greenGlass", glass);
  // A printed plinth along both sides, up to the springing.
  for (const side of [-1, 1]) {
    const run: P2[] = [];
    for (let i = 0; i <= N; i++) { const p = at(a0 + ((a1 - a0) * i) / N, side * (half + 0.05), 0); run.push([p.x, p.z]); }
    for (let i = 0; i + 1 < run.length; i++) {
      const [x0, z0] = run[i]!, [x1, z1] = run[i + 1]!;
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, len = Math.hypot(x1 - x0, z1 - z0);
      pile.obox("printed", mx, Y + (SPRING + 0.45) / 2, mz, 0.5, SPRING + 0.45, len + 0.02, Math.atan2(x1 - x0, z1 - z0));
    }
    col.wall(run, Y, Y + 3.2, 0.5);
  }
  // White arched ribs every couple of metres, a spine along the top.
  const ribs = Math.round(((a1 - a0) * GREENHOUSE.r) / 2.4);
  for (let i = 0; i <= ribs; i++) {
    const a = a0 + ((a1 - a0) * i) / ribs;
    for (let j = 1; j + 2 < M; j++) {
      const [o0, y0] = sec[j]!, [o1, y1] = sec[j + 1]!;
      pile.rod("white", at(a, o0 * 1.01, Y + 0.45 + y0), at(a, o1 * 1.01, Y + 0.45 + y1), 0.075, 5);
    }
  }
  for (let i = 0; i < N; i++) {
    const a = a0 + ((a1 - a0) * i) / N, b = a0 + ((a1 - a0) * (i + 1)) / N;
    pile.rod("white", at(a, 0, Y + GREENHOUSE.h + 0.47), at(b, 0, Y + GREENHOUSE.h + 0.47), 0.1, 6);
    for (const side of [-1, 1]) pile.rod("white", at(a, side * half * 1.01, Y + SPRING + 0.45), at(b, side * half * 1.01, Y + SPRING + 0.45), 0.07, 5);
  }
  // The ends: a glass arch round a door, framed white.
  for (const [a, dir] of [[a0, -1], [a1, 1]] as const) {
    const shape = new THREE.Shape(sec.map(([o, y]) => new THREE.Vector2(o, y)));
    const door = [[-1.1, 0], [-1.1, 2.0], [-0.55, 2.55], [0.55, 2.55], [1.1, 2.0], [1.1, 0]].reverse().map(([x, y]) => new THREE.Vector2(x!, y!));
    // A door through the base reaches the outline: build the end as a ring of panels instead.
    void door;
    const g = new THREE.ShapeGeometry(shape, 6);
    g.deleteAttribute("uv");
    const pos = g.attributes.position!;
    const keep: number[] = [];
    // Map (offset, height) onto the end's plane.
    for (let i = 0; i < pos.count; i++) {
      const p = at(a, pos.getX(i), Y + 0.45 + pos.getY(i));
      pos.setXYZ(i, p.x, p.y, p.z);
    }
    // Leave a doorway in the middle (triangles whose middle is in it).
    const I = g.index!;
    for (let i = 0; i < I.count; i += 3) {
      let ox = 0, oy = 0;
      for (let k = 0; k < 3; k++) {
        const v = I.getX(i + k);
        const p = new THREE.Vector3(pos.getX(v), pos.getY(v), pos.getZ(v));
        const r = Math.hypot(p.x, p.z);
        ox += (r - GREENHOUSE.r) / 3; oy += (p.y - Y - 0.45) / 3;
      }
      if (Math.abs(ox) < 1.3 && oy < 2.7) continue;
      keep.push(I.getX(i), I.getX(i + 1), I.getX(i + 2));
    }
    g.setIndex(keep);
    g.computeVertexNormals();
    pile.add("greenGlass", g);
    // The door's frame.
    for (const o of [-1.25, 1.25]) pile.rod("white", at(a, o, Y), at(a, o, Y + 2.7), 0.09, 6);
    pile.rod("white", at(a, -1.25, Y + 2.7), at(a, 1.25, Y + 2.7), 0.09, 6);
    pile.rod("orange", at(a, -1.2, Y + 2.85), at(a, 1.2, Y + 2.85), 0.05, 5);
    // The end's colliders: either side of the door.
    for (const side of [-1, 1]) {
      const p0 = at(a, side * 1.3, Y), p1 = at(a, side * (half + 0.2), Y);
      col.wall([[p0.x, p0.z], [p1.x, p1.z]], Y, Y + 3.5, 0.3);
    }
    void dir;
  }
  // The floor: a walkway down the middle, beds under the shelves.
  {
    const fp: number[] = [], fi: number[] = [];
    for (let i = 0; i <= N; i++) {
      const a = a0 + ((a1 - a0) * i) / N;
      const p = at(a, -half + 0.2, Y + 0.04), q = at(a, half - 0.2, Y + 0.04);
      fp.push(p.x, p.y, p.z, q.x, q.y, q.z);
    }
    for (let i = 0; i < N; i++) { const p = i * 2, q = p + 2; fi.push(p, q, q + 1, p, q + 1, p + 1); }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(fp, 3));
    g.setIndex(fi);
    g.computeVertexNormals();
    if (g.attributes.normal!.getY(0) < 0) { const I = g.index!; for (let i = 0; i < I.count; i += 3) { const t = I.getX(i + 1); I.setX(i + 1, I.getX(i + 2)); I.setX(i + 2, t); } g.computeVertexNormals(); }
    inner.add("floor", g);
    for (let i = 0; i < N; i++) {
      const a = a0 + ((a1 - a0) * i) / N, b = a0 + ((a1 - a0) * (i + 1)) / N;
      inner.rod("amber", at(a, 0.85, Y + 0.06), at(b, 0.85, Y + 0.06), 0.025, 4);
      inner.rod("amber", at(a, -0.85, Y + 0.06), at(b, -0.85, Y + 0.06), 0.025, 4);
    }
  }

  // Shelves down both sides, facing the walkway; tanks at the west end.
  const len = (a1 - a0) * GREENHOUSE.r;
  const shelves = Math.floor((len - 6) / 2.25);
  const ids: string[] = [];
  for (let i = 0; i < shelves; i++) {
    const a = a0 + (3.2 + i * 2.25 + 1.1) / GREENHOUSE.r;
    for (const side of [-1, 1]) {
      const p = at(a, side * (half - 0.75), Y);
      innerProps.put(growShelf, p.x, Y, p.z, inward(a) + (side > 0 ? 0 : Math.PI));
      const q = at(a, side * (half - 0.75), Y);
      col.obox(q.x, Y + 1.15, q.z, 2.0, 2.3, 0.65, inward(a));
    }
  }
  for (let k = 0; k < 3; k++) {
    const p = at(a0 + (1.2 + k * 0.0) / GREENHOUSE.r, (k - 1) * 1.9, Y);
    if (k === 1) continue;
    inner.cyl("tank", p.x, Y, p.z, 0.5, 2.1, 14);
    inner.cyl("white", p.x, Y + 2.1, p.z, 0.55, 0.15, 14);
    inner.cyl("orange", p.x, Y, p.z, 0.55, 0.25, 14);
    col.cyl(p.x, Y, p.z, 0.55, 2.3, 10);
  }
  {
    const p = at(a1 - 2.0 / GREENHOUSE.r, 1.4, Y);
    innerProps.put(bigCrate, p.x, Y, p.z, inward(a1));
    col.obox(p.x, Y + 0.45, p.z, 1.4, 0.9, 1.0, inward(a1));
  }
  // Places to tend the plants: at the shelves, both sides, spread along.
  const work = [0.18, 0.4, 0.62, 0.84];
  work.forEach((u, i) => {
    const a = a0 + (a1 - a0) * u;
    const side = i % 2 ? 1 : -1;
    const p = at(a, side * (half - 1.6), Y);
    plan.slot("workshop", `greenhouse-${i + 1}`, [p.x, Y, p.z], inward(a) + (side > 0 ? Math.PI : 0), { tags: ["greenhouse", "leisure", "indoors", "place:in the greenhouse", "pastime:tending the plants"] });
    const q = at(a, side * -0.2, Y);
    ids.push(plan.node(`gh:${i}`, q.x, Y, q.z));
  });
  // Light: the grow lights glow pink; after dark the whole tunnel glows from inside.
  const mid = at((a0 + a1) / 2, 0, Y + 3.6);
  s.rooms.push({ x: mid.x, y: mid.y, z: mid.z, intensity: 5, distance: 20, color: "#ff8fe0", always: true });

  // Walking: in at either end, down the middle.
  for (const [a, id, sgn] of [[a0, "w", -1], [a1, "e", 1]] as const) {
    const o = at(a + (sgn * 2.4) / GREENHOUSE.r, 0, Y);
    ids.push(plan.node(`gh:${id}-out`, o.x, Y, o.z));
    const n = at(a - (sgn * 1.2) / GREENHOUSE.r, 0, Y);
    ids.push(plan.node(`gh:${id}-in`, n.x, Y, n.z));
  }
  s.open.push({ ids, reach: 10 });
  void props; void deg;
}
