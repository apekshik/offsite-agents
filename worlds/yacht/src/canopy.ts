// The canopy deck: the office's roof, under a white tensioned sail on six posts. Café tables down
// the middle, deck chairs along the rails looking out, a lounge at the front by the bridge.

import * as THREE from "three";
import { CANOPY, D4 } from "./dims.ts";
import { armchair, cafeTable, chair, coffeeTable, deckChair, palm, sideTable, sofa } from "./furniture.ts";
import { inset, runs, yawOf, type Outline } from "./kit.ts";
import { balustrade, slab, type Ship } from "./parts.ts";

export const CANOPY_DECK: Outline = { zF: CANOPY.z0 - 1, zA: CANOPY.z1, w: CANOPY.w, ra: 1.6, na: 4 };
/** The stairs up from the sun deck land on the canopy deck's aft edge, here. */
export const UP_STAIR = { x0: 5.2, x1: 6.9 };

/** The sail: a tensioned membrane over the posts, its edges sagging between them. */
function sail(): THREE.BufferGeometry {
  const W = 8.3, z0 = -18.5, z1 = 12.5, NX = 28, NZ = 44, base = D4 + 3.5;
  const pos: number[] = [], index: number[] = [];
  for (let j = 0; j <= NZ; j++) for (let i = 0; i <= NX; i++) {
    const u = (i / NX) * 2 - 1, v = j / NZ, x = u * W, z = z0 + (z1 - z0) * v;
    const ends = Math.pow(Math.max(Math.abs(2 * v - 1), 0), 6); // near the front and back edges
    const sides = Math.pow(Math.abs(u), 6); // near the side edges
    let y = base + 0.45 * u * u + 0.35 * Math.sin(Math.PI * v) * (1 - u * u);
    y -= 0.55 * sides * Math.pow(Math.sin(2 * Math.PI * v), 2); // sag between the side posts
    y -= 0.5 * ends * (1 - u * u); // and between the corner posts
    pos.push(x, y, z);
  }
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const a = j * (NX + 1) + i, b = a + 1, c = a + NX + 1, d = c + 1;
    index.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

export function buildCanopy(s: Ship) {
  const { pile, col, plan, props } = s;
  const deck = slab(s, CANOPY_DECK, D4);
  // Rails round the sides and back; open where the bridge joins and where the stairs come up.
  const keep = (x: number, z: number) =>
    !(z < CANOPY.z0 - 0.9 && Math.abs(x) < 8.5) && !(z > CANOPY.z1 - 0.3 && Math.abs(x) > UP_STAIR.x0 - 0.05 && Math.abs(x) < UP_STAIR.x1 + 0.05);
  for (const run of runs(inset(deck, 0.08), keep)) balustrade(s, run, D4);

  // The sail, its posts.
  const sg = sail();
  pile.add("sail", sg);
  const p = sg.attributes.position!;
  const NX = 28, NZ = 44;
  for (const [i, j] of [[0, 0], [NX, 0], [0, NZ / 2], [NX, NZ / 2], [0, NZ], [NX, NZ]] as const) {
    const k = j * (NX + 1) + i;
    const top = new THREE.Vector3(p.getX(k), p.getY(k), p.getZ(k));
    pile.rod("white", new THREE.Vector3(top.x * 1.02, D4, top.z), top.clone().setY(top.y + 0.15), 0.09, 10);
    col.box(top.x - 0.12, D4, top.z - 0.12, top.x + 0.12, D4 + 2.5, top.z + 0.12);
  }

  // Café tables down the middle (decor), deck chairs along each rail (slots).
  for (const z of [-14.5, -8.5, -2.5, 3.5, 9.5]) for (const x of [-2.6, 2.6]) {
    props.put(cafeTable, x, D4, z);
    props.put(chair, x - 0.78, D4, z, Math.PI / 2);
    props.put(chair, x + 0.78, D4, z, -Math.PI / 2);
    col.box(x - 1.1, D4, z - 0.5, x + 1.1, D4 + 0.8, z + 0.5);
  }
  let n = 0;
  for (const side of [1, -1] as const) {
    for (const z of [-15, -10, -6.2, 1.0, 6.5]) {
      const x = side * 9.0;
      props.put(deckChair, x, D4, z, yawOf(side, 0));
      props.put(sideTable, x, D4, z + 0.85);
      plan.slot("deck-chair", `deck-chair-canopy-${++n}`, [x, D4, z], yawOf(side, 0), { seat: 0.38, tags: ["canopy", "shade"] });
    }
    // A palm at each corner.
    props.put(palm, side * 9.6, D4, 13.9, 1);
    props.put(palm, side * 9.7, D4, -17.8, 2);
  }
  // The lounge at the front, by the bridge's door.
  props.put(sofa, -4.5, D4, -19.2, 0);
  props.put(armchair, -6.4, D4, -17.4, Math.PI / 2);
  props.put(coffeeTable, -4.5, D4, -17.7, 0);
  col.box(-7.0, D4, -19.8, -3.3, D4 + 0.8, -16.8);
  props.put(sofa, 4.5, D4, -19.2, 0);
  props.put(armchair, 6.4, D4, -17.4, -Math.PI / 2);
  props.put(coffeeTable, 4.5, D4, -17.7, 0);
  col.box(3.3, D4, -19.8, 7.0, D4 + 0.8, -16.8);

  // Walking: an aisle down the middle, one down each side between the tables and the chairs.
  const zs = [-20.2, -11.5, -5.5, 0.5, 6.5, 12.6];
  plan.link(...zs.map((z) => plan.node(`canopy-c${z}`, 0, D4, z)));
  for (const side of [1, -1] as const) {
    const sn = side > 0 ? "s" : "p";
    plan.link(...zs.slice(1).map((z) => plan.node(`canopy-${sn}${z}`, side * 6.6, D4, z)));
    for (const z of zs.slice(1)) plan.link(`canopy-c${z}`, `canopy-${sn}${z}`);
    plan.node(`canopy-${sn}-front`, side * 8.0, D4, -20.6);
    plan.link(`canopy-${sn}-11.5`, `canopy-${sn}-front`);
    plan.slot("rail", `rail-canopy-${sn}`, [side * 9.9, D4, -20.8], yawOf(side, 0), { nav: `canopy-${sn}-front`, tags: ["canopy"] });
  }
  plan.link("canopy-c-20.2", "bridge-door");
}
