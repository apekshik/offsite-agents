// The captain walking by themselves: up to a crew member (who may be on the move) or to a spot
// (the helm), along the world's walking graph, while their hands are busy with the phone.
//
// Pure steering. Each frame it says which way to walk and how fast, or which way to turn at the
// end; the controller does the walking (walls, stairs, doors) and the Captain turns the camera.
// It re-plans when a moving target has gone somewhere else (at most every replanEvery seconds),
// and when the body stops making headway (a doorframe, someone in the way). It gives up when
// there is no way there, the target is gone, or it keeps getting stuck.

import * as THREE from "three";

export interface AutopilotGoal {
  /** Where the goal is now, read every frame. Null: it's gone (they left the ship). */
  target: () => THREE.Vector3 | null;
  /** Waypoints from `from` to `to` (the last is `to`), or null when there is no way there. */
  route: (from: THREE.Vector3, to: THREE.Vector3) => THREE.Vector3[] | null;
  /** Stop this far short of the target, metres. 0: walk right onto it. */
  stopShort?: number;
  /** At the end, turn to this yaw (0 faces +z), or "target" (the default) to face the target. */
  face?: number | "target";
  /** Re-plan once the target has moved this far from where the plan ends, metres. */
  moveTolerance?: number;
  /** ...but no more often than this, seconds. */
  replanEvery?: number;
}

export type PilotStatus = "walking" | "turning" | "arrived" | "failed";
export type PilotFailure = "unreachable" | "gone" | "stuck";

export interface PilotStep {
  status: PilotStatus;
  /** Walk this way (yaw, 0 faces +z), or null to stand. */
  heading: number | null;
  /** How fast, 0..1 of walking pace: it slows for the last step in. */
  pace: number;
  /** Turn the body toward this yaw (at the end), or null. */
  face: number | null;
  /** Why it gave up, when status is "failed". */
  reason?: PilotFailure;
}

/** Closer than this to a waypoint (flat), with more to come: on to the next. Corners are cut a little. */
const CORNER = 0.5;
/** Closer than this to an exact spot: there. */
const ON_SPOT = 0.14;
/** A waypoint on another deck isn't reached by standing under it. */
const SAME_DECK = 1.0;
/** Headway check: moved less than STUCK_MOVE metres in STUCK_TIME seconds while walking. */
const STUCK_TIME = 1.0;
const STUCK_MOVE = 0.25;
/** Re-plans after getting stuck before giving up. */
const STUCK_RETRIES = 2;
/** Stuck this close to someone you're walking up to: close enough. */
const CLOSE_ENOUGH = 1.4;
/** Turning at the end: done within this (radians), or after this long (seconds). */
const FACED = 0.06;
const TURN_MAX = 1.5;

const angleDelta = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const flat = (a: THREE.Vector3, b: THREE.Vector3) => Math.hypot(a.x - b.x, a.z - b.z);

export class Autopilot {
  readonly goal: AutopilotGoal;
  status: PilotStatus = "walking";
  reason: PilotFailure | undefined;
  /** What's left of the route; the last point is the target as it is now. */
  points: THREE.Vector3[] = [];
  /** How many routes it has planned (the first included). */
  plans = 0;
  private planned = new THREE.Vector3();
  private sincePlan = 0;
  private stuckFor = 0;
  private stuckFrom = new THREE.Vector3();
  private stuckTries = 0;
  private turnFor = 0;

  constructor(goal: AutopilotGoal) {
    this.goal = goal;
  }

  get done() { return this.status === "arrived" || this.status === "failed"; }

  private fail(reason: PilotFailure): PilotStep {
    this.status = "failed";
    this.reason = reason;
    this.points = [];
    return { status: "failed", heading: null, pace: 0, face: null, reason };
  }

  private plan(pos: THREE.Vector3, target: THREE.Vector3): boolean {
    const pts = this.goal.route(pos.clone(), target.clone());
    if (!pts || !pts.length) return false;
    this.points = pts.map((p) => p.clone());
    this.planned.copy(target);
    this.sincePlan = 0;
    this.plans++;
    return true;
  }

  /** One frame: pos is where the body stands (feet), facing the way it faces. */
  step(dt: number, pos: THREE.Vector3, facing: number): PilotStep {
    if (this.status === "arrived") return { status: "arrived", heading: null, pace: 0, face: null };
    if (this.status === "failed") return { status: "failed", heading: null, pace: 0, face: null, reason: this.reason ?? "unreachable" };
    const t = this.goal.target();
    if (!t) return this.fail("gone");
    const short = this.goal.stopShort ?? 0;
    this.sincePlan += dt;

    if (this.status === "walking") {
      if (!this.plans) {
        if (!this.plan(pos, t)) return this.fail("unreachable");
        this.stuckFrom.copy(pos);
      } else if (t.distanceTo(this.planned) > (this.goal.moveTolerance ?? 0.5) && this.sincePlan >= (this.goal.replanEvery ?? 0.5)) {
        // They've moved on: a fresh route to where they are now.
        if (!this.plan(pos, t)) return this.fail("unreachable");
      }
      // The last point follows the target as it moves.
      if (this.points.length) this.points[this.points.length - 1]!.copy(t);
      while (this.points.length > 1) {
        const p = this.points[0]!;
        if (flat(p, pos) < CORNER && Math.abs(p.y - pos.y) < SAME_DECK) this.points.shift();
        else break;
      }
      const last = this.points.length <= 1;
      const toTarget = flat(t, pos);
      const sameDeck = Math.abs(t.y - pos.y) < SAME_DECK;
      if (last && sameDeck && toTarget <= (short > 0 ? short + 0.05 : ON_SPOT)) return this.startTurn(pos, facing, t);

      // Making headway? A doorframe or a crowd can hold the body up: re-plan from here, or stop
      // if they are close enough already, or give up.
      this.stuckFor += dt;
      if (this.stuckFor >= STUCK_TIME) {
        const moved = flat(pos, this.stuckFrom);
        this.stuckFor = 0;
        this.stuckFrom.copy(pos);
        if (moved < STUCK_MOVE) {
          if (short > 0 && sameDeck && toTarget < short + CLOSE_ENOUGH) return this.startTurn(pos, facing, t);
          if (++this.stuckTries > STUCK_RETRIES) return this.fail("stuck");
          if (!this.plan(pos, t)) return this.fail("unreachable");
        } else this.stuckTries = 0;
      }

      const next = this.points[0] ?? t;
      const heading = Math.atan2(next.x - pos.x, next.z - pos.z);
      // Ease into the last step: full pace until the last metre and a half.
      const left = last ? Math.max(0, toTarget - short) : Infinity;
      const pace = Math.min(1, 0.22 + left / 1.6);
      return { status: "walking", heading, pace, face: null };
    }

    // Turning to face them, or the way the spot faces.
    this.turnFor += dt;
    const want = this.faceYaw(pos, facing, t);
    if (Math.abs(angleDelta(facing, want)) < FACED || this.turnFor > TURN_MAX) {
      this.status = "arrived";
      return { status: "arrived", heading: null, pace: 0, face: want };
    }
    return { status: "turning", heading: null, pace: 0, face: want };
  }

  private startTurn(pos: THREE.Vector3, facing: number, t: THREE.Vector3): PilotStep {
    this.status = "turning";
    this.points = [];
    this.turnFor = 0;
    return { status: "turning", heading: null, pace: 0, face: this.faceYaw(pos, facing, t) };
  }

  private faceYaw(pos: THREE.Vector3, facing: number, t: THREE.Vector3): number {
    const f = this.goal.face ?? "target";
    if (f !== "target") return f;
    return flat(t, pos) > 0.05 ? Math.atan2(t.x - pos.x, t.z - pos.z) : facing;
  }
}
