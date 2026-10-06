// The captain's own hands in first person, holding the foldable phone: navy sleeves with three
// gold stripes, white shirt cuffs, palms behind the phone's sides and thumbs on its edges (as in
// the captain's-eye concept art). They ride the camera: add `object` to the camera (Captain
// does), and keep the camera in the scene so they draw.
//
// The interface can draw the phone's screens itself, lying its real pages over the glass (see
// hold.ts): setHold says where on screen it wants them, the hands hold the phone up so they land
// there, and screens() says where each one is this frame. Without that, the phone sits lower, at
// arm's length, showing its own pictures.

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { FoldPhone, PHONE, PHONE_GLASS, type PhoneFace } from "../avatar/props.ts";
import { holdAt, raised, RAISE, sway, type HoldWant, type ViewSize } from "./hold.ts";

export interface HandsStyle {
  skin?: THREE.ColorRepresentation;
  sleeve?: THREE.ColorRepresentation;
  cuff?: THREE.ColorRepresentation;
  stripe?: THREE.ColorRepresentation;
}

/** One of the phone's screens on screen this frame: its corners (CSS pixels: top left, top right, bottom right, bottom
 * left, as seen from the front of the glass) and whether that front faces you. */
export interface ScreenQuad { corners: [number, number][]; front: boolean }

/** Where the phone's screens are on screen this frame, and how far open it is (0 folded … 1 flat). */
export interface HeldScreens { cover: ScreenQuad; left: ScreenQuad; spread: ScreenQuad; open: number }

const std = (color: THREE.ColorRepresentation, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...extra });

// Where things sit in the camera's frame (it looks down -z): the phone a little below the
// middle of the view, turned up toward the eyes; the elbows low and wide, out of view.
const PHONE_AT = new THREE.Vector3(0, -0.07, -0.335);
const PHONE_TILT = -0.38;
const ELBOW = (s: number) => new THREE.Vector3(s * 0.27, -0.46, -0.1);
const UP = new THREE.Vector3(0, 1, 0);
/** Held up to read, the top leans away a touch: enough to look held, little enough to read straight on. */
const READ_TILT = -0.05;
/**
 * Held up to read, the phone is drawn this much bigger than life (a big foldable), so that at the size the interface
 * wants it on screen it's a comfortable distance away (about 20 cm), with your hands life-size beside it.
 */
export const READ_SCALE = 1.6;
/** How much further away the phone is held halfway through unfolding (a share of its distance). */
const UNFOLD_REACH = 0.4;
/** Held up to read, the elbows are tucked lower and further forward: the forearms come up from below. */
const READ_ELBOW = (s: number) => new THREE.Vector3(s * 0.3, -0.52, -0.14);

interface Side { s: number; hand: THREE.Group; thumb: THREE.Group; arm: THREE.Group }

export class FirstPersonHands {
  readonly object = new THREE.Group();
  readonly phone: FoldPhone;
  /** Keep the phone still: no sway or breathing (the interface sets it while you type). */
  still = false;
  /** No sway at all, ever (prefers-reduced-motion). */
  calm = false;
  /** Raised and lowered around the eye. */
  private holder = new THREE.Group();
  /** The phone's place and lean in the hands (the phone, drawn at its scale, and the hands inside). */
  private pose = new THREE.Group();
  private sides: Side[] = [];
  /** 0 in the pocket … 1 up, linear in time; `up` is where it's headed. */
  private u = 0;
  private up = false;
  private hold: HoldWant | null = null;
  /** How much the phone sways now (eased toward 0 while still). */
  private life = 1;
  private stride = 0;
  private walk = 0;
  private _w = new THREE.Vector3();
  private _d = new THREE.Vector3();
  private _m = new THREE.Vector3();
  private _p = new THREE.Vector3();
  private _q = new THREE.Quaternion();

  constructor({ skin = "#e8b894", sleeve = "#1d2a4d", cuff = "#f7f7f4", stripe = "#e2b64a" }: HandsStyle = {}) {
    this.object.name = "first-person-hands";
    this.object.add(this.holder);
    this.holder.add(this.pose);
    this.phone = new FoldPhone({ open: true });
    this.pose.add(this.phone.object);
    const M = { skin: std(skin, { roughness: 0.55 }), sleeve: std(sleeve, { roughness: 0.75 }), cuff: std(cuff, { side: THREE.DoubleSide }), stripe: std(stripe, { roughness: 0.3, metalness: 0.7 }) };
    const mesh = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rz = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.z = rz;
      parent.add(m);
      return m;
    };
    for (const s of [-1, 1]) {
      // In the pose's frame, from where the hand grips the phone's side (its outer edge, a third of the way up): the
      // palm behind it, the heel of the thumb beside it, the thumb up along its edge on the front.
      const hand = new THREE.Group();
      this.pose.add(hand);
      mesh(hand, new RoundedBoxGeometry(0.05, 0.078, 0.022, 3, 0.009), M.skin, s * 0.011, -0.004, -0.017, -s * 0.22);
      const heel = mesh(hand, new THREE.SphereGeometry(0.017, 16, 12), M.skin, s * 0.015, -0.022, -0.002);
      heel.scale.set(0.8, 1.25, 0.9);
      const thumb = new THREE.Group();
      hand.add(thumb);
      mesh(thumb, new THREE.CapsuleGeometry(0.0088, 0.026, 4, 10), M.skin, 0, 0.022, 0);
      // The forearm, in the holder's frame: wrist at the origin, +y toward the elbow.
      const arm = new THREE.Group();
      this.holder.add(arm);
      // The wrist comes out of the shirt cuff (open at the end, so you see into it, not a white lid).
      mesh(arm, new THREE.CylinderGeometry(0.021, 0.024, 0.05, 12), M.skin, 0, 0.012, 0);
      mesh(arm, new THREE.CylinderGeometry(0.036, 0.038, 0.03, 16, 1, true), M.cuff, 0, 0.032, 0);
      mesh(arm, new THREE.CapsuleGeometry(0.046, 0.34, 4, 14), M.sleeve, 0, 0.25, 0);
      for (let i = 0; i < 3; i++) mesh(arm, new THREE.CylinderGeometry(0.0485, 0.0485, 0.01, 18), M.stripe, 0, 0.065 + i * 0.02, 0);
      this.sides.push({ s, hand, thumb, arm });
    }
    this.object.traverse((o) => { o.castShadow = false; o.frustumCulled = false; });
    this.object.visible = false;
  }

  /** Raise the phone into view (or put it away), or have it there (or gone) at once. */
  setOut(out: boolean, now = false) {
    this.up = out;
    if (now) this.u = out ? 1 : 0;
  }
  /** Unfold or fold the phone (at once while it's in the pocket: it comes out already that way). */
  setOpen(open: boolean) { this.phone.setOpen(open, !this.showing); }
  get showing() { return this.u > 0.001; }
  /** Held up to read, with the interface drawing the screens. */
  get reading() { return !!this.hold; }

  /**
   * Where the interface wants the phone's screens on screen (its overlay's places), or null to hold the phone lower
   * and let it show its own pictures. While set, the glass is plain: the interface draws over it.
   */
  setHold(want: HoldWant | null) {
    this.hold = want;
    this.phone.setGlass(!!want);
    this.phone.object.scale.setScalar(want ? READ_SCALE : 1);
  }

  update(dt: number, time: number, speed = 0) {
    this.u = Math.max(0, Math.min(1, this.u + (this.up ? dt / RAISE.up : -dt / RAISE.down)));
    this.object.visible = this.u > 0.001;
    if (!this.object.visible) return;
    const e = raised(this.u, this.up);
    this.walk += (Math.min(1, speed / 3) - this.walk) * Math.min(1, dt * 6);
    if (this.walk < 0.005) this.walk = 0;
    this.stride += dt * (2 + speed * 1.6);
    this.phone.update(dt);
    const cam = this.object.parent as THREE.PerspectiveCamera | null;
    if (this.hold && cam?.isPerspectiveCamera) this.poseToRead(dt, time, e, cam.fov);
    else this.poseLow(time, e);
    this.pose.updateMatrix();
    const k = this.phone.object.scale.x, open = this.phone.unfolded;
    // The phone's outer edges, its glass's, and its front, in the pose's frame, as it folds and unfolds.
    const outer = (PHONE.w / 2) * (1 + open) * k;
    const glass = ((PHONE_GLASS.cover.w / 2) * (1 - open) + (PHONE_GLASS.spread.w / 2) * open) * k;
    const front = this.phone.screenMiddle(this._m).z * k;
    for (const h of this.sides) {
      h.hand.position.set(h.s * outer, -PHONE.h * 0.2 * k, 0);
      // The thumb up along the edge, on the frame round the glass (never over it: the interface draws there).
      h.thumb.position.set(h.s * (glass + 0.0092 - outer), -0.024, front + 0.004);
      h.thumb.rotation.set(0.3, 0, h.s * 0.12);
      // The forearm runs from the wrist, below and behind the palm, to the elbow.
      const wrist = this._w.set(h.s * (outer + 0.02), h.hand.position.y - 0.05, -0.022).applyMatrix4(this.pose.matrix);
      h.arm.position.copy(wrist);
      h.arm.quaternion.setFromUnitVectors(UP, this._d.copy(this.hold ? READ_ELBOW(h.s) : ELBOW(h.s)).sub(wrist).normalize());
    }
  }

  /** At arm's length, a little below the middle of the view, turned up toward the eyes. */
  private poseLow(time: number, e: number) {
    const walk = this.walk;
    this.holder.position.set(Math.sin(this.stride) * 0.006 * walk, -0.3 * (1 - e) + Math.abs(Math.cos(this.stride)) * 0.008 * walk + Math.sin(time * 1.3) * 0.0015, 0);
    this.holder.rotation.set(-0.5 * (1 - e), 0, 0);
    this.pose.position.copy(PHONE_AT);
    this.pose.rotation.set(PHONE_TILT, 0, 0);
  }

  /**
   * Up to read: the screen's middle where the interface wants it (the cover's place folded, the spread's open, moving
   * between the two as it unfolds), square to the view but for a slight lean, breathing a little unless kept still.
   * Raised from below and lowered again by swinging round the eye, the way a phone comes up from your lap.
   */
  private poseToRead(dt: number, time: number, e: number, fov: number) {
    const hold = this.hold!;
    const view: ViewSize = { w: hold.view.w, h: hold.view.h, fov };
    const k = READ_SCALE, open = this.phone.unfolded;
    const size = (g: { w: number; h: number }) => ({ w: g.w * k, h: g.h * k });
    const a = holdAt(hold.cover, size(PHONE_GLASS.cover), view), b = holdAt(hold.open, size(PHONE_GLASS.spread), view);
    const quiet = this.still || this.calm;
    this.life += ((quiet ? 0 : 1) - this.life) * Math.min(1, dt * (quiet ? 8 : 1.5));
    // Still means still: not a sway too small to see, which would keep the page moving (and redrawn) every frame.
    if (quiet && this.life < 0.01) this.life = 0;
    const life = sway(time, this.calm ? 0 : this.life, this.calm ? 0 : this.walk, this.stride);
    this.holder.position.set(0, -0.12 * (1 - e), 0);
    this.holder.rotation.set(-0.6 * (1 - e), 0, 0);
    const p = this.pose;
    p.rotation.set(READ_TILT + life.rx, 0, life.rz);
    // Held out a little further while it folds or unfolds, so the half swinging toward you stays clear of your face.
    const out = 1 + UNFOLD_REACH * Math.sin(Math.PI * open);
    const at = this._p.set(a.x + (b.x - a.x) * open, a.y + (b.y - a.y) * open, a.z + (b.z - a.z) * open).multiplyScalar(out);
    // The pose's origin is the phone's back: step back from where the screen's middle should be.
    const mid = this.phone.screenMiddle(this._m).multiplyScalar(k).applyQuaternion(this._q.setFromEuler(p.rotation));
    p.position.set(at.x + life.x, at.y + life.y, at.z).sub(mid);
  }

  /** Where the phone's screens are on screen this frame (CSS pixels, a w × h window), for the interface to draw over. */
  screens(camera: THREE.Camera, w: number, h: number): HeldScreens {
    this.object.updateMatrixWorld(true);
    const near = (camera as THREE.PerspectiveCamera).near ?? 0;
    const quad = (f: PhoneFace): ScreenQuad => {
      const o = f.object, corners: [number, number][] = [];
      let inView = true;
      for (const [x, y] of [[-1, 1], [1, 1], [1, -1], [-1, -1]] as const) {
        const p = o.localToWorld(this._p.set((x * f.w) / 2, (y * f.h) / 2, 0));
        // A corner closer than the camera draws (it's swinging past your face) can't be drawn over.
        if (p.applyMatrix4(camera.matrixWorldInverse).z > -near) inView = false;
        p.applyMatrix4(camera.projectionMatrix);
        corners.push([((p.x + 1) / 2) * w, ((1 - p.y) / 2) * h]);
      }
      // The glass faces you when the eye is on its front side.
      const n = this._d.set(0, 0, 1).transformDirection(o.matrixWorld);
      const toEye = this._w.setFromMatrixPosition(camera.matrixWorld).sub(o.getWorldPosition(this._m));
      return { corners, front: inView && n.dot(toEye) > 0 };
    };
    const { cover, left, spread } = this.phone.faces;
    return { cover: quad(cover), left: quad(left), spread: quad(spread), open: this.phone.unfolded };
  }

  dispose() {
    this.phone.dispose();
    this.object.removeFromParent();
    this.object.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose(); (m.material as THREE.Material | undefined)?.dispose?.(); });
  }
}
