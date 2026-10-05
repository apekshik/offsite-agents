// The 30-second cut for X: the same story at twice the pace, on a take re-cut on its own beats,
// each join a 30 ms crossfade. Take B (Lo-fi Lagoon) is the one that ships; take A's re-cut is
// kept buildable (`pnpm video 30s-a`). Same shape as edl.mjs's cuts, so build.mjs renders it the same way.

import { FPS, MUSIC } from "./edl.mjs";

const LENGTH = 30;

/** Lays the pieces end to end and turns shot times into frames, like edl.mjs's cutFor. */
function assemble(take, PIECES, plan) {
  let t = 0;
  const pieces = PIECES.map(([from, to]) => { const p = { from, to, at: t }; t += to - from; return p; });
  const P = (i) => pieces[i].at;
  const { shots, end, last, graphics, sfx } = plan(P);
  const out = shots.map((s, i) => {
    const from = Math.round(s.at * FPS), to = Math.round((i + 1 < shots.length ? shots[i + 1].at : end) * FPS);
    const speed = s.speed ?? 1;
    const inT = s.lock ? s.lock[0] - (s.lock[1] - from / FPS) * speed : s.in;
    return { clip: s.clip, from, frames: to - from, in: Math.max(0, inT), speed, zoom: s.zoom ?? 1, anchor: s.anchor ?? 0.5 };
  });
  const at = (clip) => out.find((s) => s.clip === clip).from / FPS;
  const moment = (clip, src) => { const s = out.find((x) => x.clip === clip); return s.from / FPS + (src - s.in) / s.speed; };
  const card = (from) => [
    { kind: "terminal", from: end, to: last + 0.3, pace: 1.3, caption: ["Runs on your Claude and ChatGPT subscriptions.", "No API keys."] },
    { kind: "endcard", from, to: LENGTH, wordmark: "Offsite", lines: ["offsiteagents.app", "github.com/apekshik/offsite-agents"], foot: "Open source · MIT" },
  ];
  return {
    take: `30s-${take}`, music: { ...MUSIC[take], pieces }, fps: FPS, length: LENGTH, shots: out, graphicsStart: end,
    graphics: [...graphics({ at, P }), ...card(last)], sfx: sfx({ at, moment, P }),
  };
}

// ---------------- take B: Lo-fi Lagoon, 90 BPM (the one that ships) ----------------

const BEAT_B = 60 / 90;
/** Take B's beat n: before the drop on 0.0 + n beats; after it the take's beats sit at 0.32 + n. */
const b0 = (n) => n * BEAT_B, b1 = (n) => 0.32 + n * BEAT_B;
const STOP = MUSIC.b.marks.stop, HIT = MUSIC.b.marks.drop, CHORD = MUSIC.b.marks.last;

const PIECES_B = [
  [b0(10), b0(16)], //    0.00  the last bar and a half of the intro, under the title
  [b0(16), b0(24)], //    4.00  the beat comes in: the cannonball, the bar
  [b0(32), HIT], //       9.33  two bars of groove, the transition bar and the dead stop: the captain asks, the plan
  [HIT, b1(52)], //      15.65  the hit and the build: the run, the hire, the office, night, a delivery
  [b1(79), 60], //       22.99  the groove out, the last stop and the final chord (26.99) under the end card
];

function planB(P) {
  // Timeline beats: before the drop on multiples of 2/3 s; from the hit on, 0.32 past them (as in the take).
  const pre = (n) => n * BEAT_B, post = (n) => P(3) + n * BEAT_B;
  const stop = P(2) + (STOP - b0(32)), end = P(4), last = P(4) + (CHORD - b1(79));
  return {
    end, last,
    shots: [
      { clip: "arrival", at: 0, in: 2.2 },
      { clip: "pool", at: P(1), lock: [2.78, P(1) + 2 * BEAT_B] }, // the splash on the third beat of the groove
      { clip: "bar", at: pre(9), in: 1.4 },
      { clip: "captain", at: P(2), in: 1.1 },
      { clip: "typing", at: pre(16), speed: 2, lock: [4.62, pre(17.85)] },
      { clip: "plan", at: pre(18), lock: [5.75, stop - 0.75] },
      // The drop on the dead stop: the phones buzz in the silence, and everyone runs on the hit.
      { clip: "scramble", at: stop, lock: [0.9, P(3) + 0.03] },
      { clip: "hire", at: post(2), in: 1.6, speed: 2 },
      { clip: "office", at: post(4), in: 1.0 },
      { clip: "night-office", at: post(7), in: 1.0, zoom: 1.12, anchor: 0.1 },
      { clip: "delivery", at: post(9), in: 2.9, speed: 1.5 },
    ],
    graphics: ({ at }) => [
      { kind: "title", from: 0.35, to: P(1) - 0.25, text: "Offsite", tagline: "Take your coding agents on an offsite." },
      { kind: "caption", from: at("bar") + 0.2, to: P(2) - 0.12, text: "Your agents, off duty." },
      { kind: "caption", from: at("captain") + 0.15, to: at("plan") - 0.1, text: "You’re the captain." },
      { kind: "caption", from: at("plan") + 0.2, to: stop - 0.1, text: "Delegate." },
      { kind: "caption", from: at("office") + 0.2, to: at("night-office") - 0.12, text: "They get to work." },
    ],
    sfx: ({ at, moment }) => [
      { file: "helicopter-approach", at: 0, from: 6.0, dur: 4.4, gain: -21, fadeIn: 0.8, fadeOut: 0.6 },
      { file: "title-whoosh", at: 0.3, gain: -13 },
      { file: "pool-cannonball-splash", at: moment("pool", 2.78) - 0.02, gain: -1, limit: -8 },
      { file: "glass-clink-cheers", at: at("bar") + 0.1, gain: -6 },
      { file: "keyboard-typing", at: at("typing") + 0.05, from: 9.5, dur: 1.15, gain: 5, limit: -16, fadeIn: 0.05, fadeOut: 0.15 },
      { file: "record-scratch", at: stop - 0.2, gain: -12, limit: -10 },
      { file: "phone-buzz", at: stop + 0.04, gain: -14 },
      { file: "helicopter-approach", at: at("hire"), from: 9.6, dur: 1.4, gain: -13, fadeIn: 0.1, fadeOut: 0.4 },
      { file: "keyboard-typing", at: at("office") + 0.8, from: 1.0, dur: 1.4, gain: 0, limit: -16, fadeIn: 0.4, fadeOut: 0.3 },
      { file: "package-thump", at: moment("delivery", 4.6), gain: 0, limit: -10 },
      { file: "landed-chime", at: moment("delivery", 4.95), gain: -5 },
      { file: "keyboard-typing", at: end + 0.25, from: 10.0, dur: 0.6, gain: 4, limit: -16, fadeIn: 0.02, fadeOut: 0.1 },
      { file: "title-whoosh", at: last - 0.18, gain: -10 },
    ],
  };
}

// ---------------- take A: Sundeck House, 118 BPM ----------------

const BAR_A = (60 / 118) * 4;
/** Take A's downbeat k (bars from 0.5 s). */
const D = (k) => 0.5 + k * BAR_A;

const PIECES_A = [
  [D(3), D(5)], //    0.00  the end of the quiet intro, under the title
  [D(5), D(7.5)], //  4.07  the groove comes in: the cannonball lands on it
  [D(11), D(13)], //  9.15  half a bar of groove, then the breakdown: the captain asks
  [D(13), D(16)], // 13.22  the drop: phones, the run, the hire, the office
  [D(19), D(20.5)], // 19.32 the break: night, a delivery
  [D(25.5), 60], //  22.37  the groove out, the last chord (26.44) under the end card
];

function planA(P) {
  const BAR = BAR_A, drop = P(3), end = P(5), last = P(5) + (D(27.5) - D(25.5));
  return {
    end, last,
    shots: [
      { clip: "arrival", at: 0, in: 2.2 },
      { clip: "pool", at: P(1), lock: [2.78, P(1) + BAR / 2] }, // the splash on the bar's third beat
      { clip: "bar", at: P(1) + BAR, in: 1.6 },
      { clip: "captain", at: P(2), in: 1.15 },
      { clip: "typing", at: P(2) + BAR / 2, speed: 2, lock: [4.62, P(2) + BAR * 1.2] },
      { clip: "plan", at: P(2) + BAR * 1.25, lock: [5.75, drop - 0.3] },
      { clip: "scramble", at: drop, in: 0.85 },
      { clip: "hire", at: drop + BAR * 0.75, in: 1.6, speed: 2 },
      { clip: "office", at: drop + BAR * 1.5, in: 1.0 },
      { clip: "night-office", at: P(4), in: 1.0, zoom: 1.12, anchor: 0.1 },
      { clip: "delivery", at: P(4) + BAR / 2, in: 2.2, speed: 1.5 },
    ],
    graphics: ({ at }) => [
      { kind: "title", from: 0.35, to: P(1) - 0.2, text: "Offsite", tagline: "Take your coding agents on an offsite." },
      { kind: "caption", from: at("bar") + 0.2, to: P(2) - 0.12, text: "Your agents, off duty." },
      { kind: "caption", from: at("captain") + 0.15, to: at("plan") - 0.1, text: "You’re the captain." },
      { kind: "caption", from: at("office") + 0.2, to: P(4) - 0.12, text: "They get to work." },
    ],
    sfx: ({ at, moment }) => [
      { file: "helicopter-approach", at: 0, from: 6.5, dur: 4.2, gain: -15, fadeIn: 0.8, fadeOut: 0.6 },
      { file: "title-whoosh", at: 0.3, gain: -13 },
      { file: "pool-cannonball-splash", at: moment("pool", 2.78) - 0.02, gain: -1, limit: -8 },
      { file: "glass-clink-cheers", at: at("bar") + 0.1, gain: -9 },
      { file: "keyboard-typing", at: moment("typing", 2.0), from: 9.5, dur: 1.2, gain: 5, limit: -16, fadeIn: 0.05, fadeOut: 0.15 },
      { file: "record-scratch", at: drop - 0.56, gain: -12, limit: -10 },
      { file: "phone-buzz", at: drop - 0.02, gain: -10 },
      { file: "helicopter-approach", at: at("hire"), from: 9.6, dur: 1.5, gain: -13, fadeIn: 0.1, fadeOut: 0.4 },
      { file: "keyboard-typing", at: at("office") + 1.0, from: 1.0, dur: 2.0, gain: 0, limit: -16, fadeIn: 0.5, fadeOut: 0.3 },
      { file: "package-thump", at: moment("delivery", 4.6), gain: 0, limit: -10 },
      { file: "landed-chime", at: moment("delivery", 5.0), gain: -5 },
      { file: "keyboard-typing", at: end + 0.25, from: 10.0, dur: 0.6, gain: 4, limit: -16, fadeIn: 0.02, fadeOut: 0.1 },
      { file: "title-whoosh", at: last - 0.18, gain: -10 },
    ],
  };
}

/** The 30-second cut on take B (the default) or A. */
export function shortCut(take = "b") {
  return take === "a" ? assemble("a", PIECES_A, planA) : assemble("b", PIECES_B, planB);
}
