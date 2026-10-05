// Adapted from Ready Player One (github.com/apekshik/ready-player-one): updateCamera's orbit with
// collision pull-in, plus a first-person view.
//
// Third person: the camera orbits behind and above, pulled in front of anything between it and
// the captain. First person: at the eyes, with a small bob as you walk. One yaw and pitch serve
// both, so switching (V, or zooming all the way in and back out) keeps you looking the same way;
// the camera glides between them over a quarter second.

import * as THREE from "three";
import type { Collision } from "./collision.ts";

export type View = "first" | "third";

export interface CameraRigOptions {
  /** Third-person distance to start with, and its limits. */
  dist?: number;
  minDist?: number;
  maxDist?: number;
  /** Radians per pixel of mouse movement. */
  sensitivity?: number;
  invertY?: boolean;
  /** Third person looks over the right shoulder by this much (m), so the crosshair isn't on your own head. */
  shoulder?: number;
}

const THIRD_PITCH: [number, number] = [-0.45, 1.25];
const FIRST_PITCH: [number, number] = [-1.42, 1.48];
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  view: View = "third";
  /** Where the view looks, radians (0 looks toward +z). */
  yaw = 0;
  /** Radians; positive looks down (in third person: the camera is above). */
  pitch = 0.3;
  dist: number;
  minDist: number;
  maxDist: number;
  sensitivity: number;
  invertY: boolean;
  private collision: Collision;
  private camPos = new THREE.Vector3();
  private fresh = true;
  private blend = 0;
  private fromPos = new THREE.Vector3();
  private fromQuat = new THREE.Quaternion();
  private bobPhase = 0;
  private bobAmt = 0;
  private _focus = new THREE.Vector3();
  private _right = new THREE.Vector3();
  shoulder: number;
  private _dir = new THREE.Vector3();
  private _want = new THREE.Vector3();

  constructor(camera: THREE.PerspectiveCamera, collision: Collision, o: CameraRigOptions = {}) {
    this.camera = camera;
    this.collision = collision;
    this.dist = o.dist ?? 4.2;
    this.minDist = o.minDist ?? 1.1;
    this.maxDist = o.maxDist ?? 14;
    this.sensitivity = o.sensitivity ?? 0.0026;
    this.invertY = !!o.invertY;
    this.shoulder = o.shoulder ?? 0.6;
  }

  /** Mouse movement in pixels. */
  look(dx: number, dy: number) {
    this.yaw -= dx * this.sensitivity;
    const [lo, hi] = this.view === "first" ? FIRST_PITCH : THIRD_PITCH;
    this.pitch = clamp(this.pitch + dy * this.sensitivity * (this.invertY ? -1 : 1), lo, hi);
  }

  /**
   * Wheel notches (positive: out). Zooming all the way in goes first person; out of first person
   * comes back to third. Returns the view if it changed.
   */
  zoom(notches: number): View | null {
    if (!notches) return null;
    if (this.view === "first") {
      if (notches > 0) { this.dist = this.minDist + 0.6; return this.setView("third"); }
      return null;
    }
    const next = this.dist * Math.pow(1.12, notches);
    if (next < this.minDist) return this.setView("first");
    this.dist = Math.min(this.maxDist, next);
    return null;
  }

  setView(v: View): View | null {
    if (v === this.view) return null;
    // Glide from where the camera is now.
    this.fromPos.copy(this.camera.position);
    this.fromQuat.copy(this.camera.quaternion);
    this.blend = 1;
    this.view = v;
    const [lo, hi] = v === "first" ? FIRST_PITCH : THIRD_PITCH;
    this.pitch = clamp(v === "third" ? Math.max(this.pitch, 0.15) : this.pitch, lo, hi);
    if (v === "third" && this.dist < this.minDist + 0.3) this.dist = this.minDist + 1.2;
    this.fresh = true;
    return v;
  }

  /** True while gliding between views. */
  get gliding() { return this.blend > 0; }

  /** The flat direction the view faces. */
  forward(out = new THREE.Vector3()) { return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }

  /**
   * feet: where the captain stands. eye: eye height above the feet. speed: ground speed (for the
   * first-person bob). Places the camera.
   */
  update(dt: number, feet: THREE.Vector3, eye: number, speed = 0) {
    const cam = this.camera;
    const cp = Math.cos(this.pitch);
    const dir = this._dir.set(Math.sin(this.yaw) * cp, -Math.sin(this.pitch), Math.cos(this.yaw) * cp);
    if (this.view === "first") {
      // A small bob, in step with the stride.
      this.bobAmt += ((speed > 0.3 ? Math.min(1, speed / 3) : 0) - this.bobAmt) * Math.min(1, dt * 8);
      this.bobPhase += dt * (4 + speed * 1.4);
      const bob = Math.sin(this.bobPhase * 2) * 0.028 * this.bobAmt;
      cam.position.set(feet.x, feet.y + eye + bob, feet.z);
      cam.rotation.order = "YXZ";
      cam.rotation.set(-this.pitch, this.yaw + Math.PI, Math.sin(this.bobPhase) * 0.006 * this.bobAmt);
      this.camPos.copy(cam.position);
    } else {
      // Orbit a point at the shoulders, a little above the eyes when looking down, and off to the
      // right so the middle of the screen (the crosshair) looks past you, not at the back of your head.
      const focus = this._focus.set(feet.x, feet.y + eye * 0.9, feet.z);
      if (this.shoulder > 0) {
        const right = this._right.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
        const room = this.collision.raycast(focus, right, this.shoulder + 0.3);
        focus.addScaledVector(right, room ? Math.max(0, room.t - 0.3) : this.shoulder);
      }
      const want = this._want.copy(focus).addScaledVector(dir, -this.dist);
      // Keep the camera out of walls: pull it in front of whatever is behind us.
      const back = want.clone().sub(focus);
      const len = back.length();
      const hit = len > 1e-4 ? this.collision.raycast(focus, back.divideScalar(len), len + 0.25) : null;
      if (hit) want.copy(focus).addScaledVector(back, Math.max(0.35, hit.t - 0.3));
      const pulledIn = !!hit && want.distanceTo(focus) < this.camPos.distanceTo(focus);
      if (pulledIn || this.fresh) this.camPos.copy(want);
      else this.camPos.lerp(want, 1 - Math.exp(-dt * 14));
      cam.position.copy(this.camPos);
      cam.lookAt(focus);
    }
    this.fresh = false;
    if (this.blend > 0) {
      this.blend = Math.max(0, this.blend - dt / 0.28);
      const k = this.blend * this.blend * (3 - 2 * this.blend);
      cam.position.lerp(this.fromPos, k);
      cam.quaternion.slerp(this.fromQuat, k);
    }
    cam.updateMatrixWorld();
  }
}
