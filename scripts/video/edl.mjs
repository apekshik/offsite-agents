// The launch video's edit decision list: every shot, caption, title and sound effect, as data.
// build.mjs renders it (`pnpm video`).
//
// The cut is laid out against take A's beat grid (Sundeck House, 118 BPM, downbeats at 0.5 + k bars;
// assets/audio/video/README.md): cuts land on beats, the cannonball on the groove, the phones on
// the drop. Take B (Lo-fi Lagoon, 90 BPM) gets the same cut, moved: each time is mapped through the
// two takes' landmarks (groove, drop, the night break, the last chord) and every cut snapped to B's
// own beats. A field written { a, b } is set per take instead of mapped.
//
// Times are seconds on the timeline; a shot's `in` is seconds into its clip (.shots/film/<clip>.mp4).
// `lock: [src, at]` puts clip time src at timeline time at (and sets `in` from it), for moments that
// must hit a beat. `speed` plays the clip faster. `zoom` crops in, anchored by `anchor` (0 top, 0.5 middle).

export const FPS = 60;
export const LENGTH = 60;

// ---------------- the music ----------------

const beatsOf = (bpm) => 60 / bpm;

export const MUSIC = {
  a: {
    file: "assets/audio/video/offsite-launch-a-sundeck-house.mp3",
    bpm: 118,
    // Beat phases measured from the take's onsets (kick): one grid throughout.
    grid: [{ from: 0, phase: 0.5 }],
    marks: { groove: 10.669, breakdown: 23.381, drop: 26.941, break: 39.144, last: 56.432 },
  },
  b: {
    file: "assets/audio/video/offsite-launch-b-lofi-lagoon.mp3",
    bpm: 90,
    // The re-cut before the drop shifts the beat by half: measured 0.0 before, 0.32 after.
    grid: [{ from: 0, phase: 0 }, { from: 26.6, phase: 0.32 }],
    // The band stops dead at 27.34; the hit is 27.65; a last stop at 56.7 and a final chord at 57.0.
    marks: { groove: 10.667, stop: 27.34, drop: 27.653, break: 39.653, last: 56.987 },
  },
};

/** Take A's beat n (0.5 s is beat 0, a downbeat). */
const A = (n) => 0.5 + n * beatsOf(118);

/** The nearest beat of a take's grid to t. */
export function snap(take, t) {
  const m = MUSIC[take];
  const seg = [...m.grid].reverse().find((g) => t >= g.from) ?? m.grid[0];
  const beat = beatsOf(m.bpm);
  return seg.phase + Math.round((t - seg.phase) / beat) * beat;
}

/** Take A's timeline → another take's, through their shared landmarks. */
function mapper(take) {
  if (take === "a") return (t) => t;
  const a = MUSIC.a.marks, m = MUSIC[take].marks;
  const pts = [[0, 0], [a.groove, m.groove], [a.drop, m.drop], [a.break, m.break], [a.last, m.last], [LENGTH, LENGTH]];
  return (t) => {
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      if (t <= x1) return y0 + ((t - x0) / (x1 - x0)) * (y1 - y0);
    }
    return t;
  };
}

// ---------------- the cut (take A's timeline) ----------------

const at = (a, b) => ({ a, b });

/** Shots, in order; each runs to the next one's `at`. The terminal and end card are graphics (below). */
const SHOTS = [
  // 0–5: the arrival, under the title.
  { clip: "arrival", at: 0, in: 1.6 },
  // 5–20: off duty, a gag a shot.
  { clip: "bar", at: A(9), in: 1.2 }, // "what'll it be?" "something with no merge conflicts"
  { clip: "pool", at: A(16), lock: [2.78, A(20)] }, // the cannonball lands on the groove
  { clip: "hottub", at: A(22), in: 1.45 }, // "this is nice" "warmer than prod"
  { clip: "fishing", at: A(27), in: 1.15 }, // "…a boot"
  { clip: "gym", at: A(31), in: 0.45 }, // "is it DNS?" "it's always DNS"
  // 20–27: the captain asks; the plan comes back as the music thins out.
  { clip: "captain", at: A(38), in: 0.9 },
  { clip: "typing", at: A(41), speed: 1.5, lock: [4.62, at(23.25, null)] }, // sent just before the breakdown
  { clip: "plan", at: A(45), lock: [5.75, at(26.2, 26.9)] },
  // The drop: phones buzz, everyone runs.
  { clip: "scramble", at: at(A(52), MUSIC.b.marks.drop), in: 0.85 },
  { clip: "core", at: A(56), in: 0.6 },
  { clip: "hire", at: A(60), in: 1.4, speed: 1.5 },
  { clip: "office", at: A(66), in: 0.7 },
  // The break: night.
  { clip: "night-office", at: A(76), in: 0.5, zoom: 1.12, anchor: 0.1 },
  { clip: "monitors", at: A(81), in: 0.7 },
  { clip: "delivery", at: A(84), in: 1.0, speed: 1.3 },
  { clip: "diff", at: A(92), in: 0.6 },
];

/** Graphics drawn over (or instead of) the picture: graphics/graphics.js draws each kind. */
const GRAPHICS = [
  { kind: "title", from: 0.55, to: 4.75, text: "Offsite", tagline: "Take your coding agents on an offsite." },
  { kind: "caption", from: "@bar+0.25", to: "@pool-0.15", text: "Your agents, off duty." },
  { kind: "caption", from: "@captain+0.2", to: "@plan-0.15", text: "You’re the captain." },
  { kind: "caption", from: "@plan+0.25", to: "@scramble-0.12", text: "Delegate." },
  { kind: "caption", from: "@office+0.25", to: "@night-office-0.15", text: "They get to work." },
  { kind: "caption", from: "@diff+0.2", to: "@terminal-0.15", text: "Review what they built." },
  { kind: "terminal", from: A(98), to: at(A(110) + 0.3, 57.3), caption: ["Runs on your Claude and ChatGPT subscriptions.", "No API keys."] },
  { kind: "endcard", from: at(A(110), MUSIC.b.marks.last), to: LENGTH, wordmark: "Offsite", lines: ["offsiteagents.app", "github.com/apekshik/offsite-agents"], foot: "Open source · MIT" },
];

/** Sound effects under the music: file in assets/audio/video/sfx, gain in dB, `from`/`dur` in the file. */
const SFX = [
  { file: "helicopter-approach", at: 0, from: 5.2, dur: 5.6, gain: at(-15, -21), fadeIn: 1.2, fadeOut: 0.8 },
  { file: "title-whoosh", at: 0.5, gain: -13 },
  { file: "glass-clink-cheers", at: "@bar+0.15", gain: at(-9, -6) },
  { file: "pool-cannonball-splash", at: A(20) - 0.02, gain: -1, limit: -8 },
  { file: "keyboard-typing", at: "typing:2.0", from: 9.5, dur: 1.75, gain: 5, limit: -16, fadeIn: 0.05, fadeOut: 0.2 },
  { file: "record-scratch", at: at(26.38, 27.12), gain: -12, limit: -10 },
  { file: "phone-buzz", at: at(A(52) - 0.02, 27.38), gain: at(-10, -14) },
  { file: "phone-buzz", at: "core:1.05", gain: -12 },
  { file: "helicopter-approach", at: "@hire+0", from: 9.4, dur: 3.1, gain: -13, fadeIn: 0.15, fadeOut: 0.5 },
  { file: "keyboard-typing", at: "@office+2.0", from: 1.0, dur: 3.0, gain: 0, limit: -16, fadeIn: 0.6, fadeOut: 0.3 },
  { file: "keyboard-typing", at: "@monitors+0", from: 5.0, dur: 1.5, gain: 3, limit: -16, fadeIn: 0.05, fadeOut: 0.15 },
  { file: "package-thump", at: "delivery:4.6", gain: 0, limit: -10 },
  { file: "landed-chime", at: "delivery:5.0", gain: -5 },
  { file: "keyboard-typing", at: "@terminal+0.3", from: 10.0, dur: 0.8, gain: 4, limit: -16, fadeIn: 0.02, fadeOut: 0.1 },
  { file: "title-whoosh", at: at(A(110) - 0.18, MUSIC.b.marks.last - 0.18), gain: -10 },
];

// ---------------- building a take's cut ----------------

const pick = (v, take) => (v && typeof v === "object" && !Array.isArray(v) ? v[take] : v);

/**
 * The cut for a take: shots with exact frames, graphics and effects with timeline seconds.
 * Every cut lands on a frame; shot boundaries in take B are snapped to its beats.
 */
export function cutFor(take) {
  const map = mapper(take);
  const time = (v, { snapIt = false } = {}) => {
    const own = pick(v, take);
    if (own !== null && own !== undefined && typeof v === "object" && v !== null) return own;
    const base = typeof v === "object" && v !== null ? v.a : v;
    const t = map(base);
    return take === "a" || !snapIt ? t : snap(take, t);
  };
  const frame = (t) => Math.round(t * FPS);

  const shots = SHOTS.map((s) => ({ ...s, start: time(s.at, { snapIt: true }) }));
  const terminal = GRAPHICS.find((g) => g.kind === "terminal");
  const end = time(terminal.from, { snapIt: true });
  const out = shots.map((s, i) => {
    const from = frame(s.start), to = frame(i + 1 < shots.length ? shots[i + 1].start : end);
    const speed = s.speed ?? 1;
    let inT = s.in ?? 0;
    if (s.lock) {
      const lockAt = time(s.lock[1]);
      inT = s.lock[0] - (lockAt - from / FPS) * speed;
    }
    return { clip: s.clip, from, frames: to - from, in: Math.max(0, inT), speed, zoom: s.zoom ?? 1, anchor: s.anchor ?? 0.5 };
  });
  const startOf = (clip) => out.find((s) => s.clip === clip);
  const resolve = (v) => {
    if (typeof v === "string" && v.startsWith("@")) {
      // "@shot+0.25": that far from where the shot starts on the timeline (the terminal: where the graphics take over).
      const m = v.match(/^@(.+?)([+-][\d.]+)$/);
      return (m[1] === "terminal" ? end : startOf(m[1]).from / FPS) + Number(m[2]);
    }
    if (typeof v === "string" && v.includes(":")) {
      const [name, off] = v.split(":");
      const s = startOf(name);
      // A clip moment: where clip time `off` plays on the timeline.
      return s.from / FPS + (Number(off) - s.in) / s.speed;
    }
    return time(v);
  };
  const graphics = GRAPHICS.map((g) => ({ ...g, from: g.kind === "terminal" ? end : g.kind === "endcard" ? time(g.from, { snapIt: true }) : resolve(g.from), to: resolve(g.to) }));
  const sfx = SFX.map((x) => ({ ...x, at: resolve(x.at), gain: pick(x.gain, take) }));
  return { take, music: MUSIC[take], fps: FPS, length: LENGTH, shots: out, graphicsStart: end, graphics, sfx };
}
