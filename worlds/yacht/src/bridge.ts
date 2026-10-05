// The bridge: top of the forward house, glass wrapped round its front, the helm console with the
// ship's computer's big screen, a hover pad where the computer's robot floats, a counter at the
// back where finished work is dropped off. On its roof, the mast and two radomes.

import * as THREE from "three";
import type { Interactable } from "@offsite/kit";
import { BRIDGE, D4, D5, SLAB } from "./dims.ts";
import { helmChair, palm, sofa } from "./furniture.ts";
import { inset, outline, runs, yawOf, type Outline } from "./kit.ts";
import { balustrade, house, slab, type Ship } from "./parts.ts";
import { helmScreenTexture, screen } from "./screens.ts";

const BRIDGE_DECK: Outline = { zF: -34.4, zA: -22, w: 8.4, rf: 7, nf: 2.2 };
const HOUSE: Outline = { zF: BRIDGE.z0, zA: BRIDGE.z1, w: BRIDGE.w, rf: 5.5, nf: 2.2 };
const ROOF: Outline = { zF: -32.7, zA: -20.3, w: 7.7, rf: 6.4, nf: 2.2 };
const SILL = D4 + 0.9, HEAD = D5 - SLAB - 0.12;
export const HELM = { x: 0, z: -27.5 };

export function buildBridge(s: Ship): Interactable[] {
  const { pile, col, plan, props } = s;
  const deck = slab(s, BRIDGE_DECK, D4);
  for (const run of runs(deck, (_x, z) => z < -22.05)) balustrade(s, inset(run, 0.08), D4);

  // Glass all round the front; a white aft wall with a door onto the canopy deck.
  const hp = outline(HOUSE);
  house(s, hp, D4, D5 - SLAB, { glass: [SILL, HEAD], glassMat: "bridgeGlass", mullion: 2.2, open: (_x, z) => z > BRIDGE.z1 - 0.05 });
  const zA = BRIDGE.z1;
  pile.box("white", -BRIDGE.w, D4, zA - 0.2, -0.85, D5 - SLAB, zA);
  pile.box("white", 0.85, D4, zA - 0.2, BRIDGE.w, D5 - SLAB, zA);
  pile.box("white", -0.85, D4 + 2.35, zA - 0.2, 0.85, D5 - SLAB, zA);
  col.box(-BRIDGE.w, D4, zA - 0.3, -0.85, D5 - SLAB, zA);
  col.box(0.85, D4, zA - 0.3, BRIDGE.w, D5 - SLAB, zA);
  // Inside: a floor, ceiling lights.
  const floorPts = inset(hp, 0.15);
  pile.add("floor", new THREE.ShapeGeometry(new THREE.Shape(floorPts.map(([x, z]) => new THREE.Vector2(x, -z)))).rotateX(-Math.PI / 2).translate(0, D4 + 0.02, 0).deleteAttribute("uv") as THREE.BufferGeometry);
  for (const z of [-28, -24.5]) pile.box("panel", -2.5, D5 - SLAB - 0.03, z - 0.2, 2.5, D5 - SLAB, z + 0.2);

  // The helm console: a curved desk following the windows, instruments glowing along its top.
  const R = 3.3, cz = HELM.z + 1.5;
  const arc = (r0: number, r1: number, a0: number, a1: number, y0: number, y1: number) => {
    const shape = new THREE.Shape(), n = 24;
    for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; shape[i ? "lineTo" : "moveTo"](Math.sin(a) * r1, -cz + Math.cos(a) * r1); }
    for (let i = n; i >= 0; i--) { const a = a0 + ((a1 - a0) * i) / n; shape.lineTo(Math.sin(a) * r0, -cz + Math.cos(a) * r0); }
    const g = new THREE.ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: false, curveSegments: 1 }).rotateX(-Math.PI / 2).translate(0, y0, 0);
    g.deleteAttribute("uv");
    return g;
  };
  pile.add("dark", arc(R - 0.32, R + 0.36, -1.1, 1.1, D4, D4 + 0.88));
  pile.add("white", arc(R - 0.4, R + 0.42, -1.12, 1.12, D4 + 0.88, D4 + 0.94));
  for (const [a0, a1] of [[-1.0, -0.55], [-0.45, -0.3], [0.3, 0.45], [0.55, 1.0]] as const) pile.add("glowBlue", arc(R - 0.2, R + 0.15, a0, a1, D4 + 0.94, D4 + 0.955));
  col.box(-R, D4, cz - R - 0.4, R, D4 + 1.0, cz - R + 0.8);
  // The big screen: the ship's computer, tilted back a little toward whoever stands at the helm.
  const big = screen("helm", 2.5, 1.06, helmScreenTexture(), 1.15);
  big.position.set(0, D4 + 1.55, cz - R + 0.05);
  big.rotation.x = -0.18;
  s.extra.push(big);
  pile.obox("dark", 0, D4 + 1.55, cz - R + 0.0, 2.62, 1.18, 0.06, 0, -0.18);
  pile.box("dark", -0.1, D4 + 0.95, cz - R - 0.1, 0.1, D4 + 1.1, cz - R + 0.1);
  for (const sx of [-1, 1]) props.put(helmChair, sx * 1.55, D4, HELM.z + 0.2, Math.PI);

  // The computer's hover pad, beside the console.
  const comp = { x: 3.6, z: HELM.z + 1.2 };
  const ring = new THREE.TorusGeometry(0.55, 0.035, 6, 32).rotateX(Math.PI / 2).translate(comp.x, D4 + 0.03, comp.z);
  ring.deleteAttribute("uv");
  pile.add("glowBlue", ring);
  pile.cyl("dark", comp.x, D4, comp.z, 0.5, 0.025, 24);

  // The drop-off: a teak counter along the back wall, where packages pile up.
  pile.box("wood", -5.6, D4, zA - 0.75, -1.7, D4 + 0.9, zA - 0.2);
  pile.box("white", -5.65, D4 + 0.9, zA - 0.8, -1.65, D4 + 0.95, zA - 0.2);
  col.box(-5.6, D4, zA - 0.75, -1.7, D4 + 1.0, zA - 0.2);
  props.put(sofa, 4.1, D4, zA - 0.75, Math.PI);
  col.box(2.95, D4, zA - 1.2, 5.25, D4 + 0.8, zA - 0.2);
  props.put(palm, 5.9, D4, -24.2, 0.3);

  // The roof, the mast and the radomes.
  slab(s, ROOF, D5, { top: "white", collide: false });
  const mz = -24.6;
  pile.obox("white", 0, D5 + 3.4, mz + 0.4, 0.8, 6.8, 1.8, 0, -0.14);
  pile.obox("white", 0, D5 + 0.35, mz, 3.0, 0.7, 3.4);
  pile.obox("white", 0, D5 + 6.0, mz + 1.15, 6.0, 0.24, 0.45);
  pile.rod("white", new THREE.Vector3(0, D5 + 6.4, mz + 1.2), new THREE.Vector3(0, D5 + 11.6, mz + 1.5), 0.1, 8);
  pile.cyl("lamp", 0, D5 + 11.6, mz + 1.5, 0.13, 0.22, 8);
  pile.cyl("chrome", 0, D5 + 11.8, mz + 1.5, 0.05, 0.6, 6);
  for (const sx of [-1, 1]) {
    pile.rod("white", new THREE.Vector3(sx * 2.6, D5 + 6.0, mz + 1.15), new THREE.Vector3(sx * 2.65, D5 + 7.6, mz + 1.2), 0.035, 6);
    pile.cyl("white", sx * 3.5, D5, mz - 0.6, 0.5, 0.7, 14);
    const dome = new THREE.SphereGeometry(1.32, 24, 16).translate(sx * 3.5, D5 + 1.85, mz - 0.6);
    dome.deleteAttribute("uv");
    pile.add("white", dome);
  }
  // A radar bar turning on the mast's face.
  const radar = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.16, 0.24), s.materials.white);
  radar.position.set(0, D5 + 4.2, mz - 0.75);
  radar.castShadow = true;
  s.extra.push(radar);
  s.tick.push((_dt, t) => { radar.rotation.y = t * 2.4; });

  // Walking: through the door, past the spawn point, up to the helm.
  plan.node("bridge-door", 0, D4, zA + 0.9);
  plan.node("bridge-in", 0, D4, zA - 1.1);
  plan.node("bridge-mid", 0, D4, -24.2);
  plan.node("bridge-helm", HELM.x, D4, HELM.z + 0.6);
  plan.node("bridge-p", -3.4, D4, -23.4);
  plan.node("bridge-s", 2.6, D4, -24.4);
  plan.link("bridge-door", "bridge-in", "bridge-mid", "bridge-helm");
  plan.link("bridge-in", "bridge-p");
  plan.link("bridge-mid", "bridge-p");
  plan.link("bridge-mid", "bridge-s");

  plan.slot("helm", "helm", [HELM.x, D4, HELM.z], Math.PI, { nav: "bridge-helm", tags: ["bridge", "indoors"] });
  plan.slot("computer", "computer", [comp.x, D4, comp.z], yawOf(-comp.x, -22.5 - comp.z), { nav: "bridge-s", tags: ["bridge", "indoors"] });
  plan.slot("dropoff", "dropoff", [-3.65, D4, zA - 1.55], 0, { nav: "bridge-p", tags: ["bridge", "indoors"] });

  return [{ id: "helm", label: "Open the helm console", at: new THREE.Vector3(HELM.x, D4 + 1.3, HELM.z - 0.6), radius: 2.4 }];
}
