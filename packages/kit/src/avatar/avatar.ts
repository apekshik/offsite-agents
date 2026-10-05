// Adapted from Ready Player One (github.com/apekshik/ready-player-one).
//
// Avatars are built from code: a jointed body (hips, chest, neck, head, upper and lower arms and
// legs) plus layers on top: hair, head style, face, hat, back item, an optional full outfit, and
// a designed look's pieces pinned to the joints. Everything faces +z; height 1 is ~1.92 m.
//
// On top of RPO's rig: held acts (acts.ts) that can hold a prop (props.ts) and reach for it
// with the hands (ik.ts), a gait whose stride matches the ground speed so feet don't skate at a
// stroll, a head that can turn to look at someone, and where the head is now (for labels).

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { AvatarSpec, Look } from "@offsite/contracts";
import { LOOK_PARTS, sanitizeAvatar, sanitizeLook, type Piece, type PieceAnim, type SafeLook } from "./sanitize.ts";
import { pieceGeometry } from "./pieces.ts";
import {
  LR, REST, SIDES, type Pose, type Side, clamp, clamp01, copyPose, damp, lerp, mixPose, newPose, smooth,
} from "./pose.ts";
import { ACTS, type ActBody, type ActDef, type ActId, type Anchor, type Hold, isAct, keyTap, treadWater, typingBurst } from "./acts.ts";
import { makeProp, type Prop, type PropKind } from "./props.ts";
import { solveArm } from "./ik.ts";

// ---------- materials & shapes ----------

type Std = THREE.MeshStandardMaterial;
const std = (color: THREE.ColorRepresentation, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.04, ...extra });
const metal = (color: THREE.ColorRepresentation, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.28, metalness: 0.8, ...extra });
const glow = (color: THREE.ColorRepresentation, k = 1.8) =>
  new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: k, roughness: 0.4 });

const rbox = (w: number, h: number, d: number, r = 0.035) =>
  new RoundedBoxGeometry(w, h, d, 2, Math.max(0.001, Math.min(r, w / 2 - 0.002, h / 2 - 0.002, d / 2 - 0.002)));
const cap = (r: number, len: number) => new THREE.CapsuleGeometry(r, len, 4, 12);

function add(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  parent.add(m);
  return m;
}
function group(parent: THREE.Object3D, x = 0, y = 0, z = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

// ---------- proportions (metres at height 1) ----------

const HIP = 0.92; // hip joint height
const CHEST = 0.3; // chest pivot above the hips
const SHOULDER = 0.23; // shoulder height above the chest pivot
const HEAD = 0.36; // head pivot above the chest pivot
const THIGH = 0.43, SHIN = 0.41, UPPER = 0.29, FORE = 0.27;

type Pair<T> = [T, T];
interface HeadInfo { top: number; front: number; faceY: number; halfW: number; screen?: boolean }
interface Mats {
  skin: Std; hair: Std; top: Std; bottom: Std; shoe: Std; dark: Std; eye: Std; brow: Std; white: Std;
  accent: Std; accentSoft: Std; accentHex: string;
}
interface Dims { thigh: number; shin: number; upper: number; fore: number; hip: number; chest: number; shoulder: number; head: number }

/** The joints, for poses layered on top of animate() and for attaching things. */
export interface RigBones {
  hips: THREE.Group; chest: THREE.Group; head: THREE.Group;
  thighs: Pair<THREE.Group>; shins: Pair<THREE.Group>; feet: Pair<THREE.Group>;
  upperArms: Pair<THREE.Group>; forearms: Pair<THREE.Group>; hands: Pair<THREE.Group>;
  /** Rides the thighs: +z is up off the lap, -y runs toward the knees. */
  lap: THREE.Group;
}
interface Rig extends Omit<RigBones, "lap"> {
  headInfo: HeadInfo; headMeshes: THREE.Object3D[];
  armMeshes: Pair<THREE.Mesh[]>; w: number; torso: THREE.Mesh[]; pelvis: THREE.Mesh; belt: THREE.Mesh; D: Dims;
}
interface Anim {
  halo?: THREE.Mesh; haloY?: number; cape?: THREE.Group; wings?: THREE.Group[]; flames?: THREE.Mesh[]; orbRings?: THREE.Mesh[];
}

// ---------- heads ----------
// Each returns where things go on it: top, front face plane, eye height, half width.

const HEADS: Record<AvatarSpec["head"], (g: THREE.Group, M: Mats) => HeadInfo> = {
  box(g, M) {
    add(g, rbox(0.3, 0.34, 0.31, 0.07), M.skin, 0, 0.18, 0);
    return { top: 0.35, front: 0.155, faceY: 0.19, halfW: 0.15 };
  },
  round(g, M) {
    const s = add(g, new THREE.SphereGeometry(0.18, 20, 16), M.skin, 0, 0.19, 0);
    s.scale.set(1, 1.06, 1);
    return { top: 0.38, front: 0.172, faceY: 0.2, halfW: 0.17 };
  },
  tv(g, M) {
    add(g, rbox(0.42, 0.31, 0.29, 0.04), M.dark, 0, 0.17, 0);
    add(g, rbox(0.34, 0.23, 0.01, 0.01), glow(new THREE.Color(M.accentHex).multiplyScalar(0.3).getStyle(), 0.6), 0, 0.17, 0.146);
    return { top: 0.33, front: 0.15, faceY: 0.18, halfW: 0.21, screen: true };
  },
  helmet(g, M) {
    add(g, rbox(0.34, 0.38, 0.35, 0.09), M.top, 0, 0.19, 0);
    add(g, rbox(0.06, 0.1, 0.36, 0.02), M.accentSoft, 0, 0.38, 0);
    return { top: 0.39, front: 0.175, faceY: 0.2, halfW: 0.17 };
  },
  cat(g, M) {
    add(g, rbox(0.31, 0.32, 0.3, 0.08), M.skin, 0, 0.17, 0);
    for (const s of [-1, 1]) {
      add(g, new THREE.ConeGeometry(0.065, 0.14, 4), M.skin, s * 0.1, 0.38, 0, 0, Math.PI / 4, 0);
      add(g, new THREE.ConeGeometry(0.033, 0.07, 4), M.accentSoft, s * 0.1, 0.37, 0.022, 0, Math.PI / 4, 0);
    }
    add(g, rbox(0.06, 0.04, 0.03, 0.01), M.accentSoft, 0, 0.12, 0.155);
    return { top: 0.33, front: 0.152, faceY: 0.2, halfW: 0.15 };
  },
};

/** Where things sit on each head (for accessories made of look pieces). */
export const HEAD_FIT: Record<AvatarSpec["head"], HeadInfo> = {
  box: { top: 0.35, front: 0.155, faceY: 0.19, halfW: 0.15 },
  round: { top: 0.38, front: 0.172, faceY: 0.2, halfW: 0.17 },
  tv: { top: 0.33, front: 0.15, faceY: 0.18, halfW: 0.21, screen: true },
  helmet: { top: 0.39, front: 0.175, faceY: 0.2, halfW: 0.17 },
  cat: { top: 0.33, front: 0.152, faceY: 0.2, halfW: 0.15 },
};

// ---------- faces ----------

const FACES: Record<AvatarSpec["face"], (g: THREE.Group, h: HeadInfo, M: Mats) => void> = {
  none() {}, // a face built from the look's own pieces
  dots(g, h, M) {
    const m = h.screen ? M.accent : M.eye;
    for (const s of [-1, 1]) {
      add(g, rbox(0.045, 0.055, 0.02, 0.012), m, s * 0.065, h.faceY, h.front + 0.004);
      if (!h.screen) add(g, new THREE.SphereGeometry(0.008, 6, 4), M.white, s * 0.065 + 0.01, h.faceY + 0.012, h.front + 0.016);
    }
    if (!h.screen) for (const s of [-1, 1]) add(g, rbox(0.06, 0.012, 0.012, 0.004), M.brow, s * 0.065, h.faceY + 0.055, h.front + 0.004, 0, 0, -s * 0.12);
  },
  smile(g, h, M) {
    FACES.dots(g, h, M);
    add(g, new THREE.TorusGeometry(0.035, 0.007, 6, 14, Math.PI), h.screen ? M.accent : M.eye, 0, h.faceY - 0.075, h.front + 0.004, 0, 0, Math.PI);
  },
  visor(g, h, M) {
    add(g, rbox(h.halfW * 1.75, 0.07, 0.03, 0.02), M.accent, 0, h.faceY, h.front + 0.008);
  },
  cyclops(g, h, M) {
    add(g, new THREE.CylinderGeometry(0.06, 0.06, 0.02, 20), M.dark, 0, h.faceY, h.front + 0.004, Math.PI / 2, 0, 0);
    add(g, new THREE.CylinderGeometry(0.036, 0.036, 0.024, 20), M.accent, 0, h.faceY, h.front + 0.008, Math.PI / 2, 0, 0);
  },
};

// ---------- hair ----------

const HAIR: Record<AvatarSpec["hair"], (g: THREE.Group, h: HeadInfo, M: Mats) => void> = {
  none() {},
  short(g, h, M) {
    add(g, rbox(h.halfW * 2 + 0.03, 0.1, 0.33, 0.045), M.hair, 0, h.top - 0.03, -0.005);
    add(g, rbox(h.halfW * 2 + 0.025, 0.2, 0.07, 0.03), M.hair, 0, h.top - 0.13, -0.135);
    add(g, rbox(h.halfW * 2 + 0.02, 0.05, 0.08, 0.02), M.hair, 0, h.top - 0.06, 0.12, 0.3, 0, 0);
  },
  long(g, h, M) {
    HAIR.short(g, h, M);
    add(g, rbox(h.halfW * 2 + 0.02, 0.42, 0.07, 0.03), M.hair, 0, h.top - 0.29, -0.145);
    for (const s of [-1, 1]) add(g, rbox(0.04, 0.28, 0.12, 0.02), M.hair, s * (h.halfW + 0.01), h.top - 0.2, -0.05);
  },
  topknot(g, h, M) {
    add(g, rbox(h.halfW * 2 + 0.02, 0.07, 0.3, 0.03), M.hair, 0, h.top - 0.02, -0.02);
    add(g, new THREE.SphereGeometry(0.055, 12, 10), M.hair, 0, h.top + 0.05, -0.04);
    add(g, new THREE.CylinderGeometry(0.03, 0.035, 0.1, 10), M.hair, 0, h.top + 0.09, -0.08, -0.9, 0, 0);
  },
  spiky(g, h, M) {
    add(g, rbox(h.halfW * 2 + 0.02, 0.07, 0.31, 0.03), M.hair, 0, h.top - 0.02, -0.01);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      add(g, new THREE.ConeGeometry(0.045, 0.14, 5), M.hair, Math.cos(a) * 0.08, h.top + 0.03, Math.sin(a) * 0.08 - 0.02, Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6);
    }
  },
  bun(g, h, M) {
    HAIR.short(g, h, M);
    add(g, new THREE.SphereGeometry(0.075, 14, 10), M.hair, 0, h.top - 0.06, -0.16);
  },
};

// ---------- hats ----------

const HATS: Record<AvatarSpec["hat"], (g: THREE.Group, h: HeadInfo, M: Mats, anim: Anim) => void> = {
  none() {},
  crown(g, h) {
    const gold = metal("#e5b53b");
    add(g, new THREE.CylinderGeometry(0.14, 0.14, 0.07, 10), gold, 0, h.top + 0.035, 0);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      add(g, new THREE.ConeGeometry(0.03, 0.09, 4), gold, Math.cos(a) * 0.12, h.top + 0.11, Math.sin(a) * 0.12);
    }
  },
  wizard(g, h, M) {
    add(g, new THREE.CylinderGeometry(0.28, 0.28, 0.02, 20), M.top, 0, h.top + 0.01, 0);
    add(g, new THREE.CylinderGeometry(0.18, 0.19, 0.05, 16), M.accentSoft, 0, h.top + 0.04, 0);
    add(g, new THREE.ConeGeometry(0.18, 0.44, 14), M.top, -0.03, h.top + 0.24, 0, 0, 0, 0.18);
  },
  antenna(g, h, M) {
    add(g, new THREE.CylinderGeometry(0.01, 0.01, 0.22, 5), M.dark, 0.06, h.top + 0.11, 0);
    add(g, new THREE.SphereGeometry(0.04, 10, 8), M.accent, 0.06, h.top + 0.24, 0);
  },
  horns(g, h) {
    const bone = std("#eee6d0");
    for (const s of [-1, 1]) add(g, new THREE.ConeGeometry(0.04, 0.2, 8), bone, s * 0.14, h.top + 0.05, 0.02, 0, 0, -s * 0.55);
  },
  halo(g, h, M, anim) {
    anim.halo = add(g, new THREE.TorusGeometry(0.14, 0.017, 8, 28), M.accent, 0, h.top + 0.14, 0, Math.PI / 2, 0, 0);
    anim.haloY = h.top + 0.14;
  },
  mohawk(g, h, M) {
    add(g, rbox(0.05, 0.13, 0.32, 0.02), M.accentSoft, 0, h.top + 0.05, -0.02);
  },
};

// ---------- back items ----------

const BACKS: Record<AvatarSpec["back"], (R: Rig, M: Mats, anim: Anim) => void> = {
  none() {},
  cape(R, M, anim) {
    const pivot = group(R.chest, 0, 0.25, -0.125);
    const geo = rbox(0.42 * R.w, 1.0, 0.02, 0.01);
    geo.translate(0, -0.5, 0);
    add(pivot, geo, M.accentSoft);
    anim.cape = pivot;
  },
  wings(R, M, anim) {
    const mat = new THREE.MeshStandardMaterial({ color: M.accentHex, emissive: M.accentHex, emissiveIntensity: 0.3, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false });
    anim.wings = [-1, 1].map((s) => {
      const pivot = group(R.chest, s * 0.05, 0.12, -0.13);
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.bezierCurveTo(0.25, 0.35, 0.6, 0.45, 0.72, 0.2);
      shape.bezierCurveTo(0.62, -0.05, 0.45, -0.35, 0.18, -0.42);
      shape.bezierCurveTo(0.08, -0.3, 0.02, -0.12, 0, 0);
      const geo = new THREE.ShapeGeometry(shape, 16);
      if (s < 0) geo.scale(-1, 1, 1);
      add(pivot, geo, mat);
      pivot.userData["side"] = s;
      return pivot;
    });
  },
  jetpack(R, M, anim) {
    add(R.chest, rbox(0.3, 0.36, 0.13, 0.04), M.dark, 0, 0.06, -0.18);
    anim.flames = [-1, 1].map((s) => {
      add(R.chest, new THREE.CylinderGeometry(0.055, 0.055, 0.38, 12), metal("#9aa5b1"), s * 0.1, 0.03, -0.24);
      return add(R.chest, new THREE.ConeGeometry(0.05, 0.22, 10), M.accent, s * 0.1, -0.27, -0.24, Math.PI, 0, 0);
    });
  },
};

// ---------- outfits ----------
// Each gets the rig R (joints and the head info), materials M, the spec, and the animation
// bag. Returns which base layers it replaces.

interface Covers { hidesHat?: boolean; hidesHair?: boolean; hidesFace?: boolean }

const OUTFITS: Record<AvatarSpec["outfit"], (R: Rig, M: Mats, spec: AvatarSpec, anim: Anim) => Covers> = {
  none: () => ({}),

  samurai(R, M, spec) {
    const lacquer = std(spec.top, { roughness: 0.35, metalness: 0.15 });
    const dark = std(spec.bottom, { roughness: 0.6 });
    const gold = metal(spec.accent);
    const cord = std(spec.accent, { roughness: 0.5 });
    add(R.chest, rbox(0.44 * R.w, 0.34, 0.27, 0.05), lacquer, 0, 0.1, 0);
    for (let i = 0; i < 5; i++) add(R.chest, rbox(0.45 * R.w, 0.022, 0.276, 0.01), i % 2 ? cord : gold, 0, -0.03 + i * 0.065, 0);
    for (let i = 0; i < 3; i++) add(R.chest, rbox(0.34 * R.w, 0.055, 0.22, 0.02), lacquer, 0, -0.1 - i * 0.06, 0);
    R.upperArms.forEach((a, k) => {
      const s = k ? 1 : -1;
      for (let i = 0; i < 4; i++) {
        add(a, rbox(0.03, 0.072, 0.2, 0.01), lacquer, s * (0.085 + i * 0.008), 0.03 - i * 0.062, 0, 0, 0, s * 0.16);
        add(a, rbox(0.032, 0.01, 0.202, 0.003), gold, s * (0.087 + i * 0.008), -0.004 - i * 0.062, 0, 0, 0, s * 0.16);
      }
    });
    for (const [x, z, rx] of [[-0.1, 0.12, 0.15], [0.1, 0.12, 0.15], [-0.1, -0.12, -0.15], [0.1, -0.12, -0.15]] as const) {
      add(R.hips, rbox(0.15, 0.24, 0.035, 0.012), lacquer, x * R.w, -0.12, z, rx, 0, 0);
    }
    R.thighs.forEach((t) => add(t, new THREE.CylinderGeometry(0.1, 0.13, R.D.thigh, 14), dark, 0, -R.D.thigh / 2, 0));
    R.shins.forEach((t) => add(t, new THREE.CylinderGeometry(0.13, 0.16, R.D.shin - 0.04, 14), dark, 0, -R.D.shin / 2 + 0.02, 0));
    const h = R.headInfo;
    const bowl = add(R.head, new THREE.SphereGeometry(0.19, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), lacquer, 0, h.top - 0.1, -0.005);
    bowl.scale.set(1, 0.95, 1.02);
    for (let i = 0; i < 3; i++) {
      const m = add(R.head, new THREE.CylinderGeometry(0.19 + i * 0.022, 0.21 + i * 0.024, 0.05, 22, 1, true, Math.PI * 0.3, Math.PI * 1.4), lacquer, 0, h.top - 0.12 - i * 0.045, -0.01);
      (m.material as Std).side = THREE.DoubleSide;
    }
    add(R.head, new THREE.TorusGeometry(0.13, 0.012, 6, 24, Math.PI), gold, 0, h.top + 0.02, 0.1, 0, 0, 0);
    add(R.head, rbox(0.04, 0.06, 0.02, 0.008), gold, 0, h.top - 0.07, 0.18);
    add(R.head, rbox(0.22, 0.1, 0.05, 0.03), dark, 0, h.faceY - 0.09, h.front + 0.01);
    const swords = group(R.hips, -0.18 * R.w, 0.02, 0.06);
    swords.rotation.set(-1.25, 0, 0.12);
    add(swords, new THREE.CylinderGeometry(0.018, 0.02, 0.82, 8), dark, 0, -0.18, 0);
    add(swords, new THREE.CylinderGeometry(0.045, 0.045, 0.012, 12), gold, 0, 0.235, 0);
    add(swords, new THREE.CylinderGeometry(0.017, 0.017, 0.22, 8), cord, 0, 0.35, 0);
    add(swords, new THREE.CylinderGeometry(0.015, 0.017, 0.5, 8), dark, 0.04, -0.05, 0.02);
    return { hidesHat: true, hidesHair: true };
  },

  cyborg(R, M, spec) {
    const chrome = metal("#b6bec8");
    const plate = metal(spec.top, { roughness: 0.35 });
    const core = glow(spec.accent, 2.2);
    const k = 1;
    R.armMeshes[k].forEach((m) => { m.visible = false; });
    const ua = R.upperArms[k], fa = R.forearms[k];
    add(ua, new THREE.SphereGeometry(0.07, 12, 10), chrome, 0, 0, 0);
    add(ua, new THREE.CylinderGeometry(0.04, 0.04, R.D.upper, 10), chrome, 0, -R.D.upper / 2, 0);
    add(ua, rbox(0.1, 0.18, 0.11, 0.03), plate, 0.01, -R.D.upper / 2, 0);
    add(fa, new THREE.SphereGeometry(0.055, 12, 10), core, 0, 0, 0);
    for (const x of [-0.035, 0.035]) add(fa, new THREE.CylinderGeometry(0.014, 0.014, R.D.fore - 0.04, 6), chrome, x, -R.D.fore / 2, -0.03);
    add(fa, rbox(0.09, 0.2, 0.08, 0.025), plate, 0, -R.D.fore / 2, 0.02);
    add(fa, rbox(0.08, 0.06, 0.07, 0.015), plate, 0, -R.D.fore - 0.02, 0);
    for (let i = 0; i < 3; i++) add(fa, rbox(0.018, 0.08, 0.02, 0.006), chrome, -0.025 + i * 0.025, -R.D.fore - 0.08, 0.015, 0.25, 0, 0);
    const h = R.headInfo;
    add(R.head, rbox(h.halfW + 0.012, 0.3, 0.32, 0.05), chrome, h.halfW / 2 + 0.006, 0.18, 0.004);
    add(R.head, rbox(0.06, 0.03, 0.02, 0.008), core, 0.065, h.faceY, h.front + 0.012);
    add(R.head, new THREE.CylinderGeometry(0.045, 0.045, 0.04, 14), plate, h.halfW + 0.01, h.faceY - 0.02, -0.02, 0, 0, Math.PI / 2);
    add(R.chest, rbox(0.42 * R.w, 0.3, 0.25, 0.05), plate, 0, 0.11, 0);
    add(R.chest, new THREE.CylinderGeometry(0.055, 0.055, 0.02, 20), core, 0, 0.13, 0.126, Math.PI / 2, 0, 0);
    for (let i = 0; i < 3; i++) add(R.chest, rbox(0.3 * R.w, 0.022, 0.205, 0.008), chrome, 0, -0.08 - i * 0.05, 0);
    for (let i = 0; i < 6; i++) add(R.chest, rbox(0.05, 0.04, 0.04, 0.01), chrome, 0, 0.22 - i * 0.06, -0.13);
    R.shins.forEach((s) => {
      add(s, new THREE.SphereGeometry(0.06, 10, 8), chrome, 0, 0, 0.02);
      add(s, rbox(0.11, 0.28, 0.12, 0.03), plate, 0, -0.19, 0.01);
    });
    return {};
  },

  astronaut(R, M, spec) {
    const suit = std(spec.top, { roughness: 0.75 });
    const suit2 = std(spec.bottom, { roughness: 0.75 });
    const ring = std(spec.accent, { roughness: 0.4, metalness: 0.3 });
    const visor = new THREE.MeshStandardMaterial({ color: "#d6a43c", metalness: 1, roughness: 0.07 });
    R.upperArms.forEach((a) => {
      add(a, cap(0.085, R.D.upper - 0.1), suit, 0, -R.D.upper / 2, 0);
      add(a, new THREE.TorusGeometry(0.085, 0.018, 8, 20), ring, 0, -0.01, 0, Math.PI / 2, 0, 0);
    });
    R.forearms.forEach((a) => {
      add(a, cap(0.078, R.D.fore - 0.1), suit, 0, -R.D.fore / 2, 0);
      add(a, new THREE.TorusGeometry(0.075, 0.016, 8, 20), ring, 0, -R.D.fore + 0.02, 0, Math.PI / 2, 0, 0);
      add(a, rbox(0.11, 0.12, 0.1, 0.04), suit2, 0, -R.D.fore - 0.04, 0);
    });
    R.thighs.forEach((t) => add(t, cap(0.11, R.D.thigh - 0.14), suit, 0, -R.D.thigh / 2, 0));
    R.shins.forEach((t) => {
      add(t, new THREE.TorusGeometry(0.1, 0.02, 8, 20), ring, 0, 0, 0, Math.PI / 2, 0, 0);
      add(t, cap(0.1, R.D.shin - 0.16), suit, 0, -R.D.shin / 2, 0);
    });
    R.feet.forEach((f) => add(f, rbox(0.17, 0.12, 0.29, 0.04), suit2, 0, 0.02, 0.03));
    add(R.chest, rbox(0.46 * R.w, 0.42, 0.3, 0.1), suit, 0, 0.04, 0);
    add(R.hips, rbox(0.4 * R.w, 0.2, 0.27, 0.07), suit, 0, 0.02, 0);
    add(R.chest, rbox(0.18, 0.11, 0.03, 0.015), suit2, 0, 0.06, 0.15);
    ([["#7dff6a", -0.05], ["#ffd23f", 0], ["#ff5d5d", 0.05]] as const).forEach(([c, x]) => add(R.chest, new THREE.SphereGeometry(0.012, 8, 6), glow(c, 2), x, 0.06, 0.168));
    add(R.chest, rbox(0.38, 0.44, 0.17, 0.05), suit, 0, 0.04, -0.23);
    for (const x of [-0.1, 0.1]) add(R.chest, new THREE.CylinderGeometry(0.04, 0.04, 0.4, 12), ring, x, 0.04, -0.33);
    const h = R.headInfo;
    add(R.head, new THREE.SphereGeometry(0.25, 28, 20), suit, 0, 0.2, 0);
    add(R.head, new THREE.SphereGeometry(0.253, 28, 20, Math.PI / 2 - 1.05, 2.1, 0.75, 1.05), visor, 0, 0.2, 0);
    add(R.head, new THREE.TorusGeometry(0.16, 0.035, 10, 28), ring, 0, -0.02, 0, Math.PI / 2, 0, 0);
    R.headMeshes.forEach((m) => { m.visible = false; });
    R.headInfo = { ...h, top: 0.45 };
    return { hidesHat: true, hidesHair: true, hidesFace: true };
  },

  knight(R, M, spec) {
    const steel = metal(spec.top, { roughness: 0.32 });
    const dark = std(spec.bottom);
    const tabard = std(spec.accent, { roughness: 0.75 });
    const trim = metal("#e5c46b");
    add(R.chest, rbox(0.44 * R.w, 0.36, 0.28, 0.09), steel, 0, 0.09, 0);
    for (let i = 0; i < 3; i++) add(R.chest, rbox(0.36 * R.w, 0.06, 0.23, 0.02), steel, 0, -0.1 - i * 0.055, 0);
    const front = add(R.chest, rbox(0.25, 0.62, 0.02, 0.01), tabard, 0, -0.14, 0.145);
    add(R.chest, rbox(0.25, 0.62, 0.02, 0.01), tabard, 0, -0.14, -0.145);
    add(front, rbox(0.03, 0.17, 0.01, 0.004), trim, 0, 0.12, 0.012);
    add(front, rbox(0.12, 0.03, 0.01, 0.004), trim, 0, 0.15, 0.012);
    R.upperArms.forEach((a, k) => {
      const s = k ? 1 : -1;
      const p = add(a, new THREE.SphereGeometry(0.11, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), steel, s * 0.02, 0.02, 0);
      p.scale.set(1.1, 0.8, 1.1);
    });
    R.forearms.forEach((a) => {
      add(a, new THREE.CylinderGeometry(0.07, 0.06, R.D.fore - 0.04, 12), steel, 0, -R.D.fore / 2, 0);
      add(a, rbox(0.1, 0.12, 0.1, 0.03), steel, 0, -R.D.fore - 0.04, 0);
    });
    R.shins.forEach((s) => {
      add(s, new THREE.SphereGeometry(0.07, 12, 8), steel, 0, 0, 0.03);
      add(s, new THREE.CylinderGeometry(0.08, 0.07, R.D.shin - 0.08, 12), steel, 0, -R.D.shin / 2, 0);
    });
    R.feet.forEach((f) => add(f, rbox(0.14, 0.09, 0.27, 0.03), steel, 0, 0.01, 0.03));
    R.thighs.forEach((t) => add(t, cap(0.088, R.D.thigh - 0.16), dark, 0, -R.D.thigh / 2, 0));
    const h = R.headInfo;
    add(R.head, rbox(0.34, 0.4, 0.35, 0.06), steel, 0, 0.19, 0);
    add(R.head, rbox(0.25, 0.025, 0.02, 0.008), std("#0e0f12"), 0, h.faceY + 0.01, 0.176);
    add(R.head, rbox(0.03, 0.3, 0.02, 0.008), trim, 0, 0.19, 0.176);
    const plume = add(R.head, cap(0.035, 0.24), tabard, 0, 0.47, -0.06, -0.6, 0, 0);
    plume.scale.set(1, 1, 1.4);
    R.headMeshes.forEach((m) => { m.visible = false; });
    R.headInfo = { ...h, top: 0.42 };
    return { hidesHat: true, hidesHair: true, hidesFace: true };
  },

  runner(R, M, spec) {
    const hoodie = std(spec.top, { roughness: 0.9 });
    const pants = std(spec.bottom, { roughness: 0.85 });
    const shade = glow(spec.accent, 0.9);
    const white = std("#f2f2f0");
    add(R.chest, rbox(0.42 * R.w, 0.5, 0.26, 0.09), hoodie, 0, 0.0, 0);
    add(R.chest, rbox(0.22, 0.1, 0.02, 0.02), hoodie, 0, -0.14, 0.13);
    for (const x of [-0.04, 0.04]) add(R.chest, new THREE.CylinderGeometry(0.006, 0.006, 0.12, 5), white, x, 0.12, 0.135);
    add(R.chest, new THREE.TorusGeometry(0.13, 0.055, 8, 18, Math.PI), hoodie, 0, 0.25, -0.1, -0.4, 0, Math.PI);
    R.upperArms.forEach((a) => add(a, cap(0.072, R.D.upper - 0.12), hoodie, 0, -R.D.upper / 2, 0));
    R.forearms.forEach((a) => add(a, cap(0.064, R.D.fore - 0.12), hoodie, 0, -R.D.fore / 2 + 0.02, 0));
    R.thighs.forEach((t, k) => {
      add(t, cap(0.09, R.D.thigh - 0.16), pants, 0, -R.D.thigh / 2, 0);
      add(t, rbox(0.04, 0.12, 0.11, 0.015), pants, (k ? 1 : -1) * 0.095, -R.D.thigh / 2 - 0.02, 0);
    });
    R.feet.forEach((f) => {
      add(f, rbox(0.14, 0.04, 0.28, 0.015), white, 0, -0.025, 0.035);
      add(f, rbox(0.13, 0.07, 0.24, 0.03), std(spec.accent), 0, 0.025, 0.025);
    });
    const h = R.headInfo;
    add(R.head, rbox(h.halfW * 1.9, 0.05, 0.025, 0.015), shade, 0, h.faceY, h.front + 0.01);
    add(R.head, new THREE.TorusGeometry(h.halfW + 0.03, 0.016, 6, 20, Math.PI), std("#2a2d35"), 0, h.top - 0.12, 0, 0, 0, 0);
    for (const s of [-1, 1]) add(R.head, new THREE.CylinderGeometry(0.05, 0.05, 0.04, 14), std("#2a2d35"), s * (h.halfW + 0.03), h.faceY - 0.02, 0, 0, 0, Math.PI / 2);
    add(R.chest, rbox(0.26, 0.3, 0.11, 0.04), pants, 0, 0.04, -0.19);
    return { hidesFace: true };
  },

  mage(R, M, spec, anim) {
    const robe = std(spec.top, { roughness: 0.85 });
    const inner = std(spec.bottom, { roughness: 0.85 });
    const trim = std(spec.accent, { roughness: 0.5, metalness: 0.4 });
    const orb = glow(spec.accent, 2.4);
    add(R.chest, rbox(0.4 * R.w, 0.48, 0.25, 0.07), robe, 0, 0.0, 0);
    for (const s of [-1, 1]) add(R.chest, rbox(0.03, 0.3, 0.01, 0.005), trim, s * 0.06, 0.08, 0.128, 0, 0, s * 0.35);
    add(R.chest, rbox(0.42 * R.w, 0.06, 0.27, 0.02), trim, 0, -0.17, 0);
    add(R.chest, rbox(0.06, 0.3, 0.02, 0.008), trim, 0.08, -0.32, 0.13);
    const skirt = add(R.hips, new THREE.CylinderGeometry(0.21 * R.w, 0.34 * R.w, 0.86, 22, 1, true), robe, 0, -0.4, 0);
    (skirt.material as Std).side = THREE.DoubleSide;
    add(R.hips, new THREE.TorusGeometry(0.34 * R.w, 0.015, 6, 30), trim, 0, -0.82, 0, Math.PI / 2, 0, 0);
    R.upperArms.forEach((a) => add(a, cap(0.07, R.D.upper - 0.12), robe, 0, -R.D.upper / 2, 0));
    R.forearms.forEach((a) => {
      const sleeve = add(a, new THREE.CylinderGeometry(0.065, 0.13, R.D.fore, 14, 1, true), robe, 0, -R.D.fore / 2 - 0.02, 0);
      (sleeve.material as Std).side = THREE.DoubleSide;
    });
    R.thighs.forEach((t) => add(t, cap(0.085, R.D.thigh - 0.16), inner, 0, -R.D.thigh / 2, 0));
    const staff = group(R.hands[1], 0, -0.02, 0.02);
    staff.rotation.x = -0.12;
    add(staff, new THREE.CylinderGeometry(0.02, 0.025, 1.7, 8), std("#6b4a2e"), 0, 0.35, 0);
    const top = group(staff, 0, 1.25, 0);
    add(top, new THREE.SphereGeometry(0.07, 16, 12), orb);
    anim.orbRings = [0, 1].map((i) => add(top, new THREE.TorusGeometry(0.12 + i * 0.03, 0.006, 6, 30), trim, 0, 0, 0, i ? 0.8 : -0.6, 0, 0));
    return {};
  },
};

// ---------- designed looks ----------
// Primitive pieces pinned to the rig's joints, so they move with it, plus parts of the default
// body to hide. Each piece gets its own geometry (disposeObject frees them).

const DEG = Math.PI / 180;

function pieceMaterial(p: Piece) {
  const op = p.opacity ?? 1;
  const opts: THREE.MeshStandardMaterialParameters = {
    color: p.color, roughness: 0.62, metalness: 0.05, transparent: op < 1, opacity: op, depthWrite: op >= 1, flatShading: !!p.flat,
    side: p.shape === "extrude" || p.shape === "lathe" ? THREE.DoubleSide : THREE.FrontSide,
  };
  if (p.glow) Object.assign(opts, { emissive: p.color, emissiveIntensity: 1.6 });
  return new THREE.MeshStandardMaterial(opts);
}

function regionBones(R: Rig, region: string): THREE.Object3D[] {
  switch (region) {
    case "head": return [R.head];
    case "torso": return [R.hips, R.chest];
    case "arms": return [...R.upperArms, ...R.forearms, ...R.hands];
    case "legs": return [...R.thighs, ...R.shins, ...R.feet];
  }
  return [];
}

interface Moving { holder: THREE.Group; anim: PieceAnim; base: THREE.Vector3 }

function applyLook(R: Rig, look: SafeLook) {
  const bones: Record<Piece["bone"], THREE.Group> = {
    hips: R.hips, chest: R.chest, head: R.head,
    upper_arm_r: R.upperArms[0], upper_arm_l: R.upperArms[1], forearm_r: R.forearms[0], forearm_l: R.forearms[1],
    hand_r: R.hands[0], hand_l: R.hands[1], thigh_r: R.thighs[0], thigh_l: R.thighs[1],
    shin_r: R.shins[0], shin_l: R.shins[1], foot_r: R.feet[0], foot_l: R.feet[1],
  };
  // Hide what the look replaces: everything hung on those joints except the joints themselves.
  const isBone = new Set<THREE.Object3D>(Object.values(bones));
  for (const region of look.meta.hide) {
    for (const bone of regionBones(R, region)) for (const o of bone.children) if (!isBone.has(o)) o.visible = false;
  }
  const meshes: THREE.Mesh[] = [], moving: Moving[] = [];
  for (const p of look.pieces) {
    const bone = bones[p.bone];
    const pv = p.pivot ?? p.pos;
    const holder = group(bone, pv[0], pv[1], pv[2]);
    const mesh = add(holder, pieceGeometry(p), pieceMaterial(p), p.pos[0] - pv[0], p.pos[1] - pv[1], p.pos[2] - pv[2], p.rot[0] * DEG, p.rot[1] * DEG, p.rot[2] * DEG);
    mesh.scale.set(p.size[0], p.size[1], p.size[2]);
    mesh.userData["piece"] = true;
    meshes.push(mesh);
    if (p.anim) moving.push({ holder, anim: p.anim, base: holder.position.clone() });
  }
  return { meshes, moving };
}

function animatePieces(moving: Moving[], time: number) {
  for (const { holder, anim: a, base } of moving) {
    const w = time * a.speed * Math.PI * 2 + a.phase;
    if (a.type === "spin") holder.rotation[a.axis] = w;
    else if (a.type === "sway") holder.rotation[a.axis] = Math.sin(w) * a.amount * DEG;
    else if (a.type === "bob") holder.position[a.axis] = base[a.axis] + (Math.sin(w) * a.amount) / 100;
    else if (a.type === "pulse") holder.scale.setScalar(1 + (Math.sin(w) * a.amount) / 100);
  }
}

// ---------- the avatar ----------

/** What the body is doing this frame. */
export interface AvatarState {
  /** Metres a second across the ground. */
  speed?: number;
  air?: boolean;
  /** Swimming (treading water, or a front crawl when moving). */
  swim?: boolean;
  crouch?: boolean;
  /** Plainly seated (a construct's seat); acts do their own sitting. */
  sit?: boolean;
  /** A held act (acts.ts), kept until it changes; crossfades over 0.6 s. */
  act?: ActId | null;
  /** Seat height for sitting and lying acts, metres above the feet (the act's default if none). */
  seat?: number | null;
}

export type EmoteId = "wave" | "cheer" | "clap" | "dance" | "bow" | "laugh" | "shrug" | "sit";

export interface AvatarRig {
  /** Put this in the scene; turn it with root.rotation.y. Faces +z. */
  readonly root: THREE.Group;
  animate(dt: number, st: AvatarState, time: number): void;
  playEmote(id: EmoteId): void;
  stopEmote(): void;
  readonly emote: EmoteId | null;
  /** Standing height to the top of the head (or hat), metres. */
  readonly topY: number;
  readonly hipY: number;
  /** Standing eye height, metres: where a first-person camera goes. */
  readonly eyeY: number;
  readonly bones: RigBones;
  /** What the current act holds, if anything (a Laptop, FoldPhone…). */
  readonly prop: Prop | null;
  /** Override the act's prop: a kind, null for empty hands, undefined for the act's own. */
  setProp(kind: PropKind | null | undefined): void;
  /** Turn the head toward a world point (null: look where the body faces). */
  lookAt(point: THREE.Vector3 | null): void;
  /** Just above the head as it is now (sitting, lying), in the root's frame. */
  headTop(out: THREE.Vector3): THREE.Vector3;
  /** Which hand leads (holds the drink, waves): 0 their right, 1 their left. */
  lead: Side;
  /** A number of their own, so the crew don't move in step. */
  seed: number;
  dispose(): void;
}

// A held act: anchors it can hang a prop on.
interface Anchors extends Record<Anchor, THREE.Object3D> {}

/** Builds an avatar from a spec, and optionally a designed look worn over (or instead of) it. */
export function buildAvatar(specIn: AvatarSpec, lookIn: Look | null = null): AvatarRig {
  let spec = sanitizeAvatar(specIn);
  const look = lookIn ? sanitizeLook(lookIn) : null;
  // A designed look's parts are its own (meta.base; parts it doesn't name are off): whatever
  // the wearer had on never shows through it. Colours and proportions stay the wearer's.
  if (look) {
    const base = look.meta.base;
    spec = { ...spec };
    for (const k of LOOK_PARTS) (spec as Record<string, unknown>)[k] = base[k];
  }
  const root = new THREE.Group();
  root.name = "avatar";
  const body = group(root);
  body.scale.setScalar(spec.height);
  // Proportions: every length and width below is the default figure's, stretched by these.
  // bulk widens; depth grows more gently.
  const L = spec.legs, Ar = spec.arms, T = spec.torso, Hs = spec.headSize;
  const w = ({ slim: 0.88, normal: 1, bulky: 1.22 } as const)[spec.build] * spec.bulk;
  const dz = Math.sqrt(spec.bulk), hw = Math.sqrt(spec.bulk);
  const vee = Math.pow(spec.bulk, 0.25); // big builds get broader shoulders than waists
  const D: Dims = {
    thigh: THIGH * L, shin: SHIN * L, upper: UPPER * Ar, fore: FORE * Ar,
    hip: HIP - (THIGH + SHIN) * (1 - L), chest: CHEST * T, shoulder: SHOULDER * T, head: HEAD * T,
  };
  const limb = (len: number, trim: number) => Math.max(0.01, len - trim);

  const M: Mats = {
    skin: std(spec.skin, { roughness: 0.6 }),
    hair: std(spec.hairColor, { roughness: 0.75 }),
    top: std(spec.top),
    bottom: std(spec.bottom),
    shoe: std("#25262c", { roughness: 0.6 }),
    dark: std("#17181d"),
    eye: std("#16151c", { roughness: 0.3 }),
    brow: std(new THREE.Color(spec.hairColor).multiplyScalar(0.8).getStyle()),
    white: std("#ffffff"),
    accent: glow(spec.accent, 1.6),
    accentSoft: std(spec.accent, { emissive: spec.accent, emissiveIntensity: 0.15 }),
    accentHex: spec.accent,
  };
  const anim: Anim = {};

  // Hips, legs, feet.
  const hips = group(body, 0, D.hip, 0);
  const pelvis = add(hips, rbox(0.32 * w, 0.17, 0.21 * dz, 0.06), M.bottom, 0, 0.02, 0);
  const belt = add(hips, rbox(0.325 * w, 0.04, 0.215 * dz, 0.015), M.accentSoft, 0, 0.09, 0);
  const thighs: THREE.Group[] = [], shins: THREE.Group[] = [], feet: THREE.Group[] = [];
  for (const s of SIDES) {
    const thigh = group(hips, s * 0.095 * w, -0.03, 0);
    add(thigh, cap(0.074 * w, limb(D.thigh, 0.13)), M.bottom, 0, -D.thigh / 2, 0);
    const shin = group(thigh, 0, -D.thigh, 0);
    add(shin, cap(0.062 * w, limb(D.shin, 0.12)), M.bottom, 0, -D.shin / 2, 0);
    const foot = group(shin, 0, -D.shin, 0);
    add(foot, rbox(0.11 * w, 0.08, 0.24 * hw, 0.03), M.shoe, 0, -0.01, 0.035 * hw);
    thighs.push(thigh); shins.push(shin); feet.push(foot);
  }

  // Chest (pivot for sway), arms, neck, head.
  const chest = group(hips, 0, D.chest, 0);
  const torso = [
    add(chest, rbox(0.29 * w, 0.24 * T, 0.19 * dz, 0.06), M.top, 0, -0.12 * T, 0),
    add(chest, rbox(0.38 * w * vee, 0.32 * T, 0.22 * dz, 0.08), M.top, 0, 0.09 * T, 0),
  ];
  const upperArms: THREE.Group[] = [], forearms: THREE.Group[] = [], hands: THREE.Group[] = [], armMeshes: THREE.Mesh[][] = [];
  for (const s of SIDES) {
    const ua = group(chest, s * (0.19 * w * vee + 0.055), D.shoulder, 0);
    const m1 = add(ua, cap(0.056 * w, limb(D.upper, 0.1)), M.top, 0, -D.upper / 2, 0);
    const fa = group(ua, 0, -D.upper, 0);
    const m2 = add(fa, cap(0.05 * w, limb(D.fore, 0.1)), M.skin, 0, -D.fore / 2, 0);
    const hand = group(fa, 0, -D.fore, 0);
    const m3 = add(hand, rbox(0.08 * hw, 0.1 * hw, 0.07 * hw, 0.03), M.skin, 0, -0.04 * hw, 0);
    upperArms.push(ua); forearms.push(fa); hands.push(hand); armMeshes.push([m1, m2, m3]);
  }
  add(chest, new THREE.CylinderGeometry(0.05 * hw, 0.055 * hw, 0.12 * T, 12), M.skin, 0, 0.29 * T, 0);
  // headSize scales the head joint, so the head and everything worn on it grow together.
  const head = group(chest, 0, D.head, 0);
  head.scale.setScalar(Hs);
  const before = head.children.length;
  let headInfo = HEADS[spec.head](head, M);
  const headMeshes = head.children.slice(before);

  const pair = <T,>(a: T[]) => [a[0]!, a[1]!] as Pair<T>;
  const R: Rig = {
    hips, chest, head, headInfo, headMeshes,
    thighs: pair(thighs), shins: pair(shins), feet: pair(feet),
    upperArms: pair(upperArms), forearms: pair(forearms), hands: pair(hands), armMeshes: pair(armMeshes),
    w, torso, pelvis, belt, D,
  };
  // Outfits and back items are drawn for the default build; widen what they hang on the body
  // by bulk too, so a big build's arms don't poke through the sleeves.
  const bodyBones: THREE.Object3D[] = [hips, chest, ...thighs, ...shins, ...feet, ...upperArms, ...forearms, ...hands];
  const had = new Map(bodyBones.map((b) => [b, b.children.length]));
  const covers = OUTFITS[spec.outfit](R, M, spec, anim);
  headInfo = R.headInfo;
  if (!covers.hidesFace) FACES[spec.face](head, headInfo, M);
  if (!covers.hidesHair && spec.head !== "tv" && spec.head !== "helmet") HAIR[spec.hair](head, headInfo, M);
  if (!covers.hidesHat) HATS[spec.hat](head, headInfo, M, anim);
  BACKS[spec.back](R, M, anim);
  if (spec.bulk !== 1) {
    for (const b of bodyBones) {
      const deep = b === hips || b === chest ? dz : spec.bulk;
      for (const o of b.children.slice(had.get(b))) {
        o.scale.x *= spec.bulk; o.position.x *= spec.bulk;
        o.scale.z *= deep; o.position.z *= deep;
      }
    }
  }

  const hatExtra = covers.hidesHat || spec.hat === "none" ? 0 : 0.2;
  let headRoom = (headInfo.top + hatExtra) * Hs; // head pivot to the top of what's worn, in body units
  let topY = (D.hip + D.chest + D.head) * spec.height + headRoom * spec.height;
  const custom = look ? applyLook(R, look) : null;
  if (custom?.meshes.length) {
    // The name tag goes over whatever is tallest now.
    root.updateMatrixWorld(true);
    const box = new THREE.Box3();
    for (const m of custom.meshes) box.expandByObject(m);
    const keepsHead = !look!.meta.hide.includes("head");
    topY = Math.max(keepsHead ? topY : 0, box.max.y);
    headRoom = Math.max(headRoom, topY / spec.height - (D.hip + D.chest + D.head));
  }
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });

  // The lap: rides the thighs, so a laptop sits on them however the body reclines.
  const lap = group(hips, 0, -0.03, 0);
  const bones: RigBones = { hips, chest, head, thighs: R.thighs, shins: R.shins, feet: R.feet, upperArms: R.upperArms, forearms: R.forearms, hands: R.hands, lap };
  const anchors: Anchors = { root, hips, lap, chest, head, hand_r: R.hands[0], hand_l: R.hands[1] };

  // Each state is a full pose; the rig eases between them with these weights.
  const P = newPose(), A = newPose(), B = newPose();
  let phase = 0, moveW = 0, runW = 0, crouchW = 0, airW = 0, swimW = 0, sitW = 0;
  let emote: { def: EmoteDef; t: number } | null = null, emoteOn = false, emoteW = 0;
  let poseFrom: ActId | null = null, poseTo: ActId | null = null, poseMix = 1;
  const legM = (THIGH + SHIN) * L * spec.height;
  // Acts are written with y in hip heights; here y is in leg lengths at height 1.
  const hipUnits = D.hip / L;
  const actBody: ActBody = {
    hip: D.hip * spec.height,
    shoulder: (D.hip + D.chest + D.shoulder) * spec.height,
    seat: 0.46,
    lead: 0,
    seed: 0,
  };
  function act(p: Pose, id: ActId, time: number, seatH: number | null | undefined) {
    const def: ActDef = ACTS[id];
    actBody.seat = seatH ?? def.seat ?? 0.46;
    actBody.lead = rig.lead;
    actBody.seed = rig.seed;
    p.y /= hipUnits;
    def.pose(p, time, actBody);
    p.y *= hipUnits;
  }

  // ---------- holding things ----------

  let prop: Prop | null = null, propFor: ActId | null = null, propGrow = 1;
  let override: PropKind | null | undefined = undefined;
  let lookTarget: THREE.Vector3 | null = null, lookYaw = 0, lookPitch = 0;
  const _v = new THREE.Vector3(), _t = new THREE.Vector3(), _pole = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
  const _targets: [THREE.Vector3, THREE.Vector3] = [new THREE.Vector3(), new THREE.Vector3()];
  const _has: [boolean, boolean] = [false, false];

  function placeProp(hold: Hold, p: Prop) {
    const at = anchors[hold.at ?? "chest"];
    at.add(p.object);
    const pos = typeof hold.pos === "function" ? hold.pos(actBody) : hold.pos ?? [0, 0, 0];
    p.object.position.set(pos[0], pos[1], pos[2]);
    if (hold.rot) p.object.rotation.set(hold.rot[0], hold.rot[1], hold.rot[2]);
    p.object.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  }

  function setHeld(id: ActId | null) {
    const hold = id ? (ACTS[id] as ActDef).hold : undefined;
    const kind = override !== undefined ? override : hold?.prop ?? null;
    if (prop && (prop.kind !== kind || propFor !== id)) {
      // Same kind of thing, a different act (a laptop moving from the desk to the lap): keep it.
      if (prop.kind === kind && hold) { placeProp(hold, prop); propFor = id; return; }
      prop.dispose();
      prop = null;
    }
    if (!prop && kind && hold) {
      prop = makeProp(kind, rig.seed);
      placeProp(hold, prop);
      propGrow = 0;
    } else if (!prop && kind) {
      // A prop with no act to place it: in the leading hand.
      prop = makeProp(kind, rig.seed);
      anchors[rig.lead === 0 ? "hand_r" : "hand_l"].add(prop.object);
      prop.object.position.set(0, -0.08, 0.04);
      propGrow = 0;
    }
    propFor = id;
  }

  // Hands to the prop's grips, or to the act's points, by two-bone IK in the chest's frame.
  function reachFor(hold: Hold, w: number, time: number) {
    _has[0] = _has[1] = false;
    if (hold.hands === "grips") {
      if (!prop || prop.grips.length < 2) return;
      for (const k of LR) chest.worldToLocal(prop.grips[k]!.getWorldPosition(_targets[k]));
      // Whichever grip is further to -x is the right hand's.
      if (_targets[0].x > _targets[1].x) { _v.copy(_targets[0]); _targets[0].copy(_targets[1]); _targets[1].copy(_v); }
      _has[0] = _has[1] = true;
    } else if (hold.hands) {
      const at = anchors[hold.hands.at];
      at.updateWorldMatrix(true, false);
      for (const k of LR) {
        const pt = hold.hands.points[k];
        if (!pt) continue;
        chest.worldToLocal(at.localToWorld(_targets[k].set(pt[0], pt[1], pt[2])));
        _has[k] = true;
      }
    } else return;
    const burst = hold.typing ? typingBurst(time, rig.seed) : 0;
    for (const k of LR) {
      if (!_has[k]) continue;
      if (burst > 0) {
        // Fingers on the keys: little taps, and the hands drift across the keyboard.
        _targets[k].y += keyTap(time, k, rig.seed) * burst;
        _targets[k].x += 0.012 * Math.sin(time * 1.3 + k * 2 + rig.seed) * burst;
      }
      const pole = hold.pole?.[k] ?? [SIDES[k] * 0.6, -1, -0.35];
      _pole.set(pole[0], pole[1], pole[2]);
      solveArm(upperArms[k]!, forearms[k]!, upperArms[k]!.position, _targets[k], _pole, D.upper, D.fore + 0.045 * hw, w);
    }
  }

  // ---------- per frame ----------

  function animate(dt: number, st: AvatarState, time: number) {
    const want = isAct(st.act) ? st.act : null;
    const wantDef: ActDef | null = want ? ACTS[want] : null;
    const swimming = !!st.swim || !!wantDef?.swim;
    const sitting = !!st.sit || !!(wantDef && wantDef.seat !== undefined);
    const sp = sitting ? 0 : st.speed ?? 0;
    const moving = sp > 0.05;
    moveW = damp(moveW, clamp01(sp / 1.3), 10, dt);
    runW = damp(runW, clamp01((sp - 2.6) / 1.8), 6, dt);
    crouchW = damp(crouchW, st.crouch ? 1 : 0, 10, dt);
    airW = damp(airW, st.air ? 1 : 0, 12, dt);
    swimW = damp(swimW, st.swim ? 1 : 0, 5, dt);
    sitW = st.sit ? 1 : damp(sitW, 0, 10, dt);
    // Stride matched to the ground: the planted foot moves back as fast as the body goes.
    if (moving) {
      const step = legM * lerp(1.0 * Math.max(0.35, moveW), 1.5, runW);
      phase += dt * Math.min(13, (Math.PI * sp) / Math.max(0.15, step));
    }

    // Standing: idle, walk, run, then crouch, air and swim on top.
    idlePose(P, time);
    if (moveW > 0.001) {
      walkPose(A, phase);
      if (runW > 0.001) mixPose(A, runPose(B, phase), runW);
      mixPose(P, A, moveW);
    }
    if (crouchW > 0.001) mixPose(P, crouchPose(A, phase, moveW), crouchW);
    if (airW > 0.001) mixPose(P, airPose(A), airW);
    if (swimW > 0.001) mixPose(P, swimPose(A, time, clamp01(sp / 2)), swimW);
    // A held act, eased in from whatever came before over 0.6 s.
    if (want !== poseTo) {
      poseFrom = poseTo; poseTo = want; poseMix = 0;
      setHeld(want);
    }
    poseMix = Math.min(1, poseMix + dt / 0.6);
    if (poseTo || poseFrom) {
      copyPose(A, P);
      if (poseFrom) act(A, poseFrom, time, st.seat);
      copyPose(B, P);
      if (poseTo) act(B, poseTo, time, st.seat);
      copyPose(P, mixPose(A, B, smooth(0, 1, poseMix)));
      if (!poseTo && poseMix >= 1) poseFrom = null;
    }
    if (emote) {
      emote.t += dt;
      if ((!emote.def.loop && emote.t > (emote.def.dur ?? 0)) || st.sit || st.swim) emoteOn = false;
      emoteW = damp(emoteW, emoteOn ? 1 : 0, 8, dt);
      if (!emoteOn && emoteW < 0.01) emote = null;
      else {
        copyPose(A, P);
        EMOTE_POSES[emote.def.id](A, emote.t, time);
        mixPose(P, A, emoteW);
      }
    }
    if (sitW > 0.001) mixPose(P, seatedPose(A, time), sitW);

    // Turning the head toward someone: on top of whatever the pose had it doing.
    if (lookTarget) {
      root.updateWorldMatrix(true, false);
      const local = root.worldToLocal(_v.copy(lookTarget));
      const eye = (D.hip + D.chest + D.head) * spec.height;
      const yaw = clamp(Math.atan2(local.x, local.z), -1.1, 1.1);
      const pitch = clamp(-Math.atan2(local.y - eye, Math.hypot(local.x, local.z)), -0.5, 0.5);
      lookYaw = damp(lookYaw, yaw, 6, dt);
      lookPitch = damp(lookPitch, pitch, 6, dt);
    } else {
      lookYaw = damp(lookYaw, 0, 4, dt);
      lookPitch = damp(lookPitch, 0, 4, dt);
    }

    for (const k of LR) {
      thighs[k]!.rotation.set(P.thX[k], 0, P.thZ[k]);
      shins[k]!.rotation.set(P.shX[k], 0, 0);
      feet[k]!.rotation.set(P.ftX[k], 0, 0);
      upperArms[k]!.rotation.set(P.uaX[k], P.uaY[k], P.uaZ[k]);
      upperArms[k]!.position.y = D.shoulder + P.lift;
      forearms[k]!.rotation.set(P.faX[k], P.faY[k], P.faZ[k]);
      hands[k]!.rotation.set(P.wrX[k], 0, P.wrZ[k]);
    }
    hips.position.set(P.sx * D.hip, D.hip, P.sz * D.hip); // sx, sz: the hips moved over, in hip heights
    hips.rotation.set(P.hpX, P.hpY, P.hpZ);
    chest.rotation.set(P.chX, P.chY + lookYaw * 0.3, P.chZ);
    chest.scale.set(1, 1 + Math.sin(time * 1.8 + rig.seed) * 0.012 * (1 - moveW), 1);
    head.rotation.set(P.hdX + lookPitch, P.hdY + lookYaw * 0.7, P.hdZ);
    body.position.y = P.y * spec.height * L; // crouches and sits drop by how long the legs are
    lap.rotation.x = (P.thX[0] + P.thX[1]) / 2;

    // What the act holds, and the hands on it.
    const holdId = poseTo ?? null;
    const hold = holdId ? (ACTS[holdId] as ActDef).hold : undefined;
    if (prop) {
      propGrow = Math.min(1, propGrow + dt / 0.35);
      const g = smooth(0, 1, propGrow) * (hold?.scale ?? 1);
      prop.object.scale.setScalar(Math.max(0.001, g));
    }
    if (hold && (hold.hands || hold.upright)) {
      // Only the chains the hands need: the chest, and the prop and its anchor.
      chest.updateWorldMatrix(true, false);
      prop?.object.updateWorldMatrix(true, true);
      const w = smooth(0.15, 1, poseMix) * (hold.hands === "grips" && !prop ? 0 : 1);
      if (w > 0 && hold.hands) reachFor(hold, w, time);
      if (prop && hold.upright) {
        // Keep it upright in the world whatever the wrist is doing.
        prop.object.parent!.getWorldQuaternion(_q).invert();
        root.getWorldQuaternion(_q2);
        prop.object.quaternion.copy(_q.multiply(_q2));
      }
    }
    if (prop) {
      prop.object.updateWorldMatrix(true, true);
      prop.update(dt, time);
    }

    if (anim.orbRings) {
      anim.orbRings[0]!.rotation.z = time * 1.6;
      anim.orbRings[1]!.rotation.y = time * 2.1;
    }
    if (anim.halo) anim.halo.position.y = anim.haloY! + Math.sin(time * 2.5) * 0.02;
    const flying = airW > 0.5;
    if (anim.cape) {
      const flow = 0.1 + Math.min(1, sp / 10.5) * 0.8 + airW * 0.5 + crouchW * 0.3 + Math.sin(time * 3) * 0.05;
      anim.cape.rotation.x = lerp(flow, 1.2, Math.max(sitW, sitting ? 1 : 0));
    }
    if (anim.wings) {
      const f = flying ? Math.sin(time * 18) * 0.7 : Math.sin(time * 2) * 0.12;
      for (const wg of anim.wings) wg.rotation.y = -wg.userData["side"] * lerp(0.45 + f, 0.3, sitW);
    }
    if (custom) animatePieces(custom.moving, time);
    if (anim.flames) for (const fl of anim.flames) fl.scale.setScalar(sitting ? 0.4 : flying ? 1.4 + Math.random() * 0.8 : 0.5 + Math.random() * 0.2);
    void swimming;
  }

  const rig: AvatarRig = {
    root, animate,
    topY, hipY: D.hip * spec.height,
    eyeY: (D.hip + D.chest + D.head + headInfo.faceY * Hs) * spec.height,
    bones,
    get prop() { return prop; },
    get emote() { return emoteOn && emote ? emote.def.id : null; },
    lead: 0,
    seed: 0,
    playEmote(id) {
      const def = EMOTES.find((e) => e.id === id);
      if (def) { emote = { def, t: 0 }; emoteOn = true; }
    },
    stopEmote() { emoteOn = false; },
    setProp(kind) {
      if (override === kind) return;
      override = kind;
      setHeld(poseTo);
    },
    lookAt(point) { lookTarget = point ? (lookTarget ?? new THREE.Vector3()).copy(point) : null; },
    headTop(out) {
      head.getWorldPosition(out); // brings the head's chain up to date, nothing else
      out.y += headRoom * spec.height;
      return root.worldToLocal(out);
    },
    dispose() {
      prop?.dispose();
      prop = null;
      root.removeFromParent();
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        for (const mat of Array.isArray(m.material) ? m.material : m.material ? [m.material] : []) mat.dispose();
      });
    },
  };
  return rig;
}

// ---------- poses ----------

function idlePose(p: Pose, time: number) {
  copyPose(p, REST);
  p.hdY = Math.sin(time * 0.6) * 0.3;
  p.hpZ = Math.sin(time * 0.7) * 0.015;
  return p;
}

// An easy walk: modest stride, arms loose, upright.
function walkPose(p: Pose, phase: number) {
  copyPose(p, REST);
  for (const k of LR) {
    const q = phase + k * Math.PI;
    const sw = Math.sin(q), swing = Math.max(0, Math.cos(q)); // swing: the leg is coming forward
    p.thX[k] = -0.55 * sw;
    p.shX[k] = 0.06 + 0.8 * swing;
    p.ftX[k] = -0.3 * swing + 0.15 * Math.max(0, -sw);
    p.uaX[k] = 0.45 * sw;
    p.uaZ[k] = SIDES[k] * 0.08;
    p.faX[k] = -0.28 - 0.25 * Math.max(0, -sw);
  }
  p.chX = 0.04;
  p.chY = 0.1 * Math.sin(phase);
  p.hdY = -0.08 * Math.sin(phase);
  p.y = 0.04 * Math.abs(Math.cos(phase)) - 0.015;
  return p;
}

// A run: forward lean, high knees, heels kicking up, bent arms pumping, a bounce each stride.
const RUN_LEAN = 0.2;
function runPose(p: Pose, phase: number) {
  copyPose(p, REST);
  for (const k of LR) {
    const q = phase + k * Math.PI;
    const sw = Math.sin(q), swing = Math.max(0, Math.cos(q - 0.25));
    p.thX[k] = -0.3 - 0.85 * sw - RUN_LEAN; // measured from upright, not from the tipped hips
    p.shX[k] = 0.25 + 1.75 * swing;
    p.ftX[k] = 0.4 * Math.max(0, -sw) - 0.2 * Math.max(0, sw);
    p.uaX[k] = 0.8 * sw - 0.15;
    p.uaZ[k] = SIDES[k] * 0.16;
    p.faX[k] = -1.35 - 0.35 * Math.max(0, -sw);
    p.faY[k] = -SIDES[k] * 0.25;
  }
  p.hpX = RUN_LEAN;
  p.hpY = -0.1 * Math.sin(phase);
  p.chX = 0.18;
  p.chY = 0.18 * Math.sin(phase);
  p.hdX = -0.2;
  p.hdY = -0.1 * Math.sin(phase);
  p.y = 0.08 * Math.abs(Math.sin(phase)) - 0.035;
  return p;
}

// Knees bent and the body lowered, feet kept on the ground; sneaks when moving.
const CROUCH_THIGH = -1.0, CROUCH_SHIN = 1.85, CROUCH_LEAN = 0.35;
const CROUCH_DROP = THIGH + SHIN - THIGH * Math.cos(CROUCH_THIGH) - SHIN * Math.cos(CROUCH_THIGH + CROUCH_SHIN);
function crouchPose(p: Pose, phase: number, moveW: number) {
  copyPose(p, REST);
  for (const k of LR) {
    const q = phase + k * Math.PI;
    const sw = Math.sin(q) * moveW, swing = Math.max(0, Math.cos(q)) * moveW;
    p.thX[k] = CROUCH_THIGH - 0.4 * sw - CROUCH_LEAN;
    p.shX[k] = CROUCH_SHIN + 0.55 * swing - 0.15 * Math.max(0, sw);
    p.ftX[k] = -(p.thX[k] + CROUCH_LEAN + p.shX[k]);
    p.uaX[k] = -0.5 + 0.3 * sw;
    p.uaZ[k] = SIDES[k] * 0.14;
    p.faX[k] = -0.9;
  }
  p.hpX = CROUCH_LEAN;
  p.chX = 0.25;
  p.chY = 0.08 * Math.sin(phase) * moveW;
  p.hdX = -0.45;
  p.y = -CROUCH_DROP + 0.025 * Math.abs(Math.cos(phase)) * moveW;
  return p;
}

// Mid-jump: one knee up, the other trailing, arms out for balance.
function airPose(p: Pose) {
  copyPose(p, REST);
  p.thX[0] = -0.95; p.shX[0] = 1.3; p.ftX[0] = 0.2;
  p.thX[1] = -0.1; p.shX[1] = 0.8; p.ftX[1] = 0.35;
  for (const k of LR) {
    p.uaX[k] = k ? -0.8 : 0.35;
    p.uaZ[k] = SIDES[k] * 0.55;
    p.faX[k] = -0.55;
  }
  p.chX = 0.05;
  return p;
}

const CRAWL = newPose();
// Treading water when still; a front crawl when moving.
function swimPose(p: Pose, time: number, go: number) {
  copyPose(p, REST);
  treadWater(p, time);
  if (go < 0.01) return p;
  const c = copyPose(CRAWL, REST);
  const st = time * 5.5;
  for (const k of LR) {
    const q = st + k * Math.PI;
    c.thX[k] = 0.15 + 0.3 * Math.sin(time * 11 + k * Math.PI);
    c.shX[k] = 0.25 + 0.2 * Math.max(0, Math.sin(time * 11 + k * Math.PI));
    c.ftX[k] = 0.65;
    c.uaX[k] = -(q % (Math.PI * 2)); // all the way round, always the same way
    c.uaZ[k] = SIDES[k] * 0.2;
    c.faX[k] = -0.25;
  }
  c.hpX = 1.0;
  c.chY = 0.25 * Math.sin(st);
  c.hdX = -0.85;
  c.y = 0.12;
  return mixPose(p, c, go);
}

// Plainly seated: thighs level, knees bent, hands on the lap.
function seatedPose(p: Pose, time: number) {
  copyPose(p, REST);
  for (const k of LR) {
    p.thX[k] = -Math.PI / 2;
    p.shX[k] = Math.PI / 2;
    p.uaX[k] = -0.5;
    p.uaZ[k] = SIDES[k] * 0.08;
    p.faX[k] = -0.7;
  }
  p.hdY = Math.sin(time * 0.5) * 0.3;
  return p;
}

// ---------- emotes ----------
// One-shots have a duration; loops play until stopped. Each edits a copy of the current pose.

interface EmoteDef { id: EmoteId; label: string; dur?: number; loop?: boolean }
export const EMOTES: EmoteDef[] = [
  { id: "wave", label: "Wave", dur: 2.4 },
  { id: "cheer", label: "Cheer", dur: 2.6 },
  { id: "clap", label: "Clap", dur: 2.8 },
  { id: "dance", label: "Dance", loop: true },
  { id: "bow", label: "Bow", dur: 2.2 },
  { id: "laugh", label: "Laugh", dur: 2.6 },
  { id: "shrug", label: "Shrug", dur: 1.9 },
  { id: "sit", label: "Sit", loop: true },
];

// 0 → 1 → 0 over a one-shot, easing in and out.
const envelope = (t: number, dur: number, inT = 0.3, outT = 0.35) => Math.min(smooth(0, inT, t), 1 - smooth(dur - outT, dur, t));

const EMOTE_POSES: Record<EmoteId, (p: Pose, t: number, time: number) => void> = {
  wave(p, t) {
    p.uaX[0] = -0.25; p.uaY[0] = 0; p.uaZ[0] = -2.5;
    p.faX[0] = -0.15; p.faY[0] = 0; p.faZ[0] = -(0.55 + 0.45 * Math.sin(t * 10));
    p.chZ = 0.06; p.hdZ = 0.1; p.hdY = 0;
  },
  cheer(p, t) {
    const hop = t < 2 ? Math.max(0, Math.sin(t * 7.5)) : 0;
    for (const k of LR) {
      const s = SIDES[k];
      p.uaX[k] = -0.2; p.uaY[k] = 0; p.uaZ[k] = s * (2.7 + 0.15 * Math.sin(t * 15));
      p.faX[k] = -0.2; p.faY[k] = 0; p.faZ[k] = s * 0.2;
      p.thX[k] = -0.35 * hop;
      p.shX[k] = 0.06 + 0.7 * hop;
      p.ftX[k] = 0.3 * hop;
    }
    p.y = 0.22 * hop;
    p.hdX = -0.3; p.hdY = 0;
  },
  clap(p, t) {
    const c = Math.pow(Math.max(0, Math.sin(t * 12)), 0.6);
    for (const k of LR) {
      const s = SIDES[k];
      p.uaX[k] = -0.75; p.uaY[k] = -s * 0.3; p.uaZ[k] = -s * (0.05 + 0.15 * c);
      p.faX[k] = -1.05; p.faY[k] = 0; p.faZ[k] = -s * (0.25 + 0.3 * c);
    }
    p.hdX = 0.05 * c; p.hdY = 0;
  },
  dance(p, t) {
    const b = t * 7;
    const bounce = Math.abs(Math.sin(b));
    for (const k of LR) {
      const s = SIDES[k];
      p.thX[k] = -0.3 * bounce;
      p.shX[k] = 0.06 + 0.6 * bounce;
      p.ftX[k] = -0.3 * bounce;
      const disco = smooth(0.3, 0.7, Math.sin(t * 0.9) * 0.5 + 0.5);
      const pump = Math.sin(b + k * Math.PI);
      p.uaX[k] = lerp(-0.5 - 0.5 * pump, k ? -0.2 : 0.1, disco);
      p.uaY[k] = 0;
      p.uaZ[k] = s * lerp(0.55, k ? 2.6 - 0.5 * Math.max(0, Math.sin(b)) : 0.5, disco);
      p.faX[k] = lerp(-1.6, k ? 0 : -0.2, disco);
      p.faY[k] = 0; p.faZ[k] = 0;
    }
    p.y = -0.05 * bounce;
    p.hpZ = 0.1 * Math.sin(b); p.hpY = 0.15 * Math.sin(b * 0.5);
    p.chZ = -0.16 * Math.sin(b); p.chY = 0.2 * Math.sin(b * 0.5);
    p.hdZ = 0.12 * Math.sin(b); p.hdY = -0.15 * Math.sin(b * 0.5);
  },
  bow(p, t) {
    const e = envelope(t, 2.2, 0.45, 0.55);
    p.hpX = 0.85 * e;
    for (const k of LR) p.thX[k] -= 0.85 * e;
    p.chX = 0.2 * e; p.hdX = 0.25 * e; p.hdY *= 1 - e;
    p.uaX[1] = lerp(p.uaX[1], -0.45, e); p.uaZ[1] = lerp(p.uaZ[1], -0.15, e);
    p.faX[1] = lerp(p.faX[1], -1.6, e); p.faZ[1] = lerp(p.faZ[1], -0.5, e);
  },
  laugh(p, t) {
    const shake = Math.sin(t * 24);
    const fold = smooth(1.0, 1.4, t) * (1 - smooth(2.1, 2.5, t));
    for (const k of LR) {
      const s = SIDES[k];
      p.uaX[k] = -0.35; p.uaY[k] = 0; p.uaZ[k] = -s * 0.02;
      p.faX[k] = -1.35; p.faY[k] = 0; p.faZ[k] = -s * 0.45;
    }
    p.chX = lerp(-0.2, 0.45, fold) + 0.05 * shake;
    p.hdX = lerp(-0.35, -0.1, fold) + 0.06 * shake;
    p.hdY = 0; p.lift = 0.012 * shake; p.y = 0.008 * shake;
  },
  shrug(p, t) {
    const e = envelope(t, 1.9, 0.25, 0.45);
    for (const k of LR) {
      const s = SIDES[k];
      p.uaX[k] = lerp(p.uaX[k], -0.15, e); p.uaZ[k] = lerp(p.uaZ[k], s * 0.3, e);
      p.faX[k] = lerp(p.faX[k], -1.3, e); p.faZ[k] = lerp(p.faZ[k], s * 0.75, e);
    }
    p.lift = 0.06 * e; p.hdZ = 0.25 * e; p.hdX = 0.08 * e; p.hdY *= 1 - e; p.chX = -0.05 * e;
  },
  sit(p, t, time) {
    // On the ground: one leg out, one knee up, leaning back on the hands.
    p.thX[0] = -1.5; p.shX[0] = 0.05; p.ftX[0] = -0.1; p.thZ[0] = -0.08;
    p.thX[1] = -2.3; p.shX[1] = 2.6; p.ftX[1] = -0.3; p.thZ[1] = 0.12;
    for (const k of LR) {
      const s = SIDES[k];
      p.uaX[k] = 0.6; p.uaY[k] = 0; p.uaZ[k] = s * 0.22;
      p.faX[k] = 0; p.faY[k] = 0; p.faZ[k] = 0;
    }
    p.hpX = 0; p.hpY = 0; p.hpZ = 0;
    p.chX = -0.25; p.chY = 0; p.chZ = 0;
    p.hdX = 0.15; p.hdY = Math.sin(time * 0.4) * 0.4;
    p.y = -0.82;
  },
};


