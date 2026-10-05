import { describe, expect, it } from "vitest";
import { ARRIVAL } from "@offsite/contracts";
import { flightPhase } from "./cues.ts";
import { ambienceMix, busyLevel, nightFromHour, wildlifeChance } from "./mix.ts";
import { Picker, hash32 } from "./pick.ts";
import { DEFAULT_PREFS, loadPrefs, savePrefs } from "./prefs.ts";
import { AUDIO_FILES } from "./files.ts";
import { EMITTERS, LAYERS, ONE_SHOTS, UI_SOUNDS, filesOf } from "./sounds.ts";

describe("ambience", () => {
  it("is day at noon and night at midnight, easing through dusk", () => {
    expect(nightFromHour(12)).toBe(0);
    expect(nightFromHour(0)).toBe(1);
    expect(nightFromHour(24 + 12)).toBe(0);
    const dusk = nightFromHour(19);
    expect(dusk).toBeGreaterThan(0);
    expect(dusk).toBeLessThan(1);
  });

  it("crossfades wind into the night bed, keeps the sea", () => {
    const day = ambienceMix(0, 0), night = ambienceMix(1, 0);
    expect(day.night).toBe(0);
    expect(night.night).toBe(1);
    expect(day.wind).toBeGreaterThan(night.wind);
    expect(night.ocean).toBeGreaterThanOrEqual(day.ocean);
  });

  it("gets busier with work: typing, murmur and hum all rise", () => {
    const quiet = ambienceMix(0, 0), busy = ambienceMix(0, 1);
    expect(quiet.typing).toBe(0);
    expect(quiet.murmur).toBe(0);
    for (const k of ["typing", "murmur", "hum"] as const) expect(busy[k]).toBeGreaterThan(quiet[k]);
    expect(busyLevel(0, 5)).toBe(0);
    expect(busyLevel(1, 1)).toBeLessThan(1); // one person isn't a full office
    expect(busyLevel(6, 6)).toBe(1);
  });

  it("has no gulls at night", () => {
    expect(wildlifeChance(1).gull).toBe(0);
    expect(wildlifeChance(0).gull).toBeGreaterThan(0);
  });
});

describe("variations", () => {
  it("are the same for the same seed and time, and differ across seeds", () => {
    let t = 12.345;
    const a = new Picker({ seed: 7, clock: () => t }), b = new Picker({ seed: 7, clock: () => t });
    const picks = (p: Picker) => Array.from({ length: 20 }, (_, i) => { t = i * 0.37; return [p.variation("gull", 4), p.detune("gull", 150), p.slot("gull", i)]; });
    expect(picks(a)).toEqual(picks(b));
    const c = new Picker({ seed: 8, clock: () => t });
    expect(picks(c)).not.toEqual(picks(a));
  });

  it("never repeats the last variation in the game's random mode", () => {
    let i = 0;
    const seq = [0.1, 0.1, 0.1, 0.9, 0.9, 0.5];
    const p = new Picker(null, () => seq[i++ % seq.length]!);
    let prev = -1;
    for (let k = 0; k < 30; k++) {
      const v = p.variation("step", 3);
      expect(v).not.toBe(prev);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(3);
      prev = v;
    }
  });

  it("hashes parts, not their concatenation", () => {
    expect(hash32("ab", "c")).not.toBe(hash32("a", "bc"));
  });
});

describe("prefs", () => {
  const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };

  it("round-trips volume and mute", () => {
    const s = memory();
    savePrefs({ volume: 0.3, muted: true }, s);
    expect(loadPrefs(s)).toEqual({ volume: 0.3, muted: true });
  });

  it("falls back to defaults when storage is missing, throws or holds junk", () => {
    expect(loadPrefs(null)).toEqual(DEFAULT_PREFS);
    const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(loadPrefs(throwing)).toEqual(DEFAULT_PREFS);
    expect(() => savePrefs({ volume: 1, muted: false }, throwing)).not.toThrow();
    const junk = memory();
    junk.setItem("offsite.audio", "{not json");
    expect(loadPrefs(junk)).toEqual(DEFAULT_PREFS);
    junk.setItem("offsite.audio", JSON.stringify({ volume: 9, muted: "yes" }));
    expect(loadPrefs(junk)).toEqual({ volume: 1, muted: false });
  });
});

describe("helicopter", () => {
  it("follows ARRIVAL's timings", () => {
    const f = { land: 100_000, leave: 100_000 + ARRIVAL.groundMs };
    expect(flightPhase(f, f.land - ARRIVAL.approachMs - 1).phase).toBe("away");
    expect(flightPhase(f, f.land - 1000)).toEqual({ phase: "approach", ms: ARRIVAL.approachMs - 1000 });
    expect(flightPhase(f, f.land + 10).phase).toBe("ground");
    expect(flightPhase(f, f.leave + 500)).toEqual({ phase: "depart", ms: 500 });
    expect(flightPhase(f, f.leave + ARRIVAL.departMs + 1).phase).toBe("away");
  });
});

describe("catalog", () => {
  it("only names files the build made, and loops only loop files", () => {
    const all = [...Object.values(EMITTERS), ...Object.values(ONE_SHOTS), ...Object.values(UI_SOUNDS), ...Object.values(LAYERS)];
    for (const def of all) for (const f of filesOf(def)) expect(AUDIO_FILES[f]).toBeDefined();
    for (const def of [...Object.values(EMITTERS), ...Object.values(LAYERS)]) for (const f of filesOf(def)) expect(AUDIO_FILES[f].loop).toBe(true);
  });
});
