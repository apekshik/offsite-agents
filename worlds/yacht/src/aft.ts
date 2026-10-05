// Aft and below: the office deck's floor running on aft as promenades round a deckhouse to a
// curved terrace (D2); under it, promenades down both sides of the hull and a terrace at the
// stern (D1); a wide stair down through the transom to the swim platform, where the fishing is.

import * as THREE from "three";
import { LIGHT } from "@offsite/kit";
import { D1, D2, D3, PLATFORM, SLAB, TRANSOM, halfBeam, hullTop } from "./dims.ts";
import { HAMMOCK, LOUNGER, armchair, coffeeTable, hammock, lounger, palm, shrub, sofa } from "./furniture.ts";
import { along, halfWidth, inset, outline, runs, yawOf, type Outline, type P2 } from "./kit.ts";
import { balustrade, chromeRail, downlights, house, slab, stairs, type Ship } from "./parts.ts";
import { WELL } from "./hull.ts";

/** The D2 deck from the office's front wall to its curved aft end. */
export const D2_AFT: Outline = {
  zF: -22, zA: 55.5, w: 12.5, ra: 6.5, na: 2.6,
  // Cut back each aft corner where the stairs come up from the stern terrace below.
  notches: [[1, 53.7, 56, 5.95], [-1, 53.7, 56, 5.95]],
};
const D2_HOUSE: Outline = { zF: 15, zA: 44, w: 7.0, ra: 5, na: 2.2 };
const D1_DECK: Outline = { zF: -34, zA: 56, w: 11.4, hw: (z) => halfBeam(z, D1) - 0.21 };
const D1_HOUSE: Outline = { zF: -34, zA: 50, w: 8.0, ra: 4.5, na: 2.2 };
const PLAT: Outline = { zF: PLATFORM.z0 - 0.1, zA: PLATFORM.z1, w: PLATFORM.w, ra: 1.6, na: 4 };
const S1 = { x0: 6.0, x1: 7.5, zLow: 60.4, zHigh: 53.7 };

function flag(): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(1.7, 1.05, 14, 4).rotateY(-Math.PI / 2).translate(0, 0, 0.85);
  const c = document.createElement("canvas");
  c.width = 128; c.height = 80;
  const g = c.getContext("2d")!;
  g.fillStyle = "#1f3f78"; g.fillRect(0, 0, 128, 80);
  g.fillStyle = "#f4f2ec"; g.fillRect(0, 34, 128, 12); g.fillRect(52, 0, 12, 80);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = LIGHT.uTime;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;")
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        float k = clamp(position.z / 1.7, 0.0, 1.0);
        transformed.x += sin(position.z * 3.6 - uTime * 9.0) * 0.16 * k;
        transformed.y += sin(position.z * 2.1 - uTime * 6.0) * 0.05 * k - 0.08 * k * k;`);
  };
  mat.customProgramCacheKey = () => "flag";
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.name = "ensign";
  return mesh;
}

export function buildAft(s: Ship) {
  const { pile, col, plan, props } = s;

  // ---------- D2: promenades and the terrace ----------
  const d2 = slab(s, D2_AFT, D2);
  // Rails all round, but not across the heads of the stairs up from the stern terrace: the
  // opening's front edge is railed by hand, outboard of the stair.
  const s1Head = (x: number, z: number) => z > 53.4 && z < 54.0 && Math.abs(x) > S1.x0 - 0.1;
  for (const run of runs(inset(d2, 0.08), (x, z) => z > 15.0 && !s1Head(x, z))) balustrade(s, run, D2);
  for (const side of [1, -1]) {
    balustrade(s, [[side * 5.87, 54.4], [side * 5.87, 55.45]], D2);
    balustrade(s, [[side * (S1.x1 + 0.08), S1.zHigh + 0.02], [side * (halfWidth(D2_AFT, S1.zHigh) - 0.1), S1.zHigh + 0.02]], D2);
  }
  house(s, outline(D2_HOUSE), D2, D3 - SLAB, { glass: [D2 + 0.5, D3 - SLAB - 0.32], open: (_x, z) => z < D2_HOUSE.zF + 0.05 });
  downlights(s, inset(outline(D2_HOUSE), -1.9).filter(([, z]) => z > 23), D3 - SLAB, 3.2);
  plan.node("d2-c", 0, D2, 47.4);
  plan.node("d2-aft", 0, D2, 53.6);
  plan.node("d1-c", 0, D1, 52.8);

  for (const side of [1, -1] as const) {
    const sn = side > 0 ? "s" : "p";
    // Hammocks along the house, palms between them; a clear lane outboard.
    for (const z of [28.5, 35, 41.5]) {
      props.put(hammock, side * 7.95, D2, z, 0);
      plan.slot("hammock", `hammock-d2${sn}${z}`, [side * 7.95, D2, z], 0, { seat: HAMMOCK.seat, tags: ["promenade", "shade"] });
    }
    for (const z of [24.8, 31.75, 38.25]) props.put(palm, side * 7.6, D2, z, z);
    for (const z of [24.6, 31.75, 38.25]) plan.slot("rail", `rail-d2${sn}${z}`, [side * 12.0, D2, z], yawOf(side, 0), { tags: ["promenade"] });
    // Walking: in from the side deck, past the stair up to the sun deck, aft to the terrace.
    const lane = [[10.9, 16.4], [10.9, 20.5], [10.9, 24.4], [10.9, 31.8], [10.9, 38.2], [9.6, 45.2]].map(([x, z], i) => plan.node(`d2-${sn}${i}`, side * x!, D2, z!));
    plan.link(`ledge-${sn}9`, ...lane, "d2-c");
    plan.link(lane[0]!, `mid-stair-${sn}:low`);
  }
  // The terrace: a sofa and armchairs looking aft.
  props.put(sofa, 0, D2, 48.9, 0);
  props.put(coffeeTable, 0, D2, 50.4, 0);
  for (const side of [1, -1]) props.put(armchair, side * 2.2, D2, 50.6, -side * 0.5);
  col.box(-2.9, D2, 48.3, 2.9, D2 + 0.8, 51.2);
  plan.slot("deck-chair", "deck-chair-d2-s", [2.2, D2, 50.6], -0.5, { seat: 0.42, tags: ["terrace"] });
  plan.slot("deck-chair", "deck-chair-d2-p", [-2.2, D2, 50.6], 0.5, { seat: 0.42, tags: ["terrace"] });
  along(inset(d2, 0.55).filter(([x, z]) => z > 52.4 && Math.abs(x) < 5.5), 2.4, 0.6).forEach((p, i) => {
    let nx = p.dz, nz = -p.dx;
    if (nz < 0) { nx = -nx; nz = -nz; }
    plan.slot("rail", `rail-d2-aft${i + 1}`, [p.x, D2, p.z], yawOf(nx, nz), { tags: ["terrace", "stern"] });
  });

  // ---------- stairs at the stern ----------
  for (const side of [1, -1] as const) {
    const sn = side > 0 ? "s" : "p";
    stairs(s, { id: `s1-${sn}`, x0: side * S1.x0, x1: side * S1.x1, zLow: S1.zLow, yLow: D1, zHigh: S1.zHigh, yHigh: D2 });
    plan.link(`s1-${sn}:high`, `d2-${sn}5`);
    plan.link(`s1-${sn}:high`, "d2-aft");
  }
  const s0 = stairs(s, { id: "s0", x0: -WELL + 0.08, x1: WELL - 0.08, zLow: 62.9, yLow: PLATFORM.y, zHigh: 56.0, yHigh: D1 });
  plan.link(s0.high, "d1-c");


  // ---------- D1: the deck inside the hull, its house, promenades, the stern terrace ----------
  slab(s, D1_DECK, D1, { noUnder: true });
  for (const side of [1, -1]) {
    // The wings either side of the stair well, out to the transom.
    const pts: P2[] = [[side * WELL, 56]];
    for (let z = 56; z <= TRANSOM - 0.2 + 1e-6; z += 0.5) pts.push([side * (halfBeam(z, D1) - 0.21), z]);
    pts.push([side * (halfBeam(TRANSOM - 0.2, D1) - 0.21), TRANSOM - 0.2], [side * WELL, TRANSOM - 0.2]);
    slab(s, pts, D1, { noUnder: true });
    // The well's walls, down to the swim platform.
    pile.box("white", side * WELL - 0.08, PLATFORM.y, 56, side * WELL + 0.08, D1, TRANSOM);
    col.box(side * WELL - 0.1, PLATFORM.y, 56, side * WELL + 0.1, D1, TRANSOM);
  }
  house(s, outline(D1_HOUSE), D1, D2 - SLAB, { glass: [D1 + 0.45, D2 - SLAB - 0.3] });
  for (const side of [1, -1] as const) {
    const sn = side > 0 ? "s" : "p";
    const xin = (z: number) => side * (halfBeam(z, hullTop(z)) - 0.14);
    // The promenade's forward end, and its rail on top of the hull.
    // The promenade's forward end: a white bulkhead with a door into the ship.
    pile.box("white", side * 7.9, D1, -34.3, xin(-34), D2 - SLAB, -34);
    col.box(Math.min(side * 7.9, xin(-34)), D1, -34.45, Math.max(side * 7.9, xin(-34)), D2, -34);
    pile.box("darkGlass", side * 9.0, D1 + 0.02, -34.0, side * 10.1, D1 + 2.2, -33.97);
    pile.box("chrome", side * 9.0 - 0.03, D1 + 1.0, -33.97, side * 9.0 + 0.03, D1 + 1.3, -33.92);
    const run: P2[] = [];
    for (let z = -33.6; z <= TRANSOM - 0.25 + 1e-6; z += 1.0) run.push([xin(z), z]);
    run.push([xin(TRANSOM - 0.25), TRANSOM - 0.25], [side * (WELL + 0.12), TRANSOM - 0.25]);
    balustrade(s, run, hullTop(0), { h: D1 + 1.06 - hullTop(0) });
    balustrade(s, [[side * (WELL + 0.12), TRANSOM - 0.25], [side * (WELL + 0.12), 56.02]], D1);
    downlights(s, [[side * 10.4, -32], [side * 10.4, 46]], D2 - SLAB, 3.0);

    // Hammocks along the house's glass, plants between them.
    for (const z of [-6, 2, 10, 18, 26, 34]) {
      props.put(hammock, side * 8.9, D1, z, 0);
      plan.slot("hammock", `hammock-d1${sn}${z}`, [side * 8.9, D1, z], 0, { seat: HAMMOCK.seat, tags: ["promenade", "shade"] });
    }
    for (const z of [6, 14, 30]) props.put(shrub, side * 8.6, D1, z, z);
    props.put(palm, side * 8.5, D1, 38.6, 0.4);
    // Loungers in pairs, heads to the glass, looking out to sea.
    for (const z0 of [-2.5, 21.5]) for (const dz of [0, 0.95]) {
      const z = z0 + dz, x = side * 9.1;
      props.put(lounger, x, D1, z, side * Math.PI / 2);
      col.obox(x, D1 + 0.25, z, 2.0, 0.5, 0.74, side * Math.PI / 2);
      plan.slot("lounger", `lounger-d1${sn}${z.toFixed(2)}`, [x + side * LOUNGER.hips, D1, z], yawOf(side, 0), { seat: LOUNGER.seat, tags: ["promenade", "shade"] });
    }
    // Sofa groups: a sofa against the house, a low table, an armchair.
    for (const z of [-12, 43]) {
      props.put(sofa, side * 8.55, D1, z, yawOf(side, 0));
      props.put(coffeeTable, side * 9.75, D1, z, yawOf(side, 0));
      props.put(armchair, side * 9.75, D1, z + 1.85, Math.PI);
      col.box(Math.min(side * 8.1, side * 10.1), D1, z - 1.15, Math.max(side * 8.1, side * 10.1), D1 + 0.8, z + 2.3);
      plan.slot("deck-chair", `sofa-d1${sn}${z}`, [side * 8.62, D1, z], yawOf(side, 0), { seat: 0.42, tags: ["promenade", "shade"] });
    }
    // Rail spots looking out.
    for (const z of [-14, -2, 14, 30, 44]) plan.slot("rail", `rail-d1${sn}${z}`, [side * 12.0, D1, z], yawOf(side, 0), { tags: ["promenade"] });

    // Walking: down the promenade from the forward stair to the terrace.
    plan.node(`d1-${sn}f`, side * 8.9, D1, -32.6);
    plan.node(`d1-${sn}f2`, side * 8.9, D1, -21.1);
    const lane = [-16, -12, -6, -2, 6, 18, 22, 30, 42, 48].map((z) => plan.node(`d1-${sn}${z}`, side * 10.9, D1, z));
    plan.link(`d1-${sn}f`, `d1-${sn}f2`, lane[0]!);
    plan.link(`fore-stair-${sn}:low`, `d1-${sn}f2`);
    plan.link(`fore-stair-${sn}:low`, lane[0]!);
    plan.link(...lane);
    plan.node(`d1-${sn}t`, side * 9.0, D1, 50.8);
    plan.node(`d1-${sn}w2`, side * 4.7, D1, 55.6);
    plan.node(`d1-${sn}w`, side * 4.7, D1, 61.0);
    plan.link(lane[lane.length - 1]!, `d1-${sn}t`, "d1-c");
    plan.link("d1-c", `d1-${sn}w2`, `d1-${sn}w`, `s1-${sn}:low`);
  }
  // The stern terrace: sofas facing in under the D2 terrace, armchairs on the wings looking aft.
  for (const side of [1, -1]) {
    props.put(sofa, side * 10.0, D1, 53.2, -side * Math.PI / 2);
    props.put(coffeeTable, side * 8.6, D1, 53.2, Math.PI / 2);
    col.box(Math.min(side * 8.2, side * 10.5), D1, 51.9, Math.max(side * 8.2, side * 10.5), D1 + 0.8, 54.5);
    props.put(armchair, side * 9.2, D1, 58.6, 0);
    plan.slot("deck-chair", `deck-chair-d1-${side > 0 ? "s" : "p"}`, [side * 9.2, D1, 58.6], 0, { seat: 0.42, tags: ["terrace", "stern"] });
    props.put(palm, side * 3.95, D1, 57.0, side);
  }

  // The transom either side of the stair: the beach club's windows and two lamps.
  for (const side of [1, -1]) {
    const x0 = side * (WELL + 0.9), x1 = side * (halfBeam(TRANSOM, 3) - 1.2);
    pile.box("darkGlass", Math.min(x0, x1), PLATFORM.y + 0.9, TRANSOM, Math.max(x0, x1), D1 - 1.0, TRANSOM + 0.04);
    for (let k = 1; k < 3; k++) {
      const x = x0 + ((x1 - x0) * k) / 3;
      pile.box("white", x - 0.05, PLATFORM.y + 0.9, TRANSOM, x + 0.05, D1 - 1.0, TRANSOM + 0.06);
    }
    pile.cyl("lamp", x0 + (x1 - x0) * 0.5, D1 - 0.55, TRANSOM + 0.02, 0.09, 0.03, 10);
  }

  // ---------- the swim platform ----------
  slab(s, PLAT, PLATFORM.y, { edge: "navy", under: "navy", thick: 0.6 });
  const plat = inset(outline(PLAT), 0.12);
  col.wall(plat.filter(([, z]) => z > PLATFORM.z0 + 0.3), PLATFORM.y, PLATFORM.y + 1.0, 0.1);
  for (const side of [1, -1]) chromeRail(s, [[side * 9.05, PLATFORM.z0 + 0.1], [side * 9.05, PLATFORM.z0 + 2.6]], PLATFORM.y, { collide: false });
  // A ladder into the water, a cooler and a tackle box.
  for (const dx of [-0.25, 0.25]) {
    const x = 2.6 + dx, z = PLATFORM.z1;
    pile.rod("chrome", new THREE.Vector3(x, -1.4, z + 0.12), new THREE.Vector3(x, PLATFORM.y + 0.85, z + 0.12), 0.024);
    pile.rod("chrome", new THREE.Vector3(x, PLATFORM.y + 0.85, z + 0.12), new THREE.Vector3(x, PLATFORM.y + 0.85, z - 0.35), 0.024);
    pile.rod("chrome", new THREE.Vector3(x, PLATFORM.y + 0.85, z - 0.35), new THREE.Vector3(x, PLATFORM.y, z - 0.35), 0.024);
  }
  for (let k = 0; k < 4; k++) pile.box("chrome", 2.35, -1.1 + k * 0.45, PLATFORM.z1 + 0.08, 2.85, -1.06 + k * 0.45, PLATFORM.z1 + 0.16);
  pile.box("accent", -1.3, PLATFORM.y, 66.4, -0.5, PLATFORM.y + 0.42, 66.9);
  pile.box("white", -1.32, PLATFORM.y + 0.42, 66.38, -0.48, PLATFORM.y + 0.47, 66.92);
  pile.box("dark", 0.4, PLATFORM.y, 66.5, 1.0, PLATFORM.y + 0.28, 66.85);
  for (const x of [-8.6, 8.6]) pile.cyl("chrome", x, PLATFORM.y, PLATFORM.z1 - 0.6, 0.05, 0.35, 8);
  // Fishing: along the aft edge and off the sides, facing out.
  [[-6.6, 68.0, 0], [-3.6, 68.0, 0], [4.8, 68.0, 0], [7.2, 67.6, 0.4], [-8.55, 64.8, -Math.PI / 2], [8.55, 64.8, Math.PI / 2]].forEach(([x, z, f], i) =>
    plan.slot("fishing", `fishing-${i + 1}`, [x!, PLATFORM.y, z!], f!, { tags: ["stern", "water"] }));
  plan.node("plat-p", -5.4, PLATFORM.y, 65.6);
  plan.node("plat-s", 5.4, PLATFORM.y, 65.6);
  plan.node("plat-c", 0, PLATFORM.y, 66.0);
  plan.link(s0.low, "plat-p");
  plan.link(s0.low, "plat-s");
  plan.link(s0.low, "plat-c");

  // The ensign, on a staff at the sun deck's stern rail, streaming aft.
  pile.rod("chrome", new THREE.Vector3(0, D3, 48.05), new THREE.Vector3(0, D3 + 3.3, 48.05), 0.04, 8);
  const ensign = flag();
  ensign.position.set(0, D3 + 3.25 - 0.55, 48.05);
  s.extra.push(ensign);
}
