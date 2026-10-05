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
//
// Keys: WASD or arrows, Shift to jog, Space to jump, E to use, V to switch view, the wheel to
// zoom (all the way in is first person). F and Escape are the interface's.

import * as THREE from "three";
import type { Interactable } from "../world.ts";
import type { AvatarRig } from "../avatar/avatar.ts";
import { CAPTAIN_PRESET } from "../avatar/presets.ts";
import { CameraRig, type CameraRigOptions, type View } from "./camera.ts";
import { CaptainController, type ControllerOptions } from "./controller.ts";
import type { Collision } from "./collision.ts";
import { FirstPersonHands } from "./hands.ts";
import type { Input } from "./input.ts";
import { nearestInteractable } from "./interact.ts";

/** The layer the captain's own body moves to in first person: the camera doesn't see it. Enable
 * it on the sun's shadow camera (light.shadow.camera.layers.enable(SELF_LAYER)) to keep its shadow. */
export const SELF_LAYER = 1;

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
  /** E was pressed with something in reach. */
  onUse: ((it: Interactable) => void) | null = null;
  /** The view switched. */
  onView: ((v: View) => void) | null = null;
  /** A click that wasn't a drag (NDC; the crosshair while the pointer is locked): pick a crew member with pick(). */
  onClick: ((ndc: THREE.Vector2, button: number) => void) | null = null;
  onPointerLock: ((locked: boolean) => void) | null = null;
  private camera: THREE.PerspectiveCamera;
  private lockInThird: boolean;
  private speed = 0;
  private selfHidden = false;
  private off: (() => void)[] = [];
  private _chest = new THREE.Vector3();
  private _fwd = new THREE.Vector3();

  constructor(o: CaptainOptions) {
    this.camera = o.camera;
    this.lockInThird = !!o.lockInThird;
    this.avatar = o.avatar;
    this.input = o.input;
    this.interactables = o.interactables ?? [];
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
        else if (code === "KeyE" && this.prompt) this.onUse?.(this.prompt);
      }),
      this.input.onClick((ndc, button) => this.onClick?.(ndc, button)),
      this.input.onLockChange((locked) => this.onPointerLock?.(locked)),
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

  setInteractables(list: Interactable[]) { this.interactables = list; }

  update(dt: number, time: number) {
    const input = this.input;
    input.update();
    const look = input.takeLook();
    if (look.dx || look.dy) this.cameraRig.look(look.dx, look.dy);
    const switched = this.cameraRig.zoom(look.wheel);
    if (switched) this.viewChanged(switched, true);

    const m = input.move();
    const first = this.view === "first";
    this.speed = this.controller.update(dt, { x: m.x, z: m.z, sprint: input.sprint, jump: input.jump && !input.isSuspended }, this.cameraRig.yaw, first);

    // The body: where the controller is, doing what it does.
    const c = this.controller;
    this.object.position.copy(c.position);
    this.avatar.root.rotation.y = c.facing;
    this.avatar.animate(dt, { speed: this.speed, air: !c.onGround, act: this.phoneOut ? "phone" : null }, time);
    // Hidden once the camera has glided in to the eyes, shown as soon as it heads out.
    this.setSelfHidden(first && !this.cameraRig.gliding);

    // The camera's children (the hands) only draw if the camera is in the scene.
    if (this.hands && !this.camera.parent && this.object.parent) this.object.parent.add(this.camera);
    this.cameraRig.update(dt, c.position, this.avatar.eyeY, this.speed);
    if (this.hands) {
      this.hands.setOut(this.phoneOut && first);
      this.hands.update(dt, time, this.speed);
    }

    // What E would use.
    this._chest.set(c.position.x, c.position.y + 1.1, c.position.z);
    const it = nearestInteractable(this.interactables, this._chest, this.cameraRig.forward(this._fwd));
    if (it !== this.prompt) { this.prompt = it; this.onPrompt?.(it); }
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
