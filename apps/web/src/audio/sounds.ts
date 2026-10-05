import type { AudioFile } from "./files.ts";

// What each sound is made of and how it sits in the mix. The files are in apps/web/public/audio
// (made by scripts/audio/build.mjs, listed in files.ts); volumes here are the mix, 0..1.

interface Base {
  /** Variations: one is picked per play (seeded in deterministic mode). */
  files: readonly AudioFile[];
  volume: number;
}

interface Placed extends Base {
  /** Full volume within this many metres... */
  ref: number;
  /** ...falling off this fast past it (inverse distance)... */
  rolloff: number;
  /** ...and not played at all beyond this. */
  max: number;
  /** Cheaper stereo panning instead of HRTF, for small frequent sounds. */
  cheap?: boolean;
}

export interface EmitterDef extends Placed {}

export interface OneShotDef extends Placed {
  /** Pitch spread, in cents either way. */
  detune?: number;
  /** Most copies playing at once; more are dropped. */
  voices: number;
}

export interface UiDef extends Base {
  detune?: number;
  voices: number;
}

/** Loops at a place in the world, or following something (a helicopter). */
export const EMITTERS = {
  "bar-music": { files: ["bar-music"], volume: 0.5, ref: 4, rolloff: 1.4, max: 70 },
  "server-hum": { files: ["server-hum"], volume: 0.55, ref: 2.5, rolloff: 1.6, max: 30 },
  "hot-tub": { files: ["hot-tub"], volume: 0.45, ref: 2, rolloff: 1.6, max: 25 },
  "pool-swim": { files: ["pool-swim"], volume: 0.5, ref: 2.5, rolloff: 1.5, max: 30 },
  typing: { files: ["typing"], volume: 0.3, ref: 1.2, rolloff: 2, max: 12, cheap: true },
  "heli-rotor": { files: ["heli-rotor"], volume: 0.9, ref: 14, rolloff: 0.9, max: 700 },
  "heli-idle": { files: ["heli-idle"], volume: 0.8, ref: 10, rolloff: 1, max: 300 },
} as const satisfies Record<string, EmitterDef>;

/** Things that happen once, somewhere. */
export const ONE_SHOTS = {
  clink: { files: ["clink-cheers"], volume: 0.6, ref: 2, rolloff: 1.6, max: 30, voices: 3 },
  ice: { files: ["ice-glass"], volume: 0.5, ref: 1.5, rolloff: 1.8, max: 20, voices: 2, detune: 80 },
  cannonball: { files: ["cannonball"], volume: 0.8, ref: 4, rolloff: 1.2, max: 60, voices: 2, detune: 60 },
  "package-thump": { files: ["package-thump"], volume: 0.75, ref: 2, rolloff: 1.5, max: 30, voices: 2, detune: 50 },
  footstep: { files: ["step-1", "step-2", "step-3"], volume: 0.35, ref: 1, rolloff: 2, max: 12, voices: 8, detune: 120, cheap: true },
  gull: { files: ["gull-1", "gull-2", "gull-3", "gull-4"], volume: 0.45, ref: 8, rolloff: 1, max: 120, voices: 3, detune: 150 },
  "dolphin-splash": { files: ["dolphin-splash"], volume: 0.55, ref: 6, rolloff: 1, max: 90, voices: 2, detune: 100 },
  "heli-approach": { files: ["heli-approach"], volume: 1, ref: 14, rolloff: 0.9, max: 900, voices: 2 },
  "heli-takeoff": { files: ["heli-takeoff"], volume: 1, ref: 14, rolloff: 0.9, max: 900, voices: 2 },
} as const satisfies Record<string, OneShotDef>;

/** The phone and the interface: no position, always at your ear. */
export const UI_SOUNDS = {
  "phone-buzz": { files: ["phone-buzz"], volume: 0.55, voices: 1 },
  "fold-open": { files: ["fold-open"], volume: 0.5, voices: 1, detune: 30 },
  "fold-close": { files: ["fold-close"], volume: 0.5, voices: 1, detune: 30 },
  send: { files: ["send-tick"], volume: 0.4, voices: 2, detune: 40 },
  landed: { files: ["landed-chime"], volume: 0.5, voices: 1 },
} as const satisfies Record<string, UiDef>;

export type EmitterSound = keyof typeof EMITTERS;
export type OneShotSound = keyof typeof ONE_SHOTS;
export type UiSound = keyof typeof UI_SOUNDS;

/** The beds under everything, crossfaded by the time of day and how busy the ship is (mix.ts). */
export type Layer = "ocean" | "wind" | "night" | "typing" | "murmur" | "hum";

export const LAYERS: Record<Layer, { file: AudioFile; volume: number }> = {
  ocean: { file: "ocean", volume: 0.45 },
  wind: { file: "wind", volume: 0.3 },
  night: { file: "night", volume: 0.45 },
  typing: { file: "typing", volume: 0.18 },
  murmur: { file: "murmur", volume: 0.22 },
  hum: { file: "server-hum", volume: 0.12 },
};

/** Every file a sound uses, for preloading and the dev page. */
export function filesOf(def: { files: readonly AudioFile[] } | { file: AudioFile }): readonly AudioFile[] {
  return "files" in def ? def.files : [def.file];
}
