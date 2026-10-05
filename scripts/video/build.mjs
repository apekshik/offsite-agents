// Renders the launch video from its edit decision list (edl.mjs): the film rig's clips
// (.shots/film, `pnpm film all`), graphics drawn frame by frame in headless Chrome
// (graphics/), the soundtrack and the effects pack (assets/audio/video).
//
//   pnpm video                 every cut: offsite-launch-a.mp4, -b.mp4, -30s.mp4, and the thumbnail
//   pnpm video a b             just these cuts (a, b, 30s), plus `thumb` for the thumbnail
//   --draft                    a fast encode, for checking a cut
//   --out <dir>                default .shots/video
//
// Output: H.264 high profile 1080p60 yuv420p (~18 Mbps), AAC 320 kbps, -14 LUFS integrated and
// -1 dBTP true peak, moov up front. Needs ffmpeg and Chrome (playwright-core drives the installed one).

import { chromium } from "playwright-core";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cutFor, FPS, LENGTH } from "./edl.mjs";
import { shortCut } from "./short.mjs";
import { assertClean, terminalScript } from "./terminal.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : fallback; };
const draft = flag("draft");
const out = resolve(repo, opt("out", ".shots/video"));
const cache = join(here, ".cache");
const wanted = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--out");
const TAKES = wanted.length ? wanted : ["a", "b", "30s", "thumb"];
const W = 1920, H = 1080;
const CAST = join(repo, ".shots/real-run/runner-tidy.cast");

mkdirSync(out, { recursive: true });
mkdirSync(cache, { recursive: true });

const run = (cmd, args, { quiet = false } = {}) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`${cmd} failed:\n${(r.stderr || "").split("\n").slice(-25).join("\n")}`);
  if (!quiet && r.stderr) process.stderr.write("");
  return r;
};
const secs = (file) => Number(run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).stdout.trim());
const frameCount = (file) => Math.round(secs(file) * FPS);
const log = (...a) => console.log(...a);

// ---------------- fonts: Saira and JetBrains Mono, fetched once from Google Fonts ----------------

async function fonts() {
  const dir = join(cache, "fonts");
  const css = join(dir, "fonts.css");
  if (existsSync(css)) return dir;
  mkdirSync(dir, { recursive: true });
  const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
  const url = "https://fonts.googleapis.com/css2?family=Saira:wdth,wght@50..125,300..800&family=JetBrains+Mono:wght@400;600&display=block";
  let text = await (await fetch(url, { headers: { "user-agent": ua } })).text();
  let n = 0;
  for (const m of [...text.matchAll(/url\((https:[^)]+)\)/g)]) {
    const name = `f${n++}${extname(new URL(m[1]).pathname) || ".woff2"}`;
    writeFileSync(join(dir, name), Buffer.from(await (await fetch(m[1])).arrayBuffer()));
    text = text.replace(m[1], name);
  }
  writeFileSync(css, text);
  log(`fonts: ${n} files → ${dir}`);
  return dir;
}

// ---------------- the graphics page ----------------

const ORIGIN = "https://offsite.video";
let browser = null;

async function graphicsPage(size = [W, H]) {
  browser ??= await chromium.launch({ channel: "chrome", headless: true, args: ["--hide-scrollbars", "--force-color-profile=srgb", "--font-render-hinting=none"] });
  const fontDir = await fonts();
  const context = await browser.newContext({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: 1 });
  await context.route(`${ORIGIN}/**`, (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\//, "");
    const file = path.startsWith("fonts/") ? join(fontDir, path.slice(6)) : path.startsWith("frames/") ? join(cache, path) : join(here, "graphics", path);
    if (!existsSync(file)) return route.fulfill({ status: 404, body: "" });
    const type = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".woff2": "font/woff2", ".ttf": "font/ttf", ".png": "image/png", ".jpg": "image/jpeg" }[extname(file)] ?? "application/octet-stream";
    return route.fulfill({ status: 200, body: readFileSync(file), headers: { "content-type": type } });
  });
  // Nothing but our own files: a stray request would make a frame depend on the network.
  await context.route((u) => !u.href.startsWith(ORIGIN), (route) => route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(`${ORIGIN}/index.html`, { waitUntil: "load" });
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
  return { context, page, cdp, errors };
}

/** Every frame of the cut's graphics, as a PNG-in-MOV with alpha (transparent where nothing is drawn). */
async function renderGraphics(cut, file) {
  const t0 = Date.now();
  const { context, page, cdp, errors } = await graphicsPage();
  const families = await page.evaluate((c) => window.setup(c), cut);
  for (const f of ["Saira", "JetBrains Mono"]) if (!families.includes(f)) throw new Error(`graphics: font ${f} didn't load (${families.join(", ")})`);
  const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "png", "-i", "-", "-c:v", "png", "-pix_fmt", "rgba", file], { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise((res, rej) => ff.on("close", (c) => (c === 0 ? res() : rej(new Error(`ffmpeg exited ${c}`)))));
  const write = (buf) => new Promise((res) => { if (ff.stdin.write(buf)) res(); else ff.stdin.once("drain", res); });
  let blank = null, drawn = 0;
  const seen = new Set();
  const n = cut.length * FPS;
  for (let i = 0; i < n; i++) {
    const r = await page.evaluate((t) => window.frame(t), i / FPS);
    if (r.text && !seen.has(r.text)) { seen.add(r.text); assertClean(r.text, `graphics at ${(i / FPS).toFixed(2)} s`); }
    if (!r.visible) {
      blank ??= Buffer.from((await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true })).data, "base64");
      await write(blank);
      continue;
    }
    const shot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true, optimizeForSpeed: true });
    await write(Buffer.from(shot.data, "base64"));
    drawn++;
  }
  ff.stdin.end();
  await done;
  await context.close();
  if (errors.length) throw new Error(`graphics page errors:\n  ${errors.join("\n  ")}`);
  log(`  graphics: ${n} frames (${drawn} drawn) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

// ---------------- sound ----------------

function mixAudio(cut, file) {
  const inputs = ["-i", join(repo, cut.music.file)];
  const base = "aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo";
  const chains = [], labels = [];
  const pieces = cut.music.pieces;
  if (!pieces) {
    chains.push(`[0:a]${base}[m]`);
    labels.push("[m]");
  } else {
    // A re-cut take: each piece laid at its place, joined with 30 ms crossfades on the bar lines.
    const X = 0.015;
    chains.push(`[0:a]${base},asplit=${pieces.length}${pieces.map((_, i) => `[p${i}]`).join("")}`);
    pieces.forEach((p, i) => {
      const from = p.at > 0 ? Math.max(0, p.from - X) : p.from, lead = p.from - from;
      chains.push(`[p${i}]atrim=start=${from}:end=${p.to + X},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=${2 * X},afade=t=out:st=${p.to - from - X}:d=${2 * X},adelay=${Math.round((p.at - lead) * 1000)}:all=1[m${i}]`);
      labels.push(`[m${i}]`);
    });
  }
  cut.sfx.forEach((x, i) => {
    inputs.push("-i", join(repo, "assets/audio/video/sfx", `${x.file}.wav`));
    const k = i + 1, len = x.dur ?? 30;
    const f = [`[${k}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo`, `atrim=start=${x.from ?? 0}:duration=${len}`, "asetpts=PTS-STARTPTS"];
    if (x.fadeIn) f.push(`afade=t=in:st=0:d=${x.fadeIn}`);
    if (x.fadeOut && x.dur) f.push(`afade=t=out:st=${Math.max(0, x.dur - x.fadeOut)}:d=${x.fadeOut}`);
    f.push(`volume=${x.gain ?? 0}dB`);
    // Clicks and slaps peak far above their loudness: hold their peaks down so the mix isn't limited on them.
    if (x.limit !== undefined) f.push("aresample=192000", `alimiter=limit=${Math.pow(10, x.limit / 20).toFixed(4)}:attack=0.5:release=30:level=false`, "aresample=48000");
    f.push(`adelay=${Math.max(0, Math.round(x.at * 1000))}:all=1`);
    chains.push(`${f.join(",")}[s${k}]`);
    labels.push(`[s${k}]`);
  });
  const graph = [...chains, `${labels.join("")}amix=inputs=${labels.length}:normalize=0:duration=longest,atrim=0:${cut.length},apad=whole_dur=${cut.length}[mix]`].join(";");
  const raw = file.replace(/\.wav$/, "-raw.wav");
  run("ffmpeg", ["-y", "-loglevel", "error", ...inputs, "-filter_complex", graph, "-map", "[mix]", "-c:a", "pcm_f32le", raw]);
  // Loudness: measure the mix, bring it to -14 LUFS with one gain, and catch the peaks with a
  // limiter run at 4× the sample rate (so it sees inter-sample peaks), under -1 dBTP with room for AAC.
  const measure = (f) => {
    const e = run("ffmpeg", ["-hide_banner", "-nostats", "-i", f, "-af", "ebur128=peak=true", "-f", "null", "-"]).stderr;
    return { I: Number(e.match(/I:\s+(-?[\d.]+) LUFS/g).pop().match(/-?[\d.]+/)[0]), TP: Number(e.match(/Peak:\s+(-?[\d.]+) dBFS/g).pop().match(/-?[\d.]+/)[0]) };
  };
  const before = measure(raw);
  let gain = -14 - before.I, after = null;
  for (let pass = 0; pass < 3; pass++) {
    run("ffmpeg", ["-y", "-loglevel", "error", "-i", raw, "-af", `volume=${gain.toFixed(2)}dB,aresample=192000,alimiter=limit=${Math.pow(10, -2.2 / 20).toFixed(4)}:attack=2:release=60:level=false,aresample=48000`, "-c:a", "pcm_f32le", file]);
    after = measure(file);
    if (Math.abs(after.I + 14) < 0.15) break;
    gain += -14 - after.I;
  }
  log(`  sound: mix ${before.I} LUFS, ${before.TP} dBTP → ${after.I} LUFS, ${after.TP} dBTP`);
}

// ---------------- picture ----------------

/**
 * Each shot cut out of its clip into a lossless segment (trimmed by frame, sped up, cropped), then
 * joined: one simple ffmpeg run per shot instead of a graph with every clip open at once.
 */
function segments(cut, name) {
  const dir = join(cache, `segments-${name}`);
  mkdirSync(dir, { recursive: true });
  const files = [];
  const lossless = ["-c:v", "libx264", "-qp", "0", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709"];
  cut.shots.forEach((s, i) => {
    const clip = join(repo, ".shots/film", `${s.clip}.mp4`);
    const have = frameCount(clip);
    let start = Math.round(s.in * FPS);
    const need = Math.ceil(s.frames * s.speed) + 1;
    if (start + need > have) {
      log(`  ! ${s.clip}: wants frames ${start}–${start + need} of ${have}; starting earlier`);
      start = Math.max(0, have - need);
    }
    const f = [`trim=start_frame=${start}:end_frame=${Math.min(have, start + need)}`, "setpts=PTS-STARTPTS"];
    if (s.speed !== 1) f.push(`setpts=PTS/${s.speed}`, `fps=${FPS}`);
    if (s.zoom !== 1) {
      const w = Math.round((W * s.zoom) / 2) * 2, h = Math.round((H * s.zoom) / 2) * 2;
      f.push(`scale=${w}:${h}:flags=lanczos`, `crop=${W}:${H}:${(w - W) / 2}:${Math.round((h - H) * s.anchor)}`);
    }
    f.push("format=yuv420p", "setsar=1");
    const file = join(dir, `${String(i).padStart(2, "0")}-${s.clip}.mkv`);
    run("ffmpeg", ["-y", "-loglevel", "error", "-i", clip, "-vf", f.join(","), "-frames:v", String(s.frames), "-r", String(FPS), ...lossless, file]);
    const got = frameCount(file);
    if (got !== s.frames) throw new Error(`${s.clip}: segment has ${got} frames, wanted ${s.frames}`);
    files.push(file);
  });
  const rest = cut.length * FPS - cut.shots.reduce((a, s) => a + s.frames, 0);
  const tail = join(dir, "99-tail.mkv");
  run("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", `color=c=black:s=${W}x${H}:r=${FPS}`, "-frames:v", String(rest), ...lossless, tail]);
  files.push(tail);
  const list = join(dir, "list.txt");
  writeFileSync(list, files.map((f) => `file '${f}'`).join("\n") + "\n");
  return list;
}

function encode(cut, name, gfx, wav, file) {
  const list = segments(cut, name);
  const graph = [
    // The graphics are sRGB: into BT.709 limited range, the clips' space, before they're laid on top.
    `[1:v]format=rgba,scale=out_color_matrix=bt709:out_range=tv,format=yuva444p[gfx]`,
    `[0:v]format=yuv444p[base]`,
    `[base][gfx]overlay=format=yuv444:eof_action=repeat,format=yuv420p[out]`,
  ];
  const x264 = draft
    ? ["-preset", "veryfast", "-crf", "20"]
    : ["-preset", "slow", "-b:v", "20M", "-maxrate", "26M", "-bufsize", "36M", "-profile:v", "high", "-level:v", "4.2", "-g", "30", "-bf", "2", "-x264-params", "open-gop=0"];
  run("ffmpeg", [
    "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-i", gfx, "-i", wav,
    "-filter_complex", graph.join(";"), "-map", "[out]", "-map", "2:a",
    "-c:v", "libx264", ...x264, "-pix_fmt", "yuv420p", "-r", String(FPS), "-frames:v", String(cut.length * FPS),
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
    "-c:a", "aac", "-b:a", "320k", "-ar", "48000", "-t", String(cut.length), "-movflags", "+faststart", file,
  ]);
}

/** What the finished file measures: length, bitrate, loudness, true peak. */
function report(file) {
  const p = JSON.parse(run("ffprobe", ["-v", "error", "-show_entries", "format=duration,bit_rate:stream=codec_name,profile,width,height,r_frame_rate,pix_fmt,bit_rate,sample_rate", "-of", "json", file]).stdout);
  const e = run("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-map", "0:a", "-af", "ebur128=peak=true", "-f", "null", "-"]).stderr;
  const I = e.match(/I:\s+(-?[\d.]+) LUFS/g)?.pop(), TP = e.match(/Peak:\s+(-?[\d.]+) dBFS/g)?.pop();
  const v = p.streams.find((s) => s.codec_name === "h264"), au = p.streams.find((s) => s.codec_name === "aac");
  log(`  → ${file}\n    ${(+p.format.duration).toFixed(2)} s · ${v.profile} ${v.width}×${v.height} ${v.r_frame_rate} ${v.pix_fmt} ${(v.bit_rate / 1e6).toFixed(1)} Mbps · aac ${(au.bit_rate / 1000).toFixed(0)} kbps · ${I} · true peak ${TP}`);
}

// ---------------- a cut, start to finish ----------------

async function build(name) {
  const t0 = Date.now();
  const cut = name === "30s" ? shortCut() : cutFor(name);
  cut.terminal = terminalScript(CAST);
  assertClean(JSON.stringify(cut.terminal), "terminal script");
  for (const g of cut.graphics) assertClean([g.text, g.tagline, ...(g.caption ?? []), ...(g.lines ?? []), g.foot].filter(Boolean).join("\n"), `graphic ${g.kind}`);
  writeFileSync(join(cache, `cut-${name}.json`), JSON.stringify(cut, null, 2));
  log(`${name}: ${cut.shots.length} shots, graphics from ${cut.graphicsStart.toFixed(2)} s`);
  for (const s of cut.shots) log(`  ${(s.from / FPS).toFixed(2).padStart(6)}  ${s.clip.padEnd(13)} ${(s.frames / FPS).toFixed(2)} s  from ${s.in.toFixed(2)}${s.speed !== 1 ? ` ×${s.speed}` : ""}`);
  const gfx = join(cache, `graphics-${name}.mov`), wav = join(cache, `sound-${name}.wav`);
  if (!(flag("keep-graphics") && existsSync(gfx))) await renderGraphics(cut, gfx);
  mixAudio(cut, wav);
  const file = join(out, name === "30s" ? "offsite-launch-30s.mp4" : `offsite-launch-${name}.mp4`);
  encode(cut, name, gfx, wav, file);
  report(file);
  log(`  ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

/** The YouTube thumbnail: a frame of the film behind a bold title, 1280×720 JPEG. */
async function thumbnail() {
  // The README's hero (pnpm film:stills hero): the yacht at golden hour, open sea on the right for the words.
  const src = join(repo, ".shots/film/stills/hero.png");
  const still = join(cache, "frames", "thumb.png");
  mkdirSync(dirname(still), { recursive: true });
  run("ffmpeg", ["-y", "-loglevel", "error", "-i", src, "-frames:v", "1", "-vf", "scale=1280:720:flags=lanczos", still]);
  const { context, page, errors } = await graphicsPage([1280, 720]);
  await page.evaluate((o) => window.thumb(o), { image: "frames/thumb.png", word: "Offsite", tag: "Take your coding agents<br>on an <em>offsite</em>.", chip: "Claude Code + Codex, on your own subscriptions" });
  const file = join(out, "offsite-launch-thumbnail.jpg");
  await page.screenshot({ path: file, type: "jpeg", quality: 92 });
  await context.close();
  if (errors.length) throw new Error(`thumbnail page errors:\n  ${errors.join("\n  ")}`);
  log(`thumbnail → ${file}`);
}

try {
  for (const name of TAKES) {
    if (name === "thumb") await thumbnail();
    else await build(name);
  }
} finally {
  await browser?.close();
}
