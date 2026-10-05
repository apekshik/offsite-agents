// The hub dome: the base's social heart on the crater floor, under one glass dome with a white
// geodesic frame. A round cafe counter with stools (someone may play barista), a sunken lounge
// pit round a low table, a chess table, planters along the glass. On the north side, facing out
// over the arrival pad to the terraces and Earth, the captain's console: Computah's big screen,
// its hover pad beside it, and the counter where finished work is dropped off. Tube corridors run
// west and east to small airlock modules; porches open north and south.
//
// The console is here rather than in the work hall: the hub is where everyone passes (new crew
// walk in from the pad, crew come down for coffee), so the captain at the console sees the whole
// base at work, and a delivery is a walk down the switchbacks everyone can watch.

import * as THREE from "three";
import type { Interactable } from "@offsite/kit";
import { HUB } from "./dims.ts";
import { DESK, PORCH, barStool, bigPlant, chessTable, coffeeMachine, loungeEnd, loungeSeat, lowTable, planter, porch, ring, soft, stool } from "./furniture.ts";
import { arc, band, cap, deg, polar, yawOf, type P2 } from "./kit.ts";
import type { Base } from "./parts.ts";

/** The floor inside, a step up from the crater floor. */
export const HUB_FLOOR = 0.36;
/** Where the captain stands at the console (relative to the hub's centre). */
export const HELM = { x: 0, z: -4.4 };
/** The doors: map angles round the hub's centre, and their half-width. */
const DOORS = [0, deg(90), deg(180), deg(270)];
const DOOR_HALF = 1.45;
/** The tubes, west and east: from the hub's wall out to their end modules. */
export const TUBE = { r: 1.8, len: 11, module: 4.6 };
/** The cafe's round counter and the lounge pit, relative to the hub's centre. */
const BAR = { x: -5.4, z: 4.2, r: 2.3, stools: 3.05 };
const PIT = { x: 3.0, z: 4.6, r: 2.9, depth: HUB_FLOOR };

const H = (x: number, z: number): P2 => [HUB.x + x, HUB.z + z];
const HV = (x: number, y: number, z: number) => new THREE.Vector3(HUB.x + x, y, HUB.z + z);

/** The dome's profile: a spherical cap on the sill, `h` high. */
export function domeAt(t: number): { r: number; y: number } {
  // t: 0 at the sill, 1 at the top.
  const Rs = (HUB.r * HUB.r + HUB.h * HUB.h) / (2 * HUB.h), yc = HUB.sill + HUB.h - Rs;
  const p0 = Math.asin(HUB.r / Rs), p = p0 * (1 - t);
  return { r: Rs * Math.sin(p), y: yc + Rs * Math.cos(p) };
}

const inDoor = (a: number, y: number, extra = 0) =>
  DOORS.some((d) => Math.abs(Math.atan2(Math.sin(a - d), Math.cos(a - d))) * HUB.r < DOOR_HALF + 0.35 + extra && y < PORCH.h + 0.3);

export function buildHub(s: Base): Interactable[] {
  const { pile, inner, col, plan, props, innerProps } = s;

  // ---- the dome: glass in a white frame, open where the doors are ----
  const NA = 48, NT = 12;
  const gp: number[] = [], gi: number[] = [];
  for (let i = 0; i <= NT; i++) for (let j = 0; j <= NA; j++) {
    const { r, y } = domeAt(i / NT), a = (j / NA) * Math.PI * 2;
    const [x, z] = polar(a, r);
    gp.push(HUB.x + x, y, HUB.z + z);
  }
  for (let i = 0; i < NT; i++) for (let j = 0; j < NA; j++) {
    const { y } = domeAt((i + 0.5) / NT), a = ((j + 0.5) / NA) * Math.PI * 2;
    if (inDoor(a, y)) continue;
    const p = i * (NA + 1) + j, q = p + NA + 1;
    gi.push(p, p + 1, q + 1, p, q + 1, q);
  }
  const glassG = new THREE.BufferGeometry();
  glassG.setAttribute("position", new THREE.Float32BufferAttribute(gp, 3));
  glassG.setIndex(gi);
  glassG.computeVertexNormals();
  pile.add("hubGlass", glassG);
  // Its frame: meridians and three rings, a crown at the top.
  const RIBS = 24;
  for (let j = 0; j < RIBS; j++) {
    const a = (j / RIBS) * Math.PI * 2;
    for (let i = 0; i < 10; i++) {
      const t0 = i / 10, t1 = (i + 1) / 10;
      const p0 = domeAt(t0), p1 = domeAt(t1);
      if (inDoor(a, p0.y, -0.2)) continue;
      const [x0, z0] = polar(a, p0.r - 0.05), [x1, z1] = polar(a, p1.r - 0.05);
      pile.rod("white", HV(x0, p0.y, z0), HV(x1, p1.y, z1), 0.065, 5);
    }
  }
  for (const t of [0.3, 0.55, 0.78]) {
    const { r, y } = domeAt(t);
    const pts = arc(0, 0, r - 0.04, 0, Math.PI * 2, Math.PI / 32);
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = Math.atan2(pts[i]![0], -pts[i]![1]);
      if (inDoor(a, y, -0.2)) continue;
      pile.rod("white", HV(pts[i]![0], y, pts[i]![1]), HV(pts[i + 1]![0], y, pts[i + 1]![1]), 0.055, 5);
    }
  }
  const crown = domeAt(0.93);
  pile.cyl("white", HUB.x, crown.y - 0.2, HUB.z, crown.r + 0.3, 0.5, 24);
  pile.cyl("amber", HUB.x, crown.y - 0.24, HUB.z, crown.r + 0.1, 0.04, 24);
  // The dome as a collider (coarse), and the sill all round.
  {
    const cp: number[] = [], ci: number[] = [];
    const CA = 32, CT = 6;
    for (let i = 0; i <= CT; i++) for (let j = 0; j <= CA; j++) {
      const { r, y } = domeAt((i / CT) * 0.9), a = (j / CA) * Math.PI * 2;
      const [x, z] = polar(a, r - 0.15);
      cp.push(HUB.x + x, i === 0 ? 0 : y, HUB.z + z);
    }
    for (let i = 0; i < CT; i++) for (let j = 0; j < CA; j++) {
      const { y } = domeAt(((i + 0.5) / CT) * 0.9), a = ((j + 0.5) / CA) * Math.PI * 2;
      if (inDoor(a, y, 0.2)) continue;
      const p = i * (CA + 1) + j, q = p + CA + 1;
      ci.push(p, p + 1, q + 1, p, q + 1, q);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(cp, 3));
    g.setIndex(ci);
    col.add(g);
  }
  // The sill: printed regolith, open at the doors.
  const sill: P2[][] = [];
  let run: P2[] = [];
  for (let j = 0; j <= 96; j++) {
    const a = (j / 96) * Math.PI * 2;
    if (inDoor(a, 0)) { if (run.length > 1) sill.push(run); run = []; continue; }
    run.push(H(...polar(a, HUB.r + 0.12)));
  }
  if (run.length > 1) sill.push(run);
  for (const r of sill) {
    pile.add("printed", band(r, 0, HUB.sill + 0.05, { left: true }));
    pile.add("printed", band(r.map(([x, z]) => [HUB.x + (x - HUB.x) * 0.965, HUB.z + (z - HUB.z) * 0.965] as P2), HUB_FLOOR, HUB.sill + 0.05));
    for (let i = 0; i + 1 < r.length; i++) {
      const [x0, z0] = r[i]!, [x1, z1] = r[i + 1]!;
      const ix0 = HUB.x + (x0 - HUB.x) * 0.965, iz0 = HUB.z + (z0 - HUB.z) * 0.965, ix1 = HUB.x + (x1 - HUB.x) * 0.965, iz1 = HUB.z + (z1 - HUB.z) * 0.965;
      pile.add("printed", cap([[x0, z0], [x1, z1], [ix1, iz1], [ix0, iz0]], HUB.sill + 0.05));
    }
    s.col.wall(r, 0, 1.2, 0.5);
  }
  // The porches at the doors; the west and east ones lead into the tubes.
  for (const a of DOORS) {
    const [x, z] = H(...polar(a, HUB.r - 0.9));
    props.put(porch, x, 0, z, -a + Math.PI);
    // The porch's sides, as colliders.
    for (const sx of [-1, 1]) {
      const [px, pz] = H(...polar(a + (sx * (PORCH.w / 2 - 0.15)) / HUB.r, HUB.r + 0.6));
      col.obox(px, 1.4, pz, 0.4, 2.8, PORCH.d + 1.0, -a);
    }
  }

  // ---- the floor: a step up, with the lounge pit sunk into it ----
  const edge = arc(HUB.x, HUB.z, HUB.r - 0.25, 0, Math.PI * 2, Math.PI / 48).slice(0, -1);
  const pitEdge = arc(HUB.x + PIT.x, HUB.z + PIT.z, PIT.r, 0, Math.PI * 2, Math.PI / 24).slice(0, -1);
  inner.add("floor", cap(edge, HUB_FLOOR, false, [pitEdge]));
  inner.add("printed", band([...edge, edge[0]!], 0, HUB_FLOOR, { left: true }));
  inner.add("printed", band([...pitEdge, pitEdge[0]!], 0, HUB_FLOOR));
  inner.add("pad", cap(pitEdge, 0.02));
  col.floor(edge, HUB_FLOOR, HUB_FLOOR, [pitEdge]);
  // A ring of amber light round the floor's edge (broken at the doors), and round the pit's rim.
  const glowRing = (pts: P2[], doors: boolean) => {
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x0, z0] = pts[i]!, [x1, z1] = pts[i + 1]!;
      if (doors && inDoor(Math.atan2(x0 - HUB.x, -(z0 - HUB.z)), 0)) continue;
      inner.rod("amber", new THREE.Vector3(x0, HUB_FLOOR + 0.01, z0), new THREE.Vector3(x1, HUB_FLOOR + 0.01, z1), 0.03, 4);
    }
  };
  glowRing(arc(HUB.x, HUB.z, HUB.r - 0.6, 0, Math.PI * 2, Math.PI / 48), true);
  glowRing(arc(HUB.x + PIT.x, HUB.z + PIT.z, PIT.r + 0.12, 0, Math.PI * 2, Math.PI / 24), false);

  // ---- the console: Computah's big screen, facing whoever stands at it ----
  const hx = HUB.x + HELM.x, hz = HUB.z + HELM.z, y = HUB_FLOOR;
  const R = 3.3, cz = hz + 1.5;
  const arcG = (r0: number, r1: number, a0: number, a1: number, y0: number, y1: number) => {
    const shape = new THREE.Shape(), n = 24;
    for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; shape[i ? "lineTo" : "moveTo"](hx + Math.sin(a) * r1, -cz + Math.cos(a) * r1); }
    for (let i = n; i >= 0; i--) { const a = a0 + ((a1 - a0) * i) / n; shape.lineTo(hx + Math.sin(a) * r0, -cz + Math.cos(a) * r0); }
    const g = new THREE.ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: false, curveSegments: 1 }).rotateX(-Math.PI / 2).translate(0, y0, 0);
    g.deleteAttribute("uv");
    return g;
  };
  // (The shape's +y is -z on the map: the arc curves round in front of the captain, to the north.)
  inner.add("white", arcG(R - 0.34, R + 0.34, -1.05, 1.05, y, y + 0.86));
  inner.add("orange", arcG(R - 0.4, R + 0.42, -1.08, 1.08, y + 0.86, y + 0.93));
  for (const [a0, a1] of [[-0.95, -0.55], [-0.42, -0.28], [0.28, 0.42], [0.55, 0.95]] as const) inner.add("glowBlue", arcG(R - 0.2, R + 0.15, a0, a1, y + 0.93, y + 0.945));
  col.box(hx - R, y, cz - R - 0.45, hx + R, y + 1.0, cz - R + 0.75);
  // The big screen on a white stand, tilted back toward the captain.
  const screenZ = cz - R - 0.2;
  s.screens.push({ id: "helm", kind: "board", w: 2.6, h: 1.1, pos: new THREE.Vector3(hx, y + 1.62, screenZ + 0.04), quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.16, 0, 0)), brightness: 1.15 });
  inner.obox("dark", hx, y + 1.62, screenZ, 2.75, 1.24, 0.07, 0, -0.16);
  inner.obox("orange", hx, y + 2.27, screenZ - 0.1, 2.8, 0.08, 0.1, 0, -0.16);
  inner.box("white", hx - 0.12, y + 0.9, screenZ - 0.2, hx + 0.12, y + 1.05, screenZ + 0.0);
  for (const sx of [-1, 1]) innerProps.put(stool, hx + sx * 1.55, y, hz + 0.25, Math.PI);
  // Computah's hover pad, east of the console.
  const comp = { x: hx + 3.7, z: hz + 1.0 };
  ring(inner, "glowBlue", new THREE.Vector3(comp.x, y + 0.03, comp.z), "y", 0.55, 0.035, 32);
  inner.cyl("dark", comp.x, y, comp.z, 0.5, 0.025, 24);
  // The drop-off: a white counter west of the console, lit underneath.
  const drop = { x: hx - 4.3, z: hz + 1.6 };
  const cw = 3.9, cy = drop.z - 1.05;
  inner.box("white", drop.x - cw / 2, y, cy - 0.3, drop.x + cw / 2, y + 0.9, cy + 0.3);
  inner.box("orange", drop.x - cw / 2 - 0.02, y + 0.9, cy - 0.34, drop.x + cw / 2 + 0.02, y + 0.95, cy + 0.34);
  inner.box("amber", drop.x - cw / 2 + 0.05, y + 0.84, cy + 0.33, drop.x + cw / 2 - 0.05, y + 0.87, cy + 0.35);
  col.box(drop.x - cw / 2, y, cy - 0.3, drop.x + cw / 2, y + 1.0, cy + 0.3);

  // ---- the cafe: a round counter, stools round its front, a shelf of greens behind ----
  const bx = HUB.x + BAR.x, bz = HUB.z + BAR.z;
  const segs = 14, a0 = deg(-20), a1 = deg(250);
  for (let i = 0; i < segs; i++) {
    const a = a0 + ((i + 0.5) / segs) * (a1 - a0);
    const [ox, oz] = polar(a, BAR.r);
    const x = bx + ox, z = bz + oz, yaw = -a;
    const w = (BAR.r * (a1 - a0)) / segs + 0.05;
    inner.obox("white", x, y + 0.52, z, w, 1.04, 0.5, yaw);
    inner.obox("orange", x, y + 0.2, z, w + 0.01, 0.08, 0.52, yaw);
    const [tx, tz] = polar(a, BAR.r + 0.08);
    inner.obox("cushion", bx + tx, y + 1.08, bz + tz, w + 0.02, 0.06, 0.74, yaw);
    col.obox(x, y + 0.55, z, w, 1.1, 0.55, yaw);
  }
  inner.cyl("white", bx, y, bz, 0.8, 2.6, 20);
  for (const hh of [1.25, 1.8]) {
    inner.cyl("white", bx, y + hh, bz, 1.0, 0.04, 20);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const [px, pz] = polar(a, 0.9);
      const g = new THREE.IcosahedronGeometry(0.11, 0);
      g.deleteAttribute("uv");
      inner.add("leaf", g.translate(bx + px, y + hh + 0.12, bz + pz));
    }
  }
  col.cyl(bx, y, bz, 0.85, 2.6, 12);
  const [mx, mz] = polar(deg(100), BAR.r + 0.05);
  innerProps.put(coffeeMachine, bx + mx, y + 1.11, bz + mz, -deg(100) + Math.PI);
  s.marks.set("coffee", [new THREE.Vector3(bx + mx, y + 1.6, bz + mz)]);
  for (let i = 0; i < 6; i++) {
    const a = deg(20 + i * 28);
    const [ox, oz] = polar(a, BAR.stools);
    const x = bx + ox, z = bz + oz;
    innerProps.put(barStool, x, y, z);
    plan.slot("bar-stool", `cafe-stool-${i + 1}`, [x, y, z], yawOf(bx - x, bz - z), { seat: 0.76, tags: ["hub", "bar", "indoors", "place:in the hub dome", "pastime:at the cafe"] });
  }

  // ---- the lounge pit: seats round a low table, a step down ----
  const px = HUB.x + PIT.x, pz = HUB.z + PIT.z;
  innerProps.put(lowTable, px, 0, pz);
  innerProps.put(bigPlant, px, 0.41, pz, 0, 0.55);
  col.cyl(px, 0, pz, 0.62, 0.45, 12);
  const seats = 8;
  for (let i = 0; i < seats; i++) {
    const a = (i / seats) * Math.PI * 2 + deg(22.5);
    const [ox, oz] = polar(a, PIT.r - 0.55);
    const x = px + ox, z = pz + oz;
    // The way down into the pit, from the hub's centre: no seat there, a planter block either side.
    if (i === 6) continue;
    if (i === 5 || i === 7) {
      const [ex, ez] = polar(a + (i === 5 ? 1 : -1) * deg(19), PIT.r - 0.5);
      innerProps.put(loungeEnd, px + ex, 0, pz + ez, yawOf(-ex, -ez) + Math.PI / 2);
    }
    innerProps.put(loungeSeat, x, 0, z, yawOf(px - x, pz - z));
    plan.slot("deck-chair", `pit-seat-${i + 1}`, [x + (px - x) * 0.04, 0, z + (pz - z) * 0.04], yawOf(px - x, pz - z), { seat: 0.42, tags: ["hub", "lounge", "leisure", "indoors", "place:in the hub dome", "pastime:in the lounge pit"] });
  }
  // The seats' backs, as a low wall round the pit (open at the way in).
  const backs = arc(px, pz, PIT.r - 0.1, deg(22.5 + 45 * 6 + 22), deg(22.5 + 45 * 6 + 360 - 22), Math.PI / 24);
  col.wall(backs, 0, HUB_FLOOR + 0.5, 0.25);

  // ---- the chess table, south-west, two stools ----
  const chx = HUB.x - 2.6, chz = HUB.z + 8.6;
  innerProps.put(chessTable, chx, y, chz);
  col.cyl(chx, y, chz, 0.42, 0.8, 10);
  for (const sx of [-1, 1]) {
    const x = chx + sx * 0.95;
    innerProps.put(stool, x, y, chz, sx > 0 ? Math.PI / 2 : -Math.PI / 2);
    plan.slot("deck-chair", `chess-${sx > 0 ? "e" : "w"}`, [x, y, chz], yawOf(-sx, 0), { seat: 0.47, tags: ["hub", "table", "leisure", "indoors", "place:in the hub dome", "pastime:playing chess"] });
  }

  // ---- planters and plants along the glass ----
  for (const ad of [35, 60, 120, 145, 205, 300, 325]) {
    const a = deg(ad), [x, z] = H(...polar(a, HUB.r - 1.35));
    innerProps.put(planter, x, y, z, -a + Math.PI / 2);
    col.obox(x, y + 0.4, z, 1.65, 0.8, 0.65, -a + Math.PI / 2);
  }
  for (const ad of [48, 132, 312]) {
    const a = deg(ad), [x, z] = H(...polar(a, HUB.r - 2.6));
    innerProps.put(bigPlant, x, y, z, ad);
    col.cyl(x, y, z, 0.35, 1.2, 8);
  }

  // ---- light: warm, from the crown and round the walls ----
  s.rooms.push({ x: HUB.x, y: 7.5, z: HUB.z, intensity: 14, distance: 22, color: "#ffd6a6" });
  s.rooms.push({ x: bx, y: 3.4, z: bz, intensity: 6, distance: 8, color: "#ffc98c" });
  for (const ad of [0, 90, 180, 270]) {
    const [x, z] = H(...polar(deg(ad + 45), HUB.r - 0.7));
    s.halos.push({ x, y: HUB_FLOOR + 0.25, z, color: "#ffb35a", size: 0.4, mode: "night" });
  }

  // ---- walking ----
  const ids: string[] = [];
  const node = (id: string, x: number, z: number, yy = y) => { ids.push(plan.node(id, HUB.x + x, yy, HUB.z + z)); return id; };
  node("hub:c", 0, 0.6);
  node("hub:helm", HELM.x, HELM.z + 0.7);
  node("hub:comp", 2.4, -2.0);
  node("hub:drop", HELM.x - 4.3, HELM.z + 2.4);
  node("hub:n", 0, -8.2); node("hub:s", 0, 9.4); node("hub:w", -9.6, 0); node("hub:e", 9.6, 0);
  node("hub:sw", -6.4, 8.0); node("hub:se", 6.6, 8.6); node("hub:nw", -6.8, -5.2); node("hub:ne", 6.8, -5.0);
  node("hub:bar-e", BAR.x + 3.9, BAR.z - 0.2); node("hub:bar-n", BAR.x + 0.4, BAR.z - 3.9); node("hub:bar-s", BAR.x + 1.6, BAR.z + 3.7);
  node("hub:bar-back", BAR.x - 3.6, BAR.z + 0.6);
  node("hub:chess", -2.6, 7.0);
  node("hub:pit-in", PIT.x + Math.sin(deg(22.5 + 270)) * (PIT.r + 0.9), PIT.z - Math.cos(deg(22.5 + 270)) * (PIT.r + 0.9));
  node("hub:pit", PIT.x + Math.sin(deg(22.5 + 270)) * 1.35, PIT.z - Math.cos(deg(22.5 + 270)) * 1.35, 0);
  plan.link("hub:pit-in", "hub:pit");
  // Out through the porches.
  for (const [id, a] of [["n", 0], ["s", 180]] as const) {
    const [x, z] = polar(deg(a), HUB.r + PORCH.d + 1.2);
    node(`hub:${id}-out`, x, z, 0);
    plan.link(`hub:${id}`, `hub:${id}-out`);
  }
  s.open.push({ ids: ids.filter((i) => !i.endsWith("-out") && i !== "hub:pit"), reach: 14 });

  // ---- the tubes, west and east, and their end modules ----
  for (const side of [-1, 1] as const) buildTube(s, side);

  return [{ id: "helm", label: "Open the console", at: new THREE.Vector3(hx, y + 1.3, hz - 0.6), radius: 2.4 }];
}

/** Slots at the console, for Computah and the drop-off (after the walking graph has its nodes). */
export function hubSlots(s: Base) {
  const y = HUB_FLOOR, hx = HUB.x + HELM.x, hz = HUB.z + HELM.z;
  s.plan.slot("helm", "helm", [hx, y, hz], Math.PI, { nav: "hub:helm", tags: ["hub", "indoors", "place:in the hub dome"] });
  const comp = { x: hx + 3.7, z: hz + 1.0 };
  s.plan.slot("computer", "computer", [comp.x, y, comp.z], yawOf(hx - comp.x, hz + 3 - comp.z), { nav: "hub:comp", tags: ["hub", "indoors", "place:in the hub dome"] });
  s.plan.slot("dropoff", "dropoff", [hx - 4.3, y, hz + 1.6], Math.PI, { nav: "hub:drop", tags: ["hub", "indoors", "place:in the hub dome", "pastime:delivering to the hub"] });
  s.plan.slot("captain-spawn", "captain-spawn", [HUB.x, y, HUB.z + 1.2], Math.PI, { nav: "hub:c", tags: ["hub"] });
}

/** A tube corridor out of the hub (west -1, east +1) to a small airlock module, and its way out. */
function buildTube(s: Base, side: -1 | 1) {
  const { pile, inner, col, plan, props } = s;
  const y = HUB_FLOOR, r = TUBE.r;
  const x0 = HUB.x + side * (HUB.r - 0.6), x1 = HUB.x + side * (HUB.r + TUBE.len);
  const z = HUB.z;
  const xa = Math.min(x0, x1), xb = Math.max(x0, x1);
  // The tube: a white shell (outside), its inside lit warm, ribs every 1.5 m, a row of small windows down each side.
  const shell = new THREE.CylinderGeometry(r, r, xb - xa, 20, 1, true, 0, Math.PI).rotateZ(Math.PI / 2);
  shell.deleteAttribute("uv");
  // (Half a cylinder from one side round over the top to the other: lift it so its sides meet the floor.)
  shell.translate((xa + xb) / 2, y + 0.4, z);
  pile.add("white", shell);
  const inside = shell.clone();
  {
    const n = inside.attributes.normal!;
    for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
    const I = inside.index!;
    for (let i = 0; i < I.count; i += 3) { const t = I.getX(i + 1); I.setX(i + 1, I.getX(i + 2)); I.setX(i + 2, t); }
  }
  inner.add("whiteIn", inside.scale(1, 1, 1));
  for (let x = xa + 0.6; x < xb; x += 1.5) ring(pile, "white", new THREE.Vector3(x, y + 0.4, z), "x", r + 0.04, 0.09, 20);
  // Small round windows where the shell is 1.2 m above its springing, tilted to its curve.
  const wz = Math.sqrt(r * r - 1.2 * 1.2) + 0.03, tilt = Math.asin(1.2 / r);
  for (let x = xa + 1.4; x < xb - 0.6; x += 2.2) for (const sz of [-1, 1]) {
    s.pile.add("viewport", new THREE.CircleGeometry(0.28, 14).rotateX(-tilt).rotateY(sz > 0 ? 0 : Math.PI).translate(x, y + 1.6, z + sz * wz));
  }
  // Its walls: straight sides up to the curve, a skirt down to the ground.
  for (const sz of [-1, 1]) pile.box("white", xa, 0, z + sz * r - 0.12, xb, y + 0.42, z + sz * r + 0.12);
  inner.box("floor", xa, y - 0.04, z - r + 0.12, xb, y, z + r - 0.12);
  inner.box("amber", xa + 0.3, y + 0.4 + r - 0.06, z - 0.08, xb - 0.3, y + 0.4 + r - 0.03, z + 0.08);
  col.box(xa, 0, z - r + 0.1, xb, y, z + r - 0.1);
  for (const sz of [-1, 1]) col.box(xa, y, z + sz * (r - 0.35) - 0.15, xb, y + 2.6, z + sz * (r - 0.35) + 0.15);
  // The module at the far end: a printed block with a porch out to the floor.
  const m = TUBE.module, mx = x1 + side * (m / 2 - 0.3);
  pile.box("printed", mx - m / 2, 0, z - m / 2, mx + m / 2, 3.6, z + m / 2);
  pile.box("white", mx - m / 2 - 0.05, 3.6, z - m / 2 - 0.05, mx + m / 2 + 0.05, 3.85, z + m / 2 + 0.05);
  pile.box("orange", mx - m / 2 - 0.06, 3.3, z - m / 2 - 0.06, mx + m / 2 + 0.06, 3.42, z + m / 2 + 0.06);
  for (const sz of [-1, 1]) {
    pile.add("viewport", new THREE.CircleGeometry(0.42, 16).rotateY(sz > 0 ? 0 : Math.PI).translate(mx, 2.0, z + sz * (m / 2 + 0.01)));
  }
  props.put(porch, mx + side * (m / 2 - 0.25), 0, z, side * Math.PI / 2);
  inner.box("floor", mx - m / 2 + 0.2, y - 0.04, z - m / 2 + 0.2, mx + m / 2 - 0.2, y, z + m / 2 - 0.2);
  col.box(mx - m / 2, 0, z - m / 2, mx + m / 2, y, z + m / 2);
  for (const sz of [-1, 1]) col.box(mx - m / 2, y, z + sz * (m / 2 - 0.15) - 0.2, mx + m / 2, 3.6, z + sz * (m / 2 - 0.15) + 0.2);
  // The far wall, open at the porch.
  for (const sz of [-1, 1]) col.box(mx + side * (m / 2 - 0.2) - 0.15, y, z + sz * 1.2, mx + side * (m / 2 - 0.2) + 0.15, 3.6, z + sz * (m / 2)) ;
  inner.box("whiteIn", mx - m / 2 + 0.2, 3.3, z - m / 2 + 0.2, mx + m / 2 - 0.2, 3.35, z + m / 2 - 0.2);
  // Walking: down the tube and out.
  const n = side > 0 ? "e" : "w";
  plan.node(`tube-${n}:in`, HUB.x + side * (HUB.r - 0.2), y, z);
  plan.node(`tube-${n}:mid`, (x0 + x1) / 2, y, z);
  plan.node(`tube-${n}:mod`, mx, y, z);
  plan.node(`tube-${n}:out`, mx + side * (m / 2 + PORCH.d + 1.0), 0, z);
  plan.link(`hub:${n}`, `tube-${n}:in`, `tube-${n}:mid`, `tube-${n}:mod`, `tube-${n}:out`);
  void DESK; void soft;
}
