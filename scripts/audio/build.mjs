// Turn the generated audio (scripts/audio/.cache, from generate.mjs) into Offsite's files:
//
//   apps/web/public/audio/*.ogg, *.m4a   the game: trimmed one-shots, seamless loops (Opus, AAC fallback)
//   assets/audio/video/*.mp3             the launch video's soundtrack, the two picked takes
//   assets/audio/video/sfx/*.wav         a sound-effects pack for the video edit
//   assets/audio/CREDITS.md              every file, its model, its prompt, its terms
//
//   node scripts/audio/build.mjs
//
// Needs ffmpeg (with libopus). Deterministic: the same cache always builds the same files. Every
// take of the soundtrack (not just the picked two) is also rendered to scripts/audio/.cache/takes
// for auditioning.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { REPO } from "./fal.mjs";
import { ALL, LICENSES } from "./jobs.mjs";

const CACHE = resolve(REPO, "scripts/audio/.cache");
const TAKES = resolve(CACHE, "takes");
const GAME = resolve(REPO, "apps/web/public/audio");
const VIDEO = resolve(REPO, "assets/audio/video");
const PACK = resolve(VIDEO, "sfx");
const SR = 44100;

// ---------- buffers: interleaved Float32 at 44.1 kHz ----------

/** @typedef {{ data: Float32Array, ch: number }} Buf */

function ffmpeg(args, input) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-v", "error", "-y", ...args], { input, maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`ffmpeg ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

function cacheFile(id) {
  const f = readdirSync(CACHE).find((n) => n.startsWith(`${id}.`) && !n.endsWith(".json"));
  if (!f) throw new Error(`${id} is not in the cache: run node scripts/audio/generate.mjs`);
  return resolve(CACHE, f);
}

/** @returns {Buf} */
function load(id, ch = 2) {
  const out = ffmpeg(["-i", cacheFile(id), "-ac", String(ch), "-ar", String(SR), "-f", "f32le", "-"]);
  const data = new Float32Array(out.length / 4);
  for (let i = 0; i < data.length; i++) data[i] = out.readFloatLE(i * 4);
  return { data, ch };
}

const frames = (b) => b.data.length / b.ch;
const secs = (b) => frames(b) / SR;
const at = (t) => Math.max(0, Math.round(t * SR));
const empty = (seconds, ch) => ({ data: new Float32Array(at(seconds) * ch), ch });

function slice(b, t0, t1 = secs(b)) {
  const a = Math.min(frames(b), at(t0)), e = Math.min(frames(b), at(t1));
  return { data: b.data.slice(a * b.ch, e * b.ch), ch: b.ch };
}

/** Add src into dst at t seconds (dst grows if needed). */
function mixInto(dst, src, t, gain = 1) {
  const off = at(t) * dst.ch;
  const need = off + frames(src) * dst.ch;
  if (need > dst.data.length) { const d = new Float32Array(need); d.set(dst.data); dst.data = d; }
  for (let i = 0; i < frames(src); i++) for (let c = 0; c < dst.ch; c++) {
    dst.data[off + i * dst.ch + c] += gain * src.data[i * src.ch + (src.ch === 1 ? 0 : c % src.ch)];
  }
  return dst;
}

/** Equal-power ramps: up (0 → 1) or down (1 → 0) over the first or last `dur` seconds. */
function ramp(b, dur, dir, where = dir === "in" ? "start" : "end") {
  const n = Math.min(frames(b), at(dur));
  const start = where === "start" ? 0 : frames(b) - n;
  for (let i = 0; i < n; i++) {
    const x = (i + 0.5) / n;
    const g = dir === "in" ? Math.sin((x * Math.PI) / 2) : Math.cos((x * Math.PI) / 2);
    for (let c = 0; c < b.ch; c++) b.data[(start + i) * b.ch + c] *= g;
  }
  return b;
}

/**
 * Splice [from, to) pieces end to end with an equal-power crossfade of xf seconds at each join
 * (centred on the join, so the output's timing is exact).
 */
function splice(pieces, xf = 0.03) {
  const ch = pieces[0].buf.ch;
  let out = empty(0, ch), cursor = 0;
  pieces.forEach((p, i) => {
    const pre = i === 0 ? 0 : xf / 2, post = i === pieces.length - 1 ? 0 : xf / 2;
    const seg = slice(p.buf, p.from - pre, p.to + post);
    if (i > 0) ramp(seg, xf, "in");
    if (i < pieces.length - 1) ramp(seg, xf, "out");
    out = mixInto(out, seg, Math.max(0, cursor - pre), p.gain ?? 1);
    cursor += p.to - p.from;
  });
  return out;
}

/** The last time (and the first) the signal is louder than thresholdDb (2 ms windows). */
function bounds(b, thresholdDb = -50) {
  const thr = Math.pow(10, thresholdDb / 20), w = at(0.002);
  let first = -1, last = -1;
  for (let i = 0; i + w <= frames(b); i += w) {
    let s = 0;
    for (let j = i; j < i + w; j++) for (let c = 0; c < b.ch; c++) s += b.data[j * b.ch + c] ** 2;
    if (Math.sqrt(s / (w * b.ch)) > thr) { if (first < 0) first = i; last = i + w; }
  }
  return first < 0 ? [0, secs(b)] : [first / SR, last / SR];
}

function trim(b, { thresholdDb = -50, pre = 0.004, post = 0.06, fadeOut = 0.04 } = {}) {
  const [a, e] = bounds(b, thresholdDb);
  const out = slice(b, Math.max(0, a - pre), Math.min(secs(b), e + post));
  ramp(out, Math.min(pre, 0.004) || 0.002, "in");
  return ramp(out, fadeOut, "out");
}

/**
 * A seamless loop of x[start, end): its head is crossfaded with what follows `end`, so the last
 * sample flows into the first. With no audio after `end`, the tail before it is used instead
 * (the loop is then xf shorter).
 */
function loopify(b, xf, start = 0, end = null) {
  let e = end ?? secs(b);
  if (e + xf > secs(b)) e = secs(b) - xf;
  const body = slice(b, start, e);
  const tail = slice(b, e, e + xf);
  ramp(body, xf, "in", "start");
  ramp(tail, xf, "out", "end");
  return mixInto(body, tail, 0);
}

function stats(b) {
  let peak = 0, s = 0;
  for (const v of b.data) { peak = Math.max(peak, Math.abs(v)); s += v * v; }
  return { peak, rms: Math.sqrt(s / b.data.length) };
}
const db = (x) => 20 * Math.log10(x + 1e-12);

/** Scale to an RMS (loops) or peak (one-shots) target, never past -1 dBFS peak. */
function level(b, { rmsDb = null, peakDb = -1 } = {}) {
  const { peak, rms } = stats(b);
  let g = rmsDb === null ? Math.pow(10, peakDb / 20) / peak : Math.pow(10, rmsDb / 20) / rms;
  g = Math.min(g, Math.pow(10, -1 / 20) / peak);
  for (let i = 0; i < b.data.length; i++) b.data[i] *= g;
  return b;
}

function mono(b) {
  if (b.ch === 1) return b;
  const out = { data: new Float32Array(frames(b)), ch: 1 };
  for (let i = 0; i < frames(b); i++) { let s = 0; for (let c = 0; c < b.ch; c++) s += b.data[i * b.ch + c]; out.data[i] = s / b.ch; }
  return out;
}

/** Separate sound events (footsteps): stretches above thresholdDb, joined across gaps under minGap. */
function events(b, thresholdDb = -42, minGap = 0.08) {
  const thr = Math.pow(10, thresholdDb / 20), w = at(0.005), out = [];
  let open = null, quiet = 0;
  for (let i = 0; i + w <= frames(b); i += w) {
    let s = 0;
    for (let j = i; j < i + w; j++) for (let c = 0; c < b.ch; c++) s += b.data[j * b.ch + c] ** 2;
    const loud = Math.sqrt(s / (w * b.ch)) > thr, t = i / SR;
    if (loud) { if (open === null) open = t; quiet = 0; }
    else if (open !== null && (quiet += w / SR) >= minGap) { out.push([open, t - quiet + w / SR]); open = null; quiet = 0; }
  }
  if (open !== null) out.push([open, secs(b)]);
  return out;
}

function write(b, file, args) {
  mkdirSync(resolve(file, ".."), { recursive: true });
  const raw = Buffer.alloc(b.data.length * 4);
  for (let i = 0; i < b.data.length; i++) raw.writeFloatLE(b.data[i], i * 4);
  ffmpeg(["-f", "f32le", "-ar", String(SR), "-ac", String(b.ch), "-i", "-", "-map_metadata", "-1", ...args, file], raw);
}

const hasAacAt = ffmpeg(["-encoders"]).toString().includes("aac_at");
function writeGame(b, name, kbps) {
  write(b, resolve(GAME, `${name}.ogg`), ["-c:a", "libopus", "-b:a", `${kbps}k`, "-vbr", "on", "-compression_level", "10", "-application", "audio"]);
  // AAC needs a little more for the same quality; AudioToolbox's encoder (macOS) is the better one.
  write(b, resolve(GAME, `${name}.m4a`), ["-c:a", hasAacAt ? "aac_at" : "aac", "-b:a", `${Math.round(kbps * 1.25)}k`]);
}

/**
 * Integrated loudness to `lufs` by one linear gain (ffmpeg's loudnorm measures; nothing is
 * compressed), held back if that would push the true peak past -1 dBTP.
 */
function loudnorm(b, lufs = -14) {
  const raw = Buffer.alloc(b.data.length * 4);
  for (let i = 0; i < b.data.length; i++) raw.writeFloatLE(b.data[i], i * 4);
  const r = spawnSync("ffmpeg", ["-hide_banner", "-f", "f32le", "-ar", String(SR), "-ac", String(b.ch), "-i", "-", "-af", `loudnorm=I=${lufs}:TP=-1:print_format=json`, "-f", "null", "-"], { input: raw, maxBuffer: 1 << 30 });
  const m = JSON.parse(r.stderr.toString().match(/\{[\s\S]*\}/)[0]);
  const gainDb = Math.min(lufs - Number(m.input_i), -1 - Number(m.input_tp));
  const g = Math.pow(10, gainDb / 20);
  for (let i = 0; i < b.data.length; i++) b.data[i] *= g;
  return b;
}

const fitTo = (b, seconds, fade = 0.5) => {
  const out = secs(b) >= seconds ? slice(b, 0, seconds) : mixInto(empty(seconds, b.ch), b, 0);
  return ramp(out, fade, "out");
};

// ---------- the launch video's soundtrack ----------
// Each Eleven Music take came back with its drop at 31-34 s, not 27 s, so each is re-cut on its
// own bar lines (tempo from the prompt, the bar grid measured from the take's onsets): bars come
// out before the drop and the same number go back in after it, so the length and the ending stay.

const bar = (bpm) => (60 / bpm) * 4;

const TAKE_EDITS = {
  "take-a-sundeck-house": () => {
    const b = load("take-a-sundeck-house"), B = bar(118); // downbeats at k * B
    // Out: intro bars 4-6. Back in: a repeat of bars 24-26 (the groove after the second break).
    const cut = splice([
      { buf: b, from: 0, to: 4 * B },
      { buf: b, from: 7 * B, to: 27 * B },
      { buf: b, from: 24 * B, to: secs(b) },
    ]);
    const PRE = 0.5; // a half-second of room before the first note puts the drop on 26.9 s
    return { buf: mixInto(empty(PRE, 2), cut, PRE), notes: {
      drop: PRE + 4 * B + (16 - 7) * B,
      sections: [[0, "quiet intro, no kick or bass"], [PRE + 5 * B, "the groove: kick and bass come in"], [PRE + 11.25 * B, "breakdown: kick and bass drop out"], [PRE + 13 * B, "the drop: the full band hits"], [PRE + 19 * B, "a two-bar break"], [PRE + 21 * B, "the groove again, to the end"], [PRE + 27.5 * B, "last chord rings out"]],
    } };
  },
  "take-b-lofi-lagoon": () => {
    const b = load("take-b-lofi-lagoon"), B = bar(90), o = -0.07; // downbeats at o + k * B
    const cut = splice([
      { buf: b, from: 0, to: o + 8 * B },
      { buf: b, from: o + 9 * B, to: o + 16 * B },
      { buf: b, from: o + 15 * B, to: secs(b) },
    ]);
    return { buf: cut, notes: {
      drop: o + 10 * B + 0.73, // the band stops dead for a moment, then the hit; the full groove from 29.3 s
      sections: [[0, "intro, no drums or bass"], [o + 4 * B, "the beat comes in"], [o + 10 * B, "transition bar"], [o + 10 * B + 0.73, "the stop: a beat of near-silence"], [o + 10 * B + 1.03, "the hit; bass and drums build back"], [o + 11 * B, "full groove, bass and drums up about 6 dB"], [o + 21 * B, "last chord rings out"]],
    } };
  },
  "take-c-yacht-disco": () => {
    const b = load("take-c-yacht-disco"), B = bar(112);
    const cut = splice([
      { buf: b, from: 0, to: 4 * B },
      { buf: b, from: 7 * B, to: 23 * B },
      { buf: b, from: 20 * B, to: secs(b) },
    ]);
    return { buf: cut, notes: {
      drop: 13 * B,
      sections: [[0, "groove from the top"], [11 * B, "break: the band drops out"], [13 * B, "the drop"], [27.18 * B, "last hit rings out"]],
    } };
  },
  // Stitched from three Stable Audio 2.5 clips at 118 BPM and the record-scratch effect.
  "take-d-stitched": () => {
    const p1 = load("take-d-part1-sunny"), p2 = load("take-d-part2-scramble"), p3 = load("take-d-part3-night"), B = bar(118);
    const music = splice([
      { buf: p1, from: 0, to: 13 * B },
      { buf: p2, from: 0, to: 3 * B },
      { buf: p2, from: 1 * B, to: 3 * B },
      { buf: p3, from: 0, to: 4 * B },
      { buf: p3, from: 3 * B, to: secs(p3) },
    ], 0.04);
    const scratch = level(trim(load("record-scratch")), { peakDb: -4 });
    mixInto(music, scratch, 13 * B - 0.35);
    return { buf: music, notes: {
      drop: 13 * B,
      sections: [[0, "groove (clip 1)"], [13 * B - 0.35, "record scratch"], [13 * B, "louder, denser section (clip 2)"], [18 * B, "night groove (clip 3)"], [19 * B + 15.7, "fades out"]],
    } };
  },
};

/** The two takes the video should use, best first. */
const PICKS = ["take-a-sundeck-house", "take-b-lofi-lagoon"];

function soundtrack() {
  mkdirSync(TAKES, { recursive: true });
  mkdirSync(VIDEO, { recursive: true });
  const notes = {};
  for (const [id, edit] of Object.entries(TAKE_EDITS)) {
    const { buf, notes: n } = edit();
    const out = loudnorm(fitTo(buf, 60, 0.4), -14);
    write(out, resolve(TAKES, `${id}.wav`), ["-c:a", "pcm_s16le"]);
    write(out, resolve(TAKES, `${id}.mp3`), ["-c:a", "libmp3lame", "-b:a", "256k"]);
    notes[id] = n;
    if (PICKS.includes(id)) write(out, resolve(VIDEO, `offsite-launch-${id.replace(/^take-/, "")}.mp3`), ["-c:a", "libmp3lame", "-b:a", "256k"]);
    console.log(`take ${id}: drop at ${n.drop.toFixed(2)} s`);
  }
  return notes;
}

// ---------- the game ----------
// name: the file name the app loads (apps/web/src/audio/sounds.ts); src: the cache id.

const GAME_FILES = [
  // ambience beds (stereo)
  { name: "ocean", src: "ocean-hull", loop: 1.5, ch: 2, kbps: 48, rmsDb: -20 },
  { name: "wind", src: "wind-deck", loop: 1.5, ch: 2, kbps: 48, rmsDb: -22 },
  { name: "night", src: "night-sea", loop: 1.5, ch: 2, kbps: 48, rmsDb: -22 },
  { name: "murmur", src: "office-murmur", loop: 1.5, ch: 2, kbps: 40, rmsDb: -24 },
  // positional loops (mono)
  { name: "typing", src: "typing", loop: 0.25, ch: 1, kbps: 40, rmsDb: -22 },
  { name: "server-hum", src: "server-hum", loop: 1.5, ch: 1, kbps: 40, rmsDb: -22 },
  { name: "pool-swim", src: "pool-swim", loop: 1.0, ch: 1, kbps: 40, rmsDb: -22 },
  { name: "hot-tub", src: "hot-tub", loop: 1.0, ch: 1, kbps: 40, rmsDb: -22 },
  { name: "heli-idle", src: "heli-idle", loop: 0.5, ch: 1, kbps: 48, rmsDb: -18 },
  { name: "heli-rotor", src: "heli-rotor", loop: 0.5, ch: 1, kbps: 48, rmsDb: -18 },
  // one-shots (mono, peak -1 dBFS; the catalog sets the mix)
  ...["gull-1", "gull-2", "gull-3", "gull-4"].map((id) => ({ name: id, src: id, ch: 1, kbps: 40 })),
  { name: "dolphin-splash", src: "dolphin-splash", ch: 1, kbps: 40 },
  { name: "heli-approach", src: "heli-approach", ch: 1, kbps: 48, fadeOut: 0.3 },
  { name: "heli-takeoff", src: "heli-takeoff", ch: 1, kbps: 48, fadeOut: 0.5 },
  { name: "clink-cheers", src: "clink-cheers", ch: 1, kbps: 48 },
  { name: "ice-glass", src: "ice-glass", ch: 1, kbps: 40 },
  { name: "cannonball", src: "cannonball", ch: 1, kbps: 40 },
  { name: "package-thump", src: "package-thump", ch: 1, kbps: 40 },
  // the phone (no position)
  { name: "phone-buzz", src: "phone-buzz", ch: 1, kbps: 40 },
  { name: "fold-open", src: "fold-open", ch: 1, kbps: 40, fadeOut: 0.015 },
  { name: "fold-close", src: "fold-close", ch: 1, kbps: 40, fadeOut: 0.015 },
  { name: "send-tick", src: "send-tick", ch: 1, kbps: 40, fadeOut: 0.015 },
  { name: "landed-chime", src: "landed-chime", ch: 1, kbps: 48, fadeOut: 0.2 },
];

function game() {
  rmSync(GAME, { recursive: true, force: true });
  mkdirSync(GAME, { recursive: true });
  const made = [];
  for (const f of GAME_FILES) {
    let b = load(f.src, 2);
    if (f.loop) {
      const [a, e] = bounds(b, -55);
      b = loopify(slice(b, a, e), f.loop);
      level(b, { rmsDb: f.rmsDb });
    } else {
      b = level(trim(b, { fadeOut: f.fadeOut ?? 0.04 }));
    }
    if (f.ch === 1) b = mono(b);
    writeGame(b, f.name, f.kbps);
    made.push({ name: f.name, src: f.src, seconds: secs(b), loop: !!f.loop });
  }

  // Footsteps: three single steps out of one take of someone walking.
  const walk = load("steps-teak", 2);
  const steps = events(walk).filter(([a, e]) => e - a > 0.06);
  const pick = steps.length >= 5 ? steps.slice(1, 4) : steps.slice(0, 3);
  pick.forEach(([a, e], i) => {
    const s = level(ramp(ramp(slice(walk, Math.max(0, a - 0.005), Math.min(e + 0.08, a + 0.45)), 0.003, "in"), 0.05, "out"));
    writeGame(mono(s), `step-${i + 1}`, 40);
    made.push({ name: `step-${i + 1}`, src: "steps-teak", seconds: secs(s), loop: false });
  });

  // The sun-deck bar's music: 36 bars at 100 BPM (0 to 86.4 s), its head crossfaded with the bar after.
  const lounge = level(loopify(load("bar-lounge"), 0.12, 0.01, 0.01 + 36 * bar(100)), { rmsDb: -18 });
  writeGame(lounge, "bar-music", 56);
  made.push({ name: "bar-music", src: "bar-lounge", seconds: secs(lounge), loop: true });
  return made;
}

// ---------- the video edit's effects pack (WAV, 48 kHz, 16-bit) ----------

const PACK_FILES = [
  ["phone-buzz", "phone-buzz"],
  ["helicopter-flyover", "heli-flyover"],
  ["glass-clink-cheers", "clink-cheers"],
  ["pool-cannonball-splash", "cannonball"],
  ["keyboard-typing", "typing"],
  ["landed-chime", "landed-chime"],
  ["title-whoosh", "whoosh"],
  ["record-scratch", "record-scratch"],
  ["package-thump", "package-thump"],
  ["helicopter-approach", "heli-approach"],
];

function pack() {
  rmSync(PACK, { recursive: true, force: true });
  for (const [name, src] of PACK_FILES) {
    const b = level(trim(load(src, 2), { fadeOut: 0.05 }), { peakDb: -1 });
    write(b, resolve(PACK, `${name}.wav`), ["-ar", "48000", "-c:a", "pcm_s16le"]);
  }
  return PACK_FILES;
}

// ---------- credits ----------

function promptOf(job) {
  if (job.input.text) return job.input.text;
  if (job.input.prompt) return job.input.prompt;
  const p = job.input.composition_plan;
  return `Composition plan. Global: ${p.positive_global_styles.join(", ")}; avoid ${p.negative_global_styles.join(", ")}. ` +
    p.sections.map((s) => `${s.section_name} (${s.duration_ms / 1000} s): ${s.positive_local_styles.join(", ")}`).join(". ") + ".";
}

function credits(made, notes) {
  const byId = Object.fromEntries(ALL.map((j) => [j.id, j]));
  const size = (f) => `${(statSync(f).size / 1024).toFixed(0)} KB`;
  const row = (file, srcIds, extra = "") => {
    const jobs = srcIds.map((id) => byId[id]);
    return `| \`${file}\` | ${jobs.map((j) => `\`${j.endpoint}\``).filter((v, i, a) => a.indexOf(v) === i).join(", ")} | ${jobs.map((j) => promptOf(j).replace(/\|/g, "/")).join(" / ")}${extra} |`;
  };
  const lines = [
    "# Audio credits",
    "",
    "Every sound and piece of music in Offsite was generated for it on [fal.ai](https://fal.ai), by `scripts/audio/generate.mjs`",
    "(the prompts live in `scripts/audio/jobs.mjs`), then cut, looped and encoded by `scripts/audio/build.mjs`.",
    "No third-party recordings or samples are included.",
    "",
    "## Models and terms",
    "",
    ...Object.entries(LICENSES).map(([id, text]) => `- \`${id}\`: ${text}`),
    "",
    "fal's Terms of Service make no promise that output is original; prompts here avoid artist names, songs and lyrics.",
    "",
    "## The launch video's soundtrack (`assets/audio/video/`)",
    "",
    "| file | model | prompt |",
    "|---|---|---|",
    ...PICKS.map((id) => row(`video/offsite-launch-${id.replace(/^take-/, "")}.mp3`, [id], ` (re-cut on its bar lines so the drop lands at ${notes[id].drop.toFixed(1)} s)`)),
    "",
    "## The video's effects pack (`assets/audio/video/sfx/`)",
    "",
    "| file | model | prompt |",
    "|---|---|---|",
    ...PACK_FILES.map(([name, src]) => row(`video/sfx/${name}.wav`, [src])),
    "",
    "## The game (`apps/web/public/audio/`, each as `.ogg` Opus and `.m4a` AAC)",
    "",
    "| file | model | prompt |",
    "|---|---|---|",
    ...made.map((m) => row(`${m.name}.ogg/.m4a`, [m.src], m.name.startsWith("step-") ? " (one step sliced from the take)" : m.loop ? " (looped: tail crossfaded into the head)" : "")),
    "",
  ];
  writeFileSync(resolve(REPO, "assets/audio/CREDITS.md"), lines.join("\n"));
}

// ---------- notes for the video edit ----------

const TITLES = { "take-a-sundeck-house": "Sundeck House", "take-b-lofi-lagoon": "Lo-fi Lagoon", "take-c-yacht-disco": "Yacht Disco", "take-d-stitched": "Stitched (Stable Audio)" };

function videoNotes(notes) {
  const t = (s) => `${s.toFixed(1)} s`;
  const lines = [
    "# Launch video soundtrack",
    "",
    "Two takes, 60.0 s each, MP3 256 kbps, loudness -14 LUFS integrated, true peak -1 dBTP (written by",
    "`scripts/audio/build.mjs`; credits in `../CREDITS.md`). Instrumental. The section times below were",
    "measured from each take's energy (kick, bass, overall level), not just taken from the prompt.",
    "",
  ];
  for (const id of PICKS) {
    const n = notes[id];
    lines.push(`## ${TITLES[id]}: \`offsite-launch-${id.replace(/^take-/, "")}.mp3\``, "", `**The drop lands at ${t(n.drop)}.**`, "");
    for (const [at, what] of n.sections) lines.push(`- ${t(at)}: ${what}`);
    lines.push("");
  }
  lines.push(
    "## The other candidates",
    "",
    "Rendered to `scripts/audio/.cache/takes/` (git-ignored) by the build, for auditioning:",
    "",
    ...Object.keys(TAKE_EDITS).filter((id) => !PICKS.includes(id)).map((id) => `- ${TITLES[id]} (\`${id}.mp3\`): drop at ${t(notes[id].drop)}`),
    "",
    "Every Eleven Music take came back with its drop at 31 to 34 s rather than 27 s, so each was re-cut",
    "on its own bar lines: whole bars out before the drop, the same number repeated after it, joins",
    "crossfaded over 30 ms. The uncut takes are in `scripts/audio/.cache/take-*.wav`.",
    "",
  );
  writeFileSync(resolve(VIDEO, "README.md"), lines.join("\n"));
}

// ---------- the app's list of files ----------

/** apps/web/src/audio/files.ts: what build made, and each loop's exact length (codec padding aside). */
function manifest(made) {
  const lines = [
    "// Generated by scripts/audio/build.mjs: do not edit. The files in apps/web/public/audio, each as",
    "// .ogg (Opus) and .m4a (AAC). seconds is the length the build wrote: loops repeat over exactly that",
    "// (AAC pads its last frame with silence, which would otherwise leave a gap).",
    "",
    "export const AUDIO_FILES = {",
    ...[...made].sort((a, b) => a.name.localeCompare(b.name)).map((m) => `  ${JSON.stringify(m.name)}: { seconds: ${m.seconds.toFixed(4)}, loop: ${m.loop} },`),
    "} as const;",
    "",
    "export type AudioFile = keyof typeof AUDIO_FILES;",
    "",
  ];
  writeFileSync(resolve(REPO, "apps/web/src/audio/files.ts"), lines.join("\n"));
}

// ---------- run ----------

if (!existsSync(CACHE)) { console.error("No scripts/audio/.cache: run node scripts/audio/generate.mjs first"); process.exit(1); }
const notes = soundtrack();
const made = game();
pack();
writeFileSync(resolve(TAKES, "notes.json"), JSON.stringify(notes, null, 2));
credits(made, notes);
manifest(made);
videoNotes(notes);

const total = (dir) => readdirSync(dir).reduce((n, f) => n + statSync(resolve(dir, f)).size, 0);
console.log(`game audio: ${(total(GAME) / 1024 / 1024).toFixed(2)} MB in ${readdirSync(GAME).length} files`);
console.log(`video sfx pack: ${(total(PACK) / 1024 / 1024).toFixed(2)} MB`);
