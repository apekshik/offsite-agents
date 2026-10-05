// The captain's own hands in first person, holding the foldable phone: navy sleeves with three
// gold stripes, white shirt cuffs, palms behind the phone's sides and thumbs on its face (as in
// the captain's-eye concept art). They ride the camera: add `object` to the camera (Captain
// does), and keep the camera in the scene so they draw.

import * as THREE from "three";
import { FoldPhone } from "../avatar/props.ts";

export interface HandsStyle {
  skin?: THREE.ColorRepresentation;
  sleeve?: THREE.ColorRepresentation;
  cuff?: THREE.ColorRepresentation;
  stripe?: THREE.ColorRepresentation;
}

const std = (color: THREE.ColorRepresentation, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...extra });

// Where things sit in the camera's frame (it looks down -z): the phone a little below the
// middle of the view, turned up toward the eyes; the elbows low and wide, out of view.
const PHONE_AT = new THREE.Vector3(0, -0.07, -0.335);
const PHONE_TILT = -0.38;
const ELBOW = (s: number) => new THREE.Vector3(s * 0.27, -0.46, -0.1);
const UP = new THREE.Vector3(0, 1, 0);

interface Side { s: number; hand: THREE.Group; thumb: THREE.Group; arm: THREE.Group }

export class FirstPersonHands {
  readonly object = new THREE.Group();
  readonly phone: FoldPhone;
  private holder = new THREE.Group();
  private sides: Side[] = [];
  private out = 0;
  private want = 0;
  private sway = 0;
  private _w = new THREE.Vector3();
  private _d = new THREE.Vector3();

  constructor({ skin = "#e8b894", sleeve = "#1d2a4d", cuff = "#f7f7f4", stripe = "#e2b64a" }: HandsStyle = {}) {
    this.object.name = "first-person-hands";
    this.object.add(this.holder);
    this.phone = new FoldPhone({ open: true });
    this.phone.object.position.copy(PHONE_AT);
    this.phone.object.rotation.x = PHONE_TILT;
    this.holder.add(this.phone.object);
    const M = { skin: std(skin, { roughness: 0.55 }), sleeve: std(sleeve, { roughness: 0.75 }), cuff: std(cuff), stripe: std(stripe, { roughness: 0.3, metalness: 0.7 }) };
    const mesh = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rz = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.z = rz;
      parent.add(m);
      return m;
    };
    for (const s of [-1, 1]) {
      // In the phone's frame: the palm behind its side, fingers round the edge, the thumb on the glass.
      const hand = new THREE.Group();
      this.phone.object.add(hand);
      mesh(hand, new THREE.BoxGeometry(0.046, 0.09, 0.042), M.skin, s * 0.018, -0.04, -0.026, -s * 0.12);
      mesh(hand, new THREE.BoxGeometry(0.016, 0.06, 0.028), M.skin, s * 0.004, -0.012, -0.006, -s * 0.05);
      const thumb = new THREE.Group();
      thumb.position.set(s * 0.003, -0.066, 0.012);
      hand.add(thumb);
      mesh(thumb, new THREE.CapsuleGeometry(0.0105, 0.024, 3, 8), M.skin, 0, 0.018, 0);
      thumb.rotation.z = s * 0.42;
      // The forearm, in the holder's frame: wrist at the origin, +y toward the elbow.
      const arm = new THREE.Group();
      this.holder.add(arm);
      mesh(arm, new THREE.CylinderGeometry(0.043, 0.045, 0.034, 16), M.cuff, 0, 0.017, 0);
      mesh(arm, new THREE.CapsuleGeometry(0.053, 0.34, 4, 14), M.sleeve, 0, 0.255, 0);
      for (let i = 0; i < 3; i++) mesh(arm, new THREE.CylinderGeometry(0.0555, 0.0555, 0.011, 18), M.stripe, 0, 0.07 + i * 0.022, 0);
      this.sides.push({ s, hand, thumb, arm });
    }
    this.object.traverse((o) => { o.castShadow = false; o.frustumCulled = false; });
    this.object.visible = false;
  }

  /** Raise the phone into view (or put it away). */
  setOut(out: boolean) { this.want = out ? 1 : 0; }
  /** Unfold or fold the phone. */
  setOpen(open: boolean) { this.phone.setOpen(open); }
  get showing() { return this.out > 0.001; }

  update(dt: number, time: number, speed = 0) {
    this.out += (this.want - this.out) * Math.min(1, dt * 9);
    if (Math.abs(this.want - this.out) < 0.002) this.out = this.want;
    this.object.visible = this.out > 0.01;
    if (!this.object.visible) return;
    const e = this.out * this.out * (3 - 2 * this.out);
    this.sway += dt * (2 + speed * 1.6);
    const walk = Math.min(1, speed / 3);
    this.holder.position.set(Math.sin(this.sway) * 0.006 * walk, -0.3 * (1 - e) + Math.abs(Math.cos(this.sway)) * 0.008 * walk + Math.sin(time * 1.3) * 0.0015, 0);
    this.holder.rotation.x = -0.5 * (1 - e);
    this.phone.update(dt);
    this.phone.object.updateMatrix();
    for (const h of this.sides) {
      // Hands follow the phone's edges as it folds and unfolds.
      const grip = this.phone.grips[h.s < 0 ? 0 : 1]!;
      h.hand.position.set(grip.position.x - h.s * 0.016, grip.position.y + 0.02, 0);
      // Thumbs tap at the glass now and then.
      const tap = Math.pow(Math.max(0, Math.sin(time * 4.2 + h.s * 1.7)), 8);
      h.thumb.position.z = 0.012 + tap * 0.006;
      // The forearm runs from just below the palm to the elbow.
      const wrist = this._w.set(grip.position.x - h.s * 0.0, grip.position.y - 0.065, -0.03).applyMatrix4(this.phone.object.matrix);
      h.arm.position.copy(wrist);
      h.arm.quaternion.setFromUnitVectors(UP, this._d.copy(ELBOW(h.s)).sub(wrist).normalize());
    }

  }

  dispose() {
    this.phone.dispose();
    this.object.removeFromParent();
    this.object.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose(); (m.material as THREE.Material | undefined)?.dispose?.(); });
  }
}
