// The hull: one smooth surface each side, from below the waterline up to the sheer, lofted from
// the shape in dims.ts; the transom; and a coaming along the top edge, so from the deck the hull
// has a thickness and a capped edge.

import * as THREE from "three";
import { D1, D2, KEEL, PLATFORM, STERN_DOOR, TRANSOM, BOW, halfBeam, hullTop, stemY } from "./dims.ts";
import type { MatKey } from "./mats.ts";
import type { Pile } from "./kit.ts";

const NZ = 240, NT = 30;
export const WELL = 3.4; // half-width of the stair well cut into the stern, up from the swim platform

function zAt(i: number): number {
  // A little finer toward the bow, where the shape changes fastest.
  const u = i / NZ;
  return BOW + (TRANSOM - BOW) * (0.55 * u + 0.45 * u * u);
}

function side(sx: 1 | -1): THREE.BufferGeometry {
  const pos: number[] = [], index: number[] = [];
  for (let i = 0; i <= NZ; i++) {
    const z = zAt(i), top = hullTop(z), bot = Math.max(KEEL, Math.min(top, stemY(z)));
    for (let j = 0; j <= NT; j++) {
      // Rows bunch toward the top edge and the waterline, where they show.
      const s = j / NT, t = s;
      const y = bot + (top - bot) * t;
      pos.push(sx * halfBeam(z, y - 1e-4), y, z);
    }
  }
  const row = NT + 1;
  for (let i = 0; i < NZ; i++) for (let j = 0; j < NT; j++) {
    const a = i * row + j, b = a + 1, c = a + row, d = c + 1;
    if (sx > 0) index.push(a, b, c, b, d, c);
    else index.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

function transom(): THREE.BufferGeometry {
  const top = hullTop(TRANSOM), pts: THREE.Vector2[] = [];
  const n = 16;
  for (let j = 0; j <= n; j++) {
    const y = KEEL + ((top - KEEL) * j) / n;
    pts.push(new THREE.Vector2(halfBeam(TRANSOM, y), y));
  }
  pts.push(new THREE.Vector2(WELL, top), new THREE.Vector2(WELL, PLATFORM.y), new THREE.Vector2(-WELL, PLATFORM.y), new THREE.Vector2(-WELL, top));
  for (let j = n; j >= 0; j--) {
    const y = KEEL + ((top - KEEL) * j) / n;
    pts.push(new THREE.Vector2(-halfBeam(TRANSOM, y), y));
  }
  const shape = new THREE.Shape(pts);
  // The beach club's doorways, either side of the well.
  for (const sx of [1, -1]) {
    const { x0, x1, top } = STERN_DOOR;
    shape.holes.push(new THREE.Path([new THREE.Vector2(sx * x0, PLATFORM.y), new THREE.Vector2(sx * x1, PLATFORM.y), new THREE.Vector2(sx * x1, top), new THREE.Vector2(sx * x0, top)]));
  }
  const g = new THREE.ShapeGeometry(shape).translate(0, 0, TRANSOM);
  g.deleteAttribute("uv");
  return g;
}

/**
 * The coaming: the hull's top edge given a thickness. An inner face from the deck up to the sheer
 * and a cap across the top, all the way round from the stem to the transom.
 */
function coaming(pile: Pile<MatKey>) {
  const T = 0.2;
  for (const sx of [1, -1] as const) {
    const pos: number[] = [], index: number[] = [];
    let n = 0;
    for (let i = 0; i <= NZ; i++) {
      const z = Math.min(zAt(i), TRANSOM - 0.001), top = hullTop(z);
      const low = z < -41.5 ? D2 : D1;
      const wo = halfBeam(z, top - 1e-3), wi = Math.max(0, wo - T);
      // inner face bottom, inner face top, outer top
      pos.push(sx * wi, Math.min(low, top), z, sx * wi, top, z, sx * wo, top, z);
      n++;
    }
    for (let i = 0; i + 1 < n; i++) {
      const a = i * 3, b = (i + 1) * 3;
      // inner face (faces inboard), then the cap (faces up)
      if (sx < 0) index.push(a, a + 1, b, b, a + 1, b + 1, a + 1, a + 2, b + 1, b + 1, a + 2, b + 2);
      else index.push(a, b, a + 1, b, b + 1, a + 1, a + 1, b + 1, a + 2, b + 1, b + 2, a + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(index);
    g.computeVertexNormals();
    pile.add("white", g);
  }
  // Across the transom's top, either side of the stair well.
  const top = hullTop(TRANSOM);
  for (const sx of [1, -1]) {
    const w = halfBeam(TRANSOM, top);
    // Standing a hair proud of the transom: sharing its plane would z-fight along the top edge.
    pile.box("white", sx * WELL, top - 0.05, TRANSOM - 0.2, sx * w, top + 0.02, TRANSOM + 0.012);
  }
}

export function buildHull(pile: Pile<MatKey>) {
  pile.add("hull", side(1));
  pile.add("hull", side(-1));
  pile.add("hull", transom());
  coaming(pile);
}
