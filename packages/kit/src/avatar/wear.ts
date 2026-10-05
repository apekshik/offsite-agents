// Clothes and accessories made of look pieces (contracts look.ts), fitted to a body's own
// proportions: sunglasses, hats and caps, headphones, a Hawaiian shirt, ship's whites, the
// captain's jacket, swimwear, bare legs. Presets (presets.ts) and the random crew dress with
// these; a designed look can use them as a starting point.

import type { AvatarSpec, LookPiece } from "@offsite/contracts";
import { HEAD_FIT } from "./avatar.ts";
import type { Vec3 } from "./sanitize.ts";

type P = LookPiece;
type Bone = LookPiece["bone"];
const piece = (bone: Bone, shape: P["shape"], pos: Vec3, size: Vec3, color: string, extra: Record<string, unknown> = {}, rot?: Vec3): P =>
  ({ bone, shape, pos, size, color, ...(rot ? { rot } : {}), ...extra }) as P;
const mirror = (fn: (s: -1 | 1, b: "r" | "l") => P[]) => [...fn(-1, "r"), ...fn(1, "l")];

/** The default figure's measurements for a spec (avatar.ts builds the body from the same). */
export function bodyFit(spec: AvatarSpec) {
  const w = ({ slim: 0.88, normal: 1, bulky: 1.22 } as const)[spec.build] * spec.bulk;
  const dz = Math.sqrt(spec.bulk), hw = Math.sqrt(spec.bulk), vee = Math.pow(spec.bulk, 0.25);
  const T = spec.torso, L = spec.legs, A = spec.arms;
  const head = HEAD_FIT[spec.head];
  return {
    w, dz, hw, vee, T, head,
    thigh: 0.43 * L, shin: 0.41 * L, upper: 0.29 * A, fore: 0.27 * A,
    /** Front of the chest's upper and lower boxes, and their middles and half-heights. */
    chestFront: 0.11 * dz, bellyFront: 0.095 * dz, chestY: 0.09 * T, chestH: 0.16 * T, bellyY: -0.12 * T, bellyH: 0.12 * T,
    shoulderX: 0.19 * w * vee + 0.055, shoulderY: 0.23 * T, chestHalfW: 0.19 * w * vee,
    /** Where the hair's crown sits (hats go on top of it). */
    crown: spec.hair === "none" || spec.head === "tv" || spec.head === "helmet" ? head.top : head.top + 0.02,
  };
}
type Fit = ReturnType<typeof bodyFit>;

// ---------- the face ----------

export function sunglasses(spec: AvatarSpec, { frame = "#1b1d22", lens = "#11141a", style = "square" as "square" | "round" | "aviator" | "sport" } = {}): P[] {
  const h = HEAD_FIT[spec.head], y = h.faceY + 0.004, z = h.front + 0.013;
  const out: P[] = [];
  if (style === "sport") {
    out.push(piece("head", "box", [0, y, z], [h.halfW * 1.95, 0.065, 0.02], lens, { round: 0.3 }));
    out.push(piece("head", "box", [0, y + 0.035, z], [h.halfW * 1.95, 0.012, 0.024], frame, { round: 0.2 }));
  } else {
    for (const s of [-1, 1]) {
      const shape = style === "round" ? "cylinder" : "box";
      const size: Vec3 = style === "round" ? [0.085, 0.02, 0.085] : style === "aviator" ? [0.092, 0.07, 0.016] : [0.1, 0.062, 0.018];
      const rot: Vec3 | undefined = style === "round" ? [90, 0, 0] : undefined;
      out.push(piece("head", shape, [s * 0.07, y, z], size, lens, style === "aviator" ? { taper: 1.35, round: 0.35 } : { round: 0.2 }, rot));
      if (style !== "round") out.push(piece("head", "box", [s * 0.07, y + 0.034, z + 0.002], [0.104, 0.012, 0.02], frame, { round: 0.3 }));
    }
    out.push(piece("head", "box", [0, y + 0.014, z], [0.05, 0.012, 0.012], frame));
  }
  for (const s of [-1, 1]) out.push(piece("head", "box", [s * (h.halfW + 0.008), y + 0.02, h.front - 0.11], [0.012, 0.014, 0.22], frame));
  return out;
}

export function beard(spec: AvatarSpec, color = spec.hairColor, full = true): P[] {
  const h = HEAD_FIT[spec.head];
  const out = [piece("head", "box", [0, h.faceY - 0.075, h.front + 0.006], [0.1, 0.022, 0.02], color, { round: 0.3 })]; // moustache
  if (full) {
    out.push(piece("head", "box", [0, h.faceY - 0.14, h.front - 0.02], [h.halfW * 2 + 0.01, 0.1, 0.07], color, { round: 0.4 }));
    for (const s of [-1, 1]) out.push(piece("head", "box", [s * (h.halfW - 0.005), h.faceY - 0.08, h.front - 0.07], [0.03, 0.15, 0.12], color, { round: 0.3 }));
  }
  return out;
}

// ---------- hats ----------

/** A peaked cap: white crown, dark band and visor, a gold badge. The captain's has gold braid. */
export function peakedCap(spec: AvatarSpec, { captain = false, crown = "#f6f6f2", band = "#1a2440" } = {}): P[] {
  const f = bodyFit(spec), h = f.head, y = f.crown, r = h.halfW * 2 + 0.06;
  const out = [
    piece("head", "cylinder", [0, y + 0.035, -0.005], [r * 0.98, 0.07, r * 0.98], band),
    piece("head", "cylinder", [0, y + 0.1, -0.012], [r * 1.12, 0.07, r * 1.1], crown, { taper: 1.18 }),
    piece("head", "cylinder", [0, y + 0.138, -0.015], [r * 1.16, 0.012, r * 1.14], crown),
    piece("head", "cylinder", [0, y + 0.01, h.front + 0.02], [r * 0.8, 0.014, 0.17], "#111318", {}, [14, 0, 0]),
    piece("head", "box", [0, y + 0.045, h.front + 0.03], [0.05, 0.045, 0.015], "#e2b64a", { round: 0.3, glow: captain }),
  ];
  if (captain) out.push(piece("head", "box", [0, y + 0.022, h.front + 0.035], [r * 0.62, 0.012, 0.012], "#e2b64a"));
  return out;
}

export function sunHat(spec: AvatarSpec, { straw = "#e8cf94", ribbon = "#ff6b6b", brim = 0.62 } = {}): P[] {
  const f = bodyFit(spec), y = f.crown, r = f.head.halfW * 2 + 0.03;
  return [
    piece("head", "cylinder", [0, y + 0.0, -0.01], [brim, 0.014, brim], straw, { sides: 24 }, [-6, 0, 0]),
    piece("head", "cylinder", [0, y + 0.06, -0.015], [r, 0.12, r], straw, { taper: 0.82 }),
    piece("head", "cylinder", [0, y + 0.025, -0.015], [r * 1.02, 0.035, r * 1.02], ribbon),
  ];
}

export function bucketHat(spec: AvatarSpec, color = "#e9e2cf"): P[] {
  const f = bodyFit(spec), y = f.crown, r = f.head.halfW * 2 + 0.04;
  return [
    piece("head", "cylinder", [0, y - 0.01, -0.01], [r * 1.38, 0.07, r * 1.38], color, { taper: 0.72 }),
    piece("head", "cylinder", [0, y + 0.06, -0.01], [r, 0.1, r], color, { taper: 0.9 }),
  ];
}

export function baseballCap(spec: AvatarSpec, { color = "#ff6b3d", backwards = false } = {}): P[] {
  const f = bodyFit(spec), h = f.head, y = f.crown, r = h.halfW * 2 + 0.04, dir = backwards ? -1 : 1;
  return [
    piece("head", "sphere", [0, y - 0.04, -0.01], [r, 0.2, r * 1.02], color),
    piece("head", "box", [0, y - 0.005, dir * (h.front + 0.06)], [r * 0.7, 0.014, 0.15], color, { round: 0.4 }, [dir * 8, 0, 0]),
    piece("head", "sphere", [0, y + 0.085, -0.01], [0.03, 0.02, 0.03], color),
  ];
}

export function visor(spec: AvatarSpec, color = "#ffffff"): P[] {
  const f = bodyFit(spec), h = f.head, y = f.crown - 0.06, r = h.halfW * 2 + 0.035;
  return [
    piece("head", "torus", [0, y, -0.005], [r, 0.05, r * 1.02], color),
    piece("head", "box", [0, y - 0.01, h.front + 0.06], [r * 0.75, 0.012, 0.14], color, { round: 0.4 }, [10, 0, 0]),
  ];
}

export function headphones(spec: AvatarSpec, { color = "#20232b", pads = "#4fe3ff" } = {}): P[] {
  const f = bodyFit(spec), h = f.head, cy = h.faceY, R = f.crown - cy + 0.035;
  const out: P[] = [];
  for (const a of [-72, -43, -14, 14, 43, 72]) {
    const t = (a * Math.PI) / 180;
    out.push(piece("head", "box", [Math.sin(t) * R, cy + Math.cos(t) * R, -0.01], [0.115, 0.026, 0.04], color, { round: 0.4 }, [0, 0, -a]));
  }
  for (const s of [-1, 1]) {
    out.push(piece("head", "cylinder", [s * (h.halfW + 0.03), cy - 0.01, -0.01], [0.13, 0.055, 0.13], color, {}, [0, 0, 90]));
    out.push(piece("head", "cylinder", [s * (h.halfW + 0.058), cy - 0.01, -0.01], [0.08, 0.008, 0.08], pads, { glow: true }, [0, 0, 90]));
  }
  return out;
}

// ---------- tops ----------

const FLOWERS: [number, number][] = [[-0.11, 0.06], [0.06, 0.11], [0.13, -0.02], [-0.03, -0.04], [-0.13, -0.16], [0.08, -0.15], [0.0, -0.25], [-0.09, -0.31], [0.12, -0.3]];

/** Flowers and leaves over the shirt (the spec's top colour), an open collar, short sleeves. */
export function hawaiianShirt(spec: AvatarSpec, { flowers = ["#ffd23f", "#ff5d8f", "#ffffff"], leaf = "#2f9e6e" } = {}): P[] {
  const f = bodyFit(spec), out: P[] = [];
  FLOWERS.forEach(([x, y], i) => {
    const upper = y > -0.03;
    const yy = y * f.T, zf = upper ? f.chestFront : f.bellyFront;
    const xx = x * f.w * (upper ? f.vee : 0.8);
    const c = flowers[i % flowers.length]!;
    for (const side of [1, -1]) {
      const z = side * (zf + 0.004);
      out.push(piece("chest", "cylinder", [xx, yy, z], [0.06, 0.008, 0.06], c, { sides: 6 }, [90, 0, 0]));
      out.push(piece("chest", "box", [xx + 0.035, yy - 0.025, z], [0.06, 0.024, 0.008], leaf, { round: 0.4 }, [0, 0, 35 + i * 20]));
    }
  });
  // Open collar: a V of skin, the collar folded out either side.
  out.push(piece("chest", "box", [0, 0.215 * f.T, f.chestFront + 0.003], [0.075, 0.075, 0.008], spec.skin, { round: 0.1 }, [0, 0, 45]));
  for (const s of [-1, 1]) out.push(piece("chest", "box", [s * 0.055, 0.235 * f.T, f.chestFront + 0.008], [0.06, 0.035, 0.012], spec.top, { round: 0.3 }, [0, 0, s * 30]));
  for (let i = 0; i < 3; i++) out.push(piece("chest", "sphere", [0, (0.1 - i * 0.11) * f.T, (i ? f.bellyFront : f.chestFront) + 0.006], [0.016, 0.016, 0.01], "#f4efe2"));
  return out;
}

/** Ship's whites: epaulettes, a name badge, a collar. The spec's top should be white. */
export function crewWhites(spec: AvatarSpec, { braid = "#e2b64a", board = "#1a2440" } = {}): P[] {
  const f = bodyFit(spec), out: P[] = [];
  for (const s of [-1, 1]) {
    out.push(piece("chest", "box", [s * (f.chestHalfW - 0.05), 0.245 * f.T, 0], [0.1, 0.018, 0.08], board, { round: 0.3 }));
    out.push(piece("chest", "box", [s * (f.chestHalfW - 0.05), 0.256 * f.T, 0], [0.08, 0.006, 0.07], braid));
    out.push(piece("chest", "box", [s * 0.05, 0.235 * f.T, f.chestFront + 0.006], [0.06, 0.04, 0.012], "#ffffff", { round: 0.3 }, [0, 0, s * 25]));
  }
  out.push(piece("chest", "box", [0.09 * f.w, 0.13 * f.T, f.chestFront + 0.005], [0.07, 0.022, 0.01], braid, { round: 0.2 }));
  for (let i = 0; i < 3; i++) out.push(piece("chest", "sphere", [0, (0.14 - i * 0.12) * f.T, (i > 1 ? f.bellyFront : f.chestFront) + 0.006], [0.014, 0.014, 0.008], "#d9dde3"));
  return out;
}

/**
 * The captain's jacket over the spec's top (navy): long sleeves with three gold stripes and
 * white shirt cuffs, lapels over a white shirt, gold buttons.
 */
export function captainJacket(spec: AvatarSpec, { cloth = spec.top, gold = "#e2b64a", shirt = "#f7f7f4" } = {}): P[] {
  const f = bodyFit(spec), out: P[] = [];
  out.push(...mirror((s, b) => [
    piece(`forearm_${b}`, "capsule", [0, -f.fore / 2 + 0.01, 0], [0.122 * f.w, f.fore - 0.02, 0.122 * f.w], cloth),
    piece(`forearm_${b}`, "cylinder", [0, -f.fore + 0.012, 0], [0.105 * f.w, 0.03, 0.105 * f.w], shirt),
    ...[0, 1, 2].map((i) => piece(`forearm_${b}`, "cylinder", [0, -f.fore + 0.055 + i * 0.026, 0], [0.128 * f.w, 0.011, 0.128 * f.w], gold)),
    piece("chest", "box", [s * 0.06, 0.14 * f.T, f.chestFront + 0.008], [0.065, 0.2 * f.T, 0.014], "#141c33", { round: 0.2 }, [0, 0, -s * 18]),
  ]));
  out.push(piece("chest", "box", [0, 0.17 * f.T, f.chestFront + 0.004], [0.075, 0.15 * f.T, 0.008], shirt));
  out.push(piece("chest", "box", [0, 0.15 * f.T, f.chestFront + 0.009], [0.022, 0.1 * f.T, 0.008], "#0f1526"));
  for (const s of [-1, 1]) for (let i = 0; i < 2; i++) out.push(piece("chest", "sphere", [s * 0.055, (-0.02 - i * 0.12) * f.T, (i ? f.bellyFront : f.chestFront) + 0.006], [0.02, 0.02, 0.012], gold));
  return out;
}

/** A one-piece swimsuit or a bare chest: arms bare to the shoulder. */
export function bareArms(spec: AvatarSpec): P[] {
  const f = bodyFit(spec);
  return mirror((_, b) => [piece(`upper_arm_${b}`, "capsule", [0, -f.upper / 2 + 0.012, 0], [0.118 * f.w, f.upper + 0.04, 0.118 * f.w], spec.skin)]);
}

/** Shorts: shins bare. With `thighs`, swimwear: thighs bare too. */
export function bareLegs(spec: AvatarSpec, { thighs = false } = {}): P[] {
  const f = bodyFit(spec);
  return mirror((_, b) => [
    piece(`shin_${b}`, "capsule", [0, -f.shin / 2 - 0.0, 0], [0.132 * f.w, f.shin + 0.07, 0.132 * f.w], spec.skin),
    ...(thighs ? [piece(`thigh_${b}`, "capsule", [0, -f.thigh / 2 - 0.06, 0], [0.156 * f.w, f.thigh + 0.08, 0.156 * f.w], spec.skin)] : []),
  ]);
}

/** Shoes over the feet: white sneakers, sandals (bare feet with a strap), bare feet. */
export function footwear(spec: AvatarSpec, kind: "sneakers" | "sandals" | "bare" = "sneakers", color = "#f4f4f2"): P[] {
  const f = bodyFit(spec);
  return mirror((_, b) => {
    const foot: Vec3 = [0.122 * f.w, 0.09, 0.255 * f.hw];
    const at: Vec3 = [0, -0.01, 0.035 * f.hw];
    if (kind === "sneakers") return [
      piece(`foot_${b}`, "box", at, foot, color, { round: 0.12 }),
      piece(`foot_${b}`, "box", [0, -0.047, at[2]], [foot[0] + 0.006, 0.02, foot[2] + 0.008], "#d9dde3", { round: 0.2 }),
    ];
    const out = [piece(`foot_${b}`, "box", at, foot, spec.skin, { round: 0.12 })];
    if (kind === "sandals") out.push(piece(`foot_${b}`, "box", [0, -0.05, at[2]], [foot[0] + 0.01, 0.014, foot[2] + 0.01], color, { round: 0.3 }), piece(`foot_${b}`, "box", [0, 0.0, at[2] + 0.04], [foot[0] + 0.006, 0.02, 0.03], color));
    return out;
  });
}

/** A flower garland round the neck. */
export function lei(spec: AvatarSpec, colors = ["#ff5d8f", "#ffd23f", "#ff8a3d", "#ffffff"]): P[] {
  const f = bodyFit(spec), out: P[] = [];
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const x = Math.sin(a) * (0.12 * f.w + 0.02), z = Math.cos(a) * (f.chestFront + 0.005);
    const y = 0.23 * f.T - Math.max(0, Math.cos(a)) * 0.07;
    out.push(piece("chest", "sphere", [x, y, z], [0.05, 0.04, 0.05], colors[i % colors.length]!, { sides: 6 }));
  }
  return out;
}

export function goldChain(spec: AvatarSpec): P[] {
  const f = bodyFit(spec);
  return [piece("chest", "torus", [0, 0.2 * f.T, 0.03], [0.2 * f.w, 0.02, 0.22 * f.dz], "#e8c25a", {}, [-28, 0, 0])];
}

/** Horizontal stripes across the top. */
export function stripes(spec: AvatarSpec, color = "#ffffff", n = 4): P[] {
  const f = bodyFit(spec), out: P[] = [];
  for (let i = 0; i < n; i++) {
    const y = f.chestY + f.chestH - 0.05 - i * 0.075 * f.T;
    const upper = y > f.chestY - f.chestH;
    out.push(piece("chest", "box", [0, y, 0], [upper ? 0.385 * f.w * f.vee : 0.295 * f.w, 0.028, (upper ? 0.225 : 0.195) * f.dz], color, { round: 0.02 }));
  }
  return out;
}

/** A skirt or sundress below the waist. */
export function skirt(spec: AvatarSpec, color = spec.bottom, length = 0.5): P[] {
  const f = bodyFit(spec);
  return [piece("hips", "cylinder", [0, -length / 2 + 0.06, 0], [0.5 * f.w, length, 0.42 * f.dz], color, { taper: 0.55 })];
}

/** Sunglasses pushed up on the head. */
export function shadesUp(spec: AvatarSpec, color = "#1b1d22"): P[] {
  const f = bodyFit(spec), h = f.head;
  return [0, 1].flatMap((i) => [piece("head", "box", [(i ? 1 : -1) * 0.07, f.crown - 0.025, h.front - 0.03], [0.1, 0.055, 0.018], color, { round: 0.3 }, [-35, 0, 0])]);
}
