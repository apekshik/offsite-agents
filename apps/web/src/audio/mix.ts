import type { Layer } from "./sounds.ts";

// The ambience mix as plain numbers: how loud each bed is for a time of day and a busy level.
// Pure, so it can be tested and so the film rig gets the same mix for the same inputs.

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

/**
 * 0 by day, 1 at night, from the hour (0..24): full night from 21:00 to 04:30, full day from 07:30
 * to 17:30, eased in between. Prefer the sky's own `night` (YachtWorld.sky.state.night) when you
 * have it, so the sound turns with the light.
 */
export function nightFromHour(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  if (h < 12) return 1 - smooth(4.5, 7.5, h);
  return smooth(17.5, 21, h);
}

/** Each bed's level (0..1, before its own volume in LAYERS) for night (0..1) and busy (0..1). */
export function ambienceMix(night: number, busy: number): Record<Layer, number> {
  const n = clamp01(night), b = clamp01(busy), day = 1 - n;
  return {
    // The sea is always there; a touch louder at night when everything else is quiet.
    ocean: 0.8 + 0.2 * n,
    // Breeze by day, halyards and lapping water by night.
    wind: 0.25 + 0.6 * day,
    night: n,
    // Work: typing first, the murmur once a few are at it, Computah working harder.
    typing: Math.pow(b, 0.8),
    murmur: smooth(0.2, 1, b),
    hum: 0.15 + 0.85 * b,
  };
}

/**
 * Chances, per half-second, that a gull calls or a dolphin leaps somewhere near the listener.
 * Gulls keep to the daylight; dolphins go quiet at night.
 */
export function wildlifeChance(night: number): { gull: number; dolphin: number } {
  const day = 1 - clamp01(night);
  return { gull: 0.035 * day, dolphin: 0.008 * day };
}

/** How busy the ship is, for ambienceMix: the share of the crew at work, eased so a couple at work already registers. */
export function busyLevel(working: number, crew: number): number {
  if (crew <= 0 || working <= 0) return 0;
  return clamp01(Math.sqrt(working / Math.max(crew, 3)));
}
