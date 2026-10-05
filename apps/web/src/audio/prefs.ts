// Master volume and mute, kept in localStorage. Storage can be missing or throw (private windows,
// blocked site data): then the defaults hold for this visit and nothing breaks.

export interface AudioPrefs {
  /** 0..1 */
  volume: number;
  muted: boolean;
}

export const DEFAULT_PREFS: AudioPrefs = { volume: 0.8, muted: false };
const KEY = "offsite.audio";

type Store = Pick<Storage, "getItem" | "setItem">;

function storage(given?: Store | null): Store | null {
  if (given !== undefined) return given;
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

export function loadPrefs(given?: Store | null): AudioPrefs {
  try {
    const raw = storage(given)?.getItem(KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const p = JSON.parse(raw) as Partial<AudioPrefs>;
    const volume = typeof p.volume === "number" && Number.isFinite(p.volume) ? Math.min(1, Math.max(0, p.volume)) : DEFAULT_PREFS.volume;
    return { volume, muted: p.muted === true };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(p: AudioPrefs, given?: Store | null): void {
  try { storage(given)?.setItem(KEY, JSON.stringify({ volume: p.volume, muted: p.muted })); } catch { /* not saved this time */ }
}
