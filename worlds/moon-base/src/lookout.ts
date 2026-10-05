// The rim lookout: a round glass pavilion on the rim, north-west, under a white roof with a lit
// crown. Armchairs face across the crater toward Earth, a telescope stands by the glass. The
// quietest place on the base, and the best view of home.

import * as THREE from "three";
import { EARTH, LOOKOUT, TIER_Y } from "./dims.ts";
import { bigPlant, lookChair, lowTable } from "./furniture.ts";
import { angleOf, arc, cap, deg, polar, yawOf, type P2 } from "./kit.ts";
import { joinRoad, type Base } from "./parts.ts";

export function buildLookout(s: Base) {
  const { pile, inner, col, plan, props, innerProps } = s;
  const { x: cx, z: cz, r, h } = LOOKOUT;
  const Y = TIER_Y[4]!, F = Y + 0.38;
  const door = angleOf(-cx, -cz); // toward the crater's centre
  const earthYaw = Math.PI - EARTH.az; // facing Earth
  const P = (a: number, rr: number): P2 => { const [x, z] = polar(a, rr); return [cx + x, cz + z]; };
  const V = (a: number, rr: number, y: number) => { const [x, z] = P(a, rr); return new THREE.Vector3(x, y, z); };
  const isDoor = (a: number, extra = 0) => Math.abs(Math.atan2(Math.sin(a - door), Math.cos(a - door))) * r < 1.3 + extra;

  // A printed plinth, a floor a step up.
  const ringPts = arc(cx, cz, r + 0.4, 0, Math.PI * 2, Math.PI / 32).slice(0, -1);
  pile.cyl("printed", cx, Y, cz, r + 0.4, F - Y, 40);
  inner.add("floor", cap(arc(cx, cz, r - 0.05, 0, Math.PI * 2, Math.PI / 32).slice(0, -1), F + 0.005));
  col.floor(ringPts, F, F - Y);
  // The glass wall, open at the door, white mullions round it.
  const NG = 40;
  const gp: number[] = [], gi: number[] = [];
  for (let i = 0; i <= NG; i++) {
    const a = (i / NG) * Math.PI * 2;
    const [x, z] = P(a, r);
    gp.push(x, F, z, x, F + h, z);
  }
  for (let i = 0; i < NG; i++) {
    if (isDoor(((i + 0.5) / NG) * Math.PI * 2)) continue;
    const p = i * 2, q = p + 2;
    gi.push(p, q, q + 1, p, q + 1, p + 1);
  }
  const glassG = new THREE.BufferGeometry();
  glassG.setAttribute("position", new THREE.Float32BufferAttribute(gp, 3));
  glassG.setIndex(gi);
  glassG.computeVertexNormals();
  pile.add("lookGlass", glassG);
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    if (isDoor(a, -0.3) && !isDoor(a, -1.25)) continue;
    pile.rod("white", V(a, r, F), V(a, r, F + h), 0.07, 6);
  }
  for (const a of [door - 1.35 / r, door + 1.35 / r]) pile.rod("white", V(a, r, F), V(a, r, F + h), 0.1, 6);
  // Colliders: the wall, open at the door.
  const wall: P2[] = [];
  for (let i = 0; i <= 64; i++) {
    const a = door + 1.4 / r + ((i / 64) * (Math.PI * 2 - 2.8 / r));
    wall.push(P(a, r));
  }
  col.wall(wall, F, F + h, 0.25);
  // The roof: a white disc with an orange edge, light round its underside, a lit crown on top.
  pile.cyl("white", cx, F + h, cz, r + 0.6, 0.38, 40);
  pile.cyl("orange", cx, F + h + 0.38, cz, r + 0.62, 0.1, 40);
  inner.add("whiteIn", cap(arc(cx, cz, r + 0.55, 0, Math.PI * 2, Math.PI / 32).slice(0, -1), F + h - 0.005, true));
  for (const [a0, a1] of [[0, Math.PI * 2]] as const) {
    const ring = arc(cx, cz, r - 0.25, a0, a1, Math.PI / 32);
    for (let i = 0; i + 1 < ring.length; i++) inner.rod("amber", new THREE.Vector3(ring[i]![0], F + h - 0.06, ring[i]![1]), new THREE.Vector3(ring[i + 1]![0], F + h - 0.06, ring[i + 1]![1]), 0.03, 4);
  }
  pile.cyl("white", cx, F + h + 0.38, cz, 2.6, 0.9, 24, 2.2);
  pile.cyl("amber", cx, F + h + 1.0, cz, 2.3, 0.3, 24);
  pile.cyl("white", cx, F + h + 1.28, cz, 2.0, 0.3, 24, 1.2);
  pile.rod("steel", new THREE.Vector3(cx, F + h + 1.5, cz), new THREE.Vector3(cx, F + h + 4.2, cz), 0.05, 6);
  s.halos.push({ x: cx, y: F + h + 4.3, z: cz, color: "#ff2a1a", size: 1.0, mode: "blink" });
  s.halos.push({ x: cx, y: F + h + 1.15, z: cz, color: "#ffc27a", size: 1.4, mode: "night" });

  // Armchairs looking out toward Earth, low tables between, a telescope, plants.
  const chairs = [-50, -18, 14, 46].map((d) => EARTH.az + deg(d));
  const ids: string[] = [];
  chairs.forEach((a, i) => {
    const [x, z] = P(a, 4.7);
    innerProps.put(lookChair, x, F, z, earthYaw);
    col.obox(x, F + 0.35, z, 0.85, 0.7, 0.85, earthYaw);
    const [nx, nz] = P(a, 2.6);
    ids.push(plan.node(`lookout:${i}`, nx, F, nz));
    plan.slot("deck-chair", `lookout-chair-${i + 1}`, [x, F, z], earthYaw, { seat: 0.42, nav: `lookout:${i}`, tags: ["lookout", "leisure", "indoors", "place:at the lookout", "pastime:looking at Earth"] });
  });
  for (const d of [-34, 30]) {
    const [x, z] = P(EARTH.az + deg(d), 5.2);
    innerProps.put(lowTable, x, F, z, 0, 0.7);
    col.cyl(x, F, z, 0.45, 0.4, 8);
  }
  {
    // The telescope: a white tube on a tripod, aimed at Earth.
    const [tx, tz] = P(EARTH.az + deg(102), 5.6);
    const base = new THREE.Vector3(tx, F, tz);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      inner.rod("dark", base.clone().add(new THREE.Vector3(Math.cos(a) * 0.45, 0, Math.sin(a) * 0.45)), base.clone().add(new THREE.Vector3(0, 1.25, 0)), 0.025, 5);
    }
    const dir = new THREE.Vector3(Math.sin(EARTH.az), Math.tan(EARTH.el) + 0.15, -Math.cos(EARTH.az)).normalize();
    const mid = base.clone().add(new THREE.Vector3(0, 1.3, 0));
    inner.rod("white", mid.clone().addScaledVector(dir, -0.55), mid.clone().addScaledVector(dir, 0.75), 0.12, 12, false);
    inner.rod("orange", mid.clone().addScaledVector(dir, 0.55), mid.clone().addScaledVector(dir, 0.78), 0.135, 12, false);
    col.cyl(tx, F, tz, 0.45, 1.6, 8);
  }
  for (const d of [130, 170, 250, 290]) {
    const [x, z] = P(EARTH.az + deg(d), 6.2);
    innerProps.put(bigPlant, x, F, z, d);
    col.cyl(x, F, z, 0.35, 1.2, 8);
  }
  // Two places at the glass, standing, looking at home.
  for (const [i, d] of [[1, -2], [2, 30]] as const) {
    const [x, z] = P(EARTH.az + deg(d), r - 0.65);
    plan.slot("rail", `lookout-glass-${i}`, [x, F, z], earthYaw, { tags: ["lookout", "indoors", "place:at the lookout", "pastime:looking at Earth"] });
  }

  // Walking: in at the door, round the chairs.
  const [ox, oz] = P(door, r + 2.6);
  const out = plan.node("lookout:out", ox, Y, oz);
  const [ix, iz] = P(door, r - 1.6);
  const inn = plan.node("lookout:in", ix, F, iz);
  plan.link(out, inn);
  joinRoad(s, out, "t4:");
  const [mx, mz] = P(EARTH.az + deg(180), 1.2);
  ids.push(inn, plan.node("lookout:mid", mx, F, mz));
  s.open.push({ ids, reach: 8 });
  void props; void yawOf;
}
