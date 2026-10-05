// The bow: a round helipad on the foredeck behind chrome rails strung with blue and white
// bunting, the bridge house's lower tiers stacked behind it, walkways down both sides to the
// office, and a stair down each side to the promenades.

import * as THREE from "three";
import { LIGHT } from "@offsite/kit";
import { D1, D2, D3, D4, PAD, SLAB, halfBeam } from "./dims.ts";
import { along, outline, runs, yawOf, type Outline, type P2 } from "./kit.ts";
import { balustrade, chromeRail, downlights, house, slab, stairs, type Ship } from "./parts.ts";

/** The D2 slab from the stem to the office, notched each side for the stair up from the promenade. */
export const FORE: Outline = {
  zF: -69.05, zA: -22, w: 11.2,
  hw: (z) => Math.max(0, Math.min(halfBeam(z, D2) - 0.22, 11.18)),
  notches: [[1, -28.6, -22, 9.2], [-1, -28.6, -22, 9.2]],
};
export const TIER2: Outline = { zF: -40, zA: -22, w: 8.0, rf: 7, nf: 2.2 };
const TIER3_DECK: Outline = { zF: -41.2, zA: -22, w: 9.0, rf: 8, nf: 2.2 };
const TIER3: Outline = { zF: -36.6, zA: -22, w: 7.4, rf: 6, nf: 2.2 };
export const FORE_STAIR = { x0: 9.4, x1: 10.9, zLow: -22.0, zHigh: -28.6 };

function padTexture(): THREE.CanvasTexture {
  const S = 1024, c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  g.fillStyle = "#454b54";
  g.fillRect(0, 0, S, S);
  g.translate(S / 2, S / 2);
  const r = S / 2;
  g.strokeStyle = "#f4f4f0";
  // The edge line, the big circle, and the H across the ship (readable from either side).
  g.lineWidth = r * 0.035;
  g.beginPath(); g.arc(0, 0, r * 0.955, 0, Math.PI * 2); g.stroke();
  g.lineWidth = r * 0.07;
  g.beginPath(); g.arc(0, 0, r * 0.6, 0, Math.PI * 2); g.stroke();
  g.fillStyle = "#f4f4f0";
  const hw = r * 0.25, hh = r * 0.33, t = r * 0.07;
  g.fillRect(-hw - t / 2, -hh, t, hh * 2);
  g.fillRect(hw - t / 2, -hh, t, hh * 2);
  g.fillRect(-hw, -t / 2, hw * 2, t);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Pennant bunting along a rail: little triangles on a sagging line, fluttering aft in the ship's wind. */
function bunting(points: P2[], y: number): THREE.Mesh {
  const pos: number[] = [], col: number[] = [], wt: number[] = [], ph: number[] = [];
  const blue = new THREE.Color("#2b63b8"), white = new THREE.Color("#f3f2ee");
  let k = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const [x0, z0] = points[i]!, [x1, z1] = points[i + 1]!;
    const l = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.floor(l / 0.42));
    for (let j = 0; j < n; j++) {
      const u0 = (j + 0.1) / n, u1 = (j + 0.9) / n, um = (u0 + u1) / 2;
      const sag = (u: number) => y - 0.18 * 4 * u * (1 - u);
      const ax = x0 + (x1 - x0) * u0, az = z0 + (z1 - z0) * u0, bx = x0 + (x1 - x0) * u1, bz = z0 + (z1 - z0) * u1;
      const mx = x0 + (x1 - x0) * um, mz = z0 + (z1 - z0) * um;
      pos.push(ax, sag(u0), az, bx, sag(u1), bz, mx, sag(um) - 0.3, mz + 0.06);
      const c = k++ % 2 ? white : blue;
      for (let v = 0; v < 3; v++) col.push(c.r, c.g, c.b);
      wt.push(0, 0, 1);
      const p = mx * 1.7 + mz * 0.9;
      ph.push(p, p, p);
    }
    // The line itself is thin enough to leave to the eye.
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute("aWeight", new THREE.Float32BufferAttribute(wt, 1));
  geo.setAttribute("aPhase", new THREE.Float32BufferAttribute(ph, 1));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = LIGHT.uTime;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aWeight, aPhase; uniform float uTime;")
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        transformed.z += aWeight * (0.16 + 0.07 * sin(uTime * 9.0 + aPhase));
        transformed.x += aWeight * 0.06 * sin(uTime * 7.0 + aPhase * 1.3);
        transformed.y += aWeight * 0.05 * sin(uTime * 11.0 + aPhase);`);
  };
  mat.customProgramCacheKey = () => "bunting";
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "bunting";
  mesh.castShadow = true;
  return mesh;
}

export function buildForedeck(s: Ship) {
  const { pile, plan } = s;

  // The D2 slab, teak, over the hull's top.
  slab(s, FORE, D2, { noUnder: true });

  // The helipad: a dark disc with its markings, edge lights.
  const pad = new THREE.Mesh(new THREE.CircleGeometry(PAD.r, 72).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: padTexture(), roughness: 0.85 }));
  pad.position.set(PAD.x, D2 + 0.025, PAD.z);
  pad.receiveShadow = true;
  pad.name = "helipad";
  s.extra.push(pad);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    pile.cyl("lamp", PAD.x + Math.cos(a) * (PAD.r + 0.25), D2, PAD.z + Math.sin(a) * (PAD.r + 0.25), 0.07, 0.06, 8);
  }

  // Rails: chrome round the bow (with bunting), glass where the deck runs out over the promenade.
  const edge = outline({ ...FORE, hw: (z) => Math.max(0, (FORE.hw!(z)) - 0.12), notches: [] });
  // One run from the port side round the stem to the starboard side.
  const bowRun = [...edge.filter(([x, z]) => x <= 0 && z <= -38.4).sort((a, b) => b[1] - a[1]), ...edge.filter(([x, z]) => x > 0 && z <= -38.4).sort((a, b) => a[1] - b[1])];
  chromeRail(s, bowRun, D2);
  s.extra.push(bunting(bowRun.filter((_, i) => i % 2 === 0), D2 + 1.04));
  for (const side of [1, -1] as const) {
    const run = edge.filter(([x, z]) => Math.sign(x) === side && z >= -38.6 && z <= -28.6).sort((a, b) => a[1] - b[1]);
    balustrade(s, run, D2);
    // Round the notch: along its inner edge.
    balustrade(s, [[side * 9.2, -28.6], [side * 9.2, -22.02]], D2);
  }

  // The bridge house's lower tiers: dark glass bands under white eyebrows.
  const t2 = outline(TIER2);
  house(s, t2, D2, D3 - SLAB, { glass: [D2 + 0.55, D3 - SLAB - 0.35], open: (_x, z) => z > -22.05 });
  slab(s, TIER3_DECK, D3, { top: "teak" });
  const t3deck = outline(TIER3_DECK);
  for (const run of runs(t3deck, (_x, z) => z < -22.3)) balustrade(s, run.map(([x, z]) => [x * 0.985, z + 0.08] as P2), D3, { collide: true });
  house(s, outline(TIER3), D3, D4 - SLAB, { glass: [D3 + 0.55, D4 - SLAB - 0.4], open: (_x, z) => z > -22.05 });
  downlights(s, t3deck.filter(([, z]) => z < -23).map(([x, z]) => [x * 0.94, z + 0.4] as P2), D3 - SLAB, 2.8);

  // A stair each side from the promenade (D1) up through the notch to the walkway.
  for (const side of [1, -1] as const) {
    const x0 = side * FORE_STAIR.x0, x1 = side * FORE_STAIR.x1;
    stairs(s, { id: `fore-stair-${side > 0 ? "s" : "p"}`, x0, x1, zLow: FORE_STAIR.zLow, yLow: D1, zHigh: FORE_STAIR.zHigh, yHigh: D2 });
  }

  // Walking: round the pad, to the walkways either side of the house, to the office's front doors.
  plan.node("pad", PAD.x, D2, PAD.z);
  plan.node("pad-fore", 0, D2, PAD.z - 5.5);
  plan.node("pad-aft", 0, D2, -43.6);
  plan.node("pad-door", 0, D2, PAD.z + 3.6);
  plan.node("bow-c", 0, D2, -64.0);
  plan.link("pad-fore", "pad", "pad-door", "pad-aft");
  plan.link("pad-fore", "bow-c");
  for (const side of [1, -1] as const) {
    const n = side > 0 ? "s" : "p";
    plan.node(`pad-${n}`, side * 6.2, D2, PAD.z + 0.5);
    plan.node(`fore-${n}0`, side * 6.4, D2, -42.6);
    plan.node(`fore-${n}1`, side * 9.4, D2, -37.5);
    plan.node(`fore-${n}2`, side * 9.4, D2, -31.0);
    plan.node(`fore-${n}3`, side * 8.6, D2, -27.0);
    plan.node(`fore-${n}4`, side * 8.75, D2, -23.0);
    plan.link("pad", `pad-${n}`);
    plan.link("pad-fore", `pad-${n}`);
    plan.link("pad-aft", `fore-${n}0`, `fore-${n}1`, `fore-${n}2`, `fore-${n}3`, `fore-${n}4`);
    plan.link(`pad-${n}`, `fore-${n}0`);
    plan.node(`bow-${n}1`, side * 5.6, D2, -59.6);
    plan.node(`bow-${n}2`, side * 8.4, D2, -47.5);
    plan.link("bow-c", `bow-${n}1`, `pad-${n}`, `bow-${n}2`, `fore-${n}0`);
    plan.link(`fore-${n}2`, `fore-stair-${n}:high`);
  }

  // Slots: the pad, where new crew step out (aft of the helicopter's door, facing the office),
  // and spots at the bow rail looking out.
  plan.slot("helipad", "helipad", [PAD.x, D2, PAD.z], -Math.PI / 2, { nav: "pad" });
  [[-1.4, 3.1], [0.0, 3.3], [1.4, 3.1]].forEach(([x, dz], i) => plan.slot("crew-spawn", `crew-spawn-${i + 1}`, [PAD.x + x!, D2, PAD.z + dz!], 0, { nav: "pad-door" }));
  const railSpots = along(bowRun, 4.2, 2.5).filter((p) => Math.abs(p.x) > 1.5 || p.z < -66);
  railSpots.forEach((p, i) => {
    // Outward: perpendicular to the rail, away from the centreline of the deck.
    let nx = p.dz, nz = -p.dx;
    if (nx * p.x + nz * (p.z - PAD.z) < 0) { nx = -nx; nz = -nz; }
    plan.slot("rail", `rail-bow-${i + 1}`, [p.x - nx * 0.45, D2, p.z - nz * 0.45], yawOf(nx, nz), { tags: ["bow"] });
  });
}
