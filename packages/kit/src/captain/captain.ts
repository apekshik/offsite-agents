// You: walking the decks in first or third person, using things with E, clicking the crew,
// taking the phone out. Puts the controller, the camera rig, the avatar and the first-person
// hands together.
//
//   const input = new Input({ element: canvas, suspended: ui.typing });
//   const captain = new Captain({ camera, collision, avatar: buildAvatar(spec, look), input });
//   scene.add(captain.object);
//   captain.onPrompt = (it) => ui.set({ prompt: it && { id: it.id, label: it.label } });
//   captain.onUse = (it) => { if (it.id === "helm") ui.set({ helm: true }); };
//   every frame: captain.update(dt, time);
//   captain.walkTo(goal, (outcome) => …);   // walk there by yourself (autopilot.ts), phone and all
//   captain.setSeats(free.map(captainSeat));  // hammocks and chairs E can get into (seat.ts)
//
// Keys: WASD or arrows, Shift to jog, Space to jump, E to use, V to switch view, the wheel to
// zoom (all the way in is first person). F and Escape are the interface's. Moving (or grabbing the
// mouse) takes back a walk the autopilot is doing; nothing else does. In a seat, E or moving gets
// you up again, and a walk gets you up before it sets off.

import * as THREE from "three";
import type { Interactable } from "../world.ts";
import type { AvatarRig } from "../avatar/avatar.ts";
import { Autopilot, type AutopilotGoal, type PilotFailure } from "./autopilot.ts";
import { CAPTAIN_PRESET } from "../avatar/presets.ts";
import { CameraRig, type CameraRigOptions, type View } from "./camera.ts";
import { CaptainController, type ControllerOptions } from "./controller.ts";
import type { Collision } from "./collision.ts";
import { FirstPersonHands } from "./hands.ts";
import type { Input } from "./input.ts";
import { nearestInteractable } from "./interact.ts";
import { standSpot, type CaptainSeat } from "./seat.ts";

/** The layer the captain's own body moves to in first person: the camera doesn't see it. Enable
 * it on the sun's shadow camera (light.shadow.camera.layers.enable(SELF_LAYER)) to keep its shadow. */
export const SELF_LAYER = 1;

/** How a walk the autopilot was doing ended: there, no way there (or gave up), or taken back. */
export type WalkOutcome = "arrived" | "failed" | "stopped";

const angleDelta = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const ease = (x: number) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };

/** What E offers while you're in a seat. */
const GET_UP: Interactable = { id: "get-up", label: "Get up", at: new THREE.Vector3(), radius: 0 };

/** In a seat, or on the way in or out of it. */
interface InSeat {
  seat: CaptainSeat;
  phase: "in" | "on" | "out";
  /** 0..1 through the way in or out, which takes `dur` seconds. */
  u: number;
  dur: number;
  from: THREE.Vector3;
  fromYaw: number;
  to: THREE.Vector3;
  toYaw: number;
  /** Where they stood before getting in: the side to get out on, and the last place to stand if nothing else fits. */
  stood: THREE.Vector3;
  /** Seconds since getting in: for a moment the view turns to look at you there (`view`, the third person's yaw; first
   * person looks along the seat), then is yours again. */
  since: number;
  view: number;
}

export interface CaptainOptions {
  camera: THREE.PerspectiveCamera;
  collision: Collision;
  avatar: AvatarRig;
  input: Input;
  interactables?: Interactable[];
  spawn?: { pos: [number, number, number]; facing?: number };
  view?: View;
  /** First-person hands; by default in the captain's uniform. Null for none. */
  hands?: FirstPersonHands | null;
  move?: Omit<ControllerOptions, "collision">;
  look?: CameraRigOptions;
  /** Clicking grabs the pointer in third person too (it always does in first). Default: drag to look. */
  lockInThird?: boolean;
}

export class Captain {
  /** Add to the scene: the captain's body. */
  readonly object = new THREE.Group();
  readonly avatar: AvatarRig;
  readonly controller: CaptainController;
  readonly cameraRig: CameraRig;
  readonly hands: FirstPersonHands | null;
  readonly input: Input;
  /** What E would use now, or null. */
  prompt: Interactable | null = null;
  phoneOut = false;
  interactables: Interactable[];
  /** The prompt changed (null: nothing in reach). */
  onPrompt: ((it: Interactable | null) => void) | null = null;
  /** E was pressed with something in reach (seats and getting up are the captain's own). */
  onUse: ((it: Interactable) => void) | null = null;
  /** Got into a seat (the moment they start easing in), or out of it (null, as they start getting up). */
  onSeat: ((seat: CaptainSeat | null) => void) | null = null;
  /** The view switched. */
  onView: ((v: View) => void) | null = null;
  /** A click that wasn't a drag (NDC; the crosshair while the pointer is locked): pick a crew member with pick(). */
  onClick: ((ndc: THREE.Vector2, button: number) => void) | null = null;
  onPointerLock: ((locked: boolean) => void) | null = null;
  private camera: THREE.PerspectiveCamera;
  private collision: Collision;
  private lockInThird: boolean;
  /** Seats E can get into, as interactables (id seat:<slot id>), and everything E can use. */
  private seatUses = new Map<string, CaptainSeat>();
  private usable: Interactable[] = [];
  private inSeat: InSeat | null = null;
  /** The eyes in the head's own frame (measured standing), so the view lies down with the body. */
  private eyeLocal: THREE.Vector3 | null = null;
  private _eyes = new THREE.Vector3();
  private speed = 0;
  private selfHidden = false;
  private off: (() => void)[] = [];
  private pilot: { auto: Autopilot; done: ((o: WalkOutcome, why?: PilotFailure) => void) | null } | null = null;
  /** Seconds the autopilot leaves the camera alone (someone looked around by hand). */
  private steerPause = 0;
  private _chest = new THREE.Vector3();
  private _fwd = new THREE.Vector3();

  constructor(o: CaptainOptions) {
    this.camera = o.camera;
    this.collision = o.collision;
    this.lockInThird = !!o.lockInThird;
    this.avatar = o.avatar;
    this.input = o.input;
    this.interactables = o.interactables ?? [];
    this.usable = this.interactables;
    this.controller = new CaptainController({ collision: o.collision, ...o.move });
    this.cameraRig = new CameraRig(o.camera, o.collision, o.look);
    this.object.name = "captain";
    this.object.add(this.avatar.root);
    const spec = CAPTAIN_PRESET.spec;
    this.hands = o.hands === undefined ? new FirstPersonHands({ skin: spec.skin, sleeve: spec.top }) : o.hands;
    if (this.hands) o.camera.add(this.hands.object);
    const pos = o.spawn?.pos ?? [0, 0, 0];
    this.controller.spawn.pos.set(pos[0], pos[1], pos[2]);
    this.controller.spawn.facing = o.spawn?.facing ?? 0;
    this.teleport(this.controller.spawn.pos, this.controller.spawn.facing);
    this.off.push(
      this.input.onPress((code) => {
        if (code === "KeyV") this.view = this.view === "first" ? "third" : "first";
        else if (code === "KeyE" && this.prompt) this.use(this.prompt);
      }),
      this.input.onClick((ndc, button) => this.onClick?.(ndc, button)),
      this.input.onLockChange((locked) => {
        // Grabbing the mouse takes the walk back.
        if (locked) this.stopWalking();
        this.onPointerLock?.(locked);
      }),
    );
    this.view = o.view ?? "third";
  }

  get view(): View { return this.cameraRig.view; }
  set view(v: View) {
    const changed = this.cameraRig.setView(v);
    this.viewChanged(v, !!changed);
  }

  private viewChanged(v: View, changed: boolean) {
    this.input.lockOnClick = v === "first" || this.lockInThird;
    if (v === "third" && !this.lockInThird) this.input.unlock();
    if (changed) this.onView?.(v);
  }

  get position() { return this.controller.position; }
  /** Ground speed now (m/s), 0 in the air: for footsteps. */
  get groundSpeed() { return this.controller.onGround ? this.speed : 0; }
  get facing() { return this.controller.facing; }

  teleport(pos: THREE.Vector3 | [number, number, number], facing = this.controller.facing) {
    const was = this.inSeat;
    this.inSeat = null;
    if (was && was.phase !== "out") this.onSeat?.(null);
    this.controller.teleport(pos, facing);
    this.cameraRig.yaw = facing;
    this.object.position.copy(this.controller.position);
  }

  /** The phone out of the pocket (in both hands, unfolded unless open is false) or away. */
  setPhoneOut(out: boolean, open = true) {
    this.phoneOut = out;
    this.hands?.setOut(out);
    this.hands?.setOpen(open);
  }

  setInteractables(list: Interactable[]) {
    this.interactables = list;
    this.usable = [...list, ...this.seatInteractables()];
  }

  /** The seats E can get into now (free ones: the app knows who is where). */
  setSeats(seats: CaptainSeat[]) {
    this.seatUses = new Map(seats.map((s) => [`seat:${s.slot.id}`, s]));
    this.usable = [...this.interactables, ...this.seatInteractables()];
  }

  private seatInteractables(): Interactable[] {
    return [...this.seatUses].map(([id, s]) => ({ id, label: s.label, at: new THREE.Vector3(s.slot.pos[0], s.slot.pos[1] + 0.9, s.slot.pos[2]), radius: 1.6 }));
  }

  private use(it: Interactable) {
    if (it === GET_UP) { this.getUp(); return; }
    const seat = this.seatUses.get(it.id);
    if (seat) this.sit(seat);
    else this.onUse?.(it);
  }

  /** The seat you're in or getting into, or null (also while getting up). */
  get seat(): CaptainSeat | null { return this.inSeat && this.inSeat.phase !== "out" ? this.inSeat.seat : null; }

  /** Into a seat: a short ease from where you stand onto it, into its pose. Stops a walk the autopilot is doing. */
  sit(seat: CaptainSeat) {
    if (this.inSeat) return;
    this.stopWalking();
    const c = this.controller;
    const to = new THREE.Vector3(...seat.slot.pos);
    const far = Math.hypot(to.x - c.position.x, to.z - c.position.z);
    // Third person: a three-quarter view from in front (from the feet, lying), on the side they got in from.
    const f = seat.slot.facing;
    const side = (c.position.x - to.x) * Math.cos(f) - (c.position.z - to.z) * Math.sin(f) < 0 ? -1 : 1;
    const front = seat.lie ? 0.8 : 1.7;
    const ox = side * Math.cos(f) + front * Math.sin(f), oz = -side * Math.sin(f) + front * Math.cos(f);
    this.inSeat = {
      seat, phase: "in", u: 0, dur: Math.min(1.1, 0.5 + far * 0.3), since: 0, view: Math.atan2(-ox, -oz),
      from: c.position.clone(), fromYaw: c.facing, to, toYaw: f, stood: c.position.clone(),
    };
    c.velocity.set(0, 0, 0);
    this.onSeat?.(seat);
  }

  /** Out of the seat: eased back onto your feet beside it, somewhere clear. */
  getUp() {
    const s = this.inSeat;
    if (!s || s.phase === "out") return;
    const c = this.controller;
    const at = standSpot(s.seat, s.stood, (p) => this.clearToStand(p, s.seat)) ?? s.stood;
    const from = c.position.clone();
    this.inSeat = { ...s, phase: "out", u: 0, dur: 0.6, from, fromYaw: c.facing, to: at, toYaw: Math.atan2(at.x - s.to.x, at.z - s.to.z) };
    this.onSeat?.(null);
  }

  /** Deck underfoot at the seat's level, room for the body, and no wall between the seat and there. */
  private clearToStand(p: THREE.Vector3, seat: CaptainSeat) {
    const c = this.controller, col = this.collision;
    const floor = col.floorBelow(p.x, p.y + 0.6, p.z, 1.2);
    if (floor === null || Math.abs(floor - seat.slot.pos[1]) > 0.25) return false;
    const q = new THREE.Vector3(p.x, floor, p.z);
    // Walls only: a low ceiling pushes down, which the floor probe undoes when walking too.
    const push = col.resolveCapsule(q, c.radius + 0.05, c.height);
    if (push.x * push.x + push.z * push.z > 1e-4) return false;
    const o = new THREE.Vector3(seat.slot.pos[0], seat.slot.pos[1] + 1.0, seat.slot.pos[2]);
    const d = new THREE.Vector3(p.x - o.x, 0, p.z - o.z);
    const len = d.length();
    return len < 1e-3 || !col.raycast(o, d.divideScalar(len), len + c.radius);
  }

  /** The way in or out: where the body is, and done once out (back on the controller). */
  private stepSeat(dt: number) {
    const s = this.inSeat!, c = this.controller;
    if (s.phase !== "out" && (s.since += dt) < 1.6) this.steer(dt, this.view === "first" ? s.seat.slot.facing : s.view);
    if (s.phase === "on") return;
    s.u = Math.min(1, s.u + dt / s.dur);
    c.position.lerpVectors(s.from, s.to, ease(s.u));
    c.facing = s.fromYaw + angleDelta(s.fromYaw, s.toYaw) * ease(s.u * 1.6);
    if (s.u < 1) return;
    if (s.phase === "in") s.phase = "on";
    else {
      this.inSeat = null;
      c.teleport(s.to, c.facing);
    }
  }

  /**
   * Walk there by yourself: the body walks the route at walking pace, the camera turns to follow
   * (from behind in third person, looking ahead in first), and the keyboard can stay with the
   * interface. Ends there (done("arrived")), when there's no way there (done("failed", why)), or
   * when WASD or grabbing the mouse takes it back (done("stopped")). A new walk replaces this one
   * without calling its done.
   */
  walkTo(goal: AutopilotGoal, done?: (outcome: WalkOutcome, why?: PilotFailure) => void) {
    this.pilot = { auto: new Autopilot(goal), done: done ?? null };
    this.steerPause = 0;
    // In a seat: up first; the walk sets off once you're on your feet.
    this.getUp();
  }

  /** Stop a walk the autopilot is doing (done("stopped")); quietly, without calling done, if silent. */
  stopWalking(silent = false) {
    const p = this.pilot;
    if (!p) return;
    this.pilot = null;
    if (!silent) p.done?.("stopped");
  }

  /** True while the autopilot is walking (or turning at the end). */
  get walking() { return !!this.pilot; }

  private endWalk(outcome: WalkOutcome, why?: PilotFailure) {
    const p = this.pilot;
    this.pilot = null;
    p?.done?.(outcome, why);
  }

  /** Turn the view toward yaw, gently (and the first-person pitch toward looking ahead). */
  private steer(dt: number, yaw: number) {
    if (this.steerPause > 0) return;
    const rig = this.cameraRig;
    const k = 1 - Math.exp(-dt * 2.6);
    rig.yaw += angleDelta(rig.yaw, yaw) * k;
    if (this.view === "first") rig.pitch += (0.08 - rig.pitch) * k;
  }

  update(dt: number, time: number) {
    const input = this.input;
    input.update();
    const look = input.takeLook();
    if (look.dx || look.dy) { this.cameraRig.look(look.dx, look.dy); this.steerPause = 1.2; }
    this.steerPause = Math.max(0, this.steerPause - dt);
    const switched = this.cameraRig.zoom(look.wheel);
    if (switched) this.viewChanged(switched, true);

    const m = input.move();
    const jump = input.jump && !input.isSuspended;
    const first = this.view === "first";
    const c = this.controller;
    // Moving by hand takes the walk back, at once (and gets you out of a seat).
    if (this.pilot && (m.x || m.z || jump)) this.stopWalking();
    if (this.inSeat) {
      if (m.x || m.z || jump) this.getUp();
      this.speed = 0;
      this.stepSeat(dt);
    } else if (this.pilot) {
      // The autopilot walks (even while the interface has the keyboard): which way, how fast.
      const s = this.pilot.auto.step(dt, c.position, c.facing);
      if (s.heading !== null) {
        this.speed = c.update(dt, { x: 0, z: 1, sprint: false, jump: false, pace: s.pace }, s.heading, false);
        this.steer(dt, s.heading);
      } else {
        this.speed = c.update(dt, { x: 0, z: 0, sprint: false, jump: false }, this.cameraRig.yaw, false);
        if (s.face !== null) {
          c.facing += angleDelta(c.facing, s.face) * Math.min(1, dt * 9);
          this.steer(dt, s.face);
        }
      }
      if (s.status === "arrived") this.endWalk("arrived");
      else if (s.status === "failed") this.endWalk("failed", s.reason);
    } else {
      this.speed = c.update(dt, { x: m.x, z: m.z, sprint: input.sprint, jump }, this.cameraRig.yaw, first);
    }

    // The body: where the controller is, doing what it does.
    this.object.position.copy(c.position);
    this.avatar.root.rotation.y = c.facing;
    const seat = this.seat;
    this.avatar.animate(dt, seat
      ? { speed: 0, act: seat.act, seat: seat.slot.seat ?? null }
      : { speed: this.speed, air: !c.onGround && !this.inSeat, act: this.phoneOut ? "phone" : null }, time);
    // Hidden once the camera has glided in to the eyes, shown as soon as it heads out.
    this.setSelfHidden(first && !this.cameraRig.gliding);

    // The camera's children (the hands) only draw if the camera is in the scene.
    if (this.hands && !this.camera.parent && this.object.parent) this.object.parent.add(this.camera);
    this.cameraRig.update(dt, c.position, this.avatar.eyeY, this.speed, this.eyes());
    if (this.hands) {
      this.hands.setOut(this.phoneOut && first);
      this.hands.update(dt, time, this.speed);
    }

    // What E would use: in a seat, getting up.
    this._chest.set(c.position.x, c.position.y + 1.1, c.position.z);
    const it = this.inSeat ? (seat ? GET_UP : null) : nearestInteractable(this.usable, this._chest, this.cameraRig.forward(this._fwd));
    if (it !== this.prompt) { this.prompt = it; this.onPrompt?.(it); }
  }

  /**
   * Where the eyes are while in a seat (or on the way in or out): from the head as the pose has it. Null standing,
   * when they're simply eyeY above the feet (which is when the eyes are measured, the first time).
   */
  private eyes(): THREE.Vector3 | null {
    const head = this.avatar.bones.head;
    if (!this.inSeat) {
      if (!this.eyeLocal) {
        this.avatar.root.updateWorldMatrix(true, true);
        this.eyeLocal = head.worldToLocal(this.avatar.root.localToWorld(new THREE.Vector3(0, this.avatar.eyeY, 0.06)));
      }
      return null;
    }
    if (!this.eyeLocal) return null;
    head.updateWorldMatrix(true, false);
    return head.localToWorld(this._eyes.copy(this.eyeLocal));
  }

  // First person: the body moves to a layer the camera doesn't draw (its shadow can stay).
  private setSelfHidden(on: boolean) {
    if (on === this.selfHidden) return;
    this.selfHidden = on;
    this.avatar.root.traverse((o) => { if (on) o.layers.set(SELF_LAYER); else o.layers.set(0); });
  }

  dispose() {
    for (const f of this.off) f();
    this.hands?.dispose();
    this.object.removeFromParent();
  }
}
