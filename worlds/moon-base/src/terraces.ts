// What stands on the terraces and the rim: rows of hab shells facing in over the crater, stacks
// of crates between them, the tower on the west terraces, tanks and radiators to the east, masts
// and dishes along the rim, solar fields on the plain beyond it, boulders everywhere else.

import * as THREE from "three";
import { GREENHOUSE, HAB, HAB_IN, LOOKOUT, PLAIN_R, RIM_R, RISER_R, SPORTS, TIER_Y, TOWER, dugAt, onRamp, wrap } from "./dims.ts";
import { bigCrate, crate, dish, greyBox, hab, mast, MAST_TOP, radiator, rocks, solarPanel, tank } from "./furniture.ts";
import { angleOf, deg, inward, polar } from "./kit.ts";
import { hillY } from "./crater.ts";
import type { Base } from "./parts.ts";

export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

const between = (a: number, lo: number, hi: number) => { const x = lo + wrap(a - lo); return x >= lo && x <= hi; };

/** Whether something HAB.w wide at angle a on tier k (1..3) would land on a ramp, a building, or a door. */
function busyAt(k: number, a: number, halfW: number): boolean {
  const R = RISER_R[k]!;
  const m = halfW / R;
  if (onRamp(k, a, halfW + 3)) return true;
  if (dugAt(k, a - m) || dugAt(k, a + m) || dugAt(k, a)) return true;
  if (k === 3 && between(a, GREENHOUSE.a0 - deg(3), GREENHOUSE.a1 + deg(3))) return true;
  if (k === 3) { const h = (SPORTS.len / 2 + 4) / SPORTS.r; if (between(a, SPORTS.a - h, SPORTS.a + h)) return true; }
  if (k === 2 && between(a, angleOf(TOWER.x, TOWER.z) - deg(6), angleOf(TOWER.x, TOWER.z) + deg(6))) return true;
  if (k === 2 && between(a, deg(74), deg(104))) return true; // the tanks
  if (k === 3 && between(a, deg(82), deg(120))) return true; // the radiators
  return false;
}

export function buildTerraces(s: Base) {
  const r = rng(7);
  const { props, col } = s;
  // Habs: one every 13 m round each terrace, a stack of cases now and then instead.
  for (let k = 1; k <= 3; k++) {
    const R = RISER_R[k]!, y = TIER_Y[k]!, rc = R - HAB_IN;
    const step = 13 / rc;
    for (let a = -Math.PI; a < Math.PI; a += step) {
      // The south side, seen least, has fewer.
      const south = Math.cos(a) < -0.55;
      if (south && r() < 0.45) continue;
      const w = HAB.w * (0.92 + 0.16 * r());
      if (busyAt(k, a, w / 2 + 0.5)) continue;
      const [x, z] = polar(a, rc);
      if (r() < 0.16) {
        // A yard of cases.
        for (let i = 0; i < 5; i++) {
          const da = (r() - 0.5) * (6 / rc), dr = (r() - 0.5) * 3.5;
          const [cx, cz] = polar(a + da, rc + dr);
          const big = r() < 0.4;
          props.put(big ? bigCrate : r() < 0.3 ? greyBox : crate, cx, y, cz, -a + (r() - 0.5) * 0.6);
          if (r() < 0.4) props.put(crate, cx, y + (big ? 0.85 : 0.62), cz, -a + (r() - 0.5) * 0.8);
        }
        continue;
      }
      const sc = w / HAB.w;
      props.put(hab, x, y, z, inward(a), new THREE.Vector3(sc, 0.95 + 0.1 * r(), 1));
      // Its front is solid (no way in): the captain bumps into it.
      col.obox(x, y + HAB.h / 2, z, w * 0.95, HAB.h, HAB.d + 1.2, inward(a));
      // A case or two out front.
      if (r() < 0.55) {
        const [cx, cz] = polar(a + ((r() < 0.5 ? -1 : 1) * (w / 2 + 0.9)) / rc, rc + 1.5);
        props.put(r() < 0.5 ? crate : bigCrate, cx, y, cz, -a + r());
      }
      // The door's warm glow, which reads from across the crater.
      const [dx, dz] = polar(a, rc - HAB.d / 2 + 0.45);
      s.halos.push({ x: dx, y: y + 1.25, z: dz, color: "#ffb35a", size: 1.3, mode: "always" });
    }
  }

  // The tower: the lift and comms spine on the west terraces.
  buildTower(s);

  // Tanks on T2 east, radiators on T3 east.
  for (let i = 0; i < 6; i++) {
    const a = deg(77 + i * 4.6), [x, z] = polar(a, RISER_R[2]! - 3.2);
    props.put(tank, x, TIER_Y[2]!, z, -a);
    col.cyl(x, TIER_Y[2]!, z, 1.45, 7.2, 12);
    s.halos.push({ x, y: TIER_Y[2]! + 7.5, z, color: "#ff3a2a", size: 0.6, mode: "blink" });
  }
  for (let i = 0; i < 8; i++) {
    const a = deg(85 + i * 4.2), [x, z] = polar(a, RISER_R[3]! - 3.0);
    props.put(radiator, x, TIER_Y[3]!, z, -a + Math.PI / 2);
    col.obox(x, TIER_Y[3]! + 3.2, z, 3.2, 6.4, 0.7, -a + Math.PI / 2);
  }

  // Masts and dishes along the rim.
  for (const [ad, rr] of [[-78, 110], [-20, 108], [22, 112], [58, 109], [96, 111], [150, 112], [-150, 110], [190, 109]] as const) {
    const a = deg(ad), [x, z] = polar(a, rr);
    props.put(mast, x, TIER_Y[4]!, z, r() * 3);
    col.box(x - 0.8, TIER_Y[4]!, z - 0.8, x + 0.8, TIER_Y[4]! + 3, z + 0.8);
    s.halos.push({ x, y: TIER_Y[4]! + MAST_TOP + 0.08, z, color: "#ff2a1a", size: 1.4, mode: "blink" });
  }
  for (const [ad, rr] of [[-34, 112], [44, 112], [112, 108], [-118, 112]] as const) {
    const a = deg(ad), [x, z] = polar(a, rr);
    props.put(dish, x, TIER_Y[4]!, z, inward(a) + Math.PI + (r() - 0.5));
    col.box(x - 0.9, TIER_Y[4]!, z - 0.9, x + 0.9, TIER_Y[4]! + 3, z + 0.9);
  }

  // Solar fields on the plain: rows facing the low sun's side of the sky.
  const yaw = Math.atan2(0.5, 0.866);
  const fields: [number, number, number, number][] = [[-36, 24, 104, 124], [52, 104, 104, 122], [126, 168, 104, 124], [-150, -112, 104, 118]];
  for (const [a0, a1, r0, r1] of fields) {
    for (let rr = r0; rr <= r1; rr += 4.4) {
      const step = 4.0 / rr;
      for (let a = deg(a0); a <= deg(a1); a += step) {
        const [x, z] = polar(a, rr);
        if (Math.hypot(x - LOOKOUT.x, z - LOOKOUT.z) < LOOKOUT.r + 8) continue;
        if (r() < 0.06) continue;
        props.put(solarPanel, x, TIER_Y[4]!, z, yaw);
        s.col.obox(x, TIER_Y[4]! + 1.3, z, 3.6, 2.0, 1.2, yaw);
      }
    }
  }

  // Boulders: on the plain and the hills' feet, along the foot of each riser, round the pit.
  for (let i = 0; i < 160; i++) {
    const a = r() * Math.PI * 2, rr = RIM_R + 8 + r() * (PLAIN_R + 30 - RIM_R);
    const [x, z] = polar(a, rr);
    if (Math.abs(rr - (RIM_R + 4)) < 4) continue;
    const sc = 0.4 + r() * r() * 2.2;
    props.put(rocks[i % 3]!, x, (rr > PLAIN_R ? hillY(rr, a) : TIER_Y[4]!) - 0.2 * sc, z, r() * 6, sc);
  }
  for (let k = 0; k < 4; k++) {
    for (let i = 0; i < 26; i++) {
      const a = r() * Math.PI * 2;
      if (busyAt(Math.max(1, k), a, 3) || onRamp(k, a, 4)) continue;
      const [x, z] = polar(a, RISER_R[k]! - 0.6 - r() * 1.2);
      const sc = 0.3 + r() * 0.6;
      props.put(rocks[(i + k) % 3]!, x, TIER_Y[k]! - 0.15, z, r() * 6, sc);
    }
  }
}

function buildTower(s: Base) {
  const { pile, col } = s;
  const { x, z, w, top } = TOWER, y0 = TIER_Y[2]!;
  const a = angleOf(x, z), h = w / 2;
  const turn = -a;
  const box = (mat: Parameters<typeof pile.obox>[0], cx: number, cy: number, cz: number, sx: number, sy: number, sz: number) => {
    // A box in the tower's own frame (x across, z toward the crater).
    const c = Math.cos(turn), sn = Math.sin(turn);
    pile.obox(mat, x + cx * c + cz * sn, cy, z - cx * sn + cz * c, sx, sy, sz, turn);
  };
  // The core, white, with a strip of amber windows up its face and orange bands at each floor.
  box("white", 0, (y0 + top) / 2, 0, w - 1.0, top - y0, w - 1.0);
  for (let yy = y0 + 4; yy < top - 2; yy += 4) {
    box("white", 0, yy, 0, w + 0.6, 0.35, w + 0.6);
    box("orange", 0, yy - 0.3, 0, w + 0.62, 0.22, w + 0.62);
    box("viewport", 0, yy + 1.8, (w - 1.0) / 2 + 0.01, 1.4, 2.2, 0.04);
    box("viewport", (w - 1.0) / 2 + 0.01, yy + 1.8, 0, 0.04, 2.2, 1.4);
    box("viewport", -(w - 1.0) / 2 - 0.01, yy + 1.8, 0, 0.04, 2.2, 1.4);
  }
  // Corner columns, a lit cabin at the top, antennas over it.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box("printed", sx * h, (y0 + top) / 2, sz * h, 0.7, top - y0, 0.7);
  box("white", 0, top + 1.4, 0, w + 1.2, 2.8, w + 1.2);
  box("amber", 0, top + 1.5, 0, w + 1.25, 1.0, w + 1.25);
  box("orange", 0, top + 2.9, 0, w + 1.3, 0.25, w + 1.3);
  pile.rod("steel", new THREE.Vector3(x, top + 2.9, z), new THREE.Vector3(x, top + 9, z), 0.08, 6);
  pile.rod("steel", new THREE.Vector3(x + 1.2, top + 2.9, z), new THREE.Vector3(x + 1.2, top + 6, z), 0.05, 6);
  s.halos.push({ x, y: top + 9.2, z, color: "#ff2a1a", size: 2.2, mode: "blink" });
  s.halos.push({ x, y: top + 3.2, z, color: "#ffffff", size: 1.6, mode: "strobe" });
  // A foot of printed regolith where it meets the terrace.
  box("printed", 0, y0 + 0.6, 0, w + 1.6, 1.2, w + 1.6);
  col.obox(x, (y0 + top) / 2, z, w + 1.6, top - y0, w + 1.6, turn);
  s.pools.push({ x: x + Math.sin(-a) * 0, y: y0, z, r: 4.5, k: 0.6 });
}
