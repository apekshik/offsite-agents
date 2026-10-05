// Walks a body along waypoints: eases up to a stroll, turns smoothly, cuts corners a little,
// slows for the last step, turns to face the way the slot faces and settles into its seat.
// Re-route it any time (go again); it gets up first if it was sitting. It can also follow
// something that moves (the captain), stopping a polite distance away and turning to face it.
//
// It moves and turns `object` (a CrewFigure's object), and says how fast it is going and the
// seat height it is in, which is all the avatar needs (CrewFigure.update(dt, t, walker)).

import * as THREE from "three";
import type { NavGraph, Slot, Vec3 } from "@offsite/contracts";
import { routeTo, routeToPoint } from "./astar.ts";

type P3 = Vec3 | THREE.Vector3;
const v3 = (p: P3) => (Array.isArray(p) ? new THREE.Vector3(p[0], p[1], p[2]) : p.clone());
const angleDelta = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const damp = (v: number, t: number, rate: number, dt: number) => v + (t - v) * (1 - Math.exp(-rate * dt));

export type WalkerState = "idle" | "standing" | "walking" | "turning" | "seated" | "following";

export interface WalkerOptions {
  /** Strolling speed, m/s. */
  speed?: number;
  /** How fast it turns, rad/s. */
  turnRate?: number;
  /** The floor's height under a point, for stairs and ramps the waypoints don't spell out. */
  floor?: (x: number, y: number, z: number) => number | null;
}

export interface FollowOptions {
  /** How close it comes, metres. */
  distance?: number;
  /** Route around things over the graph (otherwise straight there). */
  graph?: NavGraph;
  /** Called once it has come up to the target (again after the target walks off and it catches up). */
  onReach?: () => void;
  /** Faster than a stroll: they want something. */
  speed?: number;
}

type Target = THREE.Object3D | THREE.Vector3 | (() => THREE.Vector3);

export class Walker {
  readonly object: THREE.Object3D;
  /** Ground speed right now, m/s: feed it to the avatar. */
  speed = 0;
  /** The seat height while settled into a seat, else null: feed it to the avatar. */
  seat: number | null = null;
  state: WalkerState = "idle";
  walkSpeed: number;
  turnRate: number;
  private floor: WalkerOptions["floor"];
  private points: THREE.Vector3[] = [];
  private from = new THREE.Vector3();
  private end: { facing?: number | undefined; seat?: number | null | undefined } = {};
  private onArrive: (() => void) | null = null;
  private standFor = 0;
  private follow_: (FollowOptions & { target: Target; planned: THREE.Vector3 | null; replanIn: number; reached: boolean }) | null = null;
  private pace: number;
  private _t = new THREE.Vector3();
  private _d = new THREE.Vector3();

  constructor(object: THREE.Object3D, o: WalkerOptions = {}) {
    this.object = object;
    this.walkSpeed = o.speed ?? 1.4;
    this.pace = this.walkSpeed;
    this.turnRate = o.turnRate ?? 7;
    this.floor = o.floor;
  }

  get moving() { return this.state === "walking" || (this.state === "following" && this.points.length > 0); }

  /** Put it straight into a slot (no walking): seated if the slot has a seat. */
  place(slot: Slot) {
    this.stop();
    this.object.position.set(slot.pos[0], slot.pos[1], slot.pos[2]);
    this.object.rotation.y = slot.facing;
    this.seat = slot.seat ?? null;
    this.state = this.seat != null ? "seated" : "idle";
  }

  /** Walk these points; then turn to `facing` and sit at `seat` if given. */
  go(points: P3[], end: { facing?: number; seat?: number | null } = {}, onArrive?: () => void) {
    this.follow_ = null;
    this.points = points.map(v3);
    this.end = end;
    this.onArrive = onArrive ?? null;
    this.pace = this.walkSpeed;
    this.beginWalk();
  }

  /** Walk the graph to a slot, then settle into it. */
  goTo(graph: NavGraph, slot: Slot, onArrive?: () => void) {
    this.go(routeTo(graph, this.object.position, slot), { facing: slot.facing, seat: slot.seat ?? null }, onArrive);
  }

  /** Walk up to something that moves, and stay near it, facing it. */
  follow(target: Target, o: FollowOptions = {}) {
    this.follow_ = { distance: 1.4, ...o, target, planned: null, replanIn: 0, reached: false };
    this.points = [];
    this.end = {};
    this.onArrive = null;
    this.pace = o.speed ?? this.walkSpeed * 1.25;
    if (this.seat != null) this.getUp();
    else this.state = "following";
  }

  /** Stand still where it is (it stays seated if it was). */
  stop() {
    this.points = [];
    this.follow_ = null;
    this.onArrive = null;
    this.speed = 0;
    if (this.state !== "seated") this.state = "idle";
  }

  private beginWalk() {
    if (this.seat != null) { this.getUp(); return; }
    this.from.copy(this.object.position);
    this.state = this.points.length ? "walking" : "turning";
  }

  // Out of the seat first: the avatar eases out of its act while it stands.
  private getUp() {
    this.seat = null;
    this.standFor = 0.55;
    this.state = "standing";
  }

  private targetPos(): THREE.Vector3 {
    const t = this.follow_!.target;
    if (typeof t === "function") return this._t.copy(t());
    if ((t as THREE.Object3D).isObject3D) return (t as THREE.Object3D).getWorldPosition(this._t);
    return this._t.copy(t as THREE.Vector3);
  }

  private turnToward(yaw: number, dt: number) {
    const o = this.object;
    const d = angleDelta(o.rotation.y, yaw);
    const step = Math.sign(d) * Math.min(Math.abs(d), this.turnRate * dt * Math.min(1, 0.35 + Math.abs(d)));
    o.rotation.y += step;
    return Math.abs(d - step);
  }

  update(dt: number) {
    const o = this.object;
    if (this.state === "standing") {
      this.speed = 0;
      if ((this.standFor -= dt) > 0) return;
      this.from.copy(o.position);
      this.state = this.follow_ ? "following" : this.points.length ? "walking" : "turning";
    }
    if (this.state === "following") return this.updateFollow(dt);
    if (this.state === "walking") return this.walk(dt, this.pace, 0);
    if (this.state === "turning") {
      this.speed = damp(this.speed, 0, 12, dt);
      const left = this.end.facing == null ? 0 : this.turnToward(this.end.facing, dt);
      if (left < 0.03) this.settle();
      return;
    }
    this.speed = damp(this.speed, 0, 12, dt);
  }

  private settle() {
    if (this.end.facing != null) this.object.rotation.y = this.end.facing;
    this.seat = this.end.seat ?? null;
    this.state = this.seat != null ? "seated" : "idle";
    this.speed = 0;
    const cb = this.onArrive;
    this.onArrive = null;
    cb?.();
  }

  // Along the points; stops `short` metres before the last one. Returns true once there.
  private walk(dt: number, pace: number, short: number): boolean {
    const o = this.object, p = o.position;
    const target = this.points[0];
    if (!target) { this.state = this.follow_ ? "following" : "turning"; return true; }
    const last = this.points.length === 1;
    const d = this._d.set(target.x - p.x, 0, target.z - p.z);
    const flat = d.length();
    const stopAt = last ? short : 0;
    // Corners are cut a little; the last point is walked right up to.
    if ((!last && flat < 0.35) || (last && flat <= stopAt + 0.03)) {
      this.from.copy(target);
      this.points.shift();
      if (last) {
        if (stopAt === 0) p.copy(target);
        this.state = this.follow_ ? "following" : "turning";
        return true;
      }
      return false;
    }
    const yaw = Math.atan2(d.x, d.z);
    const off = this.turnToward(yaw, dt);
    // Slow for sharp turns and for the last step in.
    const left = flat - stopAt;
    const want = pace * Math.max(0.15, Math.cos(Math.min(off, 1.5))) * Math.min(1, 0.35 + left / 0.9);
    this.speed = damp(this.speed, want, 6, dt);
    const step = Math.min(this.speed * dt, left);
    // Walk where it faces (blended toward the target), so turns are arcs, not pivots.
    const fx = Math.sin(o.rotation.y), fz = Math.cos(o.rotation.y);
    const k = Math.min(1, off * 2);
    const mx = fx * (1 - k) + (d.x / flat) * k, mz = fz * (1 - k) + (d.z / flat) * k;
    const ml = Math.hypot(mx, mz) || 1;
    p.x += (mx / ml) * step;
    p.z += (mz / ml) * step;
    // Height: along the segment (stairs between nodes), or the floor if we know it.
    const seg = Math.hypot(target.x - this.from.x, target.z - this.from.z);
    const along = seg > 1e-4 ? 1 - Math.hypot(target.x - p.x, target.z - p.z) / seg : 1;
    let y = THREE.MathUtils.lerp(this.from.y, target.y, Math.min(1, Math.max(0, along)));
    if (this.floor) { const f = this.floor(p.x, y + 0.5, p.z); if (f != null && Math.abs(f - y) < 0.6) y = f; }
    p.y = y;
    return false;
  }

  private updateFollow(dt: number) {
    const f = this.follow_!, o = this.object, p = o.position;
    const t = this.targetPos();
    const dist = Math.hypot(t.x - p.x, t.z - p.z);
    const near = f.distance ?? 1.4;
    f.replanIn -= dt;
    // Time to (re)plan: it walked off, or the plan is stale.
    const far = dist > near + (f.reached ? 0.9 : 0.05);
    if (far && (!this.points.length || !f.planned || f.planned.distanceTo(t) > 1 || f.replanIn <= 0)) {
      this.points = f.graph ? routeToPoint(f.graph, p, t) : [t.clone()];
      this.from.copy(p);
      f.planned = t.clone();
      f.replanIn = 1.5;
      f.reached = false;
    }
    if (this.points.length) {
      // The last point is the target as it is now.
      this.points[this.points.length - 1]!.copy(t);
      if (this.walk(dt, this.pace, near)) {
        this.points = [];
        if (!f.reached) { f.reached = true; f.onReach?.(); }
      }
      this.state = "following";
      return;
    }
    if (!far && !f.reached) { f.reached = true; f.onReach?.(); }
    this.speed = damp(this.speed, 0, 10, dt);
    this.turnToward(Math.atan2(t.x - p.x, t.z - p.z), dt);
  }
}
