// Ready-made crew, the captain, and a random crew member from a seed. A mix of ship's whites
// (white shirt, navy shorts, white cap) and vacation-at-work looks (sunglasses, sun hats,
// swimwear, a Hawaiian shirt, headphones), on the blocky default figure.

import { DEFAULT_AVATAR, type AvatarSpec, type Look, type LookPiece } from "@offsite/contracts";
import { LOOK_PARTS } from "./sanitize.ts";
import {
  bareArms, bareLegs, baseballCap, beard, bucketHat, captainJacket, crewWhites, footwear, goldChain, hawaiianShirt, headphones, lei,
  peakedCap, shadesUp, skirt, stripes, sunHat, sunglasses, visor,
} from "./wear.ts";

export interface AvatarPreset {
  id: string;
  name: string;
  /** One line for the picker. */
  blurb: string;
  spec: AvatarSpec;
  look: Look | null;
}

const NAVY = "#1d2a4d", WHITE = "#f3f4f1";

const spec = (s: Partial<AvatarSpec>): AvatarSpec => ({ ...DEFAULT_AVATAR, ...s });

// A look that keeps the spec's own parts (hair, head, face) and adds pieces over them.
function dressed(name: string, s: AvatarSpec, pieces: LookPiece[]): Look {
  const base: Partial<AvatarSpec> = {};
  for (const k of LOOK_PARTS) (base as Record<string, unknown>)[k] = s[k];
  return { meta: { name, base }, pieces };
}

function preset(id: string, name: string, blurb: string, s: Partial<AvatarSpec>, wear: (s: AvatarSpec) => LookPiece[]): AvatarPreset {
  const sp = spec(s);
  const pieces = wear(sp);
  return { id, name, blurb, spec: sp, look: pieces.length ? dressed(name, sp, pieces) : null };
}

/** Ship's whites: white shirt, navy shorts, white cap, white sneakers. */
const whites = (s: AvatarSpec) => [...crewWhites(s), ...peakedCap(s), ...bareLegs(s), ...footwear(s, "sneakers")];

export const CAPTAIN_PRESET: AvatarPreset = preset(
  "captain", "Captain", "Navy jacket, gold stripes, the white cap.",
  { hair: "short", hairColor: "#3a2a1e", skin: "#e8b894", top: NAVY, bottom: NAVY, accent: "#e2b64a", face: "smile", height: 0.9 },
  (s) => [...captainJacket(s), ...peakedCap(s, { captain: true }), ...footwear(s, "sneakers", "#f7f7f4")],
);

export const CREW_PRESETS: AvatarPreset[] = [
  preset("juniper", "Juniper", "Wide straw hat, round shades, laptop on the lounger.",
    { hair: "long", hairColor: "#2a1b14", skin: "#c98e66", top: "#ff7a6b", bottom: "#f4efe2", accent: "#ffd23f", height: 0.9, build: "slim", face: "smile" },
    (s) => [...sunHat(s, { ribbon: "#ff5d8f" }), ...sunglasses(s, { style: "round", frame: "#c9a24a" }), ...bareLegs(s), ...footwear(s, "sandals", "#c9a24a")]),
  preset("otis", "Otis", "Hawaiian shirt, aviators, never in a hurry.",
    { hair: "short", hairColor: "#5a3a22", skin: "#e2a77f", top: "#1fb5a8", bottom: "#d8c49a", accent: "#ffd23f", height: 0.95, build: "bulky", bulk: 1.05 },
    (s) => [...hawaiianShirt(s), ...sunglasses(s, { style: "aviator", frame: "#d4af4f", lens: "#2b2f38" }), ...beard(s), ...bareLegs(s), ...footwear(s, "sandals", "#6b4a2e")]),
  preset("wren", "Wren", "Headphones on, deep in the code.",
    { hair: "bun", hairColor: "#c8643b", skin: "#f1c9a5", top: "#9b8cff", bottom: "#2a2f3d", accent: "#4fe3ff", height: 0.88, face: "dots" },
    (s) => [...headphones(s, { color: "#f2f2f4", pads: "#9b8cff" }), ...footwear(s, "sneakers", "#ffffff")]),
  preset("kofi", "Kofi", "Ship's whites, first mate's stripes.",
    { hair: "short", hairColor: "#141010", skin: "#6b4430", top: WHITE, bottom: NAVY, accent: "#e2b64a", height: 0.97, face: "smile" },
    whites),
  preset("marlo", "Marlo", "Ship's whites and sports shades.",
    { hair: "spiky", hairColor: "#e8c46a", skin: "#f0c8a8", top: WHITE, bottom: NAVY, accent: "#4fe3ff", height: 0.92 },
    (s) => [...whites(s), ...sunglasses(s, { style: "sport", lens: "#1d6f9e" })]),
  preset("ines", "Ines", "Swimsuit, shades on her head, straight to the pool.",
    { hair: "long", hairColor: "#1e1410", skin: "#d9a07a", top: "#ff5d8f", bottom: "#ff5d8f", accent: "#ffd23f", height: 0.88, build: "slim" },
    (s) => [...bareArms(s), ...bareLegs(s, { thighs: true }), ...footwear(s, "bare"), ...shadesUp(s)]),
  preset("bodhi", "Bodhi", "Board shorts, a lei, topknot.",
    { hair: "topknot", hairColor: "#2b1d14", skin: "#b9805a", top: "#b9805a", bottom: "#ff8a3d", accent: "#ffd23f", height: 0.96, face: "smile" },
    (s) => [...lei(s), ...bareLegs(s, { thighs: false }), ...footwear(s, "bare")]),
  preset("nova", "Nova", "A robot on holiday, headphones and a loud shirt.",
    { head: "tv", face: "smile", hair: "none", skin: "#c9d3dd", top: "#8a5cff", bottom: "#2a2f3d", accent: "#6dffa8", height: 0.9 },
    (s) => [...hawaiianShirt(s, { flowers: ["#6dffa8", "#ffd23f", "#4fe3ff"], leaf: "#1d7a57" }), ...headphones(s, { color: "#20232b", pads: "#6dffa8" })]),
  preset("sable", "Sable", "Bucket hat, sport shades, gold chain.",
    { hair: "short", hairColor: "#0f0c0a", skin: "#8a5a3c", top: "#22252c", bottom: "#5b6b4a", accent: "#e8c25a", height: 0.94 },
    (s) => [...bucketHat(s, "#e9e2cf"), ...sunglasses(s, { style: "sport", lens: "#3a2a5e" }), ...goldChain(s), ...bareLegs(s), ...footwear(s, "sneakers", "#e7e2d6")]),
  preset("teo", "Teo", "Cap on backwards, striped tank, beard.",
    { hair: "short", hairColor: "#3b2416", skin: "#e8b894", top: "#2d6fd4", bottom: "#f2e6c8", accent: "#ff6b3d", height: 0.96, face: "smile" },
    (s) => [...baseballCap(s, { color: "#ff6b3d", backwards: true }), ...stripes(s), ...beard(s, s.hairColor, false), ...bareArms(s), ...bareLegs(s), ...footwear(s, "sandals", "#2a2f3d")]),
  preset("coral", "Coral", "A cat in a sun visor.",
    { head: "cat", hair: "none", skin: "#f2b37a", top: "#ffb3c7", bottom: "#ffffff", accent: "#ff5d8f", height: 0.82, face: "smile" },
    (s) => [...visor(s, "#ffffff"), ...sunglasses(s, { style: "round", frame: "#ff5d8f", lens: "#2a1f33" }), ...footwear(s, "sneakers", "#ffffff")]),
  preset("pike", "Pike", "Behind the bar, in whites.",
    { hair: "short", hairColor: "#6b6b6b", skin: "#f0c8a8", top: WHITE, bottom: NAVY, accent: "#e2b64a", height: 0.93, build: "bulky", face: "smile" },
    (s) => [...crewWhites(s), ...beard(s, "#8a8a8a"), ...footwear(s, "sneakers", "#1d2a4d")]),
  preset("lumi", "Lumi", "Sundress and a sun hat.",
    { hair: "long", hairColor: "#f0d08a", skin: "#f6d2b5", top: "#7ee0c6", bottom: "#7ee0c6", accent: "#ffffff", height: 0.86, build: "slim", face: "smile" },
    (s) => [...sunHat(s, { straw: "#f3e2b0", ribbon: "#7ee0c6", brim: 0.56 }), ...skirt(s, s.top, 0.48), ...bareArms(s), ...bareLegs(s), ...footwear(s, "sandals", "#f2e6c8")]),
];

// ---------- random crew ----------

function rng(seed: number) {
  let a = seed >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hashString = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };

const SKINS = ["#f6d2b5", "#f0c8a8", "#e8b894", "#d9a07a", "#c98e66", "#a8714c", "#8a5a3c", "#6b4430"];
const HAIRS = ["#141010", "#2b1d14", "#5a3a22", "#8a5a2b", "#c8643b", "#e8c46a", "#d9d2c5", "#ff7aa8", "#4fb3ff"];
const TOPS = ["#ff7a6b", "#1fb5a8", "#9b8cff", "#ffd23f", "#ff8a3d", "#7ee0c6", "#2d6fd4", "#ffb3c7", "#22252c", "#f3f4f1"];
const BOTTOMS = ["#1d2a4d", "#2a2f3d", "#d8c49a", "#f4efe2", "#5b6b4a", "#3d6fd4", "#ff8a3d"];

/** A crew member from a seed (a number, or their id): the same seed always gives the same person. */
export function randomCrewAvatar(seed: number | string): { spec: AvatarSpec; look: Look | null } {
  const r = rng(typeof seed === "string" ? hashString(seed) : seed);
  const pick = <T,>(a: readonly T[]) => a[Math.floor(r() * a.length)]!;
  const uniform = r() < 0.35;
  const whimsy = r();
  const s = spec({
    head: whimsy < 0.06 ? "cat" : whimsy < 0.1 ? "tv" : r() < 0.6 ? "box" : "round",
    hair: pick(["short", "short", "long", "bun", "topknot", "spiky"] as const),
    face: r() < 0.55 ? "smile" : "dots",
    build: pick(["slim", "normal", "normal", "bulky"] as const),
    skin: pick(SKINS),
    hairColor: pick(HAIRS),
    top: uniform ? "#f3f4f1" : pick(TOPS),
    bottom: uniform ? "#1d2a4d" : pick(BOTTOMS),
    accent: pick(["#4fe3ff", "#ffd23f", "#ff5d8f", "#6dffa8", "#e2b64a"]),
    height: Math.round((0.84 + r() * 0.14) * 100) / 100,
    headSize: Math.round((0.95 + r() * 0.15) * 100) / 100,
  });
  if (s.head === "cat") { s.hair = "none"; s.skin = pick(["#f2b37a", "#c9c2b8", "#3a3330", "#f4f1ec"]); }
  if (s.head === "tv") { s.hair = "none"; s.skin = "#c9d3dd"; }
  const pieces: LookPiece[] = [];
  if (uniform) pieces.push(...whites(s));
  else {
    const hat = r();
    if (hat < 0.2) pieces.push(...sunHat(s, { ribbon: pick(TOPS) }));
    else if (hat < 0.32) pieces.push(...bucketHat(s, pick(["#e9e2cf", "#f3f4f1", "#ffd23f"])));
    else if (hat < 0.44) pieces.push(...baseballCap(s, { color: pick(TOPS), backwards: r() < 0.5 }));
    else if (hat < 0.5) pieces.push(...visor(s));
    if (r() < 0.5 && hat >= 0.5) pieces.push(...headphones(s, { color: pick(["#20232b", "#f2f2f4"]), pads: s.accent }));
    if (r() < 0.55) pieces.push(...sunglasses(s, { style: pick(["square", "round", "aviator", "sport"] as const), frame: pick(["#1b1d22", "#d4af4f", "#ff5d8f", "#f2f2f4"]) }));
    if (r() < 0.25) pieces.push(...hawaiianShirt(s, { flowers: [pick(TOPS), "#ffffff", pick(TOPS)] }));
    else if (r() < 0.2) pieces.push(...stripes(s, "#ffffff"));
    if (r() < 0.1) pieces.push(...lei(s));
    if (s.hair !== "none" && r() < 0.18) pieces.push(...beard(s, s.hairColor, r() < 0.6));
    if (r() < 0.6) pieces.push(...bareLegs(s));
    pieces.push(...footwear(s, pick(["sneakers", "sandals", "sneakers"] as const), pick(["#f4f4f2", "#2a2f3d", "#c9a24a"])));
  }
  return { spec: s, look: pieces.length ? dressed("Crew", s, pieces) : null };
}
