import { z } from "zod";

// How a crew member (or the captain) looks. Two layers, from Ready Player One:
// - AvatarSpec: the default figure's parts, colours and proportions, made in the customizer.
// - Look: an optional designed look, primitive pieces pinned to the skeleton's bones, so it walks,
//   sits, swims and lounges like everyone else.
// Both are plain data. @offsite/kit's buildAvatar(spec, look) draws them, and its sanitizers
// (ported from Ready Player One's shared/schema.js) clamp every number before drawing.

export const AVATAR_PARTS = {
  outfit: ["none", "samurai", "cyborg", "astronaut", "knight", "runner", "mage"],
  hair: ["short", "long", "topknot", "spiky", "bun", "none"],
  head: ["box", "round", "tv", "helmet", "cat"],
  hat: ["none", "crown", "wizard", "antenna", "horns", "halo", "mohawk"],
  face: ["dots", "smile", "visor", "cyclops", "none"],
  back: ["none", "cape", "wings", "jetpack"],
  build: ["slim", "normal", "bulky"],
} as const;

export const AVATAR_COLORS = ["skin", "hairColor", "top", "bottom", "accent"] as const;

/** Body proportions as multiples of the default figure, with their limits. height 1 ≈ 1.92 m. */
export const AVATAR_BODY = {
  height: [0.35, 1.4],
  legs: [0.4, 1.7],
  arms: [0.5, 1.8],
  torso: [0.6, 1.6],
  bulk: [0.6, 2.2],
  headSize: [0.6, 2.2],
} as const;

const hex = z.string().regex(/^#[0-9a-f]{6}$/i);

export const AvatarSpec = z.object({
  outfit: z.enum(AVATAR_PARTS.outfit),
  hair: z.enum(AVATAR_PARTS.hair),
  head: z.enum(AVATAR_PARTS.head),
  hat: z.enum(AVATAR_PARTS.hat),
  face: z.enum(AVATAR_PARTS.face),
  back: z.enum(AVATAR_PARTS.back),
  build: z.enum(AVATAR_PARTS.build),
  skin: hex,
  hairColor: hex,
  top: hex,
  bottom: hex,
  accent: hex,
  height: z.number().min(AVATAR_BODY.height[0]).max(AVATAR_BODY.height[1]),
  legs: z.number().min(AVATAR_BODY.legs[0]).max(AVATAR_BODY.legs[1]),
  arms: z.number().min(AVATAR_BODY.arms[0]).max(AVATAR_BODY.arms[1]),
  torso: z.number().min(AVATAR_BODY.torso[0]).max(AVATAR_BODY.torso[1]),
  bulk: z.number().min(AVATAR_BODY.bulk[0]).max(AVATAR_BODY.bulk[1]),
  headSize: z.number().min(AVATAR_BODY.headSize[0]).max(AVATAR_BODY.headSize[1]),
});
export type AvatarSpec = z.infer<typeof AvatarSpec>;

export const DEFAULT_AVATAR: AvatarSpec = {
  outfit: "none", hair: "short", head: "box", hat: "none", face: "dots", back: "none", build: "normal",
  skin: "#e8b894", hairColor: "#2b1d14", top: "#3d6fd4", bottom: "#2a2f3d", accent: "#2dd4bf",
  height: 1, legs: 1, arms: 1, torso: 1, bulk: 1, headSize: 1,
};

/** _r is the avatar's right (its -x side; it faces +z), _l its left. */
export const LOOK_BONES = [
  "hips", "chest", "head",
  "upper_arm_r", "upper_arm_l", "forearm_r", "forearm_l", "hand_r", "hand_l",
  "thigh_r", "thigh_l", "shin_r", "shin_l", "foot_r", "foot_l",
] as const;
export const LOOK_SHAPES = ["box", "sphere", "cylinder", "cone", "torus", "wedge", "capsule", "hull", "extrude", "lathe"] as const;
export const LOOK_LIMITS = { maxPieces: 90, maxSize: 1.2, maxReach: 1.1 } as const;

const vec3 = z.tuple([z.number(), z.number(), z.number()]);

/** One primitive pinned to a bone. Optional knobs (sides, taper, round, bevel…) are clamped by the kit. */
export const LookPiece = z.object({
  bone: z.enum(LOOK_BONES),
  shape: z.enum(LOOK_SHAPES),
  pos: vec3,
  size: vec3,
  rot: vec3.optional(),
  color: hex,
}).passthrough();
export type LookPiece = z.infer<typeof LookPiece>;

export const Look = z.object({
  meta: z.object({
    name: z.string().max(40).optional(),
    /** The default figure under the pieces. Parts it does not name are off. */
    base: AvatarSpec.partial().optional(),
    /** Default figure parts the pieces replace: head, torso, arms, legs. */
    hide: z.array(z.enum(["head", "torso", "arms", "legs"])).max(4).optional(),
  }).passthrough(),
  pieces: z.array(LookPiece).max(LOOK_LIMITS.maxPieces),
});
export type Look = z.infer<typeof Look>;
