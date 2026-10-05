// The rover garage: three open bays dug into the floor's south-east wall, big white frames with
// lights along their heads, rovers inside (one up on a lift), tool walls, stacks of tyres and
// cases. Crew come here to tinker.

import * as THREE from "three";
import { GARAGE, dugFrame, facadeTop } from "./dims.ts";
import { bigCrate, crate, disc, greyBox, rover } from "./furniture.ts";
import type { P2 } from "./kit.ts";
import { facade, type Base } from "./parts.ts";

/** The bays: their middles along the facade, and how wide and tall their openings are. */
const BAYS = [-9, 0, 9], BAY_W = 7.2, BAY_H = 3.9;
export const GARAGE_IN = { depth: GARAGE.depth, ceil: 4.45 };

export function buildGarage(s: Base) {
  const f = dugFrame(GARAGE);
  const { pile, inner, col, plan, innerProps, props } = s;
  const W = GARAGE.w / 2, D = GARAGE.depth, C = GARAGE_IN.ceil, T = 0.6, top = facadeTop(GARAGE);
  // The facade, notched for the three bays.
  const outline: P2[] = [[-W, 0]];
  for (const x of BAYS) outline.push([x - BAY_W / 2, 0], [x - BAY_W / 2, BAY_H], [x + BAY_W / 2, BAY_H], [x + BAY_W / 2, 0]);
  outline.push([W, 0], [W, top], [-W, top]);
  facade(s, f, { outline, holes: [], thick: T, outMat: "printed", inMat: null });
  // Each bay: a white frame proud of the wall, lights along its head, an orange stripe; its reveals.
  for (const x of BAYS) {
    const x0 = x - BAY_W / 2, x1 = x + BAY_W / 2;
    f.box(pile, "white", x0 - 0.55, 0, -0.5, x0, BAY_H + 0.6, 0.05);
    f.box(pile, "white", x1, 0, -0.5, x1 + 0.55, BAY_H + 0.6, 0.05);
    f.box(pile, "white", x0 - 0.55, BAY_H, -0.5, x1 + 0.55, BAY_H + 0.75, 0.05);
    f.box(pile, "orange", x0 - 0.56, BAY_H + 0.5, -0.52, x1 + 0.56, BAY_H + 0.62, 0.05);
    for (let k = 0; k < 4; k++) {
      const lx = x0 + 0.9 + k * ((BAY_W - 1.8) / 3);
      f.box(pile, "lamp", lx - 0.35, BAY_H + 0.08, -0.52, lx + 0.35, BAY_H + 0.28, -0.48);
    }
    for (const xx of [x0 - 0.3, x1 + 0.3]) f.box(pile, "amber", xx - 0.04, 0.5, -0.53, xx + 0.04, BAY_H - 0.3, -0.49);
    f.box(inner, "inWall", x0, 0, 0, x0 + 0.02, BAY_H, T);
    f.box(inner, "inWall", x1 - 0.02, 0, 0, x1, BAY_H, T);
    f.box(inner, "whiteIn", x0, BAY_H, 0, x1, BAY_H + 0.02, T);
  }
  // The facade between and beside the bays, as colliders.
  const solid: [number, number][] = [[-W, BAYS[0]! - BAY_W / 2]];
  for (let i = 0; i + 1 < BAYS.length; i++) solid.push([BAYS[i]! + BAY_W / 2, BAYS[i + 1]! - BAY_W / 2]);
  solid.push([BAYS[BAYS.length - 1]! + BAY_W / 2, W]);
  for (const [x0, x1] of solid) f.cbox(col, x0 - 0.55, 0, -0.5, x1 + 0.55, top, T);
  f.cbox(col, -W, BAY_H, -0.5, W, top, T);

  // Inside: one long hall behind the bays.
  const H = W - 0.3;
  for (const sx of [-1, 1]) {
    f.box(inner, "inWall", sx * H, 0, T, sx * (H + 0.3), C + 0.2, D);
    f.cbox(col, sx * H, 0, 0, sx * (H + 0.4), C + 0.4, D + 0.3);
  }
  f.box(inner, "inWall", -H - 0.3, 0, D, H + 0.3, C + 0.2, D + 0.3);
  f.cbox(col, -H - 0.3, 0, D, H + 0.3, C + 0.4, D + 0.4);
  f.box(inner, "whiteIn", -H - 0.3, C, T, H + 0.3, C + 0.25, D + 0.3);
  f.cbox(col, -H - 0.3, C, 0, H + 0.3, C + 0.4, D + 0.3);
  f.box(inner, "pad", -H, -0.1, T, H, 0.02, D);
  f.cbox(col, -H, -0.4, -0.05, H, 0.02, D);
  for (let x = -12; x <= 12; x += 4) f.box(inner, "panel", x - 0.9, C - 0.06, 1.5, x + 0.9, C - 0.01, D - 1.5);
  // Yellow-orange safety lines on the floor of each bay.
  for (const x of BAYS) for (const sx of [-1, 1]) f.box(inner, "orange", x + sx * 2.8 - 0.06, 0.02, 1.0, x + sx * 2.8 + 0.06, 0.03, D - 1.5);
  // Tool walls: orange pegboards with dark tools, on the back wall of each bay.
  for (const x of BAYS) {
    f.box(inner, "orange", x - 2.2, 1.0, D - 0.12, x + 2.2, 2.6, D);
    for (let k = 0; k < 9; k++) f.box(inner, "dark", x - 1.9 + k * 0.45, 1.3 + (k % 3) * 0.35, D - 0.18, x - 1.82 + k * 0.45, 1.65 + (k % 3) * 0.35, D - 0.12);
    f.cbox(col, x - 2.2, 0, D - 0.5, x + 2.2, 2.6, D);
  }

  // The rovers: one up on a lift, one with its cab open, one being looked over.
  BAYS.forEach((x, i) => {
    const lift = i === 0 ? 1.1 : 0;
    const [rx, rz] = f.at(x, 6.2);
    innerProps.put(rover, rx, lift, rz, f.yaw(Math.PI));
    f.cbox(col, x - 1.3, lift, 3.6, x + 1.3, lift + 2.8, 8.8);
    if (lift > 0) {
      // The lift: four orange posts and arms under the chassis.
      for (const sx of [-1, 1]) for (const sz of [4.4, 8.0]) {
        f.box(inner, "orange", x + sx * 1.6 - 0.15, 0, sz - 0.15, x + sx * 1.6 + 0.15, lift + 0.9, sz + 0.15);
        f.box(inner, "orange", x + sx * 0.6, lift + 0.6, sz - 0.12, x + sx * 1.6, lift + 0.75, sz + 0.12);
        f.cbox(col, x + sx * 1.6 - 0.2, 0, sz - 0.2, x + sx * 1.6 + 0.2, lift + 0.9, sz + 0.2);
      }
      f.box(inner, "dark", x - 1.7, 0, 3.9, x + 1.7, 0.08, 8.5);
    }
    // Tyres stacked by the wall, cases, a rolling tool chest.
    for (let k = 0; k < 3; k++) disc(inner, "rubber", f.v(x + 2.6, 0.22 + k * 0.42, 9.8), "y", 0.55, 0.4, 14);
    f.cbox(col, x + 2.0, 0, 9.2, x + 3.2, 1.3, 10.4);
    const [cx, cz] = f.at(x - 2.7, 9.6);
    innerProps.put(i % 2 ? greyBox : bigCrate, cx, 0, cz, f.yaw(0));
    f.cbox(col, x - 3.4, 0, 9.0, x - 2.0, 1.0, 10.2);
    // Two places to work on it: at its flank, and at its nose.
    const spots: [number, number, number][] = [[x - 2.0, 6.0, Math.PI / 2], [x + 0.2, 3.0, 0]];
    spots.forEach(([sx, sz, ly], k) => {
      const [wx, wz] = f.at(sx, sz);
      plan.slot("workshop", `garage-${i + 1}${k ? "b" : "a"}`, [wx, 0, wz], f.yaw(ly), { tags: ["garage", "leisure", "indoors", "place:in the rover garage", "pastime:fixing a rover"] });
    });
  });
  {
    const p = f.v(0, C - 0.6, 6);
    s.rooms.push({ x: p.x, y: p.y, z: p.z, intensity: 6, distance: 16, color: "#ffe2bf" });
  }

  // Out front: a rover parked, cases waiting to go in.
  const [ox, oz] = f.at(13.5, -6.5);
  props.put(rover, ox, 0, oz, f.yaw(Math.PI) + 0.5);
  s.col.obox(ox, 1.4, oz, 2.6, 2.8, 5.4, f.yaw(Math.PI) + 0.5);
  for (const [x, z] of [[-14.5, -2.0], [-13.6, -2.4], [-14.0, -3.4]] as const) {
    const [wx, wz] = f.at(x, z);
    props.put(crate, wx, 0, wz, f.yaw(x));
  }
  f.cbox(col, -15.2, 0, -4.0, -12.9, 0.7, -1.4);

  // Walking: in front of each bay, into it, along the back.
  const ids: string[] = [];
  BAYS.forEach((x, i) => {
    const [ax, az] = f.at(x, -3.2);
    ids.push(plan.node(`garage:${i}:out`, ax, 0, az));
    const [bx, bz] = f.at(x - 0.4, 1.6);
    ids.push(plan.node(`garage:${i}:in`, bx, 0, bz));
    const [dx, dz] = f.at(x - 2.2, 4.6);
    ids.push(plan.node(`garage:${i}:side`, dx, 0, dz));
  });
  s.open.push({ ids, reach: 12 });
  void THREE;
}
