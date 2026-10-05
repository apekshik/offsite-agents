// The crater floor round the hub: three ring landing pads (new crew land on the north one; the
// other two have landers parked on them), rovers and cases about, and the ways across it. And the
// places along the terraces' edges where crew stop to look out over the crater.

import * as THREE from "three";
import { BERM, FLOOR_R, HUB, LOOKOUT, PAD, PAD_SE, PAD_W, PIT, RISER_R, TIER_Y, onRamp, riserAt } from "./dims.ts";
import { HUB_FLOOR } from "./hub.ts";
import { LANDER, parkLander } from "./lander.ts";
import { bigCrate, crate, greyBox, pathLight, ring, rover } from "./furniture.ts";
import { angleOf, arc, cap, deg, polar, yawOf } from "./kit.ts";
import { band } from "./kit.ts";
import type { Base } from "./parts.ts";

/** Which way the arrival pad's lander faces: its hatch toward the hub. */
export const PAD_YAW = yawOf(HUB.x - PAD.x, HUB.z - PAD.z);
const PAD_Y = 0.14;

function pad(s: Base, p: { x: number; z: number; r: number }) {
  const { pile } = s;
  const edge = arc(p.x, p.z, p.r, 0, Math.PI * 2, Math.PI / 32).slice(0, -1);
  pile.add("pad", cap(edge, PAD_Y));
  pile.add("printed", band([...edge, edge[0]!], 0, PAD_Y, { left: true }));
  s.col.floor(edge, PAD_Y, PAD_Y);
  // Markings: a white ring, an orange one inside it, a ring of lights round the edge.
  for (const [rr, mat, t] of [[p.r * 0.72, "white", 0.09], [p.r * 0.42, "orange", 0.07]] as const) ring(pile, mat, new THREE.Vector3(p.x, PAD_Y + 0.005, p.z), "y", rr, t, 48);
  ring(pile, "padRing", new THREE.Vector3(p.x, PAD_Y + 0.02, p.z), "y", p.r - 0.35, 0.06, 64);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const [x, z] = polar(a, p.r - 0.35);
    s.halos.push({ x: p.x + x, y: PAD_Y + 0.12, z: p.z + z, color: "#ffb347", size: 0.45, mode: "always" });
    const [lx, lz] = polar(a + Math.PI / 12, p.r + 0.9);
    if (i % 2 === 0) s.props.put(pathLight, p.x + lx, 0, p.z + lz, -a);
  }
  s.pools.push({ x: p.x, y: PAD_Y, z: p.z, r: p.r * 0.7, k: 0.35 });
}

export function buildPads(s: Base) {
  const { plan, col, pile } = s;
  for (const p of [PAD, PAD_W, PAD_SE]) pad(s, p);
  // Landers parked on the west and south-east pads, hatches toward the hub.
  for (const p of [PAD_W, PAD_SE]) {
    const yaw = yawOf(HUB.x - p.x, HUB.z - p.z);
    parkLander(pile, p.x, PAD_Y, p.z, yaw);
    col.cyl(p.x, PAD_Y, p.z, 2.9, 8, 12);
    for (let i = 0; i < 4; i++) {
      const a = yaw + (i / 4) * Math.PI * 2 + Math.PI / 4;
      col.cyl(p.x + Math.sin(a) * 4.3, PAD_Y, p.z + Math.cos(a) * 4.3, 0.6, 1.2, 8);
    }
  }
  // The arrival pad: where the lander sets down, and the foot of its ramp, where new crew step off.
  plan.node("pad:c", PAD.x, PAD_Y, PAD.z);
  const fwd = [Math.sin(PAD_YAW), Math.cos(PAD_YAW)] as const, side = [Math.cos(PAD_YAW), -Math.sin(PAD_YAW)] as const;
  const foot = (d: number, o: number): [number, number] => [PAD.x + fwd[0] * d + side[0] * o, PAD.z + fwd[1] * d + side[1] * o];
  const [fx, fz] = foot(LANDER.rampFoot + 1.6, 0);
  plan.node("pad:foot", fx, PAD_Y, fz);
  const [ex, ez] = foot(PAD.r + 2.4, 0);
  plan.node("pad:edge", ex, 0, ez);
  plan.link("pad:c", "pad:foot", "pad:edge");
  plan.slot("helipad", "landing-pad", [PAD.x, PAD_Y, PAD.z], PAD_YAW, { nav: "pad:c", tags: ["pad", "place:on the landing pad"] });
  [-1.3, 0, 1.3].forEach((o, i) => {
    const [x, z] = foot(LANDER.rampFoot + 0.6 + Math.abs(o) * 0.2, o);
    plan.slot("crew-spawn", `crew-spawn-${i + 1}`, [x, PAD_Y, z], PAD_YAW, { nav: "pad:foot", tags: ["pad", "place:on the landing pad"] });
  });
}

export function buildFloor(s: Base) {
  const { props, col, plan } = s;
  // Rovers parked about the floor, cases waiting.
  const parked: [number, number, number][] = [[-16, -18, 0.6], [-24, -6, 2.2], [20, -10, -1.0], [32, 12, 1.9], [-8, 30, 0.3], [14, 40, -0.5]];
  for (const [x, z, yaw] of parked) {
    props.put(rover, x, 0, z, yaw);
    col.obox(x, 1.4, z, 2.6, 2.8, 5.4, yaw);
  }
  const yard: [number, number, number, number][] = [[-20, -12, 0, 0], [-18.8, -12.4, 1, 1], [-19.5, -10.8, 0, 2], [24, -14, 2, 0], [25.2, -14.6, 0, 1], [10, 22, 1, 2], [11.3, 21.6, 0, 0], [-34, -20, 0, 1], [-33, -21.5, 1, 0], [38, 2, 2, 0]];
  for (const [x, z, kind, turn] of yard) {
    props.put(kind === 1 ? bigCrate : kind === 2 ? greyBox : crate, x, 0, z, turn * 0.7);
    col.box(x - 0.7, 0, z - 0.6, x + 0.7, kind === 2 ? 0.9 : 0.86, z + 0.6);
  }
  // Path lights along the ways from the hub's doors to the pads and ramps.
  const ways: [number, number, number, number][] = [
    [HUB.x, HUB.z - HUB.r - 4, PAD.x, PAD.z + PAD.r + 1.5],
    [HUB.x - HUB.r - 16, HUB.z, PAD_W.x + PAD_W.r + 1.5, PAD_W.z],
    [HUB.x + HUB.r + 16, HUB.z + 2, PAD_SE.x - 4, PAD_SE.z - 6],
  ];
  for (const [x0, z0, x1, z1] of ways) {
    const len = Math.hypot(x1 - x0, z1 - z0), n = Math.floor(len / 6);
    const nx = -(z1 - z0) / len, nz = (x1 - x0) / len;
    for (let i = 1; i < n; i++) for (const sgn of [-1, 1]) {
      const x = x0 + ((x1 - x0) * i) / n + nx * sgn * 2.4, z = z0 + ((z1 - z0) * i) / n + nz * sgn * 2.4;
      props.put(pathLight, x, 0, z, Math.atan2(x1 - x0, z1 - z0));
      s.halos.push({ x, y: 0.62, z, color: "#ffb35a", size: 0.45, mode: "night" });
    }
  }

  // Walking across the floor: waypoints in rings round the hub and the crater; the build links
  // the ones that can see each other and drops any that land on something.
  const ids: string[] = [];
  const add = (id: string, x: number, z: number) => {
    if (Math.hypot(x - PIT.x, z - PIT.z) < PIT.r + 1.2) return;
    if (Math.hypot(x - HUB.x, z - HUB.z) < HUB.r + 1.5) return;
    for (const p of [PAD, PAD_W, PAD_SE]) if (Math.hypot(x - p.x, z - p.z) < p.r + 1.0) return;
    ids.push(plan.node(id, x, 0, z));
  };
  for (let i = 0; i < 16; i++) { const [x, z] = polar((i / 16) * Math.PI * 2, HUB.r + 6.5); add(`fl:a${i}`, HUB.x + x, HUB.z + z); }
  for (let i = 0; i < 20; i++) { const [x, z] = polar((i / 20) * Math.PI * 2 + 0.1, 32); add(`fl:b${i}`, x, z); }
  for (let i = 0; i < 28; i++) { const [x, z] = polar((i / 28) * Math.PI * 2, FLOOR_R - 6.5); add(`fl:c${i}`, x, z); }
  for (const p of [PAD, PAD_W, PAD_SE]) for (let i = 0; i < 6; i++) { const [x, z] = polar((i / 6) * Math.PI * 2, p.r + 2.2); add(`fl:p${p.x.toFixed(0)}:${i}`, p.x + x, p.z + z); }
  ids.push("pad:edge", "hub:n-out", "hub:s-out", "tube-w:out", "tube-e:out", "ne0:foot", "w0:foot", "pit:top", "garage:0:out", "garage:1:out", "garage:2:out", "rig:edge");
  s.open.push({ ids, reach: 26 });
  void HUB_FLOOR;
}

/**
 * Places at the terraces' edges, by the berm, looking out over the crater, and on the rim.
 * Crew stop at them to take in the view (or gather round in twos and threes).
 */
export function buildViewpoints(s: Base) {
  const spots: [number, number][] = [[1, -60], [1, 10], [1, 150], [2, -20], [2, 60], [2, 110], [2, -120], [3, -40], [3, 18], [3, 66], [4, -10], [4, 30]];
  spots.forEach(([k, d], i) => {
    const a = deg(d);
    if (onRamp(k - 1, a, 6)) return;
    const R = riserAt(k - 1, a) + BERM.d + 0.75;
    const [x, z] = polar(a, R);
    s.plan.slot("rail", `edge-${i + 1}`, [x, TIER_Y[k]!, z], -a, { tags: [k === 4 ? "rim" : "terraces", "outdoors", k === 4 ? "place:on the rim" : "place:on the terraces", "pastime:looking out over the crater"] });
  });
  void LOOKOUT; void RISER_R; void angleOf;
}
