// The 30-second cut for X: the same story at twice the pace, on take A re-cut on its bar lines
// (intro, the groove coming in, the breakdown, the drop, the night break, the ending), each join
// a 30 ms crossfade on a downbeat. Same shape as edl.mjs's cuts, so build.mjs renders it the same way.

import { FPS, MUSIC } from "./edl.mjs";

const BAR = (60 / 118) * 4;
/** Take A's downbeat k (bars from 0.5 s). */
const D = (k) => 0.5 + k * BAR;

// The music, piece by piece: [from, to) in the take, laid end to end.
const PIECES = [
  [D(3), D(5)], //    0.00  the end of the quiet intro, under the title
  [D(5), D(7.5)], //  4.07  the groove comes in: the cannonball lands on it
  [D(11), D(13)], //  9.15  half a bar of groove, then the breakdown: the captain asks
  [D(13), D(16)], // 13.22  the drop: phones, the run, the hire, the office
  [D(19), D(20.5)], // 19.32 the break: night, a delivery
  [D(25.5), 60], //  22.37  the groove out, the last chord (26.44) under the end card
];

export function shortCut() {
  let t = 0;
  const pieces = PIECES.map(([from, to]) => { const p = { from, to, at: t }; t += to - from; return p; });
  const length = 30; // the last piece runs to the take's end; its silent tail is cut
  const P = (i) => pieces[i].at;
  const drop = P(3), last = P(5) + (D(27.5) - D(25.5));

  const shots = [
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
  ].map((s) => ({ ...s, start: s.at }));
  const end = P(5);
  const out = shots.map((s, i) => {
    const from = Math.round(s.start * FPS), to = Math.round((i + 1 < shots.length ? shots[i + 1].start : end) * FPS);
    const speed = s.speed ?? 1;
    const inT = s.lock ? s.lock[0] - (s.lock[1] - from / FPS) * speed : s.in;
    return { clip: s.clip, from, frames: to - from, in: Math.max(0, inT), speed, zoom: s.zoom ?? 1, anchor: s.anchor ?? 0.5 };
  });
  const at = (clip) => out.find((s) => s.clip === clip).from / FPS;
  const moment = (clip, src) => { const s = out.find((x) => x.clip === clip); return s.from / FPS + (src - s.in) / s.speed; };

  const graphics = [
    { kind: "title", from: 0.35, to: P(1) - 0.2, text: "Offsite", tagline: "Take your coding agents on an offsite." },
    { kind: "caption", from: at("bar") + 0.2, to: P(2) - 0.12, text: "Your agents, off duty." },
    { kind: "caption", from: at("captain") + 0.15, to: at("plan") - 0.1, text: "You’re the captain." },
    { kind: "caption", from: at("office") + 0.2, to: P(4) - 0.12, text: "They get to work." },
    { kind: "terminal", from: end, to: last + 0.3, pace: 1.3, caption: ["Runs on your Claude and ChatGPT subscriptions.", "No API keys."] },
    { kind: "endcard", from: last, to: length, wordmark: "Offsite", lines: ["offsiteagents.app", "github.com/apekshik/offsite-agents"], foot: "Open source · MIT" },
  ];
  const sfx = [
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
  ];
  return { take: "30s", music: { ...MUSIC.a, pieces }, fps: FPS, length, shots: out, graphicsStart: end, graphics, sfx };
}
