#!/usr/bin/env node
// Rebuilds docs/media, the README's pictures, from the rendered stills and the real run's
// screenshots, and the animated loop at the top from the film's clips. The sources are local and
// gitignored (.shots/); the WebP copies here are committed.
//
//   pnpm film:stills                  render the stills first (.shots/film/stills/*.png)
//   pnpm film bar pool scramble night-office   and the clips the loop is cut from (.shots/film/*.mp4)
//   node scripts/readme-media.mjs     → docs/media/*.webp, each under its budget
//   node scripts/readme-media.mjs --check   list what would be made and which sources are missing
//   node scripts/readme-media.mjs --loop    only the loop (and its poster)
//
// Each picture is resized to its width and encoded with cwebp, starting at a high quality and
// stepping down until it fits its budget (400 KB unless noted). The real run's pictures are listed
// one by one on purpose: some of its screenshots show the account email, and those stay out.
//
// The loop (LOOP below) is cut and cross-faded by ffmpeg into frames, then assembled into an
// animated WebP by img2webp (this ffmpeg has no WebP encoder, and img2webp's is the better one).
// Its last cut fades into the moment just before its first frame, so it loops without a jump.
// GitHub serves README images from the repo as image/webp, so it plays in Chrome, Safari and Firefox.
//
// Needs cwebp and img2webp (macOS: brew install webp; Debian/Ubuntu: apt install webp) and ffmpeg.

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stills = join(repo, ".shots/film/stills");
const real = join(repo, ".shots/real-run");
const clips = join(repo, ".shots/film");
const out = join(repo, "docs/media");

const KB = 1024;
const BUDGET = 400 * KB;
const TOTAL = 12 * 1024 * KB;

/**
 * The loop at the top of the README: who's aboard, at a glance. Each cut is [clip, in, out] in
 * seconds (.shots/film/SHOTLOG.md); cuts cross-fade for `fade` seconds. The last cut ends where the
 * first begins, and fades in over its whole length, so the end runs straight into the start.
 */
const LOOP = {
  file: "hero-loop.webp",
  poster: { file: "hero-poster.webp", at: 2.0, budget: 200 * KB },
  width: 1000,
  fps: 15,
  fade: 0.3,
  budget: 4.6 * 1024 * KB,
  cuts: [
    ["bar", 1.6, 4.6], // Pike: "what'll it be?" Wren: "something with no merge conflicts"
    ["pool", 1.5, 3.6], // Bodhi's cannonball; "BODHI!"
    ["scramble", 0.8, 2.8], // the phones buzz: drinks down, out of the hot tub
    ["night-office", 0.5, 2.5], // night: the office lit, everyone at work
    ["bar", 1.1, 1.6], // back to the bar, into the first frame
  ],
};

/** [output name, source, width, budget?] */
const still = (name, width = 1600, budget = BUDGET) => [`${name}.webp`, join(stills, `${name}.png`), width, budget];
const MEDIA = [
  // The hero: the plain one in the README, a sharper one (from the 4K render) behind its link.
  still("hero", 1920),
  ["hero@2x.webp", join(stills, "hero@2x.png"), 2880, BUDGET],
  // Life on board: two to a row under the title, so a little smaller.
  ...["bar", "hottub", "cannonball", "gym", "scramble", "night"].map((n) => still(`life-${n}`, 1200, 200 * KB)),
  // How a thread plays out: shown two to a row, so a little smaller.
  ...["thread-1-ask", "thread-2-plan", "thread-3-crew", "thread-4-work", "thread-5-review", "thread-6-pr"].map((n) => still(n, 1280, 300 * KB)),
  still("cast", 1920),
  ...["sunset", "night"].flatMap((t) => ["aerial", "sundeck", "office", "stern"].map((p) => still(`yacht-${t}-${p}`, 1600, 300 * KB))),
  still("phone", 1600, 300 * KB),
  still("helm", 1600, 300 * KB),
  still("crew-card", 1600, 300 * KB),
  // The real run (.shots/real-run): Claude Code and Codex on a sample repo. Only screenshots
  // without the account email.
  ["real-ask.webp", join(real, "progress/phone-thread-early.png"), 1600, 300 * KB],
  ["real-working.webp", join(real, "progress/crew-arlo-codex-working.png"), 1600, 300 * KB],
  ["real-off-duty.webp", join(real, "card-indy-claude.png"), 1600, 300 * KB],
  ["real-diff.webp", join(real, "diff-thread.png"), 1600, 300 * KB],
  ["real-app-light.webp", join(real, "app/app-counter-7-light.png"), 1200, 150 * KB],
  ["real-app-dark.webp", join(real, "app/app-counter-7-dark.png"), 1200, 150 * KB],
];

const check = process.argv.includes("--check");
const loopOnly = process.argv.includes("--loop");
const loopSources = [...new Set(LOOP.cuts.map(([clip]) => join(clips, `${clip}.mp4`)))];
const missing = [...(loopOnly ? [] : MEDIA.map(([, src]) => src)), ...loopSources].filter((src) => !existsSync(src));
if (check) {
  for (const [name, src, width, budget] of MEDIA) console.log(`${existsSync(src) ? "ok     " : "missing"} ${name.padEnd(28)} ${String(width).padStart(4)} px  ≤${Math.round(budget / KB)} KB  ← ${src.slice(repo.length + 1)}`);
  const length = LOOP.cuts.reduce((a, [, from, to]) => a + to - from, 0) - LOOP.fade * (LOOP.cuts.length - 2) - (LOOP.cuts.at(-1)[2] - LOOP.cuts.at(-1)[1]);
  console.log(`${loopSources.every(existsSync) ? "ok     " : "missing"} ${LOOP.file.padEnd(28)} ${String(LOOP.width).padStart(4)} px  ≤${Math.round(LOOP.budget / KB)} KB  ← ${LOOP.cuts.map(([c, a, b]) => `${c} ${a}–${b}`).join(", ")} (${length.toFixed(1)} s at ${LOOP.fps} fps)`);
  process.exit(missing.length ? 1 : 0);
}
if (missing.length) {
  console.error(`Missing sources (render them with \`pnpm film:stills\` and \`pnpm film <clip>\`, or keep the old copies):\n${missing.map((s) => `  ${s.slice(repo.length + 1)}`).join("\n")}`);
  process.exit(1);
}
for (const [tool, args] of [["cwebp", ["-version"]], ["img2webp", ["-version"]], ["ffmpeg", ["-version"]]]) {
  if (spawnSync(tool, args).status !== 0) {
    console.error(`${tool} isn't on the PATH. macOS: brew install webp ffmpeg; Debian/Ubuntu: apt install webp ffmpeg.`);
    process.exit(1);
  }
}
const run = (tool, args) => {
  const r = spawnSync(tool, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) { console.error(`${tool} failed:\n${r.stderr}`); process.exit(1); }
  return r;
};

mkdirSync(out, { recursive: true });
const made = new Set();
let total = 0;

// ---- the loop: ffmpeg cuts, scales and cross-fades the clips into frames; img2webp animates them ----
{
  const frames = mkdtempSync(join(tmpdir(), "readme-loop-"));
  const inputs = LOOP.cuts.flatMap(([clip, from, to]) => ["-ss", String(from), "-t", String(to - from), "-i", join(clips, `${clip}.mp4`)]);
  const prep = LOOP.cuts.map((_, i) => `[${i}]fps=${LOOP.fps},scale=${LOOP.width}:-2:flags=lanczos,setsar=1,settb=AVTB[c${i}]`);
  // Each fade starts `fade` before the end of what's been joined so far; the last one is as long as its cut.
  let length = LOOP.cuts[0][2] - LOOP.cuts[0][1];
  let prev = "c0";
  const joins = LOOP.cuts.slice(1).map(([, from, to], k) => {
    const i = k + 1;
    const len = to - from;
    const fade = i === LOOP.cuts.length - 1 ? len : LOOP.fade;
    const step = `[${prev}][c${i}]xfade=transition=fade:duration=${fade}:offset=${(length - fade).toFixed(3)}[j${i}]`;
    length += len - fade;
    prev = `j${i}`;
    return step;
  });
  // The clips are limited-range BT.709; the frames full-range RGB.
  const graph = [...prep, ...joins, `[${prev}]scale=in_color_matrix=bt709:in_range=tv:out_range=pc,format=rgb24[out]`].join(";");
  run("ffmpeg", ["-loglevel", "error", "-y", ...inputs, "-filter_complex", graph, "-map", "[out]", join(frames, "%04d.png")]);
  const pngs = readdirSync(frames).filter((f) => f.endsWith(".png")).sort().map((f) => join(frames, f));
  const ms = Math.round(1000 / LOOP.fps);
  const tmp = join(frames, LOOP.file);
  let size = Infinity, used = 0;
  // Every frame a key frame (-kmax 1): img2webp's lossy frame-to-frame patches leave stale blocks in
  // the sky as the camera moves. Whole frames cost about a tenth more and stay clean.
  for (let q = 60; q >= 30; q -= 5) {
    used = q;
    run("img2webp", ["-kmax", "1", "-loop", "0", "-lossy", "-q", String(q), "-m", "6", "-d", String(ms), ...pngs, "-o", tmp]);
    size = statSync(tmp).size;
    if (size <= LOOP.budget) break;
  }
  if (size > LOOP.budget) console.warn(`  ${LOOP.file} is still ${Math.round(size / KB)} KB at the lowest quality (budget ${Math.round(LOOP.budget / KB)} KB)`);
  copyFileSync(tmp, join(out, LOOP.file));
  made.add(LOOP.file);
  total += size;
  console.log(`${LOOP.file.padEnd(28)} ${String(LOOP.width).padStart(4)} px  q${String(used).padEnd(3)} ${String(Math.round(size / KB)).padStart(4)} KB  ${pngs.length} frames, ${(pngs.length / LOOP.fps).toFixed(1)} s at ${LOOP.fps} fps`);
  // The poster: one frame of it, for anyone who'd rather it didn't move.
  const p = LOOP.poster;
  const frame = pngs[Math.min(pngs.length - 1, Math.round(p.at * LOOP.fps))];
  const ptmp = join(frames, p.file);
  for (let q = 88; q >= 55; q -= 3) {
    used = q;
    run("cwebp", ["-quiet", "-q", String(q), "-m", "6", "-sharp_yuv", "-metadata", "none", frame, "-o", ptmp]);
    if (statSync(ptmp).size <= p.budget) break;
  }
  copyFileSync(ptmp, join(out, p.file));
  made.add(p.file);
  total += statSync(ptmp).size;
  console.log(`${p.file.padEnd(28)} ${String(LOOP.width).padStart(4)} px  q${String(used).padEnd(3)} ${String(Math.round(statSync(ptmp).size / KB)).padStart(4)} KB  frame at ${p.at} s`);
  rmSync(frames, { recursive: true, force: true });
}

if (loopOnly) process.exit(0);

for (const [name, src, width, budget] of MEDIA) {
  const dest = join(out, name);
  const tmp = join(tmpdir(), `readme-media-${process.pid}-${name}`);
  let size = Infinity;
  let used = 0;
  for (let q = 88; q >= 55; q -= 3) {
    used = q;
    const r = spawnSync("cwebp", ["-quiet", "-q", String(q), "-m", "6", "-sharp_yuv", "-metadata", "none", "-resize", String(width), "0", src, "-o", tmp], { encoding: "utf8" });
    if (r.status !== 0) { console.error(`cwebp failed on ${src}:\n${r.stderr}`); process.exit(1); }
    size = statSync(tmp).size;
    if (size <= budget) break;
  }
  if (size > budget) console.warn(`  ${name} is still ${Math.round(size / KB)} KB at the lowest quality (budget ${Math.round(budget / KB)} KB)`);
  copyFileSync(tmp, dest);
  rmSync(tmp, { force: true });
  made.add(name);
  total += size;
  console.log(`${name.padEnd(28)} ${String(width).padStart(4)} px  q${String(used).padEnd(3)} ${String(Math.round(size / KB)).padStart(4)} KB`);
}

// Pictures nobody lists any more go, so the folder only holds what the README can use.
for (const f of readdirSync(out)) if (f.endsWith(".webp") && !made.has(f)) { rmSync(join(out, f)); console.log(`removed ${f}`); }

console.log(`\n${made.size} pictures, ${(total / 1024 / 1024).toFixed(2)} MB in docs/media`);
if (total > TOTAL) { console.error(`That's over the ${TOTAL / 1024 / 1024} MB budget for the folder: lower some widths or budgets above.`); process.exit(1); }
