// The office: a double-height glass hall midship on D2, the canopy deck for a roof. Four long
// lines of desks run fore and aft in groups of three: the inner lines face out toward the
// windows, the outer lines face in, so from the central aisle and from the window aisles you
// look over people's shoulders at their screens. A wall board up front, a lounge aft.

import * as THREE from "three";
import { D2, D3, D4, OFFICE, SLAB } from "./dims.ts";
import { DESK, HAMMOCK, LOUNGER, armchair, coffeeTable, deckChair, desk, hammock, lounger, officeChair, palm, shrub, sideTable, sofa } from "./furniture.ts";
import { along, band, yawOf, type P2 } from "./kit.ts";
import { balustrade, roomLight, type Ship } from "./parts.ts";
import { deskScreenTexture, screen, wallScreenTexture } from "./screens.ts";

const CEIL = D4 - SLAB;
const G = OFFICE.glass;
/** Desk lines across the office: x of the desk's centre, and which way its user faces (±1 in x). */
const LINES: [number, 1 | -1][] = [[-5.6, 1], [-2.8, -1], [2.8, 1], [5.6, -1]];
const GROUPS = [-17.0, -10.2, -3.4];
const PITCH = 1.75;
export const DESK_Z = GROUPS.flatMap((z0) => [0, 1, 2].map((k) => z0 + k * PITCH));
const CROSS = [-11.85, -5.05];
const SIDE_DOORS: [number, number][] = [[-20.6, -18.6], [11.6, 13.6]];
const DOOR_TOP = D2 + 2.45;

export function buildOffice(s: Ship) {
  const { pile, col, plan, props } = s;

  // Floor, a step's thickness above the deck's teak.
  pile.box("floor", -G + 0.05, D2, OFFICE.z0 + 0.05, G - 0.05, D2 + 0.02, OFFICE.z1 - 0.05);

  // Side walls: floor-to-ceiling glass with slim white mullions, doors fore and aft.
  for (const side of [1, -1] as const) {
    const x = side * G;
    const cuts = [OFFICE.z0, ...SIDE_DOORS.flat(), OFFICE.z1];
    for (let i = 0; i < cuts.length; i += 2) {
      const z0 = cuts[i]!, z1 = cuts[i + 1]!;
      const run: P2[] = [[x, z0], [x, z1]];
      pile.add("officeGlass", band(run, D2 + 0.08, CEIL, { closed: false }));
      col.wall(run, D2, CEIL, 0.12);
    }
    for (const [z0, z1] of SIDE_DOORS) {
      pile.add("officeGlass", band([[x, z0], [x, z1]], DOOR_TOP + 0.12, CEIL, { closed: false }));
      pile.box("white", x - 0.07, DOOR_TOP, z0, x + 0.07, DOOR_TOP + 0.12, z1);
      for (const z of [z0, z1]) pile.box("white", x - 0.08, D2, z - 0.06, x + 0.08, DOOR_TOP, z + 0.06);
    }
    for (const m of along([[x, OFFICE.z0], [x, OFFICE.z1]], 3.1, 1.55)) pile.box("frame", x - 0.04, D2, m.z - 0.035, x + 0.04, CEIL, m.z + 0.035);
    pile.box("white", x - 0.1, D2, OFFICE.z0, x + 0.1, D2 + 0.1, OFFICE.z1); // sill
  }

  // The front wall: white, the wall board in its middle. The way in is through the side doors.
  pile.box("white", -G, D2, OFFICE.z0 - 0.2, G, CEIL, OFFICE.z0);
  col.box(-G, D2, OFFICE.z0 - 0.3, G, CEIL, OFFICE.z0);
  const board = screen("wall", 9.6, 3.75, wallScreenTexture(), 1.1);
  board.position.set(0, D2 + 3.6, OFFICE.z0 + 0.03);
  s.extra.push(board);
  pile.box("dark", -4.95, D2 + 1.6, OFFICE.z0, 4.95, D2 + 5.6, OFFICE.z0 + 0.02);

  // The aft wall: white up to the sun deck behind it, glass above, looking up at the sun deck.
  pile.box("white", -G, D2, OFFICE.z1, G, D3, OFFICE.z1 + 0.2);
  col.box(-G, D2, OFFICE.z1, G, CEIL, OFFICE.z1 + 0.3);
  pile.add("officeGlass", band([[-G, OFFICE.z1], [G, OFFICE.z1]], D3, CEIL, { closed: false }));
  for (const m of along([[-G, OFFICE.z1], [G, OFFICE.z1]], 3.1, 1.5)) pile.box("frame", m.x - 0.035, D3, OFFICE.z1, m.x + 0.035, CEIL, OFFICE.z1 + 0.08);

  // Status strips: a line of light along the foot and the head of the glass all round, and a
  // frame round the wall board. Dark at rest; they glow cyan as the crew gets to work.
  for (const side of [1, -1] as const) {
    const x = side * (G - 0.14);
    const cuts = [OFFICE.z0 + 0.3, ...SIDE_DOORS.flat(), OFFICE.z1 - 0.3];
    for (let i = 0; i < cuts.length; i += 2) pile.box("status", x - 0.015, D2 + 0.1, cuts[i]!, x + 0.015, D2 + 0.155, cuts[i + 1]!);
    pile.box("status", x - 0.015, CEIL - 0.18, OFFICE.z0 + 0.3, x + 0.015, CEIL - 0.13, OFFICE.z1 - 0.3);
  }
  for (const y of [D2 + 1.66, D2 + 5.5]) pile.box("status", -4.92, y, OFFICE.z0 + 0.02, 4.92, y + 0.035, OFFICE.z0 + 0.035);
  for (const x of [-4.9, 4.9]) pile.box("status", x - 0.018, D2 + 1.66, OFFICE.z0 + 0.02, x + 0.018, D2 + 5.535, OFFICE.z0 + 0.035);

  // Light: long panels in the ceiling over each line of desks; brighter as the crew gets to work.
  for (const [x] of LINES) pile.box("panel", x - 0.25, CEIL - 0.03, -19.5, x + 0.25, CEIL, 12.5);
  pile.box("panel", -0.25, CEIL - 0.03, -19.5, 0.25, CEIL, 12.5);
  // After dark the panels light the room for real: the crew at their desks, warm, not silhouettes
  // against the screens. Brighter with work under way.
  for (const z of [-15, -4, 7]) roomLight(s, 0, CEIL - 1.2, z, { intensity: 9, distance: 15, color: "#ffe6c8", busy: 0.5 });

  // The desks: a desk, a chair and a screen each, and a slot facing the screen.
  const screenMap = deskScreenTexture();
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  let n = 0;
  for (const z of DESK_Z) for (const [x, f] of LINES) {
    // f: the way the user faces in x. The prefab's user side is its +z: turn it to -f.
    const yaw = yawOf(-f, 0);
    props.put(desk, x, D2, z, yaw);
    const cx = x - f * 0.72;
    props.put(officeChair, cx, D2, z, yaw);
    col.obox(x, D2 + DESK.h / 2, z, DESK.d, DESK.h, DESK.w, 0);
    const id = `desk-${String(++n).padStart(2, "0")}`;
    const sc = screen(id, DESK.screen.w, DESK.screen.h, screenMap);
    q.setFromAxisAngle(up, yaw);
    m.compose(new THREE.Vector3(x, D2, z), q, new THREE.Vector3(1, 1, 1));
    sc.position.set(0, DESK.screen.y, DESK.screen.z + 0.003).applyMatrix4(m);
    sc.quaternion.copy(q);
    s.extra.push(sc);
    plan.slot("desk", id, [cx, D2, z], yawOf(f, 0), { seat: 0.47, tags: ["office", "indoors"] });
  }
  // Palms in the middle aisles and the corners, a plant on the odd desk.
  for (const side of [1, -1]) {
    for (const z of [-15.25, -8.45, -1.65, 1.5]) props.put(palm, side * 4.2, D2, z, z * 1.3);
    props.put(palm, side * 6.0, D2, -21.55, 0.4);
  }
  for (const [x, z] of [[-5.6, -13.5], [2.8, -8.45], [5.6, -1.65], [-2.8, 0.1]] as const) props.put(shrub, x, D2 + DESK.h, z + 0.55, 0, 0.55);

  // The lounge aft: sofas facing across coffee tables.
  for (const side of [1, -1]) {
    props.put(sofa, side * 3.6, D2, 6.2, 0);
    props.put(sofa, side * 3.6, D2, 10.6, Math.PI);
    props.put(coffeeTable, side * 3.6, D2, 8.4, 0);
    props.put(palm, side * 6.3, D2, 8.4, 0.7);
    col.box(side * 3.6 - 1.15, D2, 5.7, side * 3.6 + 1.15, D2 + 0.8, 11.1);
  }

  // Walking: a central aisle, an aisle down each window, cross aisles between the desk groups.
  const zs = [-20.8, ...DESK_Z, ...CROSS, 3.0, 7.0, 12.6, 14.0].sort((a, b) => a - b);
  const centre = zs.filter((z) => z !== 12.6 && z !== 14.0).map((z) => plan.node(`office-c${z.toFixed(2)}`, 0, D2, z));
  plan.link(...centre);
  for (const side of [1, -1] as const) {
    const sn = side > 0 ? "s" : "p";
    const win = [-20.8, -19.6, ...DESK_Z, ...CROSS, 3.0, 7.0, 12.6, 14.0].sort((a, b) => a - b).map((z) => plan.node(`office-${sn}${z.toFixed(2)}`, side * 7.45, D2, z));
    plan.link(...win);
    for (const z of [-20.8, ...CROSS, 3.0]) {
      const mid = plan.node(`office-${sn}m${z.toFixed(2)}`, side * 4.2, D2, z);
      plan.link(`office-c${z.toFixed(2)}`, mid, `office-${sn}${z.toFixed(2)}`);
    }
  }
  buildSideDecks(s);
}

/**
 * The side decks: four metres of teak down each side of the office, between its glass and the
 * rail, in the shade of the canopy deck above. Along the glass, a band of things to sit and lie
 * on (sofa groups, hammocks, loungers facing the sea, deck chairs, palms); along the rail, a
 * clear lane to walk past people.
 */
function buildSideDecks(s: Ship) {
  const { col, plan, props } = s;
  const LANE = 11.3, RAIL = OFFICE.edge;
  const laneZ = [-21.0, -19.6, -15.0, -10.5, -6.0, -1.0, 3.0, 7.5, 12.6, 15.6];
  for (const side of [1, -1] as const) {
    const sn = side > 0 ? "s" : "p";
    balustrade(s, [[side * RAIL, OFFICE.z0 - 0.02], [side * RAIL, OFFICE.z1]], D2);
    // The lane: the first node sits clear of the stair opening forward of it.
    const lane = laneZ.map((z, i) => plan.node(`ledge-${sn}${i}`, side * (i === 0 ? 10.0 : LANE), D2, z));
    plan.link(...lane);
    plan.link(`fore-${sn}4`, lane[0]!);
    plan.link(lane[1]!, `office-${sn}-19.60`); // the side doors
    plan.link(lane[8]!, `office-${sn}12.60`);
    const near = (z: number) => lane[laneZ.reduce((b, lz, i) => (Math.abs(lz - z) < Math.abs(laneZ[b]! - z) ? i : b), 1)]!;
    const out = yawOf(side, 0); // facing the sea
    const x = (d: number) => side * (OFFICE.glass + d); // d metres out from the glass

    // A sofa group: the sofa's back to the glass, a low table, an armchair at its end.
    for (const z of [-15.2, 9.6]) {
      props.put(sofa, x(0.55), D2, z, out);
      props.put(coffeeTable, x(1.75), D2, z, out);
      props.put(armchair, x(1.75), D2, z + 1.85, Math.PI);
      col.box(Math.min(x(0.1), x(2.1)), D2, z - 1.15, Math.max(x(0.1), x(2.1)), D2 + 0.8, z + 2.3);
      plan.slot("deck-chair", `sofa-side-${sn}${z}`, [x(0.62), D2, z], out, { seat: 0.42, nav: near(z), tags: ["side-deck", "shade"] });
    }
    // Hammocks along the glass.
    for (const z of [-10.5, 3.0]) {
      props.put(hammock, x(0.95), D2, z, 0);
      plan.slot("hammock", `hammock-side-${sn}${z}`, [x(0.95), D2, z], 0, { seat: HAMMOCK.seat, nav: near(z), tags: ["side-deck", "shade"] });
    }
    // Loungers in pairs, heads to the glass, looking out to sea.
    for (const z0 of [-6.6, 6.2]) for (const dz of [0, 0.95]) {
      const z = z0 + dz;
      props.put(lounger, x(1.25), D2, z, side * Math.PI / 2);
      col.obox(x(1.25), D2 + 0.25, z, 2.0, 0.5, 0.74, side * Math.PI / 2);
      plan.slot("lounger", `lounger-side-${sn}${z.toFixed(2)}`, [x(1.25 + LOUNGER.hips), D2, z], out, { seat: LOUNGER.seat, nav: near(z), tags: ["side-deck", "shade"] });
    }
    // Deck chairs either side of a little table.
    for (const z of [-1.8, -0.2]) {
      props.put(deckChair, x(0.9), D2, z, out);
      plan.slot("deck-chair", `deck-chair-side-${sn}${z}`, [x(0.9), D2, z], out, { seat: 0.38, nav: near(z), tags: ["side-deck", "shade"] });
    }
    props.put(sideTable, x(0.9), D2, -1.0);
    // Palms between, a shrub by each door.
    for (const z of [-17.6, -13.0, -8.0, 0.8, 5.4]) props.put(palm, x(0.45), D2, z, z);
    props.put(shrub, x(0.35), D2, -21.6, 1);
    props.put(shrub, x(0.35), D2, 14.4, 2);
    // Rail spots, looking out.
    for (const z of [-17.0, -10.5, -4.0, 3.0, 9.5]) plan.slot("rail", `rail-side-${sn}${z}`, [side * (RAIL - 0.45), D2, z], out, { nav: near(z), tags: ["side-deck"] });
  }
}
