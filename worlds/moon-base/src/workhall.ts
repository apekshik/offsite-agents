// The work hall: the crew's office, dug into the north-west terrace wall behind a printed facade
// of small round viewports and an arched airlock porch. You come in onto a mezzanine at terrace
// level and look down into a double-height hall: pods of three desks turned every which way with
// wide gaps between them (no rows all facing one way), a big board on the back wall, lockers and
// suits under the mezzanine, white ribs across the ceiling with the lights between them. It sits
// under the terrace above, so it is bigger on the inside than any hab looks from out on the road.

import * as THREE from "three";
import { TIER_Y, WORK_HALL, dugFrame, facadeTop } from "./dims.ts";
import { DESK, PORCH, bigCrate, bigPlant, crate, desk, lockers, loungeSeat, lowTable, porch, stool, suit } from "./furniture.ts";
import { facade, joinRoad, rail, steps, workstation, type Base, type Hole } from "./parts.ts";

/** The hall's own measurements, in its frame (x along the facade, z into the hill). */
export const HALL = { half: 17.7, depth: 20, floor: TIER_Y[1]! - 3.6, mezD: 4.6, ceil: TIER_Y[2]! - 0.6, thick: 0.5 };

const POD_RINGS = 2.1;
/** Pods of three desks: centre (x, z) and how they're turned. */
const PODS: [number, number, number][] = [
  [-10, 8.6, 0.3], [0, 8.4, 1.4], [10, 8.6, 2.5],
  [-14.0, 16.0, 0.9], [-4.8, 15.8, 2.0], [4.8, 16.0, 0.1], [14.0, 16.0, 1.7],
];
/** Desks along the mezzanine, looking out of the viewports. */
const MEZ_DESKS = [-13, -9, -5];

export function buildWorkHall(s: Base) {
  const f = dugFrame(WORK_HALL);
  const { inner, col, plan, innerProps, props } = s;
  const Y = f.y, F = HALL.floor, C = HALL.ceil, H = HALL.half, D = HALL.depth, T = HALL.thick;
  const W = WORK_HALL.w / 2, DUG_FACADE_TOP = facadeTop(WORK_HALL);

  // ---- the facade: printed, a porch in the middle, small round viewports either side ----
  const ports: Hole[] = [3.9, 7.5, 11.1, 14.7].flatMap((x) => [{ port: [x, Y + 1.9, 0.62] as [number, number, number] }, { port: [-x, Y + 1.9, 0.62] as [number, number, number] }]);
  const door: Hole = { door: [0, Y, 2.5, 3.1] };
  facade(s, f, { outline: [[-W, Y], [W, Y], [W, DUG_FACADE_TOP], [-W, DUG_FACADE_TOP]], holes: [...ports, door], thick: T, outMat: "printed", inMat: "inWall", inY: [F, C], glass: "hubGlass" });
  // White pilasters and an orange band across it, the way the art's facades are trimmed.
  for (const x of [-W + 0.4, -9.3, -5.7, 5.7, 9.3, W - 0.4]) f.box(s.pile, "white", x - 0.25, Y, -0.12, x + 0.25, DUG_FACADE_TOP - 0.3, 0.0);
  f.box(s.pile, "orange", -W, DUG_FACADE_TOP - 0.55, -0.14, W, DUG_FACADE_TOP - 0.35, 0.0);
  f.box(s.pile, "amber", -W + 0.6, Y + 0.05, -0.1, -1.7, Y + 0.12, -0.02);
  f.box(s.pile, "amber", 1.7, Y + 0.05, -0.1, W - 0.6, Y + 0.12, -0.02);
  // The porch out onto the terrace.
  const [px, pz] = f.at(0, 0.2);
  props.put(porch, px, Y, pz, f.yaw(Math.PI));
  for (const sx of [-1, 1]) f.cbox(col, sx * (PORCH.w / 2 - 0.25) - 0.2, Y, -PORCH.d, sx * (PORCH.w / 2 - 0.25) + 0.2, Y + PORCH.h, 0);
  // The facade as a collider, open at the door.
  f.cbox(col, -W, Y, 0, -1.3, DUG_FACADE_TOP, T);
  f.cbox(col, 1.3, Y, 0, W, DUG_FACADE_TOP, T);
  f.cbox(col, -1.3, Y + 3.1, 0, 1.3, DUG_FACADE_TOP, T);

  // ---- the shell inside: walls, ceiling, floors ----
  for (const sx of [-1, 1]) {
    f.box(inner, "inWall", sx * H, F - 0.3, T, sx * (H + 0.3), C + 0.2, D);
    f.cbox(col, sx * H, F - 0.3, 0, sx * (H + 0.4), C + 0.4, D + 0.3);
  }
  f.box(inner, "inWall", -H - 0.3, F - 0.3, D, H + 0.3, C + 0.2, D + 0.3);
  f.cbox(col, -H - 0.3, F - 0.3, D, H + 0.3, C + 0.4, D + 0.4);
  f.box(inner, "whiteIn", -H - 0.3, C, T - 0.2, H + 0.3, C + 0.25, D + 0.3);
  f.cbox(col, -H - 0.3, C, 0, H + 0.3, C + 0.4, D + 0.3);
  f.box(inner, "floor", -H, F - 0.3, T, H, F, D);
  f.cbox(col, -H, F - 0.6, 0, H, F, D);
  // The mezzanine: a slab across the front at terrace level, an orange edge, light under its lip.
  f.box(inner, "floor", -H, Y - 0.3, 0, H, Y, HALL.mezD);
  f.box(inner, "orange", -H, Y - 0.32, HALL.mezD - 0.02, H, Y - 0.08, HALL.mezD + 0.04);
  f.box(inner, "amber", -H + 0.2, Y - 0.36, HALL.mezD - 0.3, H - 0.2, Y - 0.32, HALL.mezD - 0.1);
  f.cbox(col, -H, Y - 0.3, -0.05, H, Y, HALL.mezD);
  for (const x of [-11.5, -5.8, 5.8, 11.5]) {
    f.box(inner, "white", x - 0.22, F, HALL.mezD - 0.45, x + 0.22, Y - 0.3, HALL.mezD - 0.01);
    f.cbox(col, x - 0.22, F, HALL.mezD - 0.45, x + 0.22, Y - 0.3, HALL.mezD - 0.01);
  }
  // Its rail, open where the stairs go down at each end.
  rail(inner, col, f.run([[-14.05, HALL.mezD - 0.08], [14.05, HALL.mezD - 0.08]]), Y);
  for (const sx of [-1, 1]) rail(inner, col, f.run([[sx * 16.35, HALL.mezD - 0.08], [sx * (H - 0.05), HALL.mezD - 0.08]]), Y);
  const stairs = [-1, 1].map((sx) => steps(s, { id: `hall-stair-${sx > 0 ? "e" : "w"}`, x0: sx * 14.2, x1: sx * 16.2, zLow: 9.9, yLow: F, zHigh: HALL.mezD, yHigh: Y, at: (x, z) => f.at(x, z) }));

  // Ribs across the ceiling, the lights between them, orange pipes along the walls.
  for (let x = -15; x <= 15; x += 6) f.box(inner, "white", x - 0.28, C - 0.55, T, x + 0.28, C, D);
  for (let x = -12; x <= 12; x += 6) f.box(inner, "panel", x - 0.7, C - 0.07, 1.5, x + 0.7, C - 0.01, D - 1.5);
  for (const sx of [-1, 1]) for (const yy of [C - 0.9, C - 1.25]) {
    const a = f.v(sx * (H - 0.18), yy, 1.0), b = f.v(sx * (H - 0.18), yy, D - 0.5);
    inner.rod("orange", a, b, 0.07, 8);
  }
  // Status strips at the foot of the walls: cyan as the crew get going.
  for (const sx of [-1, 1]) f.box(inner, "status", sx * (H - 0.02), F + 0.1, HALL.mezD + 0.3, sx * (H - 0.06), F + 0.16, D - 0.3);
  f.box(inner, "status", -H + 0.3, F + 0.1, D - 0.06, H - 0.3, F + 0.16, D - 0.02);

  // The big board on the back wall: the ship at a glance (the app paints it), in a dark frame.
  s.screens.push({ id: "wall", kind: "board", w: 7.2, h: 2.9, pos: f.v(0, F + 4.4, D - 0.06), quat: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), f.yaw(Math.PI)), brightness: 1.1 });
  f.box(inner, "dark", -3.85, F + 2.8, D - 0.05, 3.85, F + 6.0, D);
  f.box(inner, "orange", -3.9, F + 6.0, D - 0.08, 3.9, F + 6.12, D);
  // Two smaller screens of code on the side walls, just for the look of it.
  for (const sx of [-1, 1]) {
    s.screens.push({ id: `hall-code-${sx > 0 ? "e" : "w"}`, kind: "code", w: 2.6, h: 1.5, pos: f.v(sx * (H - 0.04), F + 3.2, 13), quat: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), f.yaw(-sx * Math.PI / 2)) });
    f.box(inner, "dark", sx * (H - 0.03), F + 2.35, 11.6, sx * H, F + 4.05, 14.4);
  }

  // ---- the desks: pods of three on the floor, a row along the mezzanine ----
  let n = 0;
  const kit = { desk, stool, w: DESK.w, dd: DESK.d, h: DESK.h, screen: DESK.screen };
  const ids: string[] = [];
  PODS.forEach(([cx, cz, rot], i) => {
    const gaps: string[] = [];
    for (let k = 0; k < 3; k++) {
      const g = rot + (k * 2 * Math.PI) / 3 + Math.PI / 3;
      const lx = Math.max(-H + 1.2, Math.min(H - 1.2, cx + Math.sin(g) * 3.4)), lz = Math.max(5.4, Math.min(D - 1.0, cz + Math.cos(g) * 3.4));
      const [gx, gz] = f.at(lx, lz);
      gaps.push(plan.node(`hall:p${i}g${k}`, gx, F, gz));
    }
    ids.push(...gaps);
    for (let k = 0; k < 3; k++) {
      const phi = rot + (k * 2 * Math.PI) / 3;
      const [dx, dz] = f.at(cx + Math.sin(phi) * POD_RINGS, cz + Math.cos(phi) * POD_RINGS);
      const id = `desk-${String(++n).padStart(2, "0")}`;
      workstation(s, id, dx, F, dz, f.yaw(phi + Math.PI), { nav: gaps[k]!, tags: ["work-hall", "office", "indoors", "place:in the work hall"] }, kit);
    }
    // A lamp post in the middle of each pod, where the monitors' backs meet.
    const [mx, mz] = f.at(cx, cz);
    inner.cyl("white", mx, F, mz, 0.12, 2.2, 10);
    inner.cyl("amber", mx, F + 2.2, mz, 0.22, 0.12, 12);
    col.cyl(mx, F, mz, 0.15, 2.3, 8);
  });
  for (const x of MEZ_DESKS) {
    const [dx, dz] = f.at(x, 1.15);
    const id = `desk-${String(++n).padStart(2, "0")}`;
    const [nx, nz] = f.at(x, 3.4);
    const nav = plan.node(`hall:m${x}`, nx, Y, nz);
    ids.push(nav);
    workstation(s, id, dx, Y, dz, f.yaw(0), { nav, tags: ["work-hall", "office", "mezzanine", "indoors", "place:in the work hall"] }, kit);
  }
  // A lounge corner on the mezzanine, looking out: for anyone who'd rather work on a laptop.
  for (const x of [6.2, 8.8, 11.4]) {
    const [lx, lz] = f.at(x, 1.35);
    innerProps.put(loungeSeat, lx, Y, lz, f.yaw(Math.PI));
    const [nx, nz] = f.at(x, 3.4);
    const nav = plan.node(`hall:l${x}`, nx, Y, nz);
    ids.push(nav);
    plan.slot("deck-chair", `hall-lounge-${x}`, [lx, Y, lz], f.yaw(Math.PI), { seat: 0.42, nav, tags: ["work-hall", "mezzanine", "indoors", "place:in the work hall"] });
    f.cbox(col, x - 0.45, Y, 0.85, x + 0.45, Y + 0.45, 1.85);
  }
  {
    const [tx, tz] = f.at(13.6, 1.4);
    innerProps.put(lowTable, tx, Y, tz);
    const [bx, bz] = f.at(15.6, 1.2);
    innerProps.put(bigPlant, bx, Y, bz, 0.4, 0.9);
    f.cbox(col, 13.0, Y, 0.8, 14.2, Y + 0.5, 2.0);
  }

  // ---- under the mezzanine: lockers, suits on their stands, cases ----
  for (const x of [-15.4, -13.2, -11.0]) { const [wx, wz] = f.at(x, 0.85); innerProps.put(lockers, wx, F, wz, f.yaw(0)); }
  f.cbox(col, -16.5, F, 0.5, -9.9, F + 2.1, 1.2);
  for (const x of [8.0, 9.3, 10.6, 11.9]) { const [wx, wz] = f.at(x, 0.95); innerProps.put(suit, wx, F, wz, f.yaw(0)); }
  f.cbox(col, 7.4, F, 0.6, 12.5, F + 2.0, 1.3);
  for (const [x, z, big] of [[-7.5, 1.0, 1], [-6.4, 1.1, 0], [-3.5, 0.9, 0], [3.0, 1.0, 1], [14.5, 1.1, 0], [16.4, 6.0, 1], [-16.4, 6.2, 0], [16.5, 19.0, 0]] as const) {
    const [wx, wz] = f.at(x, z);
    innerProps.put(big ? bigCrate : crate, wx, F, wz, f.yaw(0.3 * x));
    f.cbox(col, x - 0.6, F, z - 0.5, x + 0.6, F + (big ? 0.86 : 0.62), z + 0.5);
  }

  // ---- light: the panels, and real lights over the floor at night (brighter with work on) ----
  for (const x of [-7, 7]) { const p = f.v(x, C - 1.0, 12); s.rooms.push({ x: p.x, y: p.y, z: p.z, intensity: 12, distance: 20, color: "#ffe2bf", busy: 0.5 }); }

  // ---- walking: in through the porch, along the mezzanine, down the stairs, between the pods ----
  const porchOut = plan.node("hall:porch", ...xyz(f, 0, Y, -3.3));
  const doorIn = plan.node("hall:in", ...xyz(f, 0, Y, 1.7));
  plan.link(porchOut, doorIn);
  joinRoad(s, porchOut, "t1:");
  const mez = [-15.2, -11, -7, -3, 0, 3, 7, 15.2].map((x) => plan.node(`hall:mz${x}`, ...xyz(f, x, Y, 3.5)));
  const floor: string[] = [];
  for (const z of [5.6, 12.4, 19.2]) for (let x = -16; x <= 16; x += 4) floor.push(plan.node(`hall:f${x}:${z}`, ...xyz(f, x, F, z)));
  s.open.push({ ids: [doorIn, ...mez, ...ids.filter((i) => i.startsWith("hall:m") || i.startsWith("hall:l")), ...stairs.map((st) => st.high)], reach: 9 });
  s.open.push({ ids: [...floor, ...ids.filter((i) => i.includes("g")), ...stairs.map((st) => st.low)], reach: 9 });
}

const xyz = (f: ReturnType<typeof dugFrame>, x: number, y: number, z: number): [number, number, number] => { const [wx, wz] = f.at(x, z); return [wx, y, wz]; };
