// The lower deck: inside the hull at the swim platform's height, under the promenades. From the
// stern forward: the beach club (a bar and loungers to starboard, the tender garage with the tender
// and two jet skis to port, a lounge between them under the stern terrace), then a corridor between
// the spa and the engine room, the gym and the cinema, into the crew mess and its galley, and
// through a glass wall into the server room, where Computah (the orchestrator) lives (core.ts).
//
// Two stairs come down from the promenades into the server room; the beach club opens onto the
// swim platform through the transom. Everything down here sits in the hull's shade, so it goes in
// the piles that cast no shadows, and is lit by its own warm (or, in the server room, blue) light.

import * as THREE from "three";
import { LIGHT } from "@offsite/kit";
import { D1, LD, LD_CEIL, PLATFORM, SLAB, STERN_DOOR, TRANSOM, halfBeam } from "./dims.ts";
import {
  BEANBAG, DAYBED, LOUNGER, RACK, TREADMILL, armchair, barBack, barStool, beanBagBlue, beanBagGrey, beanBagWhite, chair, coffeeMachine, coffeeTable,
  daybed, dumbbellRack, jetSki, lounger, palm, rack, shrub, sofa, tender, treadmill, weightBench,
} from "./furniture.ts";
import { band, cap, yawOf, type P2 } from "./kit.ts";
import type { MatKey } from "./mats.ts";
import { balustrade, stairs, type Ship } from "./parts.ts";
import { WELL } from "./hull.ts";
import { helmScreenTexture, screen } from "./screens.ts";

const CEIL = LD_CEIL;
/** The inside of the hull's skin at z: where the lining stands. */
const hin = (z: number) => halfBeam(Math.min(z, TRANSOM - 0.01), LD) - 0.3;

/** The stairs down from the promenades into the server room (starboard; port mirrors it). */
export const CREW_STAIR = { x0: 8.2, x1: 9.7, zLow: -22.5, zHigh: -15.5 };
/** The opening each cuts in the D1 deck: x across (starboard), z along. */
const HOLE = { x0: 8.12, x1: 9.78, z0: -20.05, z1: -15.45 };
/** The holes in the D1 deck for the crew stairs, for its slab. */
export function crewStairHoles(): P2[][] {
  return [1, -1].map((sx) => [[sx * HOLE.x0, HOLE.z0], [sx * HOLE.x1, HOLE.z0], [sx * HOLE.x1, HOLE.z1], [sx * HOLE.x0, HOLE.z1]] as P2[]);
}

// Along the ship: the cross walls between the rooms.
const Z = { fwd: -33.5, server: 2, mess: 20, rowB: 34, rowA: 46, aft: TRANSOM - 0.25 };
const COR = 1.4; // half the corridor's width
export const CORE = { x: 0, z: -15 };

/** Where the server racks stand, for the lights on their fronts (core.ts). */
export interface RackSpot { x: number; z: number; yaw: number }

export function buildLowerDeck(s: Ship): { racks: RackSpot[] } {
  const { inner: pile, col, plan, innerProps: props } = s;

  // ---------- helpers ----------
  /** A polygon from x0 to x1 (null: the hull on that side) and z0 to z1. */
  const area = (x0: number | null, x1: number | null, z0: number, z1: number, out = 0.2): P2[] => {
    const zs: number[] = [];
    for (let z = z0; z < z1; z += 1) zs.push(z);
    zs.push(z1);
    const right = zs.map((z) => [x1 ?? hin(z) + out, z] as P2);
    const left = zs.map((z) => [x0 ?? -(hin(z) + out), z] as P2).reverse();
    return [...right, ...left];
  };
  const floor = (mat: MatKey, x0: number | null, x1: number | null, z0: number, z1: number) => pile.add(mat, cap(area(x0, x1, z0, z1), LD));
  const ceiling = (mat: MatKey, x0: number | null, x1: number | null, z0: number, z1: number, holes: P2[][] = []) =>
    pile.add(mat, cap(area(x0, x1, z0, z1, 0.05), CEIL, true, holes));
  /**
   * A wall across the ship at z, from x0 to x1 (null: out to the hull), each face its own
   * material, with doorways [from, to] in x.
   */
  const wallZ = (z: number, x0: number | null, x1: number | null, fwd: MatKey, aft: MatKey, doors: [number, number][] = [], t = 0.14) => {
    const a = x0 ?? -hin(z) - 0.1, b = x1 ?? hin(z) + 0.1;
    const cuts = [a, ...doors.flat().sort((p, q) => p - q), b];
    for (let i = 0; i + 1 < cuts.length; i++) {
      const u = cuts[i]!, v = cuts[i + 1]!;
      const solid = i % 2 === 0;
      const y0 = solid ? LD : LD + 2.3;
      pile.box(fwd, u, y0, z - t / 2, v, CEIL, z);
      pile.box(aft, u, y0, z, v, CEIL, z + t / 2);
      if (solid) col.box(u, LD, z - t / 2 - 0.03, v, CEIL, z + t / 2 + 0.03);
    }
    for (const [u, v] of doors) pile.box("frame", u, LD + 2.28, z - t / 2 - 0.01, v, LD + 2.33, z + t / 2 + 0.01);
  };
  /** A wall along the ship at x, from z0 to z1: `inMat` faces the centreline, `outMat` the hull. */
  const wallX = (x: number, z0: number, z1: number, inMat: MatKey, outMat: MatKey, doors: [number, number][] = [], t = 0.14) => {
    const sx = Math.sign(x);
    const cuts = [z0, ...doors.flat().sort((p, q) => p - q), z1];
    for (let i = 0; i + 1 < cuts.length; i++) {
      const u = cuts[i]!, v = cuts[i + 1]!;
      const solid = i % 2 === 0;
      const y0 = solid ? LD : LD + 2.3;
      pile.box(inMat, x - (sx * t) / 2, y0, u, x, CEIL, v);
      pile.box(outMat, x, y0, u, x + (sx * t) / 2, CEIL, v);
      if (solid) col.box(Math.min(x - (sx * t) / 2, x + (sx * t) / 2) - 0.03, LD, u, Math.max(x - (sx * t) / 2, x + (sx * t) / 2) + 0.03, CEIL, v);
    }
    for (const [u, v] of doors) pile.box("frame", x - t / 2 - 0.01, LD + 2.28, u, x + t / 2 + 0.01, LD + 2.33, v);
  };
  /**
   * The hull's lining from z0 to z1 on a side, with a band of window where the hull outside has
   * its long dark window band (seen from in here, the sea).
   */
  const lining = (side: 1 | -1, z0: number, z1: number, mat: MatKey, win: [number, number, number, number] | null = null) => {
    const pts = (a: number, b: number): P2[] => {
      const out: P2[] = [];
      for (let z = a; z < b; z += 1) out.push([side * hin(z), z]);
      out.push([side * hin(b), b]);
      return out;
    };
    const inward = side > 0;
    const spans: [number, number, boolean][] = [];
    if (win && win[1] > z0 && win[0] < z1) {
      const w0 = Math.max(z0, win[0]), w1 = Math.min(z1, win[1]);
      if (w0 > z0) spans.push([z0, w0, false]);
      spans.push([w0, w1, true]);
      if (w1 < z1) spans.push([w1, z1, false]);
    } else spans.push([z0, z1, false]);
    for (const [a, b, glass] of spans) {
      const run = pts(a, b);
      if (!glass) { pile.add(mat, band(run, LD, CEIL, { closed: false, inward })); continue; }
      const [, , y0, y1] = win!;
      pile.add(mat, band(run, LD, y0, { closed: false, inward }));
      pile.add(mat, band(run, y1, CEIL, { closed: false, inward }));
      pile.add("officeGlass", band(run.map(([x, z]) => [x - side * 0.03, z] as P2), y0, y1, { closed: false, inward }));
      for (let z = a + 0.8; z < b - 0.3; z += 1.6) pile.box("frame", side * hin(z) - 0.06, y0, z - 0.04, side * hin(z) + 0.06, y1, z + 0.04);
      pile.box("white", side * hin((a + b) / 2) - side * 0.18, y0 - 0.05, a, side * hin((a + b) / 2) + side * 0.02, y0, b);
    }
    col.wall(pts(z0, z1), LD, CEIL, 0.2);
  };
  // The hull's long window band (dims: mats.ts BANDS), trimmed in from its slanted ends.
  const WIN_LONG: [number, number, number, number] = [-8.5, 33.5, 2.45, 3.75];
  const WIN_AFT: [number, number, number, number] = [43.6, 49.4, 2.9, 3.5];
  const cove = (x0: number, x1: number, z0: number, z1: number) => pile.box("cove", x0, CEIL - 0.04, z0, x1, CEIL, z1);
  const node = (id: string, x: number, z: number) => plan.node(id, x, LD, z);
  /** The nearest of these nodes to (x, z). */
  const nearest = (ids: string[], x: number, z: number) =>
    ids.reduce((b, id) => { const p = plan.nodes.get(id)!, q = plan.nodes.get(b)!; return Math.hypot(p[0] - x, p[2] - z) < Math.hypot(q[0] - x, q[2] - z) ? id : b; });

  // ---------- the deck itself: one floor to walk on, the lining, the ends ----------
  col.floor(area(null, null, Z.fwd, Z.aft + 0.1, 0.25), LD, 0.3);
  for (const side of [1, -1] as const) {
    lining(side, Z.fwd, Z.server, "inDark");
    lining(side, Z.server, Z.mess, "inWall", WIN_LONG);
    lining(side, Z.mess, Z.rowB, side > 0 ? "inWall" : "navy", side > 0 ? WIN_LONG : null);
    lining(side, Z.rowB, Z.rowA, "inWall", side > 0 ? WIN_AFT : null);
    lining(side, Z.rowA, Z.aft, "inWall", WIN_AFT);
  }
  wallZ(Z.fwd, null, null, "white", "inDark");

  // ---------- the server room ----------
  floor("dark", null, null, Z.fwd, Z.server);
  const holes = crewStairHoles();
  ceiling("inDark", null, null, Z.fwd, Z.server, holes);
  // Blue light lines along the aisles overhead.
  for (const x of [-9.9, -5.6, -2.2, 2.2, 5.6, 9.9]) pile.box("glowBlue", x - 0.04, CEIL - 0.03, Z.fwd + 1, x + 0.04, CEIL, Z.server - 0.6);
  // The glass wall aft, onto the mess, with a doorway.
  for (const [a, b] of [[-hin(Z.server) - 0.1, -1.0], [1.0, hin(Z.server) + 0.1]] as const) {
    pile.box("officeGlass", a, LD, Z.server - 0.02, b, CEIL, Z.server + 0.02);
    col.box(a, LD, Z.server - 0.08, b, CEIL, Z.server + 0.08);
  }
  for (let x = -10.5; x <= 10.6; x += 1.5) if (Math.abs(x) > 1.2) pile.box("frame", x - 0.04, LD, Z.server - 0.05, x + 0.04, CEIL, Z.server + 0.05);
  pile.box("frame", -hin(Z.server), LD + 2.3, Z.server - 0.05, hin(Z.server), LD + 2.36, Z.server + 0.05);
  for (const x of [-1.0, 1.0]) pile.box("frame", x - 0.05, LD, Z.server - 0.06, x + 0.05, CEIL, Z.server + 0.06);
  // Racks: inner rows facing the core, outer rows facing the aisles along the hull.
  const racks: RackSpot[] = [];
  const row = (x: number, z0: number, z1: number, faceX: number) => {
    for (let z = z0; z <= z1 + 1e-6; z += RACK.w + 0.02) {
      const yaw = yawOf(faceX, 0);
      props.put(rack, x, LD, z, yaw);
      racks.push({ x, z, yaw });
    }
    col.box(x - RACK.d / 2, LD, z0 - RACK.w / 2, x + RACK.d / 2, LD + RACK.h, z1 + RACK.w / 2);
    // A cable tray over the row.
    pile.box("frame", x - 0.3, LD + RACK.h + 0.35, z0 - 0.3, x + 0.3, LD + RACK.h + 0.4, z1 + 0.3);
    for (let z = z0; z <= z1; z += 2.4) pile.box("frame", x - 0.02, LD + RACK.h, z - 0.02, x + 0.02, LD + RACK.h + 0.35, z + 0.02);
  };
  for (const side of [1, -1] as const) {
    row(side * 4.2, -30.6, -20.8, -side);
    row(side * 4.2, -9.4, 0.5, -side);
    row(side * 7.0, -30.6, -12.9, side);
    row(side * 7.0, -9.2, 0.5, side);
  }
  // A big board on the forward wall: Computah (the orchestrator)'s own screen (the app paints it).
  const board = screen("core", 6.4, 2.3, helmScreenTexture(), 1.1);
  board.position.set(0, LD + 2.45, Z.fwd + 0.09);
  s.extra.push(board);
  pile.box("dark", -3.35, LD + 1.2, Z.fwd + 0.07, 3.35, LD + 3.7, Z.fwd + 0.085);
  // Round the core: a rail to lean on, a ring of light on the floor (the core itself is core.ts).
  const ringR = 3.0;
  const ringPts: P2[] = Array.from({ length: 33 }, (_, i) => {
    const a = (i / 32) * Math.PI * 2;
    return [CORE.x + Math.cos(a) * ringR, CORE.z + Math.sin(a) * ringR] as P2;
  });
  for (let i = 0; i < 32; i++) {
    const [x0, z0] = ringPts[i]!, [x1, z1] = ringPts[i + 1]!;
    pile.rod("chrome", new THREE.Vector3(x0, LD + 1.05, z0), new THREE.Vector3(x1, LD + 1.05, z1), 0.035, 6);
    pile.rod("chrome", new THREE.Vector3(x0, LD + 0.55, z0), new THREE.Vector3(x1, LD + 0.55, z1), 0.018, 6);
    if (i % 4 === 0) pile.rod("chrome", new THREE.Vector3(x0, LD, z0), new THREE.Vector3(x0, LD + 1.05, z0), 0.03, 6);
  }
  col.wall(ringPts, LD, LD + 1.15, 0.12);
  const glowRing = new THREE.RingGeometry(ringR - 0.25, ringR - 0.12, 64).rotateX(-Math.PI / 2).translate(CORE.x, LD + 0.012, CORE.z);
  glowRing.deleteAttribute("uv");
  pile.add("glowBlue", glowRing);
  // Its nodes, the aisles, and the stairs down from the promenades.
  node("srv-d", 0, 0.9);
  node("srv-a", 0, -4.5);
  const ring = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 2;
    return node(`srv-r${k}`, CORE.x + Math.cos(a) * 3.85, CORE.z + Math.sin(a) * 3.85);
  });
  plan.link(...ring, ring[0]!);
  plan.link("srv-d", "srv-a", ring[0]!);
  plan.link(ring[4]!, node("srv-f", 0, -27.5));
  for (const side of [1, -1] as const) {
    const sn = side > 0 ? "s" : "p";
    const st = stairs(s, { id: `crew-stair-${sn}`, x0: side * CREW_STAIR.x0, x1: side * CREW_STAIR.x1, zLow: CREW_STAIR.zLow, yLow: LD, zHigh: CREW_STAIR.zHigh, yHigh: D1 });
    const cross = node(`srv-${sn}x`, side * 5.6, -11.1);
    const out1 = node(`srv-${sn}o1`, side * 10.75, -11.1);
    const out2 = node(`srv-${sn}o2`, side * 10.75, -23.6);
    const out3 = node(`srv-${sn}o3`, side * 10.75, -1.0);
    plan.link(ring[side > 0 ? 7 : 1]!, cross, out1, out2, st.low);
    plan.link(out1, out3);
    plan.link(st.low, node(`srv-${sn}o4`, side * 10.75, -31.4));
    // The opening up on the promenade: a glass rail round it, open at the stair's head.
    balustrade(s, [[side * 8.05, HOLE.z0 - 0.02], [side * (HOLE.x1 + 0.07), HOLE.z0 - 0.02], [side * (HOLE.x1 + 0.07), HOLE.z1 + 0.02]], D1);
    plan.link(st.high, `d1-${sn}-16`);
    // Along the outer racks, where the stairs come down, the computer can be visited too.
    plan.slot("core", `core-aisle-${sn}`, [side * 9.3, LD, -3.0], yawOf(-side, 0), { nav: out3, tags: ["below", "server-room"] });
  }
  // People stand at the rail round the core, watching it think.
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
    const x = CORE.x + Math.cos(a) * 3.4, z = CORE.z + Math.sin(a) * 3.4;
    plan.slot("core", `core-${k + 1}`, [x, LD, z], yawOf(CORE.x - x, CORE.z - z), { tags: ["below", "server-room"] });
  }

  // ---------- the crew mess and galley ----------
  floor("deskTop", null, null, Z.server, Z.mess);
  ceiling("under", null, null, Z.server, Z.mess);
  for (const x of [-6, 0, 6]) cove(x - 0.15, x + 0.15, Z.server + 1, Z.mess - 1);
  node("mess-c1", 0, 3.6);
  node("mess-c2", 0, 11.0);
  node("mess-c3", 0, 18.8);
  node("mess-w1", 3.3, 10.0);
  node("mess-e1", 6.7, 10.0);
  node("mess-w0", 3.3, 4.2);
  node("mess-e0", 6.7, 4.2);
  node("mess-w2", 3.3, 16.0);
  node("mess-e2", 6.7, 16.0);
  node("gal-e", -3.0, 10.5);
  node("gal-w", -8.4, 10.5);
  node("gal-n", -8.4, 4.4);
  node("gal-s", -5.2, 16.2);
  // The long table, starboard, chairs down both sides.
  const T = { x: 5.0, z0: 5.6, z1: 14.4 };
  pile.box("deskTop", T.x - 0.55, LD + 0.72, T.z0, T.x + 0.55, LD + 0.76, T.z1);
  for (const z of [T.z0 + 0.4, T.z1 - 0.4]) for (const dx of [-0.4, 0.4]) pile.box("chrome", T.x + dx - 0.03, LD, z - 0.03, T.x + dx + 0.03, LD + 0.72, z + 0.03);
  col.box(T.x - 0.55, LD, T.z0, T.x + 0.55, LD + 0.78, T.z1);
  let seat = 0;
  for (let z = T.z0 + 0.5; z < T.z1 - 0.3; z += 0.98) for (const sx of [-1, 1]) {
    const x = T.x + sx * 0.88, yaw = yawOf(-sx, 0);
    props.put(chair, x, LD, z, yaw);
    plan.slot("deck-chair", `mess-${++seat}`, [x, LD, z], yaw, { seat: 0.46, nav: sx < 0 ? nearest(["mess-w0", "mess-w1", "mess-w2"], x, z) : nearest(["mess-e0", "mess-e1", "mess-e2"], x, z), tags: ["below", "mess", "indoors"] });
  }
  // Things on the table: a bowl of fruit, mugs.
  for (const z of [7.3, 10.1, 12.9]) pile.cyl("white", T.x, LD + 0.76, z, 0.16, 0.08, 14, 0.2);
  for (const [dx, z] of [[-0.3, 6.4], [0.3, 8.7], [-0.25, 11.6], [0.28, 13.5]] as const) pile.cyl("accent", T.x + dx, LD + 0.76, z, 0.045, 0.1, 10);
  // The galley along the port side: counters under the windows, an island with stools, a fridge.
  const gx = -hin(10) + 0.36;
  pile.box("white", gx - 0.33, LD, Z.server + 1.2, gx + 0.33, LD + 0.88, Z.mess - 1.6);
  pile.box("stone", gx - 0.36, LD + 0.88, Z.server + 1.2, gx + 0.36, LD + 0.93, Z.mess - 1.6);
  col.box(gx - 0.4, LD, Z.server + 1.2, gx + 0.4, LD + 1.0, Z.mess - 1.6);
  pile.box("dark", gx - 0.25, LD + 0.93, 9.2, gx + 0.25, LD + 0.94, 10.6); // the hob
  pile.box("steel", gx - 0.2, LD + 0.93, 6.0, gx + 0.25, LD + 0.95, 7.2); // the sink
  pile.box("steel", -hin(19) + 0.05, LD, Z.mess - 1.45, -hin(19) + 1.0, LD + 2.2, Z.mess - 0.15); // the fridge
  col.box(-hin(19), LD, Z.mess - 1.45, -hin(19) + 1.05, LD + 2.2, Z.mess - 0.1);
  const I = { x: -5.2, z0: 7.0, z1: 14.0 };
  pile.box("white", I.x - 0.5, LD, I.z0, I.x + 0.5, LD + 0.9, I.z1);
  pile.box("stone", I.x - 0.6, LD + 0.9, I.z0 - 0.05, I.x + 0.6, LD + 0.95, I.z1 + 0.05);
  col.box(I.x - 0.6, LD, I.z0 - 0.05, I.x + 0.6, LD + 1.0, I.z1 + 0.05);
  props.put(coffeeMachine, I.x, LD + 0.95, I.z1 - 0.5, Math.PI / 2);
  s.coffee = new THREE.Vector3(I.x + 0.15, LD + 1.45, I.z1 - 0.5);
  for (let i = 0; i < 4; i++) {
    const z = I.z0 + 1.0 + i * 1.45, x = I.x + 1.05;
    props.put(barStool, x, LD, z);
    plan.slot("bar-stool", `galley-stool-${i + 1}`, [x, LD, z], yawOf(-1, 0), { seat: 0.76, nav: "gal-e", tags: ["below", "mess", "indoors"] });
  }
  for (const [x, z] of [[9.8, 18.9], [-2.7, 19.0], [10.4, 3.0]] as const) props.put(palm, x, LD, z, x + z);
  // A lounge corner aft to starboard: a sofa and armchairs round a table, on a rug.
  props.put(sofa, 9.6, LD, 16.6, -Math.PI / 2);
  props.put(coffeeTable, 8.1, LD, 16.6, Math.PI / 2);
  props.put(armchair, 8.1, LD, 14.6, 0);
  pile.box("accent", 6.8, LD, 14.0, 10.6, LD + 0.012, 18.4);
  col.box(7.4, LD, 15.4, 10.1, LD + 0.8, 17.8);
  plan.slot("deck-chair", "mess-sofa", [9.55, LD, 16.6], -Math.PI / 2, { seat: 0.42, nav: "mess-e2", tags: ["below", "mess", "indoors"] });
  plan.slot("deck-chair", "mess-armchair", [8.1, LD, 14.6], 0, { seat: 0.42, nav: "mess-e2", tags: ["below", "mess", "indoors"] });
  plan.link("srv-d", "mess-c1", "mess-c2", "mess-c3");
  plan.link("mess-c1", "mess-w0", "mess-w1", "mess-w2", "mess-c3");
  plan.link("mess-w0", "mess-e0", "mess-e1", "mess-e2", "mess-w2");
  plan.link("mess-c2", "gal-e", "gal-s", "gal-w", "gal-n", "mess-c1");
  plan.link("mess-c2", "mess-w1");

  // ---------- the corridor between the rooms aft ----------
  floor("stone", -COR, COR, Z.mess, Z.rowA);
  ceiling("under", -COR, COR, Z.mess, Z.rowA);
  cove(-0.12, 0.12, Z.mess + 0.5, Z.rowA - 0.5);
  const DOOR = { spa: [37.8, 39.2], gym: [31.5, 32.9], engine: [44.0, 45.4], cinema: [32.2, 33.6] } as const;
  wallX(COR, Z.mess, Z.rowB, "inWall", "inWall", [[...DOOR.gym]]);
  wallX(COR, Z.rowB, Z.rowA, "inWall", "inWall", [[...DOOR.spa]]);
  wallX(-COR, Z.mess, Z.rowB, "inWall", "navy", [[...DOOR.cinema]]);
  wallX(-COR, Z.rowB, Z.rowA, "inWall", "inWall", [[...DOOR.engine]]);
  wallZ(Z.mess, COR, null, "inWall", "inWall");
  wallZ(Z.mess, null, -COR, "inWall", "navy");
  wallZ(Z.rowB, COR, null, "inWall", "inWall");
  wallZ(Z.rowB, null, -COR, "navy", "inWall");
  wallZ(Z.rowA, null, null, "inWall", "inWall", [[-0.9, 0.9]]);
  // Status strips along the corridor walls, by the floor: they glow cyan when the crew is busy.
  for (const sx of [1, -1]) pile.box("status", sx * (COR - 0.075) - 0.01, LD + 0.12, Z.mess + 0.3, sx * (COR - 0.075) + 0.01, LD + 0.16, Z.rowA - 0.3);
  const cz = [21.0, 32.2, 38.5, 44.7].map((z) => node(`cor-${z}`, 0, z));
  plan.link("mess-c3", ...cz, node("cor-aft", 0, 47.3));

  // ---------- the gym (starboard, behind the mess): treadmills at the windows, weights ----------
  floor("pad", COR, null, Z.mess, Z.rowB);
  ceiling("under", COR, null, Z.mess, Z.rowB);
  cove(5.8, 6.1, Z.mess + 1, Z.rowB - 1);
  node("gym-d", 2.6, (DOOR.gym[0] + DOOR.gym[1]) / 2);
  node("gym-a", 7.6, 32.2);
  node("gym-m", 7.6, 26.8);
  node("gym-b", 7.6, 21.6);
  node("gym-w", 3.6, 21.6);
  plan.link("cor-32.2", "gym-d", "gym-a", "gym-m", "gym-b", "gym-w", "gym-d");
  [22.6, 24.7, 26.8, 28.9].forEach((z, i) => {
    const x = hin(z) - 1.25;
    props.put(treadmill, x, LD, z, Math.PI / 2);
    col.obox(x + 0.6, LD + 0.7, z, 0.5, 1.4, 0.9, 0);
    plan.slot("gym", `treadmill-${i + 1}`, [x - 0.1, LD + TREADMILL.belt, z], Math.PI / 2, { nav: nearest(["gym-a", "gym-m", "gym-b"], x, z), tags: ["below", "gym", "run"] });
  });
  props.put(weightBench, 5.4, LD, 26.2, 0);
  col.box(4.3, LD, 25.45, 6.5, LD + 1.25, 25.75);
  col.box(5.2, LD, 25.75, 5.6, LD + 0.5, 26.9);
  plan.slot("gym", "weight-bench", [5.4, LD, 26.4], 0, { seat: 0.46, nav: "gym-m", tags: ["below", "gym", "bench"] });
  props.put(dumbbellRack, COR + 0.4, LD, 25.0, Math.PI / 2);
  col.box(COR, LD, 24.1, COR + 0.7, LD + 0.9, 25.9);
  for (const z of [24.4, 25.6]) plan.slot("gym", `weights-${z}`, [COR + 1.55, LD, z], yawOf(-1, 0), { nav: "gym-w", tags: ["below", "gym", "weights"] });
  // A screen of a workout down the inner wall, a strip of light over it, a punching bag.
  pile.box("dark", COR + 0.075, LD + 1.0, 26.2, COR + 0.1, LD + 2.5, 30.6);
  pile.box("glowBlue", COR + 0.1, LD + 1.1, 26.35, COR + 0.11, LD + 2.4, 30.45);
  pile.box("cove", COR + 0.075, LD + 2.9, 20.5, COR + 0.12, LD + 2.95, 31.0);
  for (const [z, m] of [[21.0, "accent"], [21.9, "red"], [22.8, "yellow"]] as const) pile.add(m, new THREE.TorusGeometry(0.18, 0.05, 8, 18).rotateY(Math.PI / 2).translate(COR + 0.15, LD + 1.6, z));
  pile.rod("chrome", new THREE.Vector3(8.6, CEIL, 31.6), new THREE.Vector3(8.6, LD + 2.1, 31.6), 0.015, 5);
  pile.cyl("red", 8.6, LD + 0.95, 31.6, 0.22, 1.15, 14);
  col.box(8.35, LD, 31.35, 8.85, LD + 2.2, 31.85);

  // ---------- the cinema (port, behind the galley): bean bags facing a screen forward ----------
  floor("navy", null, -COR, Z.mess, Z.rowB);
  ceiling("navy", null, -COR, Z.mess, Z.rowB);
  const film = cinemaScreen(6.4, 2.75);
  film.position.set(-6.7, LD + 2.25, Z.mess + 0.09);
  s.extra.push(film);
  pile.box("dark", -10.05, LD + 0.78, Z.mess + 0.07, -3.35, LD + 3.72, Z.mess + 0.085);
  // Dim aisle lights along the floor, a projector on the back wall with its beam.
  for (let z = 22; z < 33; z += 1.6) pile.box("cove", -COR - 0.1, LD + 0.08, z, -COR - 0.075, LD + 0.12, z + 0.25);
  pile.box("dark", -7.1, CEIL - 0.6, Z.rowB - 0.6, -6.3, CEIL - 0.2, Z.rowB - 0.07);
  s.extra.push(projectorBeam(new THREE.Vector3(-6.7, CEIL - 0.42, Z.rowB - 0.62), film.position, 6.4, 2.75));
  node("cin-d", -2.5, (DOOR.cinema[0] + DOOR.cinema[1]) / 2);
  node("cin-b", -6.7, 33.0);
  node("cin-o", -10.6, 33.0);
  node("cin-o3", -10.6, 27.3);
  node("cin-o2", -10.6, 22.2);
  node("cin-i2", -2.5, 27.3);
  node("cin-i", -2.5, 22.2);
  plan.link("cor-32.2", "cin-d", "cin-b", "cin-o", "cin-o3", "cin-o2");
  plan.link("cin-d", "cin-i2", "cin-i");
  let bean = 0;
  const bags = [beanBagBlue, beanBagWhite, beanBagGrey];
  for (const [z, xs] of [[23.9, [-8.7, -6.7, -4.7]], [26.2, [-9.6, -7.7, -5.7, -3.8]], [28.5, [-8.7, -6.7, -4.7]]] as const) {
    for (const x of xs) {
      props.put(bags[bean % 3]!, x, LD, z, Math.PI + (x + 6.7) * -0.05);
      plan.slot("cinema", `cinema-${++bean}`, [x, LD, z + 0.05], Math.PI, { seat: BEANBAG.seat, nav: nearest(["cin-o2", "cin-o3", "cin-i", "cin-i2"], x, z), tags: ["below", "cinema", "indoors"] });
    }
  }
  props.put(sofa, -6.7, LD, 31.0, Math.PI);
  col.box(-7.85, LD, 30.5, -5.55, LD + 0.8, 31.5);
  for (const dx of [-0.7, 0.7]) plan.slot("cinema", `cinema-sofa${dx > 0 ? 2 : 1}`, [-6.7 + dx, LD, 30.95], Math.PI, { seat: 0.44, nav: "cin-b", tags: ["below", "cinema", "indoors"] });

  // ---------- the spa (starboard, aft): a sauna cabin against the hull, loungers, plants ----------
  floor("stone", COR, null, Z.rowB, Z.rowA);
  ceiling("under", COR, null, Z.rowB, Z.rowA);
  cove(4.6, 4.9, Z.rowB + 1, Z.rowA - 1);
  const SA = { x0: 8.4, z0: 34.6, z1: 40.0, top: LD + 2.45 };
  const sx1 = hin(37) - 0.05;
  // Its walls: wood, a glass front with a door; benches in two tiers; a stove with hot stones.
  pile.box("wood", SA.x0, LD, SA.z0 - 0.1, sx1, SA.top, SA.z0);
  pile.box("wood", SA.x0, LD, SA.z1, sx1, SA.top, SA.z1 + 0.1);
  pile.box("wood", SA.x0, SA.top, SA.z0 - 0.1, sx1, SA.top + 0.1, SA.z1 + 0.1);
  pile.box("wood", SA.x0 - 0.05, LD, SA.z0 - 0.1, SA.x0, SA.top, SA.z0 + 0.4);
  pile.box("officeGlass", SA.x0 - 0.03, LD, SA.z0 + 0.4, SA.x0 + 0.03, SA.top, 36.9);
  pile.box("officeGlass", SA.x0 - 0.03, LD, 38.1, SA.x0 + 0.03, SA.top, SA.z1);
  pile.box("wood", SA.x0 - 0.05, LD + 2.2, 36.9, SA.x0, SA.top, 38.1);
  pile.box("wood", SA.x0, LD, SA.z0, sx1, LD + 0.02, SA.z1); // its slatted floor, a step above the stone
  col.box(SA.x0 - 0.05, LD, SA.z0 - 0.1, sx1, SA.top, SA.z0 + 0.05);
  col.box(SA.x0 - 0.05, LD, SA.z1 - 0.05, sx1, SA.top, SA.z1 + 0.1);
  col.box(SA.x0 - 0.06, LD, SA.z0, SA.x0 + 0.06, SA.top, 36.9);
  col.box(SA.x0 - 0.06, LD, 38.1, SA.x0 + 0.06, SA.top, SA.z1);
  pile.box("wood", sx1 - 0.7, LD, SA.z0 + 1.0, sx1, LD + 0.45, SA.z1);
  pile.box("wood", sx1 - 0.45, LD + 0.45, SA.z0 + 1.0, sx1, LD + 0.9, SA.z1);
  col.box(sx1 - 0.7, LD, SA.z0 + 1.0, sx1, LD + 0.5, SA.z1);
  pile.box("dark", sx1 - 0.65, LD, SA.z0, sx1 - 0.05, LD + 0.75, SA.z0 + 0.7);
  for (let i = 0; i < 9; i++) pile.add("seat", new THREE.DodecahedronGeometry(0.09 + (i % 3) * 0.02).translate(sx1 - 0.55 + (i % 3) * 0.2, LD + 0.8, SA.z0 + 0.15 + Math.floor(i / 3) * 0.2));
  pile.box("cove", SA.x0 + 0.1, SA.top - 0.05, SA.z0 + 0.2, SA.x0 + 0.2, SA.top, SA.z1 - 0.2);
  s.sauna = new THREE.Vector3(sx1 - 0.35, LD + 0.9, SA.z0 + 0.35);
  node("spa-d", 2.6, (DOOR.spa[0] + DOOR.spa[1]) / 2);
  node("spa-a", 6.5, 37.5);
  node("sauna", 9.4, 37.5);
  node("spa-b", 3.4, 43.6);
  plan.link("cor-38.5", "spa-d", "spa-a", "sauna");
  plan.link("spa-a", "spa-b");
  [35.9, 36.9, 37.9, 38.9].forEach((z, i) =>
    plan.slot("sauna", `sauna-${i + 1}`, [sx1 - 0.42, LD, z], yawOf(-1, 0), { seat: 0.45, nav: "sauna", tags: ["below", "spa", "indoors"] }));
  // Two loungers looking at the sea through the aft window, plants, folded towels on a shelf.
  for (const z of [44.0, 45.1]) {
    props.put(lounger, 6.6, LD, z, Math.PI / 2);
    col.obox(6.6, LD + 0.25, z, 2.0, 0.5, 0.74, 0);
    plan.slot("lounger", `lounger-spa-${z}`, [6.6 + LOUNGER.hips, LD, z], Math.PI / 2, { seat: LOUNGER.seat, nav: "spa-b", tags: ["below", "spa", "indoors"] });
  }
  for (const [x, z] of [[9.4, 45.3], [2.2, 34.8], [7.9, 34.9]] as const) props.put(shrub, x, LD, z, z, 1.4);
  pile.box("wood", hin(43) - 0.5, LD + 1.1, 41.2, hin(43) - 0.05, LD + 1.14, 44.6);
  for (let i = 0; i < 5; i++) pile.box(i % 2 ? "cushion" : "accent", hin(43) - 0.45, LD + 1.14, 41.4 + i * 0.62, hin(43) - 0.1, LD + 1.34, 41.9 + i * 0.62);

  // ---------- the engine room (port, aft): two big diesels, pipes, gauges ----------
  floor("frame", null, -COR, Z.rowB, Z.rowA);
  ceiling("inWall", null, -COR, Z.rowB, Z.rowA);
  for (const x of [-2.4, -6.4, -10.6]) pile.box("yellow", x - 0.04, LD, Z.rowB + 0.6, x + 0.04, LD + 0.01, Z.rowA - 0.6);
  cove(-6.5, -6.3, Z.rowB + 0.5, Z.rowA - 0.5);
  for (const ex of [-4.3, -8.6]) engine(pile, ex, 37.2, 43.6);
  for (const ex of [-4.3, -8.6]) col.box(ex - 1.05, LD, 35.95, ex + 1.05, LD + 2.3, 44.45);
  // Pipes along the ceiling and down the hull.
  const pipes: [MatKey, number, number, number][] = [["pipe", -2.0, 4.55, 0.12], ["yellow", -2.4, 4.6, 0.07], ["red", -11.0, 4.5, 0.1], ["pipe", -11.0, 4.2, 0.08], ["steel", -6.4, 4.65, 0.16]];
  for (const [m, x, y, r] of pipes) {
    pile.rod(m, new THREE.Vector3(x, y, Z.rowB + 0.2), new THREE.Vector3(x, y, Z.rowA - 0.2), r, 10);
    for (let z = Z.rowB + 1.5; z < Z.rowA - 1; z += 3) bar(pile, m, new THREE.Vector3(x, y, z - 0.05), new THREE.Vector3(x, y, z + 0.05), r * 1.45, 12);
  }
  for (const z of [35.5, 40.5, 45.0]) pile.rod("pipe", new THREE.Vector3(-hin(z) + 0.15, LD, z), new THREE.Vector3(-hin(z) + 0.15, 4.2, z), 0.08, 8);
  // The control console against the forward wall: a sloped desk of screens and dials.
  pile.box("dark", -8.6, LD, Z.rowB + 0.08, -4.4, LD + 0.85, Z.rowB + 0.75);
  pile.obox("dark", -6.5, LD + 1.05, Z.rowB + 0.3, 4.2, 0.6, 0.12, 0, -0.35);
  col.box(-8.6, LD, Z.rowB, -4.4, LD + 1.0, Z.rowB + 0.8);
  const gauges = gaugePanel(4.0, 0.55);
  gauges.position.set(-6.5, LD + 1.06, Z.rowB + 0.37);
  gauges.rotation.x = -0.35;
  s.extra.push(gauges);
  // Round gauges on the cross wall above it, their needles alive (the tick below).
  s.gauges = [];
  for (let i = 0; i < 6; i++) {
    const x = -8.3 + i * 0.72, y = LD + 2.35;
    const face = new THREE.CircleGeometry(0.24, 24).translate(x, y, Z.rowB + 0.08);
    face.deleteAttribute("uv");
    pile.add("white", face);
    const rim = new THREE.TorusGeometry(0.25, 0.025, 6, 24).translate(x, y, Z.rowB + 0.08);
    rim.deleteAttribute("uv");
    pile.add("chrome", rim);
    s.gauges.push(new THREE.Vector3(x, y, Z.rowB + 0.1));
  }
  node("eng-d", -2.5, (DOOR.engine[0] + DOOR.engine[1]) / 2);
  node("eng-i", -2.5, 35.6);
  node("eng-c", -6.5, 35.6);
  node("eng-o", -10.7, 35.6);
  node("eng-o2", -10.7, 44.9);
  plan.link("cor-44.7", "eng-d", "eng-i", "eng-c", "eng-o", "eng-o2");
  plan.slot("workshop", "engine-console", [-6.5, LD, 35.2], Math.PI, { nav: "eng-c", tags: ["below", "engine-room"] });

  // ---------- the beach club ----------
  const W = STERN_DOOR;
  floor("teak", null, null, Z.rowA, PLATFORM.z0 - 0.12);
  ceiling("under", -WELL, WELL, Z.rowA, 56.0);
  for (const sx of [1, -1]) {
    const lo = sx > 0 ? WELL : null, hi = sx > 0 ? null : -WELL;
    ceiling("under", lo, hi, Z.rowA, TRANSOM - 0.25);
    for (const z of [48.5, 52.5, 56.5, 60.5]) for (const x of [5.6, 9.2]) {
      pile.cyl("cove", sx * x, CEIL - 0.03, z, 0.12, 0.03, 12);
    }
    // The transom from inside, round its doorway: the wall, and the reveal through to the platform.
    const edge = hin(TRANSOM) + 0.35;
    const zi = TRANSOM - 0.25, zo = TRANSOM - 0.015;
    const xs = (a: number, b: number): [number, number] => [Math.min(sx * a, sx * b), Math.max(sx * a, sx * b)];
    for (const [a, b] of [xs(WELL + 0.08, W.x0), xs(W.x1, edge)]) {
      pile.box("inWall", a, LD, zi, b, CEIL, zo);
      col.box(a, LD, zi, b, CEIL, TRANSOM + 0.05);
    }
    const [a, b] = xs(W.x0, W.x1);
    pile.box("inWall", a, W.top, zi, b, CEIL, zo);
    pile.box("frame", a, W.top - 0.05, zi - 0.02, b, W.top, zo);
  }
  // Starboard: the bar against the well wall, stools, loungers looking out at the sea.
  props.put(barBack, WELL + 0.36, LD, 56.6, Math.PI / 2);
  for (let i = 0; i < 5; i++) {
    const z = 53.2 + i * 1.3;
    pile.obox("wood", 5.05, LD + 0.52, z, 0.55, 1.04, 1.32, 0);
    pile.obox("white", 5.12, LD + 1.08, z, 0.78, 0.06, 1.34, 0);
  }
  pile.box("cove", 5.36, LD + 0.1, 52.6, 5.4, LD + 0.9, 59.0);
  col.box(4.75, LD, 52.55, 5.45, LD + 1.1, 59.1);
  for (let i = 0; i < 5; i++) {
    const z = 53.2 + i * 1.3, x = 6.15;
    props.put(barStool, x, LD, z);
    plan.slot("bar-stool", `beach-bar-${i + 1}`, [x, LD, z], yawOf(-1, 0), { seat: 0.76, nav: "bc-s2", tags: ["below", "beach-club", "bar"] });
  }
  for (const [x, z] of [[9.3, 50.8], [10.4, 50.8], [9.3, 55.4], [10.4, 55.4]] as const) {
    props.put(lounger, x, LD, z, 0);
    col.obox(x, LD + 0.25, z, 0.74, 0.5, 2.0, 0);
    plan.slot("lounger", `lounger-beach-${x}-${z}`, [x, LD, z + LOUNGER.hips], 0, { seat: LOUNGER.seat, nav: z < 53 ? "bc-s3" : "bc-s2", tags: ["below", "beach-club"] });
  }
  for (const [x, z] of [[11.0, 47.0], [11.0, 57.6]] as const) props.put(palm, x, LD, z, z);
  // A round daybed by the doorway, and pictures either side of the corridor's door.
  props.put(daybed, 9.7, LD, 59.7, 0);
  col.box(8.6, LD, 58.6, 10.8, LD + 0.5, 60.8);
  plan.slot("lounger", "daybed-beach", [9.7, LD, 59.7 + DAYBED.hips], 0, { seat: DAYBED.seat, nav: "bc-s1", tags: ["below", "beach-club"] });
  for (const [x, m] of [[-2.4, "accent"], [2.4, "pipe"]] as const) {
    pile.box("frame", x - 0.85, LD + 1.2, Z.rowA + 0.07, x + 0.85, LD + 2.5, Z.rowA + 0.1);
    pile.box(m, x - 0.78, LD + 1.27, Z.rowA + 0.1, x + 0.78, LD + 2.43, Z.rowA + 0.11);
    pile.box("cove", x - 0.6, LD + 1.6 + (x > 0 ? 0.3 : 0), Z.rowA + 0.11, x + 0.3, LD + 1.66 + (x > 0 ? 0.3 : 0), Z.rowA + 0.115);
  }
  // The middle, under the stern terrace: a sofa, armchairs, a table.
  props.put(sofa, 0, LD, 55.2, Math.PI);
  props.put(coffeeTable, 0, LD, 53.7, 0);
  for (const sx of [-1, 1]) props.put(armchair, sx * 1.45, LD, 52.3, 0);
  col.box(-2.0, LD, 51.8, 2.0, LD + 0.8, 55.7);
  plan.slot("deck-chair", "beach-sofa-1", [-0.6, LD, 55.15], Math.PI, { seat: 0.42, nav: "bc-c", tags: ["below", "beach-club"] });
  plan.slot("deck-chair", "beach-sofa-2", [0.6, LD, 55.15], Math.PI, { seat: 0.42, nav: "bc-c", tags: ["below", "beach-club"] });
  for (const sx of [-1, 1]) plan.slot("deck-chair", `beach-armchair-${sx > 0 ? "s" : "p"}`, [sx * 1.45, LD, 52.3], 0, { seat: 0.42, nav: "bc-c", tags: ["below", "beach-club"] });
  pile.box("accent", -2.2, LD, 51.6, 2.2, LD + 0.012, 56.0); // a rug
  // Port: the tender garage. The tender on its cradle, two jet skis on dollies, a work bench.
  props.put(tender, -9.0, LD, 53.6, 0);
  col.box(-10.45, LD, 49.6, -7.55, LD + 2.1, 57.6);
  for (const z of [51.6, 55.6]) {
    props.put(jetSki, -5.6, LD, z, 0);
    col.box(-6.2, LD, z - 1.6, -5.0, LD + 1.3, z + 1.6);
    plan.slot("workshop", `jet-ski-${z < 53 ? 1 : 2}`, [-4.5, LD, z - 0.4], yawOf(-1, 0), { nav: "bc-p2", tags: ["below", "beach-club", "garage"] });
  }
  for (const x of [-9.0, -5.6]) pile.box("frame", x - 0.6, LD, 50, x + 0.6, LD + 0.012, TRANSOM - 0.3); // slipway strips
  // Toys on the hull's wall: paddleboards, a kayak, life rings.
  for (const [i, m] of (["accent", "yellow", "white", "red"] as const).entries()) {
    const z = 50.5 + i * 0.9, x = -hin(z) + 0.18;
    pile.add(m, new THREE.CapsuleGeometry(0.33, 2.6, 4, 12).scale(1, 1, 0.18).rotateY(Math.PI / 2).translate(x, LD + 1.75, z));
  }
  for (const z of [47.6, 59.6]) {
    const ring = new THREE.TorusGeometry(0.34, 0.09, 8, 20).rotateY(Math.PI / 2).translate(-hin(z) + 0.12, LD + 1.9, z);
    ring.deleteAttribute("uv");
    pile.add("red", ring);
  }
  pile.box("wood", -10.8, LD, Z.rowA + 0.1, -6.8, LD + 0.9, Z.rowA + 0.8);
  pile.box("dark", -10.8, LD + 1.2, Z.rowA + 0.08, -6.8, LD + 2.4, Z.rowA + 0.12);
  for (let i = 0; i < 7; i++) pile.box("steel", -10.5 + i * 0.55, LD + 1.5 + (i % 2) * 0.3, Z.rowA + 0.12, -10.42 + i * 0.55, LD + 2.1, Z.rowA + 0.16);
  col.box(-10.8, LD, Z.rowA, -6.8, LD + 1.0, Z.rowA + 0.85);
  plan.slot("workshop", "garage-bench", [-8.8, LD, Z.rowA + 1.25], Math.PI, { nav: "bc-p4", tags: ["below", "beach-club", "garage"] });
  // The garage door, rolled up into the head of the opening.
  pile.rod("white", new THREE.Vector3(-W.x1, W.top - 0.25, TRANSOM - 0.45), new THREE.Vector3(-W.x0, W.top - 0.25, TRANSOM - 0.45), 0.22, 12);
  // Starboard's opening: glass doors slid back to either side, a white drape at each.
  for (const [a, b] of [[W.x0, W.x0 + 1.6], [W.x1 - 1.6, W.x1]] as const) {
    pile.box("officeGlass", a, LD, TRANSOM - 0.35, b, W.top - 0.05, TRANSOM - 0.3);
    pile.box("frame", a, LD, TRANSOM - 0.37, b, LD + 0.06, TRANSOM - 0.28);
    for (const x of [a, b]) pile.box("frame", x - 0.03, LD, TRANSOM - 0.37, x + 0.03, W.top - 0.05, TRANSOM - 0.28);
    col.box(a, LD, TRANSOM - 0.4, b, W.top, TRANSOM - 0.25);
  }
  s.drapes.push({ x: W.x0 + 0.25, z: TRANSOM - 0.6, y0: LD + 0.05, y1: W.top - 0.1, w: 0.9, axis: "x" });
  s.drapes.push({ x: W.x1 - 1.15, z: TRANSOM - 0.6, y0: LD + 0.05, y1: W.top - 0.1, w: 0.9, axis: "x" });
  // Walking: in from the platform through both doorways, across the club, into the corridor.
  node("bc-s0", 7.4, 63.6);
  node("bc-s1", 7.4, 60.4);
  node("bc-s2", 7.4, 55.0);
  node("bc-s3", 7.4, 48.4);
  node("bc-c", 0, 50.9);
  node("bc-p0", -4.6, 63.6);
  node("bc-p1", -4.45, 60.4);
  node("bc-p2", -4.35, 53.6);
  node("bc-p3", -4.35, 48.4);
  node("bc-p4", -6.85, 48.4);
  plan.link("plat-s", "bc-s0", "bc-s1", "bc-s2", "bc-s3", "bc-c", "bc-p3", "bc-p2", "bc-p1", "bc-p0", "plat-p");
  plan.link("bc-p3", "bc-p4");
  plan.link("bc-c", "cor-aft");
  plan.link("bc-s0", "s0:low");
  plan.link("bc-p0", "s0:low");

  // ---------- the fold-down swim platform: its hinge and rams on the transom ----------
  s.pile.rod("chrome", new THREE.Vector3(-8.6, PLATFORM.y - 0.02, TRANSOM + 0.06), new THREE.Vector3(8.6, PLATFORM.y - 0.02, TRANSOM + 0.06), 0.06, 10);
  for (const sx of [1, -1]) for (const x of [3.7, 11.0]) {
    const top = new THREE.Vector3(sx * x, 4.1, TRANSOM + 0.04), foot = new THREE.Vector3(sx * x, PLATFORM.y + 0.04, TRANSOM + 1.45);
    s.pile.rod("steel", top, top.clone().lerp(foot, 0.55), 0.07, 8);
    s.pile.rod("chrome", top.clone().lerp(foot, 0.5), foot, 0.045, 8);
    s.pile.box("steel", sx * x - 0.1, 4.0, TRANSOM, sx * x + 0.1, 4.25, TRANSOM + 0.08);
  }

  return { racks };
}

/** A solid round bar from a to b (closed ends, unlike Pile.rod). */
function bar(pile: Ship["inner"], mat: MatKey, a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 16) {
  const d = new THREE.Vector3().subVectors(b, a), len = d.length();
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  g.deleteAttribute("uv");
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  pile.add(mat, g, new THREE.Matrix4().compose(a.clone().lerp(b, 0.5), q, new THREE.Vector3(1, 1, 1)));
}

/** A diesel: a block on a skid, red valve covers on its V, turbos at the aft end, the gearbox forward. */
function engine(pile: Ship["inner"], x: number, z0: number, z1: number) {
  pile.box("frame", x - 1.05, LD, z0 - 0.4, x + 1.05, LD + 0.3, z1 + 0.6);
  pile.box("engine", x - 0.78, LD + 0.3, z0, x + 0.78, LD + 1.45, z1);
  pile.box("engine", x - 0.95, LD + 0.55, z0 + 0.2, x + 0.95, LD + 1.1, z1 - 0.2);
  for (const sx of [-1, 1]) {
    pile.obox("engine", x + sx * 0.45, LD + 1.55, (z0 + z1) / 2, 0.6, 0.4, z1 - z0 - 0.2, 0, 0, sx * -0.55);
    pile.obox("red", x + sx * 0.6, LD + 1.8, (z0 + z1) / 2, 0.42, 0.18, z1 - z0 - 0.6, 0, 0, sx * -0.55);
    for (let k = 0; k < 8; k++) pile.cyl("steel", x + sx * 0.68, LD + 1.88, z0 + 0.6 + k * ((z1 - z0 - 1.2) / 7), 0.05, 0.12, 8);
  }
  pile.box("steel", x - 0.22, LD + 1.45, z0 + 0.3, x + 0.22, LD + 2.0, z1 - 0.3);
  for (const sx of [-1, 1]) {
    bar(pile, "steel", new THREE.Vector3(x + sx * 0.4, LD + 1.9, z1 + 0.15), new THREE.Vector3(x + sx * 0.4, LD + 1.9, z1 + 0.65), 0.28);
    bar(pile, "inWall", new THREE.Vector3(x + sx * 0.4, LD + 2.1, z1 + 0.4), new THREE.Vector3(x + sx * 0.4, LD_CEIL, z1 + 0.4), 0.17);
  }
  bar(pile, "engine", new THREE.Vector3(x, LD + 0.95, z0 - 0.06), new THREE.Vector3(x, LD + 0.95, z0 + 0.02), 0.72, 24);
  pile.box("pipe", x - 0.55, LD + 0.3, z0 - 1.2, x + 0.55, LD + 1.2, z0 - 0.05);
  pile.box("yellow", x - 0.8, LD + 0.3, z1 - 0.02, x + 0.8, LD + 0.36, z1 + 0.04);
}

/**
 * The cinema's screen: a film that plays forever. A slow evening at sea (a sky that turns, a sun
 * going down, a boat crossing, waves) drawn by a small shader, so it costs one quad.
 */
function cinemaScreen(w: number, h: number): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: LIGHT.uTime },
    toneMapped: false,
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: /* glsl */ `
      uniform float uTime; varying vec2 vUv;
      void main() {
        vec2 p = vUv;
        float t = uTime * 0.05, cyc = fract(t);
        float sunY = 0.85 - cyc * 0.75;
        vec3 top = mix(vec3(0.15, 0.35, 0.75), vec3(0.08, 0.06, 0.2), cyc);
        vec3 hor = mix(vec3(1.0, 0.75, 0.45), vec3(0.9, 0.35, 0.25), cyc);
        vec3 col = mix(hor, top, smoothstep(0.42, 1.0, p.y));
        float d = length((p - vec2(0.62, sunY)) * vec2(2.3, 1.0));
        col += vec3(1.0, 0.8, 0.5) * (smoothstep(0.09, 0.08, d) * 1.5 + 0.35 * exp(-d * 6.0));
        if (p.y < 0.42) {
          float wave = sin(p.x * 60.0 + uTime * 1.3 + p.y * 40.0) * 0.5 + 0.5;
          vec3 sea = mix(vec3(0.05, 0.18, 0.35), hor * 0.6, smoothstep(0.0, 0.42, p.y) * 0.7);
          float glit = smoothstep(0.08, 0.0, abs(p.x - 0.62)) * wave * smoothstep(0.42, 0.1, p.y);
          col = sea + vec3(1.0, 0.8, 0.5) * glit * 0.6;
        }
        float bx = fract(uTime * 0.013) * 1.4 - 0.2;
        vec2 b = p - vec2(bx, 0.43);
        float hull = step(abs(b.x), 0.06) * step(-0.012, b.y) * step(b.y, 0.0 + 0.01 * (1.0 - abs(b.x) / 0.06));
        float house = step(abs(b.x + 0.01), 0.03) * step(0.0, b.y) * step(b.y, 0.025);
        col = mix(col, vec3(0.05, 0.06, 0.1), max(hull, house));
        col *= smoothstep(0.0, 0.03, p.x) * smoothstep(1.0, 0.97, p.x) * smoothstep(0.0, 0.03, p.y) * smoothstep(1.0, 0.97, p.y);
        gl_FragColor = vec4(col * 1.25, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  mesh.name = "cinema-film";
  return mesh;
}

/** The projector's beam: a faint wedge of light from the back wall to the screen. */
function projectorBeam(from: THREE.Vector3, to: THREE.Vector3, w: number, h: number): THREE.Mesh {
  const g = new THREE.BufferGeometry();
  const c = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) => new THREE.Vector3(to.x + x!, to.y + y!, to.z + 0.05));
  const pos: number[] = [], al: number[] = [];
  for (let i = 0; i < 4; i++) {
    const a = c[i]!, b = c[(i + 1) % 4]!;
    pos.push(from.x, from.y, from.z, a.x, a.y, a.z, b.x, b.y, b.z);
    al.push(1, 0.25, 0.25);
  }
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aA", new THREE.Float32BufferAttribute(al, 1));
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: "attribute float aA; varying float vA; void main(){ vA = aA; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: "varying float vA; void main(){ gl_FragColor = vec4(vec3(0.5, 0.55, 0.65) * 0.022 * (vA * vA + 0.3), 1.0); }",
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.name = "projector-beam";
  return mesh;
}

/** The engine console's panel: screens of engine data and a row of dials, lit. */
function gaugePanel(w: number, h: number): THREE.Mesh {
  const c = document.createElement("canvas");
  c.width = 1024; c.height = 140;
  const g = c.getContext("2d")!;
  g.fillStyle = "#0a1018"; g.fillRect(0, 0, 1024, 140);
  for (let i = 0; i < 4; i++) {
    const x = 16 + i * 252;
    g.fillStyle = "#0f2235"; g.fillRect(x, 14, 236, 112);
    g.strokeStyle = i % 2 ? "#9be28f" : "#4fd1ff"; g.lineWidth = 3;
    g.beginPath();
    for (let k = 0; k <= 40; k++) { const px = x + 10 + k * 5.4, py = 92 - 30 * Math.abs(Math.sin(k * 0.35 + i)) - k * 0.4; k ? g.lineTo(px, py) : g.moveTo(px, py); }
    g.stroke();
    g.fillStyle = "#f2c46d"; g.fillRect(x + 12, 22, 60 + i * 18, 10);
    g.fillStyle = "#7d97b5"; g.fillRect(x + 12, 104, 120, 8);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, color: new THREE.Color(1.2, 1.2, 1.2) }));
  mesh.name = "engine-console";
  return mesh;
}
