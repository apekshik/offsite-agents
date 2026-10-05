import * as THREE from "three";
import type { Slot } from "@offsite/contracts";

// The drop-off: each finished task the captain hasn't opened yet leaves a package on the surface in front of the
// "dropoff" slot, lined up along it, at most MAX_PACKAGES with a "+N" past the last. Placed from the slot alone
// (where the crew member stands and which way they face), so any world with a drop-off gets them; a world whose
// counter sits elsewhere says so with `userData.dropoffSurface` on its root.

/** The surface packages sit on, relative to the drop-off slot: metres in front of it, its height, and how long it runs. */
export interface Surface { forward: number; height: number; width: number }
/** A counter at hand height just in front of where the crew member stands (the yacht's teak counter on the bridge). */
export const DEFAULT_SURFACE: Surface = { forward: 1.05, height: 0.95, width: 3.6 };
export const MAX_PACKAGES = 8;
const SIZE = { w: 0.34, h: 0.24, d: 0.28 };

export interface Spot { x: number; y: number; z: number; yaw: number }

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Where `ids.length` packages go (one spot each, up to MAX_PACKAGES), and where a "+N" goes when there are more.
 * They line up centred along the surface, each turned a little, the newest in the middle.
 */
export function packageSpots(slot: Pick<Slot, "pos" | "facing">, ids: string[], surface: Surface = DEFAULT_SURFACE): { spots: Spot[]; more: Spot | null } {
  const n = Math.min(ids.length, MAX_PACKAGES);
  const f = slot.facing;
  const fwd = { x: Math.sin(f), z: Math.cos(f) };
  const right = { x: Math.cos(f), z: -Math.sin(f) };
  const cx = slot.pos[0] + fwd.x * surface.forward, cz = slot.pos[2] + fwd.z * surface.forward;
  const y = slot.pos[1] + surface.height + SIZE.h / 2;
  const step = Math.min(0.44, (surface.width - 0.4) / Math.max(1, MAX_PACKAGES));
  // Newest in the middle, then alternating outwards: 0, +1, −1, +2, …
  const lane = (i: number) => (i === 0 ? 0 : (i % 2 ? 1 : -1) * Math.ceil(i / 2));
  const spots = ids.slice(0, n).map((id, i) => {
    const l = lane(i) * step;
    const jitter = ((hash(id) % 1000) / 1000 - 0.5) * 0.4;
    return { x: cx + right.x * l, y, z: cz + right.z * l, yaw: f + jitter };
  });
  if (ids.length <= MAX_PACKAGES) return { spots, more: null };
  const end = (Math.max(...spots.map((_, i) => lane(i))) + 1) * step;
  return { spots, more: { x: cx + right.x * end, y: y + 0.05, z: cz + right.z * end, yaw: f } };
}

/** One package: a cardboard box with a strip of tape and a coloured tag for whoever made it. */
export function makePackage(tag: string, seed: string): THREE.Group {
  const g = new THREE.Group();
  const s = 0.92 + ((hash(seed) % 100) / 100) * 0.16;
  const card = new THREE.Mesh(new THREE.BoxGeometry(SIZE.w * s, SIZE.h, SIZE.d * s), new THREE.MeshStandardMaterial({ color: "#b98a57", roughness: 0.92 }));
  card.castShadow = true;
  card.receiveShadow = true;
  g.add(card);
  const tape = new THREE.Mesh(new THREE.BoxGeometry(SIZE.w * s + 0.004, 0.006, 0.07), new THREE.MeshStandardMaterial({ color: "#e2cf9f", roughness: 0.6 }));
  tape.position.y = SIZE.h / 2 + 0.002;
  g.add(tape);
  const label = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.07), new THREE.MeshBasicMaterial({ color: tag, toneMapped: false }));
  // On the side facing whoever stands at the drop-off (the slot faces the surface).
  label.position.set(0, 0.01, -(SIZE.d * s) / 2 - 0.002);
  label.rotation.y = Math.PI;
  g.add(label);
  return g;
}

/** "+3", a small sign floating past the last package. */
export function makeMore(n: number): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = 128; c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "rgba(5, 7, 11, 0.78)";
  ctx.beginPath(); ctx.roundRect(4, 8, 120, 48, 12); ctx.fill();
  ctx.fillStyle = "#6dffa8";
  ctx.font = "600 34px Saira, system-ui, sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(`+${n}`, 64, 33);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
  sprite.scale.set(0.3, 0.15, 1);
  return sprite;
}

export function disposeObject(o: THREE.Object3D) {
  o.removeFromParent();
  o.traverse((x) => {
    if (x instanceof THREE.Mesh || x instanceof THREE.Sprite) {
      // Sprites share one geometry across the scene; only a mesh's own is freed.
      if (x instanceof THREE.Mesh) x.geometry.dispose();
      const m = x.material as THREE.Material & { map?: THREE.Texture | null };
      m.map?.dispose();
      m.dispose();
    }
  });
}
