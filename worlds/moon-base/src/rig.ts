// The ice rig in the pit: an orange gantry bridge out over the pit to a drill tower standing on
// the ice, control desks at the bridge's root, glowing blue crystals round the pit's foot, and a
// conveyor carrying blocks of ice up out of the pit to the storage tanks by the hub's south side.

import * as THREE from "three";
import { PIT } from "./dims.ts";
import { GANTRY } from "./crater.ts";
import { DESK, bigCrate, crate, desk, rover, soft, tank } from "./furniture.ts";
import { polar, prefab, yawOf, type P2, type Prefab } from "./kit.ts";
import type { MatKey } from "./mats.ts";
import { rail, type Base } from "./parts.ts";

const pitAt = (a: number, r: number): P2 => { const [x, z] = polar(a, r); return [PIT.x + x, PIT.z + z]; };
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** A cluster of ice crystals: long glowing prisms leaning every which way. */
export const crystals: Prefab<MatKey> = prefab("crystals", (p) => {
  let sd = 5;
  const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 7; i++) {
    const h = 0.6 + rnd() * 1.6, r = 0.15 + rnd() * 0.22;
    const g = new THREE.CylinderGeometry(0, r, h, 5, 1).translate(0, h / 2, 0);
    g.deleteAttribute("uv");
    const m = new THREE.Matrix4().compose(V((rnd() - 0.5) * 0.9, 0, (rnd() - 0.5) * 0.9), new THREE.Quaternion().setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.9, rnd() * 6, (rnd() - 0.5) * 0.9)), V(1, 1, 1));
    p.add("ice", g.toNonIndexed(), m);
  }
});

/** Where the conveyor runs: up out of the pit, over its rim, on to the hopper by the tanks. */
export const CONVEYOR: THREE.Vector3[] = [
  V(...pitXZ(110, 4.2, -8.0)), V(...pitXZ(110, 14.6, 1.3)), V(...pitXZ(110, 25.0, 4.2)),
];
function pitXZ(deg: number, r: number, y: number): [number, number, number] {
  const [x, z] = pitAt((deg * Math.PI) / 180, r);
  return [x, y, z];
}

export function buildRig(s: Base) {
  const { pile, col, plan, props } = s;
  const a = GANTRY.a, w = GANTRY.w;
  const out: P2 = [Math.sin(a), -Math.cos(a)];
  const across: P2 = [-out[1], out[0]];
  const along = (r: number, side: number): P2 => { const [x, z] = pitAt(a, r); return [x + across[0] * side, z + across[1] * side]; };
  const yaw = yawOf(-out[0], -out[1]); // looking along the bridge, out over the pit

  // The bridge: an orange-railed deck from the edge out to the tower.
  const r0 = PIT.r + 0.8, r1 = PIT.r - GANTRY.len;
  const [mx, mz] = pitAt(a, (r0 + r1) / 2);
  pile.obox("dark", mx, -0.12, mz, w, 0.3, r0 - r1, yaw);
  pile.obox("orange", mx, -0.38, mz, w + 0.1, 0.3, r0 - r1, yaw);
  col.obox(mx, -0.15, mz, w, 0.3, r0 - r1, yaw);
  for (const side of [-1, 1]) rail(pile, col, [along(r0 - 0.6, side * (w / 2 - 0.05)), along(r1 + 0.1, side * (w / 2 - 0.05))], 0.03, { every: 1.6 });
  // Braces under the deck, back to the pit's wall.
  for (let r = r1 + 0.6; r < PIT.r - 1.6; r += 2.6) for (const side of [-1, 1]) {
    const [x, z] = along(r, side * (w / 2 - 0.1)), [bx, bz] = along(r + 1.6, side * 0.4);
    pile.rod("orange", V(x, -0.5, z), V(bx, -2.4, bz), 0.07, 6);
  }

  // The drill tower, standing on the ice: four orange legs, lattice, a white shaft down its middle.
  const [tx, tz] = pitAt(a, r1 - 1.6);
  const top = 13.5, base = PIT.y;
  const legs: P2[] = [[-1.5, -1.5], [1.5, -1.5], [1.5, 1.5], [-1.5, 1.5]];
  const L = (p: P2): P2 => [tx + across[0] * p[0] + out[0] * p[1], tz + across[1] * p[0] + out[1] * p[1]];
  for (const l of legs) {
    const [x, z] = L(l);
    pile.box("orange", x - 0.2, base, z - 0.2, x + 0.2, top, z + 0.2);
    col.box(x - 0.22, base, z - 0.22, x + 0.22, top, z + 0.22);
  }
  for (let y = base + 1.5; y < top - 1; y += 2.8) {
    for (let i = 0; i < 4; i++) {
      const [x0, z0] = L(legs[i]!), [x1, z1] = L(legs[(i + 1) % 4]!);
      pile.rod("orange", V(x0, y, z0), V(x1, y + 2.8, z1), 0.06, 5);
      pile.rod("white", V(x0, y, z0), V(x1, y, z1), 0.07, 5);
    }
  }
  pile.cyl("white", tx, base - 0.5, tz, 0.55, top - base + 1.2, 16);
  for (let y = base + 2; y < top; y += 3) pile.cyl("dark", tx, y, tz, 0.6, 0.3, 16);
  pile.box("orange", tx - 2.0, top, tz - 2.0, tx + 2.0, top + 1.2, tz + 2.0);
  pile.box("white", tx - 1.2, top + 1.2, tz - 1.2, tx + 1.2, top + 2.4, tz + 1.2);
  for (const l of legs) {
    const [x, z] = L([l[0] * 1.25, l[1] * 1.25]);
    pile.cyl("lamp", x, top + 1.2, z, 0.18, 0.25, 8);
    s.halos.push({ x, y: top + 1.5, z, color: "#ffd9a0", size: 1.3, mode: "always" });
  }
  s.halos.push({ x: tx, y: top + 2.9, z: tz, color: "#ff2a1a", size: 1.5, mode: "blink" });
  // A platform at the bridge's end, where the tower meets it.
  {
    const [px, pz] = pitAt(a, r1 - 1.1);
    pile.obox("dark", px, -0.12, pz, 4.2, 0.3, 3.4, yaw);
    col.obox(px, -0.15, pz, 4.2, 0.3, 3.4, yaw);
    const c = (lx: number, lz: number) => L([lx, lz + 0.5]);
    // Railed round three sides, open to the bridge.
    rail(pile, col, [c(-2.05, 1.5), c(-2.05, -1.2), c(2.05, -1.2), c(2.05, 1.5)], 0.03, { every: 1.4 });
  }
  // The glow where the drill goes into the ice.
  s.rooms.push({ x: tx, y: base + 1.6, z: tz, intensity: 18, distance: 26, color: "#4fb8ff", always: true });
  s.marks.set("drill", [V(tx, base, tz), V(tx, top, tz)]);

  // Ice crystals round the pit's foot and the drill, glowing.
  for (let i = 0; i < 22; i++) {
    const aa = (i / 22) * Math.PI * 2 + (i % 3) * 0.1;
    const rr = PIT.r - 0.8 - (i % 4) * 0.5;
    const [x, z] = pitAt(aa, rr);
    props.put(crystals, x, PIT.y, z, i * 1.7, 0.9 + (i % 3) * 0.35);
  }
  for (let i = 0; i < 5; i++) {
    const [x, z] = pitAt(a + 0.6 + i * 1.25, 3.2 + (i % 2));
    props.put(crystals, x, PIT.y, z, i, 1.4);
  }

  // Control desks at the bridge's root, looking out over the pit.
  const desks: string[] = [];
  for (const side of [-1, 1]) {
    const [dx, dz] = along(PIT.r + 3.1, side * 3.0);
    const dyaw = yawOf(out[0], out[1]); // user's side away from the pit
    props.put(desk, dx, 0, dz, dyaw);
    const cx = dx + out[0] * 0.72, cz = dz + out[1] * 0.72;
    col.obox(dx, DESK.h / 2, dz, DESK.w, DESK.h, DESK.d, dyaw);
    const q = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), dyaw);
    const sz = DESK.screen.z + 0.003;
    s.screens.push({ id: `rig-${side > 0 ? "e" : "w"}`, kind: "code", w: DESK.screen.w, h: DESK.screen.h, pos: V(dx + Math.sin(dyaw) * sz, DESK.screen.y, dz + Math.cos(dyaw) * sz), quat: q });
    plan.slot("workshop", `rig-desk-${side > 0 ? "e" : "w"}`, [cx, 0, cz], yaw, { tags: ["ice-rig", "leisure", "place:by the ice pit", "pastime:running the ice rig"] });
    const [nx, nz] = along(PIT.r + 5.6, side * 3.0);
    desks.push(plan.node(`rig:d${side}`, nx, 0, nz));
  }
  // On the bridge, at the tower's platform, and down on the ice.
  const [bx, bz] = pitAt(a, r1 + 2.0);
  const bridge = plan.node("rig:bridge", bx, 0.03, bz);
  const [ex, ez] = pitAt(a, PIT.r + 2.0);
  const edge = plan.node("rig:edge", ex, 0, ez);
  plan.link(edge, bridge);
  {
    const [px, pz] = pitAt(a, r1 + 0.7);
    plan.slot("workshop", "rig-tower", [px + across[0] * 0.5, 0.03, pz + across[1] * 0.5], yaw, { nav: bridge, tags: ["ice-rig", "leisure", "place:by the ice pit", "pastime:watching the drill"] });
    plan.slot("rail", "rig-bridge", [bx + across[0] * 0.6, 0.03, bz + across[1] * 0.6], yawOf(across[0], across[1]), { nav: bridge, tags: ["ice-rig", "place:by the ice pit", "pastime:looking down at the ice"] });
  }
  {
    const ice = s.plan.at("pit:ice");
    const toward = Math.atan2(PIT.x - ice[0], PIT.z - ice[2]);
    plan.slot("workshop", "pit-ice-1", [ice[0] + Math.sin(toward + 1.6) * 1.2, PIT.y, ice[2] + Math.cos(toward + 1.6) * 1.2], toward + Math.PI, { nav: "pit:ice", tags: ["ice-rig", "leisure", "place:in the ice pit", "pastime:cutting ice"] });
    plan.slot("workshop", "pit-ice-2", [ice[0] + Math.sin(toward - 1.6) * 1.2, PIT.y, ice[2] + Math.cos(toward - 1.6) * 1.2], toward + Math.PI, { nav: "pit:ice", tags: ["ice-rig", "leisure", "place:in the ice pit", "pastime:cutting ice"] });
    const [cx, cz] = [ice[0] + Math.sin(toward + Math.PI) * 2.6, ice[2] + Math.cos(toward + Math.PI) * 2.6];
    props.put(crystals, cx, PIT.y, cz, 0.4, 1.8);
  }
  s.open.push({ ids: [edge, ...desks, "pit:top"], reach: 14 });

  // The conveyor: a truss with a belt on it, on legs; its path is marked for the ice blocks.
  for (let i = 0; i + 1 < CONVEYOR.length; i++) {
    const p = CONVEYOR[i]!, q = CONVEYOR[i + 1]!;
    const d = q.clone().sub(p), len = d.length(), dir = d.clone().normalize();
    const side = new THREE.Vector3(dir.z, 0, -dir.x).normalize();
    const mid = p.clone().add(q).multiplyScalar(0.5);
    const ry = Math.atan2(dir.x, dir.z), rx = -Math.asin(dir.y);
    pile.obox("dark", mid.x, mid.y - 0.05, mid.z, 1.1, 0.12, len, ry, rx);
    for (const sgn of [-1, 1]) {
      const o = side.clone().multiplyScalar(sgn * 0.62);
      pile.obox("orange", mid.x + o.x, mid.y + 0.05, mid.z + o.z, 0.14, 0.4, len, ry, rx);
    }
    pile.obox("orange", mid.x, mid.y - 0.35, mid.z, 0.8, 0.25, len, ry, rx);
    col.obox(mid.x, mid.y - 0.1, mid.z, 1.5, 0.8, len, ry, rx);
    // Legs down to whatever is below.
    for (let t = 0.12; t < 1; t += 0.22) {
      const at = p.clone().lerp(q, t);
      const ground = Math.hypot(at.x - PIT.x, at.z - PIT.z) < PIT.r ? PIT.y : 0;
      if (at.y - ground < 0.6) continue;
      for (const sgn of [-1, 1]) {
        const o = side.clone().multiplyScalar(sgn * 0.5);
        pile.rod("steel", V(at.x + o.x, ground, at.z + o.z), V(at.x + o.x, at.y - 0.3, at.z + o.z), 0.07, 6);
      }
      col.box(at.x - 0.6, ground, at.z - 0.6, at.x + 0.6, at.y - 0.4, at.z + 0.6);
    }
  }
  s.marks.set("conveyor", CONVEYOR.map((v) => v.clone().setY(v.y + 0.25)));

  // The hopper at the top and the tanks it fills: white, banded orange, by the hub's south side.
  const end = CONVEYOR[CONVEYOR.length - 1]!;
  const hop = end.clone().add(new THREE.Vector3(Math.sin(1.92) * 1.6, 0, Math.cos(1.92) * 1.6));
  soft(pile, "white", hop.x, 2.4, hop.z, 2.6, 2.4, 2.6, 0, 0, 0.12);
  pile.box("orange", hop.x - 1.35, 3.4, hop.z - 1.35, hop.x + 1.35, 3.7, hop.z + 1.35);
  for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) pile.rod("steel", V(hop.x + dx * 1.1, 0, hop.z + dz * 1.1), V(hop.x + dx * 1.1, 1.3, hop.z + dz * 1.1), 0.08, 6);
  col.box(hop.x - 1.4, 0, hop.z - 1.4, hop.x + 1.4, 3.7, hop.z + 1.4);
  const tanks: [number, number][] = [[4.0, 2.5], [4.0, 6.0], [7.4, 2.5], [7.4, 6.0]];
  for (const [dx, dz] of tanks) {
    const x = hop.x + dx, z = hop.z + dz - 2;
    props.put(tank, x, 0, z, 0, 0.85);
    col.cyl(x, 0, z, 1.25, 6.2, 12);
  }
  // A hauler waiting by the hopper, cases stacked.
  props.put(rover, hop.x - 1.0, 0, hop.z + 5.2, 2.3);
  col.obox(hop.x - 1.0, 1.4, hop.z + 5.2, 2.6, 2.8, 5.4, 2.3);
  for (const [dx, dz, big] of [[-3.6, -1.0, 1], [-3.4, 0.4, 0], [-4.8, -0.2, 0]] as const) {
    props.put(big ? bigCrate : crate, hop.x + dx, 0, hop.z + dz, dx);
    col.box(hop.x + dx - 0.65, 0, hop.z + dz - 0.5, hop.x + dx + 0.65, 0.86, hop.z + dz + 0.5);
  }
}
