// Adapted from Ready Player One (github.com/apekshik/ready-player-one).
//
// Static batching. A world is put together from thousands of small meshes, nearly all of which
// never move, and every one of them is a draw call in the main view and in each shadow cascade.
// This merges the ones that share a material (and shadow settings) into one mesh per cell of
// space, so culling still drops whatever's out of view, and draws them all at once. Materials with
// the same userData.batchKey count as one (the first is used).
//
// Left alone: anything marked userData.dynamic (and everything under it), meshes or materials
// marked userData.noBatch, hidden meshes, transparent materials (they need sorting), instanced,
// batched and skinned meshes, meshes with their own onBeforeRender, and shader materials.

import * as THREE from "three";

const CELL: [number, number, number] = [40, 30, 40]; // metres

const plainHook = THREE.Object3D.prototype.onBeforeRender;

function mergeable(o: THREE.Object3D): o is THREE.Mesh {
  const mesh = o as THREE.Mesh;
  if (!mesh.isMesh || (o as THREE.InstancedMesh).isInstancedMesh || (o as THREE.SkinnedMesh).isSkinnedMesh || o.userData.noBatch) return false;
  const m = mesh.material as THREE.Material, g = mesh.geometry;
  if (!m || Array.isArray(m) || m.transparent || (m as THREE.ShaderMaterial).isShaderMaterial || m.userData.noBatch) return false;
  if (o.onBeforeRender !== plainHook || mesh.morphTargetInfluences || o.layers.mask !== 1) return false;
  if (!g.attributes.position || g.attributes.position.count === 0 || Object.keys(g.morphAttributes).length) return false;
  for (const a of Object.values(g.attributes)) if ((a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute || !(a.array instanceof Float32Array)) return false;
  return true;
}

const signature = (g: THREE.BufferGeometry) => Object.keys(g.attributes).sort().map((n) => `${n}${g.attributes[n]!.itemSize}`).join(",");

/**
 * Merges geometries, each placed by its matrix, into one indexed geometry. Only the attributes
 * every input has are kept (position and normal always, uv when all have one).
 */
export function mergeInto(parts: { geometry: THREE.BufferGeometry; matrix?: THREE.Matrix4 }[]): THREE.BufferGeometry {
  const names = ["position", "normal", "uv"].filter((n) => parts.every((p) => p.geometry.attributes[n]));
  let verts = 0, idx = 0;
  for (const { geometry: g } of parts) {
    verts += g.attributes.position!.count;
    idx += g.index ? g.index.count : g.attributes.position!.count;
  }
  const sizes = Object.fromEntries(names.map((n) => [n, parts[0]!.geometry.attributes[n]!.itemSize]));
  const arrays = Object.fromEntries(names.map((n) => [n, new Float32Array(verts * sizes[n]!)]));
  const index = verts > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);
  const nm = new THREE.Matrix3(), v = new THREE.Vector3(), I = new THREE.Matrix4();
  let vo = 0, io = 0;
  for (const { geometry: g, matrix = I } of parts) {
    const n = g.attributes.position!.count;
    nm.getNormalMatrix(matrix);
    for (const name of names) {
      const src = g.attributes[name]!, size = src.itemSize, dst = arrays[name]!;
      for (let i = 0; i < n; i++) {
        const k = (vo + i) * size;
        if (name === "position" || name === "normal") {
          v.fromBufferAttribute(src, i);
          if (name === "position") v.applyMatrix4(matrix);
          else v.applyNormalMatrix(nm);
          dst[k] = v.x; dst[k + 1] = v.y; dst[k + 2] = v.z;
        } else {
          for (let c = 0; c < size; c++) dst[k + c] = src.getComponent(i, c);
        }
      }
    }
    // A mirrored transform turns triangles inside out: flip their winding back.
    const flip = matrix.determinant() < 0;
    const count = g.index ? g.index.count : n;
    for (let i = 0; i < count; i += 3) {
      const a = g.index ? g.index.getX(i) : i, b = g.index ? g.index.getX(i + 1) : i + 1, c = g.index ? g.index.getX(i + 2) : i + 2;
      index[io++] = vo + a;
      index[io++] = vo + (flip ? c : b);
      index[io++] = vo + (flip ? b : c);
    }
    vo += n;
  }
  const geo = new THREE.BufferGeometry();
  for (const name of names) geo.setAttribute(name, new THREE.BufferAttribute(arrays[name]!, sizes[name]!));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}

export function batchStatic(root: THREE.Object3D, { cell = CELL }: { cell?: [number, number, number] } = {}): { before: number; after: number } {
  root.updateMatrixWorld(true);
  const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map<string, THREE.Mesh[]>();
  const center = new THREE.Vector3();
  (function visit(o: THREE.Object3D) {
    if (!o.visible || o.userData.dynamic) return;
    if (mergeable(o)) {
      const g = o.geometry, mat = o.material as THREE.Material;
      if (!g.boundingSphere) g.computeBoundingSphere();
      center.copy(g.boundingSphere!.center).applyMatrix4(o.matrixWorld);
      const key = [mat.userData.batchKey ?? mat.uuid, o.castShadow, o.receiveShadow, o.renderOrder, o.frustumCulled, signature(g),
        Math.floor(center.x / cell[0]), Math.floor(center.y / cell[1]), Math.floor(center.z / cell[2])].join("|");
      let list = groups.get(key);
      if (!list) groups.set(key, (list = []));
      list.push(o);
    }
    for (const c of o.children) visit(c);
  })(root);

  let before = 0, after = 0;
  for (const list of groups.values()) {
    before += list.length;
    after++;
    if (list.length < 2) continue;
    const first = list[0]!;
    const geo = mergeInto(list.map((o) => ({ geometry: o.geometry, matrix: new THREE.Matrix4().multiplyMatrices(toRoot, o.matrixWorld) })));
    const mesh = new THREE.Mesh(geo, first.material);
    mesh.name = "batch";
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.renderOrder = first.renderOrder;
    mesh.frustumCulled = first.frustumCulled;
    for (const o of list) o.removeFromParent();
    root.add(mesh);
  }
  return { before, after };
}
