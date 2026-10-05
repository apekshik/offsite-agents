// Your own body in first person. The camera at the eyes sees your chest, arms, legs and feet,
// walking, sitting or lying as the body does, but not the head it sits in: the head, everything worn
// on it (hair, hat, glasses, a helmet) and the neck move to SELF_LAYER, which the camera doesn't draw
// and the sun's shadow camera does, so your shadow on the deck stays whole. One body, no copy; only
// layers change, so the third person, and everyone else, see exactly what they did before.
//
// The arms go the same way when they'd be in your face: while the first-person hands (hands.ts) hold
// the phone up, so there's one pair of arms and one phone, not two; and while a hand is up at the
// head (hands behind it in a hammock or on a lounger), where the elbows would fill the view.

import * as THREE from "three";
import type { AvatarRig } from "../avatar/avatar.ts";
import type { View } from "./camera.ts";

/** The layer the parts of you that the first-person camera hides move to. Enable it on the sun's
 * shadow camera (light.shadow.camera.layers.enable(SELF_LAYER)) to keep them in your shadow. */
export const SELF_LAYER = 1;

/** The head shows again once a camera gliding out of first person is this far from the eyes (m), and hides once one gliding in is this close. */
export const HEAD_CLEAR = 0.45;
/** A hand this close to the head joint (m) puts the arms out of sight in first person: behind the head is ~0.26,
 * holding a phone at the chest ~0.45, hanging at the side ~0.67. */
export const HAND_CLEAR = 0.35;

/** Which parts of you the camera doesn't draw. */
export interface SelfHidden {
  /** The head, what's worn on it, and the neck. */
  head: boolean;
  /** Both arms, and what the body holds. */
  arms: boolean;
}

export interface SelfView {
  view: View;
  /** Gliding between views. */
  gliding: boolean;
  /** From the camera to the first-person eye point, metres. */
  camToEyes: number;
  /** The first-person hands are up (holding the phone). */
  phoneHands: boolean;
  /** From the nearer of the body's hands to the head joint, metres. */
  handToHead: number;
}

/**
 * What to hide. Settled in a view: the head in first person, nothing in third. Gliding between them
 * it goes by how near the camera is to the eyes, so the head is never seen from inside and never
 * blinks out while the camera is still behind you.
 */
export function selfHidden(s: SelfView, out: SelfHidden = { head: false, arms: false }): SelfHidden {
  out.head = s.gliding ? s.camToEyes < HEAD_CLEAR : s.view === "first";
  out.arms = out.head && (s.phoneHands || s.handToHead < HAND_CLEAR);
  return out;
}

/** Puts the avatar's parts on SELF_LAYER or back, when what's hidden (or what the body holds) changes. */
export class OwnBody {
  private avatar: AvatarRig;
  private head = false;
  private arms = false;
  private held: THREE.Object3D | null = null;

  constructor(avatar: AvatarRig) { this.avatar = avatar; }

  set(hide: SelfHidden) {
    const held = this.avatar.prop?.object ?? null;
    if (hide.head === this.head && hide.arms === this.arms && (!hide.arms || held === this.held)) return;
    this.head = hide.head;
    this.arms = hide.arms;
    this.held = hide.arms ? held : null;
    const { bones, neck, root } = this.avatar;
    root.traverse((o) => o.layers.set(0));
    const away = (o: THREE.Object3D) => o.traverse((x) => x.layers.set(SELF_LAYER));
    if (hide.head) { away(bones.head); away(neck); }
    if (hide.arms) {
      for (const a of bones.upperArms) away(a);
      if (held) away(held);
    }
  }
}
