import * as THREE from "three";
import type { Prop } from "@offsite/kit";
import { stream } from "./rng.ts";

// Little moments in the world, outside anyone's body: the splash of a cannonball (or drips from
// someone shaking off pool water) and a glass let go of when the phone buzzes. Each runs on dt
// alone and draws its randomness from a seed, so a fixed clock replays them exactly.

export interface Effect {
  readonly object: THREE.Object3D;
  /** Returns false once it is over (the caller removes and disposes it). */
  update(dt: number): boolean;
  dispose(): void;
}

let dropTex: THREE.Texture | null = null;
function dropTexture() {
  if (dropTex) return dropTex;
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.5, "rgba(220,245,255,0.8)");
  g.addColorStop(1, "rgba(220,245,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  dropTex = new THREE.CanvasTexture(c);
  return dropTex;
}

/** Water thrown up and falling back, and a ring spreading on the surface. `big` for a cannonball. */
export class Splash implements Effect {
  readonly object = new THREE.Group();
  private points: THREE.Points;
  private ring: THREE.Mesh;
  private vel: Float32Array;
  private age = 0;
  private readonly life: number;
  private readonly floor: number;

  constructor(at: THREE.Vector3, seed: number, o: { big?: boolean; count?: number } = {}) {
    const big = o.big ?? true, count = o.count ?? (big ? 90 : 24);
    const r = stream(seed);
    this.life = big ? 1.6 : 0.9;
    this.floor = at.y - 0.05;
    const pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const a = r() * Math.PI * 2, out = (big ? 1.2 : 0.6) + r() * (big ? 2.4 : 0.8), up = (big ? 3.5 : 0.6) + r() * (big ? 4.5 : 1.2);
      pos.set([at.x + Math.cos(a) * 0.15, at.y, at.z + Math.sin(a) * 0.15], i * 3);
      this.vel.set([Math.cos(a) * out, up, Math.sin(a) * out], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      map: dropTexture(), size: big ? 0.16 : 0.07, transparent: true, depthWrite: false, color: "#eaf8ff", sizeAttenuation: true,
    }));
    this.points.frustumCulled = false;
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.75, 1, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: "#f2fbff", transparent: true, opacity: 0.8, depthWrite: false }),
    );
    this.ring.position.set(at.x, at.y + 0.02, at.z);
    this.ring.scale.setScalar(0.2);
    this.ring.visible = big;
    this.object.add(this.points, this.ring);
  }

  update(dt: number) {
    this.age += dt;
    const arr = this.points.geometry.attributes["position"] as THREE.BufferAttribute;
    for (let i = 0; i < arr.count; i++) {
      const y = arr.getY(i);
      if (y < this.floor) continue;
      this.vel[i * 3 + 1]! -= 9.8 * dt;
      arr.setXYZ(i, arr.getX(i) + this.vel[i * 3]! * dt, y + this.vel[i * 3 + 1]! * dt, arr.getZ(i) + this.vel[i * 3 + 2]! * dt);
    }
    arr.needsUpdate = true;
    const k = this.age / this.life;
    (this.points.material as THREE.PointsMaterial).opacity = 1 - Math.max(0, (k - 0.6) / 0.4);
    this.ring.scale.setScalar(0.2 + 2.6 * Math.sqrt(k));
    (this.ring.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - k);
    return this.age < this.life;
  }

  dispose() {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
    this.ring.geometry.dispose();
    (this.ring.material as THREE.Material).dispose();
    this.object.removeFromParent();
  }
}

/**
 * A drink let go of. "drop": it falls, bounces once and tips over on the deck. "set": it is put
 * down on the counter in front of them. Either way it stays a few seconds, then is cleared away.
 */
export class LooseGlass implements Effect {
  readonly object: THREE.Object3D;
  private vel = new THREE.Vector3();
  private spin = new THREE.Vector3();
  private age = 0;
  private settled = false;
  private tip = 0;
  private readonly prop: Prop;
  private readonly floorAt: (p: THREE.Vector3) => number;
  private readonly mode: "drop" | "set";
  private readonly from = new THREE.Vector3();
  private readonly to = new THREE.Vector3();

  constructor(prop: Prop, opts: { mode: "drop" | "set"; seed: number; forward: THREE.Vector3; floorAt: (p: THREE.Vector3) => number; setAt?: THREE.Vector3 }) {
    this.prop = prop;
    this.object = prop.object;
    this.mode = opts.mode;
    this.floorAt = opts.floorAt;
    const r = stream(opts.seed);
    this.vel.copy(opts.forward).multiplyScalar(0.4 + r() * 0.5).add(new THREE.Vector3((r() - 0.5) * 0.6, 1.0 + r() * 0.6, (r() - 0.5) * 0.6));
    this.spin.set((r() - 0.5) * 9, (r() - 0.5) * 4, (r() - 0.5) * 9);
    this.from.copy(this.object.position);
    this.to.copy(opts.setAt ?? this.object.position);
  }

  update(dt: number) {
    this.age += dt;
    const o = this.object;
    if (this.mode === "set") {
      // Down onto the counter over half a second, upright.
      const k = Math.min(1, this.age / 0.45), e = k * k * (3 - 2 * k);
      o.position.lerpVectors(this.from, this.to, e);
      o.position.y += Math.sin(e * Math.PI) * 0.06;
      o.quaternion.slerp(new THREE.Quaternion(), Math.min(1, dt * 8));
    } else if (!this.settled) {
      this.vel.y -= 9.8 * dt;
      o.position.addScaledVector(this.vel, dt);
      o.rotation.x += this.spin.x * dt; o.rotation.y += this.spin.y * dt; o.rotation.z += this.spin.z * dt;
      const floor = this.floorAt(o.position);
      if (o.position.y <= floor) {
        o.position.y = floor;
        if (this.vel.y < -1.2) { this.vel.y *= -0.28; this.vel.x *= 0.5; this.vel.z *= 0.5; this.spin.multiplyScalar(0.4); }
        else { this.settled = true; o.rotation.set(0, o.rotation.y, 0); }
      }
    } else {
      // On its side, rolling to a stop.
      this.tip = Math.min(1, this.tip + dt * 6);
      o.rotation.x = (Math.PI / 2) * this.tip;
      o.position.y = this.floorAt(o.position) + 0.035 * this.tip;
    }
    // Cleared away after a while.
    const left = 6 - this.age;
    if (left < 0.4) o.scale.setScalar(Math.max(0.001, o.scale.x * (left / 0.4 > 0 ? 0.9 : 0)));
    return left > 0;
  }

  dispose() { this.prop.dispose(); }
}
