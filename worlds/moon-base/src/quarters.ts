// The crew quarters: a smaller hall dug in beside the work hall, its own porch and two
// viewports, sleep slings round the walls, lockers, a rug of light. Where crew go to nap.

import * as THREE from "three";
import { QUARTERS, dugFrame, facadeTop } from "./dims.ts";
import { PORCH, SLING, bigCrate, bigPlant, lockers, porch, sling } from "./furniture.ts";
import { facade, joinRoad, type Base } from "./parts.ts";

export function buildQuarters(s: Base) {
  const f = dugFrame(QUARTERS);
  const { inner, col, plan, innerProps, props } = s;
  const Y = f.y, W = QUARTERS.w / 2, D = QUARTERS.depth, C = Y + 4.3, T = 0.5, H = W - 0.3;
  const top = facadeTop(QUARTERS);
  facade(s, f, {
    outline: [[-W, Y], [W, Y], [W, top], [-W, top]],
    holes: [{ door: [0, Y, 2.4, 3.0] }, { port: [-3.9, Y + 2.0, 0.6] }, { port: [3.9, Y + 2.0, 0.6] }],
    thick: T, outMat: "printed", inMat: "inWall", inY: [Y, C], glass: "hubGlass",
  });
  for (const x of [-W + 0.4, W - 0.4]) f.box(s.pile, "white", x - 0.25, Y, -0.12, x + 0.25, top - 0.3, 0);
  f.box(s.pile, "orange", -W, top - 0.55, -0.14, W, top - 0.35, 0);
  const [px, pz] = f.at(0, 0.2);
  props.put(porch, px, Y, pz, f.yaw(Math.PI));
  for (const sx of [-1, 1]) f.cbox(col, sx * (PORCH.w / 2 - 0.25) - 0.2, Y, -PORCH.d, sx * (PORCH.w / 2 - 0.25) + 0.2, Y + PORCH.h, 0);
  f.cbox(col, -W, Y, 0, -1.25, top, T);
  f.cbox(col, 1.25, Y, 0, W, top, T);
  f.cbox(col, -1.25, Y + 3.0, 0, 1.25, top, T);

  // The room: printed walls warm with light, a low vaulted ceiling of white ribs.
  for (const sx of [-1, 1]) {
    f.box(inner, "inWall", sx * H, Y, T, sx * (H + 0.3), C + 0.2, D);
    f.cbox(col, sx * H, Y, 0, sx * (H + 0.4), C + 0.4, D + 0.3);
  }
  f.box(inner, "inWall", -H - 0.3, Y, D, H + 0.3, C + 0.2, D + 0.3);
  f.cbox(col, -H - 0.3, Y, D, H + 0.3, C + 0.4, D + 0.4);
  f.box(inner, "whiteIn", -H - 0.3, C, T - 0.2, H + 0.3, C + 0.25, D + 0.3);
  f.cbox(col, -H - 0.3, C, 0, H + 0.3, C + 0.4, D + 0.3);
  f.box(inner, "floor", -H, Y - 0.2, 0, H, Y + 0.02, D);
  f.cbox(col, -H, Y - 0.3, -0.05, H, Y + 0.02, D);
  for (let z = 2; z < D; z += 2.5) f.box(inner, "white", -H, C - 0.4, z - 0.2, H, C, z + 0.2);
  f.box(inner, "amber", -2.5, C - 0.05, 2, 2.5, C - 0.01, D - 1.5);
  // A soft round rug of light in the middle of the floor.
  {
    const [cx, cz] = f.at(0, 5.0);
    inner.cyl("seat", cx, Y + 0.02, cz, 1.8, 0.02, 28);
  }

  // Sleep slings: three across the back, one down each side.
  const spots: [number, number, number][] = [[-4.4, 8.3, Math.PI / 2], [0, 8.3, Math.PI / 2], [4.4, 8.3, Math.PI / 2], [-5.5, 3.9, 0], [5.5, 3.9, 0]];
  const ids: string[] = [];
  spots.forEach(([x, z, ly], i) => {
    const [wx, wz] = f.at(x, z);
    const yaw = f.yaw(ly);
    innerProps.put(sling, wx, Y, wz, yaw);
    const along = ly === 0 ? [0, 1] : [1, 0];
    const ends = [-1, 1].map((k) => f.at(x + along[0]! * k * 1.9, z + along[1]! * k * 1.9));
    for (const [ex, ez] of ends) col.cyl(ex, Y, ez, 0.3, 1.5, 6);
    // Its own nav node, beside it on the room's side.
    const [nx, nz] = ly === 0 ? f.at(x - Math.sign(x) * 1.35, z) : f.at(x, z - 1.35);
    const nav = plan.node(`quarters:${i}`, nx, Y, nz);
    ids.push(nav);
    plan.slot("hammock", `sling-${i + 1}`, [wx, Y, wz], yaw, { seat: SLING.seat, nav, tags: ["quarters", "leisure", "indoors", "place:in the quarters", "pastime:napping"] });
  });
  // A soft warm light, on day and night (it's underground).
  {
    const p = f.v(0, C - 0.8, 5);
    s.rooms.push({ x: p.x, y: p.y, z: p.z, intensity: 5, distance: 11, color: "#ffcf9c", always: true });
  }
  // Lockers by the door, a plant, a case.
  for (const sx of [-1, 1]) {
    const [lx, lz] = f.at(sx * 4.6, 1.0);
    innerProps.put(lockers, lx, Y, lz, f.yaw(0));
    f.cbox(col, sx * 4.6 - 1.05, Y, 0.6, sx * 4.6 + 1.05, Y + 2.1, 1.35);
  }
  {
    const [bx, bz] = f.at(-6.2, 6.2);
    innerProps.put(bigPlant, bx, Y, bz, 1);
    const [cx, cz] = f.at(6.3, 6.4);
    innerProps.put(bigCrate, cx, Y, cz, f.yaw(Math.PI / 2));
    f.cbox(col, 5.6, Y, 5.9, 6.9, Y + 0.9, 6.9);
  }

  const out = plan.node("quarters:porch", ...xyz(f.at(0, -3.3), Y));
  const inn = plan.node("quarters:in", ...xyz(f.at(0, 1.8), Y));
  const mid = plan.node("quarters:mid", ...xyz(f.at(0, 5.0), Y));
  plan.link(out, inn);
  joinRoad(s, out, "t1:");
  s.open.push({ ids: [inn, mid, ...ids], reach: 9 });
  void THREE;
}

const xyz = ([x, z]: [number, number], y: number): [number, number, number] => [x, y, z];
