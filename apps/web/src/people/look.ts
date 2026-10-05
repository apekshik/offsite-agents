import { CAPTAIN_PRESET, CREW_PRESETS } from "@offsite/kit";
import type { AvatarSpec, Look } from "@offsite/contracts";

// How a person aboard looks, the same everywhere: in the world, on their messages, in the HUD. Their own look when they
// made one; until then the captain wears the captain's uniform and a friend one of the ready-made crew looks, picked by
// who they are, so two friends never look like two captains.

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export interface PersonLook { avatar: AvatarSpec; look: Look | null }

export function personLook(p: { userId: string; avatar: unknown; look: unknown; owner: boolean }): PersonLook {
  if (p.avatar) return { avatar: p.avatar as AvatarSpec, look: (p.look ?? null) as Look | null };
  const preset = p.owner ? CAPTAIN_PRESET : CREW_PRESETS[hash(p.userId) % CREW_PRESETS.length]!;
  return { avatar: preset.spec, look: preset.look };
}
