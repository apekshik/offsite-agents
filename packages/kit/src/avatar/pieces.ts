// Adapted from Ready Player One (github.com/apekshik/ready-player-one).
//
// The shapes of look pieces (sanitize.ts sanitizePiece). Every piece's geometry fills the unit
// box (-0.5 to 0.5), which its size then scales: the knobs (sides, taper, round) and the
// freeform shapes (hull, extrude, lathe: points inside that box) keep to it too.

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { ConvexGeometry } from "three/addons/geometries/ConvexGeometry.js";

/** A look piece after sanitizing: the contract's fields plus the optional knobs. */
export interface PieceShape {
  shape: string;
  sides?: number;
  taper?: number;
  round?: number;
  bevel?: number;
  smooth?: boolean;
  points?: number[][];
}

export function pieceGeometry(p: PieceShape): THREE.BufferGeometry {
  try {
    return shapeGeometry(p);
  } catch {
    return new RoundedBoxGeometry(1, 1, 1, 2, 0.06); // points that make no solid (all in a line): a block
  }
}

// A taper of t: the top this wide against the bottom, the wider end full size.
const ends = (t = 1): [number, number] => [0.5 * Math.min(1, t), 0.5 * Math.min(1, 1 / Math.max(t, 1e-3))];

// Points through a smooth curve (closed for an outline), a few per span.
function smoothed(pts: number[][], closed: boolean) {
  const curve = new THREE.CatmullRomCurve3(pts.map(([a = 0, b = 0]) => new THREE.Vector3(a, b, 0)), closed, "centripetal");
  return curve.getPoints(pts.length * 6).map((v) => new THREE.Vector2(v.x, v.y));
}

function shapeGeometry(p: PieceShape): THREE.BufferGeometry {
  const sides = p.sides;
  const pts = p.points ?? [];
  switch (p.shape) {
    case "sphere": return new THREE.SphereGeometry(0.5, sides ?? 16, sides ? Math.max(2, Math.round(sides * 0.75)) : 12);
    case "cylinder": { const [top, bottom] = ends(p.taper); return new THREE.CylinderGeometry(top, bottom, 1, sides ?? 16); }
    case "cone": return new THREE.ConeGeometry(0.5, 1, sides ?? 16);
    case "hull": {
      const g = new ConvexGeometry(pts.map(([x = 0, y = 0, z = 0]) => new THREE.Vector3(x, y, z)));
      if (!g.attributes["position"]?.count) throw new Error("flat hull");
      return g;
    }
    case "extrude": {
      const outline = p.smooth ? smoothed(pts, true) : pts.map(([x = 0, y = 0]) => new THREE.Vector2(x, y));
      const b = p.bevel ?? 0, depth = Math.max(0.05, 1 - 2 * b);
      const g = new THREE.ExtrudeGeometry(new THREE.Shape(outline), { depth, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b * 0.5, bevelSegments: 2, curveSegments: 4 });
      return g.translate(0, 0, -depth / 2);
    }
    case "lathe": {
      const profile = p.smooth ? smoothed(pts, false).map((v) => new THREE.Vector2(Math.max(0, v.x), v.y)) : pts.map(([r = 0, y = 0]) => new THREE.Vector2(r, y));
      return new THREE.LatheGeometry(profile, sides ?? 24);
    }
    case "capsule": return new THREE.CapsuleGeometry(0.5, 1, 4, 12).scale(1, 0.5, 1);
    case "torus": return new THREE.TorusGeometry(0.4, 0.1, 10, 24).rotateX(Math.PI / 2).scale(1, 5, 1);
    case "wedge": {
      const tri = new THREE.Shape([new THREE.Vector2(-0.5, -0.5), new THREE.Vector2(0.5, -0.5), new THREE.Vector2(-0.5, 0.5)]);
      return new THREE.ExtrudeGeometry(tri, { depth: 1, bevelEnabled: false }).rotateY(-Math.PI / 2).translate(0.5, 0, 0);
    }
    default: {
      const r = p.round ?? 0.06;
      const g = r > 0 ? new RoundedBoxGeometry(1, 1, 1, 2, Math.min(r, 0.49)) : new THREE.BoxGeometry(1, 1, 1);
      if (p.taper != null && p.taper !== 1) {
        // Narrow toward the top (or the bottom, above 1), the wider end full size.
        const [top, bottom] = ends(p.taper), pos = g.attributes["position"]!;
        for (let i = 0; i < pos.count; i++) {
          const k = (top + (bottom - top) * (0.5 - pos.getY(i))) * 2;
          pos.setX(i, pos.getX(i) * k);
          pos.setZ(i, pos.getZ(i) * k);
        }
        g.computeVertexNormals();
      }
      return g;
    }
  }
}
