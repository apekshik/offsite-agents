// Adapted from Ready Player One (github.com/apekshik/ready-player-one): makeCharacter and
// sayBubble, grown into a crew member as the world draws them: their avatar, a nameplate with
// what they are doing, a speech bubble, the "!" when they need the captain, whatever they hold,
// a "!" that pops when their phone buzzes, "Z z z" while they sleep, gestures over whatever they
// are doing, and a backpack when they have just flown in.
//
// Move and turn `object` (a Walker does, nav/walker.ts); call update every frame.

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { AvatarSpec, Look } from "@offsite/contracts";
import { buildAvatar, type AvatarRig, type EmoteId } from "./avatar.ts";
import type { ActId, GestureId } from "./acts.ts";
import { AskMarker, Nameplate, PopMarker, SleepMarker, SpeechBubble, makeShadow, type Tone } from "./labels.ts";
import { FishingRod, Laptop, type Prop, type PropKind } from "./props.ts";
import { damp, type Side } from "./pose.ts";
import { bodyFit } from "./wear.ts";
import { sanitizeAvatar } from "./sanitize.ts";

export interface CrewFigureOptions {
  spec: AvatarSpec;
  look?: Look | null;
  name: string;
  /** The nameplate's second line: what they are doing ("Editing", "Off duty"). */
  line?: string;
  tone?: Tone;
  /** A number of their own (their id hashed), so the crew don't move in step. */
  seed?: number;
  /** The hand they hold things in: 0 their right, 1 their left. */
  lead?: Side;
  /** A soft blob shadow under them, for scenes without real shadows. */
  blob?: boolean;
}

export interface FigureMotion {
  /** Metres a second over the ground (a Walker's speed). */
  speed?: number;
  /** Seat height when sitting or lying (a Walker's seat, the slot's seat). */
  seat?: number | null;
  /** For labels that stay readable with distance. */
  camera?: THREE.Camera;
}

export class CrewFigure {
  readonly object = new THREE.Group();
  rig: AvatarRig;
  readonly plate: Nameplate;
  readonly bubble = new SpeechBubble();
  readonly ask = new AskMarker();
  readonly buzz = new PopMarker();
  readonly zzz = new SleepMarker();
  act: ActId | null = null;
  /** World height of the water, for a fishing line to reach (null: 3 m below the rod's tip). */
  water: number | null = null;
  private seed: number;
  private lead: Side;
  private prop: PropKind | null | undefined = undefined;
  private screen: { lines: string[]; title?: string } | null = null;
  private wroteTo: Laptop | null = null;
  private labelY = 2;
  private backpack: THREE.Group | null = null;
  private blob: THREE.Mesh | null = null;
  private spec: AvatarSpec;
  private _v = new THREE.Vector3();
  private sleeping = false;
  /** In plain sight of the camera (the game says, as it decides name tags): markers hide when not. */
  inSight = true;

  constructor(o: CrewFigureOptions) {
    this.seed = o.seed ?? [...o.name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 1000, 7);
    this.lead = o.lead ?? 0;
    this.spec = sanitizeAvatar(o.spec);
    this.rig = this.build(o.spec, o.look ?? null);
    this.plate = new Nameplate(o.name, o.line ?? "", o.tone ?? "accent");
    this.object.add(this.plate.sprite, this.bubble.sprite, this.ask.sprite, this.buzz.sprite, this.zzz.object);
    this.labelY = this.rig.topY + 0.18;
    if (o.blob) {
      this.blob = makeShadow(0.9);
      this.blob.position.y = 0.01;
      this.object.add(this.blob);
    }
  }

  private build(spec: AvatarSpec, look: Look | null) {
    const rig = buildAvatar(spec, look);
    rig.seed = this.seed;
    rig.lead = this.lead;
    this.object.add(rig.root);
    return rig;
  }

  /** A new look: rebuilds the avatar, keeps everything else. */
  setLook(spec: AvatarSpec, look: Look | null = null) {
    const hadPack = !!this.backpack;
    this.setBackpack(false);
    this.rig.dispose();
    this.spec = sanitizeAvatar(spec);
    this.rig = this.build(spec, look);
    this.rig.setProp(this.prop);
    if (hadPack) this.setBackpack(true);
  }

  /** What they are doing where they are (acts.ts). opts.prop overrides what the act holds (null: nothing). */
  setAct(act: ActId | null, opts: { prop?: PropKind | null } = {}) {
    this.act = act;
    this.prop = "prop" in opts ? opts.prop : undefined;
    this.rig.setProp(this.prop);
  }

  setLabel(name: string, line?: string, tone?: Tone) { this.plate.set(name, line, tone); }
  /** Say something: a bubble over their head for a few seconds. */
  say(text: string, ms?: number) { this.bubble.say(text, ms); }
  /** The "!" that says they are waiting on the captain. */
  setAsking(on: boolean) { this.ask.visible = on; }
  /** Fade the nameplate (far away, or not the one you're looking for). */
  dim(on: boolean) { this.plate.dim(on); }
  /** Turn the head toward a world point (the captain), or null. */
  lookAt(point: THREE.Vector3 | null) { this.rig.lookAt(point); }
  playEmote(id: EmoteId) { this.rig.playEmote(id); }
  /** A gesture over what they're doing (a laugh, a toast, the phone): null eases a looping one out. */
  gesture(id: GestureId | null) { this.rig.gesture(id); }
  /** Their phone buzzed: the "!" pops over them. */
  popAlert() { this.buzz.pop(); }
  /** "Z z z" over them, or not (only while they're in sight: it hides behind walls and decks). */
  setSleeping(on: boolean) { this.sleeping = on; }
  /** Let go of what they're holding (a drink, dropped): the caller owns it now, where it is in the world. */
  releaseProp(): Prop | null { return this.rig.releaseProp(); }

  /** What their laptop shows (kept for the next laptop they open). */
  write(lines: string[], title?: string) {
    this.screen = { lines, ...(title !== undefined ? { title } : {}) };
    const p = this.rig.prop;
    if (p instanceof Laptop) { p.write(lines, title); this.wroteTo = p; }
  }

  /** A backpack, for crew just off the helicopter. */
  setBackpack(on: boolean) {
    if (!on) {
      this.backpack?.removeFromParent();
      this.backpack?.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose(); (m.material as THREE.Material | undefined)?.dispose(); });
      this.backpack = null;
      return;
    }
    if (this.backpack) return;
    this.backpack = makeBackpack(this.spec, this.seed);
    this.rig.bones.chest.add(this.backpack);
  }

  update(dt: number, time: number, m: FigureMotion = {}) {
    this.rig.animate(dt, { speed: m.speed ?? 0, act: this.act, seat: m.seat ?? null }, time);
    const p = this.rig.prop;
    if (p instanceof FishingRod) p.water = this.water;
    if (this.screen && p instanceof Laptop && p !== this.wroteTo) {
      p.write(this.screen.lines, this.screen.title);
      this.wroteTo = p;
    }
    // Labels ride just above the head, wherever it is (sitting, lying, swimming).
    const top = this.rig.headTop(this._v).y + 0.16;
    this.labelY = damp(this.labelY, top, 6, dt);
    this.plate.sprite.position.set(0, this.labelY, 0);
    if (m.camera) this.plate.update(m.camera);
    const plateH = this.plate.sprite.scale.y;
    this.bubble.restY = this.labelY + plateH + 0.04;
    this.bubble.update(dt, m.camera);
    this.ask.restY = this.labelY + plateH + 0.03 + (this.bubble.showing ? this.bubble.sprite.scale.y + 0.04 : 0);
    this.ask.update(time, m.camera);
    this.buzz.restY = this.ask.restY + (this.ask.visible ? this.ask.sprite.scale.y : 0);
    this.buzz.sprite.visible &&= this.inSight;
    this.buzz.update(dt, m.camera);
    // The Z's start just over the head, off to one side.
    this.zzz.visible = this.sleeping && this.inSight;
    this.zzz.restY = top - 0.1;
    this.zzz.side = this.plate.sprite.visible ? this.plate.sprite.scale.x / 2 : 0.04;
    this.zzz.update(time, m.camera);
    if (this.blob) {
      const seated = m.seat != null;
      this.blob.visible = !seated;
    }
  }

  dispose() {
    this.setBackpack(false);
    this.rig.dispose();
    this.plate.dispose();
    this.bubble.dispose();
    this.ask.dispose();
    this.buzz.dispose();
    this.zzz.dispose();
    this.blob?.geometry.dispose();
    (this.blob?.material as THREE.Material | undefined)?.dispose();
    this.object.removeFromParent();
  }
}

/** A rounded pack with a flap, a pocket and two straps; hangs on the chest bone's back. */
export function makeBackpack(spec: AvatarSpec, seed = 0) {
  const f = bodyFit(spec);
  const colors = ["#ff8a3d", "#2d6fd4", "#1fb5a8", "#ffd23f", "#e2574c"];
  const main = new THREE.MeshStandardMaterial({ color: colors[seed % colors.length], roughness: 0.85 });
  const trim = new THREE.MeshStandardMaterial({ color: "#2a2f3d", roughness: 0.7 });
  const g = new THREE.Group();
  g.position.set(0, 0.02 * f.T, -(0.11 * f.dz + 0.085));
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.x = rx;
    m.castShadow = true;
    g.add(m);
    return m;
  };
  add(new RoundedBoxGeometry(0.3 * f.w, 0.4, 0.17, 3, 0.06), main, 0, -0.02, 0);
  add(new RoundedBoxGeometry(0.31 * f.w, 0.13, 0.18, 3, 0.05), main, 0, 0.13, 0.004);
  add(new RoundedBoxGeometry(0.2 * f.w, 0.14, 0.05, 2, 0.02), main, 0, -0.1, -0.1);
  add(new THREE.BoxGeometry(0.16 * f.w, 0.012, 0.012), trim, 0, -0.03, -0.126);
  for (const s of [-1, 1]) {
    // Straps over the shoulders and down the front.
    const back = 0.085, front = back + 2 * f.chestFront + 0.008;
    add(new THREE.BoxGeometry(0.045, 0.024, front - back + 0.02), trim, s * 0.1 * f.w, 0.235 * f.T, (back + front) / 2);
    add(new THREE.BoxGeometry(0.045, 0.28 * f.T, 0.014), trim, s * 0.1 * f.w, 0.1 * f.T, front);
  }
  return g;
}
