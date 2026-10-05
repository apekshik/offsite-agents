// Adapted from Ready Player One (github.com/apekshik/ready-player-one).
//
// Walkable decks. The world hands its solid meshes to one collision world (a BVH over their
// triangles). The captain is a capsule for walls and ceilings, plus a downward probe that finds
// the floor under their feet: planks, steps, ramps. Anything lower than STEP is walked onto.

import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/** The tallest ledge you walk up without jumping (a stair is ~0.18). */
export const STEP = 0.42;
const FLOOR_NORMAL_Y = 0.5; // surfaces steeper than ~60° aren't floors

export interface RayHit { point: THREE.Vector3; t: number; normal: THREE.Vector3 }

export class Collision {
  private parts: THREE.BufferGeometry[] = [];
  private bvh: MeshBVH | null = null;
  private ray = new THREE.Ray();
  private seg = new THREE.Line3();
  private box = new THREE.Box3();
  private triPoint = new THREE.Vector3();
  private capPoint = new THREE.Vector3();
  private dir = new THREE.Vector3();

  /** Add meshes as solid, with their current world transforms. Skips anything with userData.noCollide. */
  add(...objects: THREE.Object3D[]) {
    for (const object of objects) {
      object.updateWorldMatrix(true, true);
      object.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || o.userData["noCollide"] || !m.geometry?.attributes["position"]) return;
        const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
        for (const name of Object.keys(g.attributes)) if (name !== "position") g.deleteAttribute(name);
        g.morphAttributes = {};
        g.applyMatrix4(m.matrixWorld);
        this.parts.push(g);
      });
    }
    return this;
  }

  /** Merge everything added into the BVH. Call once after adding (again after adding more). */
  build() {
    if (!this.parts.length) return this;
    const all = this.bvh ? [this.bvh.geometry, ...this.parts] : this.parts;
    const merged = mergeGeometries(all, false);
    for (const g of this.parts) g.dispose();
    this.parts = [];
    this.bvh = new MeshBVH(merged);
    return this;
  }

  get ready() { return !!this.bvh; }

  /** Height of the floor under (x, z), searching from `top` down by `depth`. Null if none. */
  floorBelow(x: number, top: number, z: number, depth: number): number | null {
    if (!this.bvh) return null;
    this.ray.origin.set(x, top, z);
    this.ray.direction.set(0, -1, 0);
    const hit = this.bvh.raycastFirst(this.ray, THREE.DoubleSide, 0, depth);
    if (!hit) return null;
    const n = hit.face?.normal;
    if (n && Math.abs(n.y) < FLOOR_NORMAL_Y) return null;
    return hit.point.y;
  }

  raycast(origin: THREE.Vector3, dir: THREE.Vector3, far: number): RayHit | null {
    if (!this.bvh) return null;
    this.ray.origin.copy(origin);
    this.ray.direction.copy(dir);
    const hit = this.bvh.raycastFirst(this.ray, THREE.DoubleSide, 0, far);
    return hit ? { point: hit.point.clone(), t: hit.distance, normal: hit.face?.normal?.clone() ?? new THREE.Vector3(0, 1, 0) } : null;
  }

  /**
   * Push a capsule out of walls and ceilings. `pos` is the feet; the capsule starts above STEP so
   * ledges below that are left to the floor probe. Returns the push applied (also added to pos).
   */
  resolveCapsule(pos: THREE.Vector3, radius: number, height: number, out = new THREE.Vector3()): THREE.Vector3 {
    out.set(0, 0, 0);
    if (!this.bvh) return out;
    const seg = this.seg, box = this.box;
    seg.start.set(pos.x, pos.y + STEP + radius, pos.z);
    seg.end.set(pos.x, pos.y + height - radius, pos.z);
    if (seg.end.y < seg.start.y) seg.end.y = seg.start.y;
    const sx = seg.start.x, sy = seg.start.y, sz = seg.start.z;
    for (let pass = 0; pass < 3; pass++) {
      box.makeEmpty();
      box.expandByPoint(seg.start);
      box.expandByPoint(seg.end);
      box.min.addScalar(-radius);
      box.max.addScalar(radius);
      let moved = false;
      this.bvh.shapecast({
        intersectsBounds: (b) => b.intersectsBox(box),
        intersectsTriangle: (tri) => {
          const d = tri.closestPointToSegment(seg, this.triPoint, this.capPoint);
          if (d < radius) {
            const depth = radius - d;
            const dir = this.dir.subVectors(this.capPoint, this.triPoint);
            if (dir.lengthSq() < 1e-10) tri.getNormal(dir);
            dir.normalize();
            // Never lift: standing on things is the floor probe's job. Taller ledges block.
            if (dir.y > 0) {
              dir.y = 0;
              if (dir.lengthSq() < 1e-6) return false;
              dir.normalize();
            }
            seg.start.addScaledVector(dir, depth);
            seg.end.addScaledVector(dir, depth);
            moved = true;
          }
          return false;
        },
      });
      if (!moved) break;
    }
    out.set(seg.start.x - sx, seg.start.y - sy, seg.start.z - sz);
    if (out.lengthSq() > 1e-10) pos.add(out);
    return out;
  }

  dispose() {
    this.bvh?.geometry.dispose();
    this.bvh = null;
    for (const g of this.parts) g.dispose();
    this.parts = [];
  }
}
