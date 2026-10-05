// Adapted from Ready Player One (github.com/apekshik/ready-player-one): the lab's Player, without
// vehicles, held things or seats. Walk, sprint, jump; gravity; floors and stairs from the floor
// probe; walls from the capsule. Movement is relative to where the camera looks.

import * as THREE from "three";
import { Collision, STEP } from "./collision.ts";

const angleDelta = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

export interface ControllerOptions {
  collision: Collision;
  /** m/s. A yacht is small: an easy walk, and a jog with Shift. */
  walk?: number;
  sprint?: number;
  /** Take-off speed, m/s. */
  jump?: number;
  gravity?: number;
  radius?: number;
  height?: number;
  /** Fall below this (overboard) and you're back at the spawn. */
  respawnBelow?: number;
}

export interface MoveIntent {
  x: number; z: number; sprint: boolean; jump: boolean;
  /** 0..1 of the pace (walking or sprinting): easing into a stop. Default 1. */
  pace?: number;
}

export class CaptainController {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  onGround = false;
  /** Which way the body faces (0 is +z). */
  facing = 0;
  spawn = { pos: new THREE.Vector3(), facing: 0 };
  walk: number;
  sprint: number;
  jumpSpeed: number;
  gravity: number;
  radius: number;
  height: number;
  respawnBelow: number;
  private collision: Collision;
  private push = new THREE.Vector3();

  constructor(o: ControllerOptions) {
    this.collision = o.collision;
    this.walk = o.walk ?? 3.2;
    this.sprint = o.sprint ?? 5.8;
    this.jumpSpeed = o.jump ?? 6.2;
    this.gravity = o.gravity ?? 22;
    this.radius = o.radius ?? 0.3;
    this.height = o.height ?? 1.75;
    this.respawnBelow = o.respawnBelow ?? -30;
  }

  teleport(pos: THREE.Vector3 | [number, number, number], facing = this.facing) {
    if (Array.isArray(pos)) this.position.set(pos[0], pos[1], pos[2]);
    else this.position.copy(pos);
    this.velocity.set(0, 0, 0);
    this.facing = facing;
    this.onGround = false;
  }

  /**
   * One step. yaw: where the camera looks (0 looks toward +z). faceView: the body turns with the
   * view (first person) instead of toward where it walks. Returns the ground speed.
   */
  update(dt: number, m: MoveIntent, yaw: number, faceView: boolean) {
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    // Right of the view is (-cos yaw, 0, sin yaw) when looking along (sin yaw, 0, cos yaw).
    let wx = fx * m.z - fz * m.x, wz = fz * m.z + fx * m.x;
    const wl = Math.hypot(wx, wz);
    if (wl > 0) { wx /= wl; wz /= wl; }
    const speed = (m.sprint ? this.sprint : this.walk) * Math.max(0, Math.min(1, m.pace ?? 1));
    const blend = Math.min(1, (this.onGround ? 14 : 3) * dt);
    this.velocity.x += (wx * speed - this.velocity.x) * blend;
    this.velocity.z += (wz * speed - this.velocity.z) * blend;
    if (m.jump && this.onGround) { this.velocity.y = this.jumpSpeed; this.onGround = false; }
    this.velocity.y = Math.max(-40, this.velocity.y - this.gravity * dt);

    const wasOnGround = this.onGround;
    const steps = Math.max(1, Math.ceil((this.velocity.length() * dt) / 0.25));
    const h = dt / steps;
    const p = this.position;
    for (let i = 0; i < steps; i++) {
      p.x += this.velocity.x * h;
      p.z += this.velocity.z * h;
      const push = this.collision.resolveCapsule(p, this.radius, this.height, this.push);
      if (push.lengthSq() > 1e-8) {
        const n = push.normalize();
        const into = this.velocity.dot(n);
        if (into < 0) this.velocity.addScaledVector(n, -into);
      }
      p.y += this.velocity.y * h;
      const floor = this.collision.floorBelow(p.x, p.y + STEP, p.z, STEP + 60);
      if (floor == null) { this.onGround = false; continue; }
      // Walking down stairs: stay on them rather than skipping off each step.
      const snap = wasOnGround && this.velocity.y <= 0 && p.y - floor < 0.35;
      if (p.y <= floor || snap) {
        p.y = floor;
        if (this.velocity.y < 0) this.velocity.y = 0;
        this.onGround = true;
      } else this.onGround = false;
    }
    if (p.y < this.respawnBelow) this.teleport(this.spawn.pos, this.spawn.facing);

    const hSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    if (faceView) this.facing += angleDelta(this.facing, yaw) * Math.min(1, dt * 20);
    else if (hSpeed > 0.4) this.facing += angleDelta(this.facing, Math.atan2(this.velocity.x, this.velocity.z)) * Math.min(1, dt * 12);
    return hSpeed;
  }
}
