import { useSyncExternalStore } from "react";
import { Voice, type VoiceSnapshot } from "./voice.ts";

// Proximity voice chat between people aboard. One instance for the app: the deck (src/net) feeds it each person's
// stream, the game places the voices every frame, and the interface turns the mic on and mutes people.

export { MAX_DISTANCE, Voice, type VoiceSnapshot } from "./voice.ts";

export const voice = new Voice();

// For poking at it from the console while developing (and the two-browser test).
if (import.meta.env.DEV && typeof window !== "undefined") Object.assign(window, { offsiteVoice: voice });

/** React: the mic's state, who is talking, whom you muted. */
export function useVoice(): VoiceSnapshot {
  return useSyncExternalStore(voice.subscribe, voice.getSnapshot);
}
