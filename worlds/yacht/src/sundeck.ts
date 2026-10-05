// The sun deck, aft on D3: a long pool on the port side, a round hot tub in a teak surround
// behind it, a row of white loungers under white umbrellas down the starboard rail, a round bar
// under a white dome at the stern, palms. Stairs come up each side from the promenades below and
// go on up to the canopy deck.

import * as THREE from "three";
import { D2, D3, D4, SLAB, SUN } from "./dims.ts";
import { LOUNGER, armchair, barStool, coffeeTable, deckChair, lounger, palm, sideTable, umbrella } from "./furniture.ts";
import { along, band, cap, halfWidth, inset, runs, yawOf, type Outline, type P2 } from "./kit.ts";
import { balustrade, downlights, slab, stairs, type Ship } from "./parts.ts";
import { UP_STAIR } from "./canopy.ts";

export const SUNDECK: Outline = {
  zF: SUN.z0, zA: SUN.z1, w: SUN.w, ra: 7, na: 2.4,
  notches: [[1, SUN.z0, 23.1, 7.0], [-1, SUN.z0, 23.1, 7.0]],
};
// Up from the D2 promenade, against the deckhouse, so the promenade keeps a wide lane outboard.
export const MID_STAIR = { x0: 7.1, x1: 8.6, zLow: 17.0, zHigh: 23.1 };
const POOL = { x0: -6.6, x1: -0.8, z0: 24.5, z1: 38.5, depth: 1.35 }; // inside the deckhouse below
const TUB = { x: -6.0, z: 42.6, r: 1.55, R: 2.35 };
const BAR = { x: 1.2, z: 43.4 };

function circle(x: number, z: number, r: number, n = 28): P2[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [x + Math.cos(a) * r, z + Math.sin(a) * r] as P2;
  });
}

/** Local (lx, lz) in a frame at (x, z) turned by yaw, to world (x, z). */
const local = (x: number, z: number, yaw: number, lx: number, lz: number): P2 => [x + lx * Math.cos(yaw) + lz * Math.sin(yaw), z - lx * Math.sin(yaw) + lz * Math.cos(yaw)];

export function buildSunDeck(s: Ship) {
  const { pile, col, plan, props } = s;
  const poolHole: P2[] = [[POOL.x0, POOL.z0], [POOL.x1, POOL.z0], [POOL.x1, POOL.z1], [POOL.x0, POOL.z1]];
  // The hot tub stands on the deck (no hole): sunk into it, its bowl hung through the ceiling of the room below.
  const deck = slab(s, SUNDECK, D3, { holes: [poolHole] });
  // Rails all round except the front (the office's glass) and the stair heads in the notches.
  const keep = (x: number, z: number) => z > SUN.z0 + 0.3 && !(z > MID_STAIR.zHigh - 0.2 && z < MID_STAIR.zHigh + 0.2 && Math.abs(x) > 6.95);
  for (const run of runs(inset(deck, 0.08), keep)) balustrade(s, run, D3);
  downlights(s, inset(deck, 0.5).filter(([, z]) => z > 22.5), D3 - SLAB, 3.0);

  // ---- the pool: tiled basin, white coping, water, steps down at the back ----
  const floorY = D3 - POOL.depth;
  pile.add("tile", band(inset(poolHole, -0.0).map(([x, z]) => [x, z] as P2), floorY, D3 - 0.01, { inward: true }));
  pile.add("tile", cap(poolHole, floorY));
  for (const [x0, z0, x1, z1] of [[POOL.x0 - 0.35, POOL.z0 - 0.35, POOL.x1 + 0.35, POOL.z0], [POOL.x0 - 0.35, POOL.z1, POOL.x1 + 0.35, POOL.z1 + 0.35], [POOL.x0 - 0.35, POOL.z0, POOL.x0, POOL.z1], [POOL.x1, POOL.z0, POOL.x1 + 0.35, POOL.z1]] as const)
    pile.box("white", x0, D3, z0, x1, D3 + 0.05, z1);
  const steps = 6;
  for (let k = 1; k <= steps; k++) pile.box("tile", POOL.x0, floorY, POOL.z1 - (steps + 1 - k) * 0.62, POOL.x0 + 1.3, floorY + k * 0.2, POOL.z1);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(POOL.x1 - POOL.x0, POOL.z1 - POOL.z0).rotateX(-Math.PI / 2), s.materials.poolWater);
  water.position.set((POOL.x0 + POOL.x1) / 2, D3 - 0.12, (POOL.z0 + POOL.z1) / 2);
  water.renderOrder = 2;
  s.extra.push(water);
  col.box(POOL.x0, floorY - 0.3, POOL.z0, POOL.x1, floorY, POOL.z1);
  col.ramp(POOL.x0, POOL.x0 + 1.3, POOL.z1 - (steps + 1) * 0.62, floorY, POOL.z1, D3);
  col.wall([[POOL.x0, POOL.z0], [POOL.x1, POOL.z0], [POOL.x1, POOL.z1], [POOL.x0, POOL.z1], [POOL.x0, POOL.z0]], floorY, D3 + 0.05, 0.1);
  // A chrome ladder at the front corner.
  for (const dx of [0, 0.5]) {
    const x = POOL.x1 - 0.55 + dx;
    pile.rod("chrome", new THREE.Vector3(x, D3 - 0.9, POOL.z0 + 0.12), new THREE.Vector3(x, D3 + 0.85, POOL.z0 + 0.12), 0.025);
    pile.rod("chrome", new THREE.Vector3(x, D3 + 0.85, POOL.z0 + 0.12), new THREE.Vector3(x, D3 + 0.85, POOL.z0 - 0.3), 0.025);
    pile.rod("chrome", new THREE.Vector3(x, D3 + 0.85, POOL.z0 - 0.3), new THREE.Vector3(x, D3, POOL.z0 - 0.3), 0.025);
  }
  // In the water: the slot sits at the surface (the swim pose holds the shoulders just under it).
  const surface = D3 - 0.12;
  [[-2.2, 26.2, 0.6], [-2.0, 29.4, -2.2], [-4.9, 31.0, 1.2], [-2.4, 33.8, 3.0], [-3.6, 36.4, -2.8]].forEach(([x, z, f], i) =>
    plan.slot("pool", `pool-${i + 1}`, [x!, surface, z!], f!, { tags: ["water"] }));

  // ---- the hot tub: a raised teak drum on the deck, a tiled bowl with a bench round it, two steps up ----
  const RIM = D3 + 0.85, BENCH = D3 + 0.38, FLOOR = D3 + 0.02;
  const ring = (r: number, y0: number, y1: number, inward: boolean) => band(circle(TUB.x, TUB.z, r, 40), y0, y1, { inward });
  pile.add("wood", ring(TUB.R, D3, RIM, false));
  pile.add("wood", cap(circle(TUB.x, TUB.z, TUB.R, 40), RIM, false, [circle(TUB.x, TUB.z, TUB.r, 40)]));
  pile.add("tile", ring(TUB.r, FLOOR, RIM, true));
  pile.add("tile", cap(circle(TUB.x, TUB.z, 1.1, 32), FLOOR));
  pile.add("tile", cap(circle(TUB.x, TUB.z, TUB.r, 40), BENCH, false, [circle(TUB.x, TUB.z, 1.1, 32)]));
  pile.add("tile", ring(1.1, FLOOR, BENCH, true));
  pile.box("wood", TUB.x - 0.7, D3, TUB.z - TUB.R - 0.9, TUB.x + 0.7, D3 + 0.28, TUB.z - TUB.R);
  pile.box("wood", TUB.x - 0.7, D3, TUB.z - TUB.R - 0.45, TUB.x + 0.7, D3 + 0.56, TUB.z - TUB.R);
  const tubWater = new THREE.Mesh(new THREE.CircleGeometry(TUB.r, 40).rotateX(-Math.PI / 2), s.materials.tubWater);
  tubWater.position.set(TUB.x, RIM - 0.13, TUB.z);
  tubWater.renderOrder = 2;
  s.extra.push(tubWater);
  // A solid drum to walk round, not into: crew get in by their slots, not by climbing.
  col.box(TUB.x - TUB.R, D3, TUB.z - TUB.R, TUB.x + TUB.R, RIM, TUB.z + TUB.R);
  col.box(TUB.x - 0.7, D3, TUB.z - TUB.R - 0.9, TUB.x + 0.7, D3 + 0.28, TUB.z - TUB.R);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const x = TUB.x + Math.cos(a) * 1.28, z = TUB.z + Math.sin(a) * 1.28;
    plan.slot("hot-tub", `hot-tub-${i + 1}`, [x, FLOOR, z], yawOf(TUB.x - x, TUB.z - z), { seat: BENCH - FLOOR, tags: ["water"] });
  }

  // ---- loungers in pairs under umbrellas, heads to the starboard rail ----
  const yawL = -Math.PI / 2; // head (the prefab's -z) to +x: the body faces -x, toward the pool
  let n = 0;
  for (let k = 0; k < 8; k++) {
    const z0 = 25.4 + k * 2.6;
    for (const dz of [0, 0.95]) {
      const x = 8.4, z = z0 + dz;
      props.put(lounger, x, D3, z, yawL);
      const [hx, hz] = local(x, z, yawL, 0, LOUNGER.hips);
      plan.slot("lounger", `lounger-${++n}`, [hx, D3, hz], yawL, { seat: LOUNGER.seat, tags: ["sun", "shade"] });
      col.obox(x, D3 + 0.25, z, 2.0, 0.5, 0.74, yawL);
    }
    props.put(umbrella, 9.75, D3, z0 + 0.475);
  }

  // ---- the bar: a round counter under a white dome, stools round its front ----
  const segs = 14, a0 = (100 / 180) * Math.PI, a1 = (350 / 180) * Math.PI;
  for (let i = 0; i < segs; i++) {
    const a = a0 + ((i + 0.5) / segs) * (a1 - a0), r = 2.3;
    const x = BAR.x + Math.cos(a) * r, z = BAR.z + Math.sin(a) * r, yaw = Math.atan2(Math.cos(a), Math.sin(a));
    const w = (2 * Math.PI * r * ((a1 - a0) / (2 * Math.PI))) / segs + 0.05;
    pile.obox("wood", x, D3 + 0.52, z, w, 1.04, 0.55, yaw);
    pile.obox("white", x + Math.cos(a) * 0.08, D3 + 1.08, z + Math.sin(a) * 0.08, w + 0.02, 0.06, 0.78, yaw);
    col.obox(x, D3 + 0.55, z, w, 1.1, 0.6, yaw);
  }
  pile.cyl("wood", BAR.x, D3, BAR.z, 0.95, 2.95, 20);
  for (const h of [1.25, 1.75, 2.25]) {
    pile.cyl("white", BAR.x, D3 + h, BAR.z, 1.15, 0.04, 20);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      pile.cyl("bottle", BAR.x + Math.cos(a) * 1.04, D3 + h + 0.04, BAR.z + Math.sin(a) * 1.04, 0.045, 0.3 - (i % 3) * 0.05, 6, 0.03);
    }
  }
  col.box(BAR.x - 0.95, D3, BAR.z - 0.95, BAR.x + 0.95, D3 + 2.9, BAR.z + 0.95);
  const dome = new THREE.SphereGeometry(3.6, 36, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.26, 1).translate(BAR.x, D3 + 3.2, BAR.z);
  dome.deleteAttribute("uv");
  pile.add("white", dome);
  pile.add("white", band(circle(BAR.x, BAR.z, 3.6, 36), D3 + 2.85, D3 + 3.2));
  pile.add("under", cap(circle(BAR.x, BAR.z, 3.6, 36), D3 + 2.85, true));
  for (const a of [0.55, 1.15]) {
    const x = BAR.x + Math.cos(a) * 3.3, z = BAR.z + Math.sin(a) * 3.3;
    pile.cyl("white", x, D3, z, 0.07, 2.9, 10);
    col.box(x - 0.1, D3, z - 0.1, x + 0.1, D3 + 2.9, z + 0.1);
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    pile.cyl("lamp", BAR.x + Math.cos(a) * 2.6, D3 + 2.83, BAR.z + Math.sin(a) * 2.6, 0.08, 0.02, 8);
    s.lights.push({ x: BAR.x + Math.cos(a) * 2.6, y: D3 + 2.83, z: BAR.z + Math.sin(a) * 2.6, r: 1.3 });
  }
  for (let i = 0; i < 9; i++) {
    const a = ((118 + (i * 212) / 8) / 180) * Math.PI;
    const x = BAR.x + Math.cos(a) * 3.05, z = BAR.z + Math.sin(a) * 3.05;
    props.put(barStool, x, D3, z);
    plan.slot("bar-stool", `bar-stool-${i + 1}`, [x, D3, z], yawOf(BAR.x - x, BAR.z - z), { seat: 0.76, tags: ["bar"] });
  }

  // ---- deck chairs by the pool, palms, a lounge corner up front ----
  [27.5, 31.0, 34.5].forEach((z, i) => {
    props.put(deckChair, 3.4, D3, z, -Math.PI / 2);
    props.put(sideTable, 3.45, D3, z + 0.9);
    plan.slot("deck-chair", `deck-chair-sun-${i + 1}`, [3.4, D3, z], -Math.PI / 2, { seat: 0.38, tags: ["sun"] });
  });
  for (const [x, z, r] of [[-3.2, 21.3, 0.3], [3.2, 21.3, 1.4], [-7.6, 46.4, 2.2], [4.6, 47.2, 0.8]] as const) props.put(palm, x, D3, z, r);
  props.put(armchair, -1.3, D3, 17.0, 0);
  props.put(armchair, 1.3, D3, 17.0, 0);
  props.put(coffeeTable, 0, D3, 18.6, 0);
  col.box(-1.9, D3, 16.5, 1.9, D3 + 0.8, 19.0);
  plan.slot("deck-chair", "deck-chair-sun-4", [-1.3, D3, 17.0], 0, { seat: 0.42, tags: ["shade"] });
  plan.slot("deck-chair", "deck-chair-sun-5", [1.3, D3, 17.0], 0, { seat: 0.42, tags: ["shade"] });

  // ---- stairs: up each side from the D2 promenade, and on up to the canopy deck ----
  for (const side of [1, -1] as const) {
    const sn = side > 0 ? "s" : "p";
    // Its inner side runs along the deckhouse: no rail there.
    stairs(s, { id: `mid-stair-${sn}`, x0: side * MID_STAIR.x0, x1: side * MID_STAIR.x1, zLow: MID_STAIR.zLow, yLow: D2, zHigh: MID_STAIR.zHigh, yHigh: D3, bare: side > 0 ? [true, false] : [false, true] });
    // The notch's aft edge, outboard of the stair's head.
    balustrade(s, [[side * (MID_STAIR.x1 + 0.08), MID_STAIR.zHigh + 0.08], [side * (halfWidth(SUNDECK, MID_STAIR.zHigh) - 0.1), MID_STAIR.zHigh + 0.08]], D3);
    stairs(s, { id: `up-stair-${sn}`, x0: side * UP_STAIR.x0, x1: side * UP_STAIR.x1, zLow: 21.0, yLow: D3, zHigh: SUN.z0, yHigh: D4 });
  }

  // ---- walking ----
  const A = (z: number) => `sun-a${z}`, B = (z: number) => `sun-b${z}`;
  const az = [23.2, 27, 31.5, 39.5], bz = [23.2, 27, 31, 35, 39, 43, 46.4];
  az.forEach((z) => plan.node(A(z), 0.9, D3, z));
  bz.forEach((z) => plan.node(B(z), 5.6, D3, z));
  plan.link(...az.map(A));
  plan.link(...bz.map(B));
  plan.node("sun-port0", -9.3, D3, 24.2);
  plan.node("sun-port1", -9.3, D3, 39.5);
  plan.node("sun-tub", -6.0, D3, 39.5);
  plan.node("sun-tubE", -2.85, D3, 43.2);
  plan.node("sun-front", 0, D3, 20.2);
  plan.node("sun-port-mid", -9.3, D3, 31.5);
  plan.link("mid-stair-p:high", "sun-port0", "sun-port-mid", "sun-port1", "sun-tub", A(39.5));
  plan.node("sun-aft", 0.6, D3, 47.7);
  plan.node("sun-aftP", -2.6, D3, 46.6);
  // The captain starts out here, between the pool and the loungers, looking forward over the ship.
  plan.slot("captain-spawn", "captain-spawn", [2.0, D3, 33.5], Math.PI, { tags: ["sundeck"] });
  plan.link(B(46.4), "sun-aft", "sun-aftP", "sun-tubE");
  plan.link("mid-stair-p:high", A(23.2), B(23.2), "mid-stair-s:high");
  plan.link("up-stair-p:low", A(23.2));
  plan.link("up-stair-s:low", B(23.2));
  plan.link("sun-front", A(23.2));
  plan.link("sun-front", B(23.2));
  plan.link(A(39.5), "sun-tubE");
  plan.link(A(31.5), B(31));
  plan.link(A(39.5), B(39));
  plan.link("up-stair-s:high", "canopy-s12.6");
  plan.link("up-stair-p:high", "canopy-p12.6");

  // Rail spots: down the port side by the pool, and round the stern.
  for (const z of [26, 30, 34, 38]) plan.slot("rail", `rail-sun-p${z}`, [-10.95, D3, z], -Math.PI / 2, { tags: ["sun"] });
  const aftRail = inset(deck, 0.55).filter(([x, z]) => z > 46.6 && x > -6.5 && x < 6);
  along(aftRail, 2.6, 0.5).forEach((p, i) => {
    let nx = p.dz, nz = -p.dx;
    if (nz < 0) { nx = -nx; nz = -nz; }
    plan.slot("rail", `rail-sun-aft${i + 1}`, [p.x, D3, p.z], yawOf(nx, nz), { tags: ["sun", "stern"] });
  });
}
