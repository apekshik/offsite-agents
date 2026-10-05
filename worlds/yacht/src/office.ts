// The office: a double-height glass hall midship on D2, the canopy deck for a roof. Four long
// lines of desks run fore and aft in groups of three: the inner lines face out toward the
// windows, the outer lines face in, so from the central aisle and from the window aisles you
// look over people's shoulders at their screens. A wall board up front, a lounge aft.

import * as THREE from "three";
import { D2, D3, D4, OFFICE, SLAB } from "./dims.ts";
import { DESK, desk, officeChair, palm, sofa, coffeeTable, shrub } from "./furniture.ts";
import { along, band, yawOf, type P2 } from "./kit.ts";
import { balustrade, type Ship } from "./parts.ts";
import { deskScreenTexture, screen, wallScreenTexture } from "./screens.ts";

const CEIL = D4 - SLAB;
const G = OFFICE.glass;
/** Desk lines across the office: x of the desk's centre, and which way its user faces (±1 in x). */
const LINES: [number, 1 | -1][] = [[-6.6, 1], [-3.3, -1], [3.3, 1], [6.6, -1]];
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

  // The front wall: white, the wall board in its middle, a door in each corner.
  pile.box("white", -8.1, D2, OFFICE.z0 - 0.2, 8.1, CEIL, OFFICE.z0);
  col.box(-8.1, D2, OFFICE.z0 - 0.3, 8.1, CEIL, OFFICE.z0);
  for (const side of [1, -1]) {
    pile.box("white", side * 8.1, DOOR_TOP, OFFICE.z0 - 0.2, side * G, CEIL, OFFICE.z0);
    pile.box("white", side * 9.6, D2, OFFICE.z0 - 0.2, side * G, DOOR_TOP, OFFICE.z0);
    col.box(Math.min(side * 9.6, side * G), D2, OFFICE.z0 - 0.3, Math.max(side * 9.6, side * G), CEIL, OFFICE.z0);
  }
  const board = screen("wall", 9.6, 3.75, wallScreenTexture(), 1.1);
  board.position.set(0, D2 + 3.6, OFFICE.z0 + 0.03);
  s.extra.push(board);
  pile.box("dark", -4.95, D2 + 1.6, OFFICE.z0, 4.95, D2 + 5.6, OFFICE.z0 + 0.02);

  // The aft wall: the deckhouse behind fills its middle below the sun deck; glass above, looking
  // up at the sun deck; a door in each corner, open to the promenade and the ledge alike.
  pile.box("white", -7.4, D2, OFFICE.z1, 7.4, D3 - SLAB, OFFICE.z1 + 0.2);
  col.box(-7.4, D2, OFFICE.z1, 7.4, CEIL, OFFICE.z1 + 0.3);
  for (const side of [1, -1]) {
    pile.box("white", side * 7.4, D2, OFFICE.z1, side * 7.6, D3 - SLAB, OFFICE.z1 + 0.2);
    pile.box("white", side * 7.4, DOOR_TOP, OFFICE.z1, side * G, D3, OFFICE.z1 + 0.2);
    col.box(Math.min(side * 7.4, side * 7.6), D2, OFFICE.z1, Math.max(side * 7.4, side * 7.6), CEIL, OFFICE.z1 + 0.3);
    col.box(Math.min(side * 7.4, side * G), DOOR_TOP, OFFICE.z1, Math.max(side * 7.4, side * G), CEIL, OFFICE.z1 + 0.3);
  }
  pile.add("officeGlass", band([[-G, OFFICE.z1], [G, OFFICE.z1]], D3, CEIL, { closed: false }));
  for (const m of along([[-G, OFFICE.z1], [G, OFFICE.z1]], 3.1, 1.5)) pile.box("frame", m.x - 0.035, D3, OFFICE.z1, m.x + 0.035, CEIL, OFFICE.z1 + 0.08);

  // Light: long panels in the ceiling over each line of desks, always on.
  for (const [x] of LINES) pile.box("panel", x - 0.25, CEIL - 0.03, -19.5, x + 0.25, CEIL, 12.5);
  pile.box("panel", -0.25, CEIL - 0.03, -19.5, 0.25, CEIL, 12.5);

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
    for (const z of [-15.25, -8.45, -1.65, 1.5]) props.put(palm, side * 4.95, D2, z, z * 1.3);
    props.put(palm, side * 5.8, D2, -21.3, 0.4);
  }
  for (const [x, z] of [[-6.6, -13.5], [3.3, -8.45], [6.6, -1.65], [-3.3, 0.1]] as const) props.put(shrub, x, D2 + DESK.h, z + 0.55, 0, 0.55);

  // The lounge aft: sofas facing across coffee tables.
  for (const side of [1, -1]) {
    props.put(sofa, side * 3.6, D2, 6.2, 0);
    props.put(sofa, side * 3.6, D2, 10.6, Math.PI);
    props.put(coffeeTable, side * 3.6, D2, 8.4, 0);
    props.put(palm, side * 6.4, D2, 8.4, 0.7);
    col.box(side * 3.6 - 1.15, D2, 5.7, side * 3.6 + 1.15, D2 + 0.8, 11.1);
  }

  // The ledge outside the glass: teak, a balustrade, and the promenade's rail spots.
  for (const side of [1, -1] as const) {
    balustrade(s, [[side * 11.1, OFFICE.z0 - 0.02], [side * 11.1, OFFICE.z1]], D2);
    balustrade(s, [[side * G, OFFICE.z0], [side * 11.1, OFFICE.z0]], D2);
  }

  // Walking: a central aisle, an aisle down each window, cross aisles between the desk groups.
  const zs = [-20.8, ...DESK_Z, ...CROSS, 3.0, 7.0, 12.6, 14.0].sort((a, b) => a - b);
  const centre = zs.filter((z) => z !== 12.6 && z !== 14.0).map((z) => plan.node(`office-c${z.toFixed(2)}`, 0, D2, z));
  plan.link(...centre);
  for (const side of [1, -1] as const) {
    const sn = side > 0 ? "s" : "p";
    const win = [-20.8, -19.6, ...DESK_Z, ...CROSS, 3.0, 7.0, 12.6, 14.0].sort((a, b) => a - b).map((z) => plan.node(`office-${sn}${z.toFixed(2)}`, side * 8.75, D2, z));
    plan.link(...win);
    for (const z of [-20.8, ...CROSS, 3.0]) {
      const mid = plan.node(`office-${sn}m${z.toFixed(2)}`, side * 4.95, D2, z);
      plan.link(`office-c${z.toFixed(2)}`, mid, `office-${sn}${z.toFixed(2)}`);
    }
    // Through the doors.
    plan.link(`office-${sn}-20.80`, `fore-${sn}4`);
    const ledge = [-21.2, -19.6, -12, -4, 4, 12.6, 15.6].map((z, i) => plan.node(`ledge-${sn}${i}`, side * (i === 6 ? 10.6 : 10.5), D2, z));
    plan.link(...ledge);
    plan.link(`ledge-${sn}1`, `office-${sn}-19.60`);
    plan.link(`ledge-${sn}5`, `office-${sn}12.60`);
    // Rail spots along the ledge, looking out to sea.
    for (const z of [-15, -6, 3]) plan.slot("rail", `rail-ledge-${sn}${z}`, [side * 10.65, D2, z], yawOf(side, 0), { tags: ["ledge"] });
  }
}
