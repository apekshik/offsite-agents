import { useSyncExternalStore } from "react";
import { AudioManager, type AudioSnapshot } from "./manager.ts";

// Offsite's sound. One manager for the whole app: the game places and plays sounds, the interface
// plays the phone's. Wiring: README.md in this folder.

export { AudioManager } from "./manager.ts";
export type { AudioOptions, AudioSnapshot, Emitter, PlayOptions, Where } from "./manager.ts";
export { flightPhase, type Flight, type FlightPhase } from "./cues.ts";
export { ambienceMix, busyLevel, nightFromHour } from "./mix.ts";
export type { Deterministic } from "./pick.ts";
export type { EmitterSound, Layer, OneShotSound, UiSound } from "./sounds.ts";

/** The app's audio. Creating it touches no browser audio: that waits for the first gesture. */
export const audio = new AudioManager();

/** React: volume, mute and whether sound has started, for a HUD control. */
export function useAudio(): AudioSnapshot {
  return useSyncExternalStore(audio.subscribe, audio.getSnapshot);
}
