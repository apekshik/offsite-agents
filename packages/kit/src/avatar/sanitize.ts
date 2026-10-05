// Adapted from Ready Player One (github.com/apekshik/ready-player-one).
//
// Looks are data from anywhere (the customizer, a look the runner designed, an old save), so
// every number is clamped and every name checked here before buildAvatar draws it. Shapes and
// limits are the contract's (@offsite/contracts look.ts).

import {
  AVATAR_BODY, AVATAR_COLORS, AVATAR_PARTS, DEFAULT_AVATAR, LOOK_BONES, LOOK_LIMITS, LOOK_SHAPES,
  type AvatarSpec, type Look,
} from "@offsite/contracts";
import type { PieceShape } from "./pieces.ts";

export type Vec3 = [number, number, number];
export type LookBone = (typeof LOOK_BONES)[number];
export type LookShape = (typeof LOOK_SHAPES)[number];
export const HIDEABLE = ["head", "torso", "arms", "legs"] as const;
export type Hideable = (typeof HIDEABLE)[number];
export const PIECE_ANIMS = ["spin", "sway", "bob", "pulse"] as const;
export type PieceAnim = { type: (typeof PIECE_ANIMS)[number]; axis: "x" | "y" | "z"; speed: number; amount: number; phase: number };

/** The default figure's parts a designed look keeps: they belong to the design. */
export const LOOK_PARTS = ["outfit", "hair", "head", "hat", "face", "back", "build"] as const;

/** A look piece, clamped. */
export interface Piece extends PieceShape {
  bone: LookBone;
  shape: LookShape;
  pos: Vec3;
  size: Vec3;
  rot: Vec3;
  color: string;
  glow?: boolean;
  flat?: boolean;
  opacity?: number;
  pivot?: Vec3;
  anim?: PieceAnim;
}

export interface SafeLook {
  meta: { name: string; say: string; hide: Hideable[]; base: AvatarSpec };
  pieces: Piece[];
}

const HEX = /^#[0-9a-f]{6}$/i;
export const isHex = (c: unknown): c is string => typeof c === "string" && HEX.test(c);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const num = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = Number(v);
  return v != null && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};
const round = (n: number, k = 1000) => Math.round(n * k) / k;
const vec3 = (v: unknown, lo: number, hi: number, dflt: Vec3): Vec3 =>
  Array.isArray(v) && v.length === 3 ? [round(num(v[0], lo, hi, dflt[0])), round(num(v[1], lo, hi, dflt[1])), round(num(v[2], lo, hi, dflt[2]))] : dflt;
const axis = (a: unknown): "x" | "y" | "z" => (a === "x" || a === "y" || a === "z" ? a : "y");
const oneOf = <T extends string>(list: readonly T[], v: unknown, dflt: T): T => (list.includes(v as T) ? (v as T) : dflt);

export function cleanText(s: unknown, max = 200): string {
  return String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
}

/** Any object into a valid AvatarSpec: unknown parts fall back to the default figure's. */
export function sanitizeAvatar(a: unknown): AvatarSpec {
  const src = obj(a);
  const out = { ...DEFAULT_AVATAR };
  out.outfit = oneOf(AVATAR_PARTS.outfit, src["outfit"], DEFAULT_AVATAR.outfit);
  out.hair = oneOf(AVATAR_PARTS.hair, src["hair"], DEFAULT_AVATAR.hair);
  out.head = oneOf(AVATAR_PARTS.head, src["head"], DEFAULT_AVATAR.head);
  out.hat = oneOf(AVATAR_PARTS.hat, src["hat"], DEFAULT_AVATAR.hat);
  out.face = oneOf(AVATAR_PARTS.face, src["face"], DEFAULT_AVATAR.face);
  out.back = oneOf(AVATAR_PARTS.back, src["back"], DEFAULT_AVATAR.back);
  out.build = oneOf(AVATAR_PARTS.build, src["build"], DEFAULT_AVATAR.build);
  for (const k of AVATAR_COLORS) { const c = src[k]; out[k] = isHex(c) ? c.toLowerCase() : DEFAULT_AVATAR[k]; }
  for (const k of Object.keys(AVATAR_BODY) as (keyof typeof AVATAR_BODY)[]) {
    const [lo, hi] = AVATAR_BODY[k];
    out[k] = round(num(src[k], lo, hi, 1), 100);
  }
  return out;
}

/** A look's meta. The parts it does not name are off (no default hair poking through hair it built from pieces). */
export function sanitizeLookMeta(m: unknown): SafeLook["meta"] {
  const src = obj(m);
  const hide = (Array.isArray(src["hide"]) ? src["hide"] : []).filter((h, i, a): h is Hideable => HIDEABLE.includes(h as Hideable) && a.indexOf(h) === i);
  const base = sanitizeAvatar({ outfit: "none", hair: "none", hat: "none", back: "none", ...obj(src["base"]) });
  return { name: cleanText(src["name"], 40) || "New look", say: cleanText(src["say"], 160), hide, base };
}

const FREEFORM: Record<string, { dims: number; min: number }> = { hull: { dims: 3, min: 4 }, extrude: { dims: 2, min: 3 }, lathe: { dims: 2, min: 2 } };
const MAX_POINTS = 24;

// A freeform shape's points, inside the unit box (lathe radii from 0), or null if too few are usable.
function shapePoints(shape: string, src: unknown): number[][] | null {
  const f = FREEFORM[shape];
  if (!f || !Array.isArray(src)) return null;
  const pts: number[][] = [];
  for (const q of src.slice(0, MAX_POINTS)) {
    if (!Array.isArray(q) || q.length !== f.dims || !q.every((n) => Number.isFinite(Number(n)))) continue;
    pts.push(q.map((n, i) => round(num(n, shape === "lathe" && i === 0 ? 0 : -0.5, 0.5, 0))));
  }
  return pts.length >= f.min ? pts : null;
}

/** One piece pinned to a bone, or null if it names no bone. */
export function sanitizePiece(p: unknown): Piece | null {
  const src = obj(p);
  if (!LOOK_BONES.includes(src["bone"] as LookBone)) return null;
  const R = LOOK_LIMITS.maxReach, S = LOOK_LIMITS.maxSize;
  let shape = oneOf(LOOK_SHAPES, src["shape"], "box");
  const points = FREEFORM[shape] ? shapePoints(shape, src["points"]) : null;
  if (FREEFORM[shape] && !points) shape = "box"; // not enough to make it from: a plain block stands in
  const piece: Piece = {
    bone: src["bone"] as LookBone,
    shape,
    pos: vec3(src["pos"], -R, R, [0, 0, 0]),
    size: vec3(src["size"], 0.005, S, [0.1, 0.1, 0.1]),
    rot: vec3(src["rot"], -360, 360, [0, 0, 0]),
    color: isHex(src["color"]) ? src["color"].toLowerCase() : "#cccccc",
  };
  if (points) piece.points = points;
  // The knobs: few sides make prisms and gems; taper narrows the top; round softens a box's
  // edges (0: hard plates); bevel and smooth soften freeform outlines; flat shades it faceted.
  if (["cylinder", "cone", "sphere", "lathe"].includes(shape) && src["sides"] != null) piece.sides = Math.round(num(src["sides"], 3, 32, 16));
  if (["box", "cylinder"].includes(shape) && src["taper"] != null && num(src["taper"], 0, 3, 1) !== 1) piece.taper = round(num(src["taper"], 0, 3, 1), 100);
  if (shape === "box" && src["round"] != null) piece.round = round(num(src["round"], 0, 0.5, 0.06), 100);
  if (shape === "extrude" && src["bevel"]) piece.bevel = round(num(src["bevel"], 0, 0.3, 0), 100);
  if ((shape === "extrude" || shape === "lathe") && src["smooth"]) piece.smooth = true;
  if (src["flat"]) piece.flat = true;
  if (src["glow"]) piece.glow = true;
  const op = num(src["opacity"], 0.1, 1, 1);
  if (op < 1) piece.opacity = op;
  if (Array.isArray(src["pivot"])) piece.pivot = vec3(src["pivot"], -R, R, piece.pos);
  const a = obj(src["anim"]);
  if (PIECE_ANIMS.includes(a["type"] as PieceAnim["type"])) {
    piece.anim = {
      type: a["type"] as PieceAnim["type"],
      axis: axis(a["axis"]),
      speed: num(a["speed"], -6, 6, 1),
      amount: num(a["amount"], 0, 90, 15),
      phase: num(a["phase"], -10, 10, 0),
    };
  }
  return piece;
}

/** A whole look, clamped; null when there is nothing to draw. */
export function sanitizeLook(look: Look | unknown): SafeLook | null {
  if (!look || typeof look !== "object") return null;
  const src = obj(look);
  const pieces = (Array.isArray(src["pieces"]) ? src["pieces"] : []).slice(0, LOOK_LIMITS.maxPieces).map(sanitizePiece).filter((p): p is Piece => !!p);
  return { meta: sanitizeLookMeta(src["meta"]), pieces };
}
