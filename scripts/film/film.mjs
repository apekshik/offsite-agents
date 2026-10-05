// Renders the launch film's shots and the README's pictures from the film page
// (apps/web/dev/film.html, apps/web/src/film): the real game and interface on a scripted ship and a
// virtual clock, stepped exactly 1/60 s a frame by this script and captured frame by frame, so a
// clip is perfectly smooth however long each frame takes to draw.
//
//   pnpm film <shot…|all>        clips → .shots/film/<shot>.mp4 (1920×1080, 60 fps, H.264)
//   pnpm film:stills [still…]    README pictures → .shots/film/stills/<file>.png
//   pnpm film list               every shot and still
//
//   --url http://localhost:5191  use a running vite instead of starting one (no HMR mid-render, though)
//   --jobs 2                     render this many shots at once (default 1)
//   --draft                      30 fps and lighter encoding, for checking a cut quickly
//   --frames                     also keep each clip's frames as JPEGs (.shots/film/<shot>/)
//   --check                      report repeated frames (a frame identical to the one before)
//   --peek                       no clip: the first, middle and last frames as JPEGs (.shots/film/peek/), for framing
//   --where 0,2.5,5              with --peek: who is where (crew, activity, slot, position) at those seconds of the shot
//   --out <dir>                  default .shots/film
//   --story s --warmup s --duration s --cam x,y,z,tx,ty,tz[,fov]
//                                override a shot's timing or hold its camera somewhere (with --peek, for framing)
//
// Needs ffmpeg on the PATH, and Chrome (playwright-core drives the installed one, GPU on).

import { chromium } from "playwright-core";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const valued = new Set(["url", "jobs", "out", "story", "warmup", "duration", "cam", "where"]);
const whereAt = (opt("where", "") || "").split(",").filter(Boolean).map(Number);
const overrides = ["story", "warmup", "duration", "cam"].filter((k) => opt(k, null) !== null).map((k) => `&${k}=${encodeURIComponent(opt(k))}`).join("");
const names = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && valued.has(argv[i - 1]?.slice(2))));
const stills = flag("stills");
const draft = flag("draft");
const keepFrames = flag("frames");
const check = flag("check");
const peek = flag("peek");
const jobs = Math.max(1, Number(opt("jobs", "1")));
const out = resolve(repo, opt("out", ".shots/film"));

if (spawnSync("ffmpeg", ["-version"]).status !== 0 && !stills) {
  console.error("ffmpeg isn't on the PATH: brew install ffmpeg");
  process.exit(1);
}

// ---- the page server: our own vite, with no file watching, so edits elsewhere can't reload a page mid-shot ----

let server = null;
let base = opt("url", null);
if (!base) {
  const { createServer } = await import("vite");
  server = await createServer({
    configFile: join(repo, "apps/web/vite.config.ts"),
    root: join(repo, "apps/web"),
    logLevel: "warn",
    clearScreen: false,
    server: { port: 5190, strictPort: false, hmr: false, watch: null },
  });
  await server.listen();
  base = server.resolvedUrls.local[0].replace(/\/$/, "");
}

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--hide-scrollbars"],
});

async function openShot(name, [width, height]) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, timezoneId: "America/Los_Angeles", locale: "en-GB", reducedMotion: "no-preference", colorScheme: "dark" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.stack ?? e).split("\n").slice(0, 4).join("\n")));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(`${base}/dev/film.html?shot=${encodeURIComponent(name)}&capture${overrides}`, { waitUntil: "load", timeout: 180_000 });
  // Ready: the world built, the crew aboard, fonts and textures in. A page error before then is fatal.
  const until = Date.now() + 180_000;
  for (;;) {
    if (errors.length) throw new Error(`${name}: the page failed while loading:\n    ${errors.slice(0, 4).join("\n    ")}`);
    if (await page.evaluate(() => !!window.film && window.film.ready())) break;
    if (Date.now() > until) throw new Error(`${name}: not ready after 3 minutes`);
    await page.waitForTimeout(150);
  }
  await page.waitForLoadState("networkidle");
  // Anything fetched from here on would pop in mid-shot.
  const late = [];
  page.on("request", (r) => { if (!r.url().startsWith("data:")) late.push(r.url()); });
  const cdp = await context.newCDPSession(page);
  return { context, page, cdp, errors, late };
}

async function grab(cdp, format) {
  const r = await cdp.send("Page.captureScreenshot", { format, ...(format === "jpeg" ? { quality: draft ? 85 : 95 } : {}), optimizeForSpeed: true, fromSurface: true });
  return Buffer.from(r.data, "base64");
}

const stamp = (ms) => `${(ms / 1000).toFixed(1)}s`;

async function peekClip(shot) {
  const t0 = Date.now();
  const { context, page, cdp, errors } = await openShot(shot.name, shot.size);
  const n = Math.max(1, Math.round(Number(opt("duration", shot.duration)) * 60));
  const want = [[0, "a"], [Math.floor(n / 2), "b"], [n - 1, "c"]];
  mkdirSync(join(out, "peek"), { recursive: true });
  let i = 0;
  for (;;) {
    const r = await page.evaluate(() => window.film.frame());
    const mark = whereAt.find((m) => Math.abs(r.t - m) < 0.5 / 60);
    if (mark !== undefined) {
      console.log(`${shot.name} at ${mark}s:`);
      for (const w of await page.evaluate(() => window.film.where())) {
        console.log(`  ${w.crew.padEnd(8)} ${String(w.activity).padEnd(10)} ${String(w.target?.slotId ?? w.target?.kind ?? "").padEnd(22)} ${w.arrived ? "at" : "->"} ${w.pos.join(", ")}`);
      }
    }
    if (r.record) {
      const tags = want.filter(([at]) => at === i).map(([, tag]) => tag);
      if (tags.length) { const buf = await grab(cdp, "jpeg"); for (const tag of tags) writeFileSync(join(out, "peek", `${shot.name}-${tag}.jpg`), buf); }
      i++;
    }
    if (r.done) break;
  }
  await context.close();
  console.log(`${shot.name}: peeked → ${join(out, "peek", `${shot.name}-{a,b,c}.jpg`)} (${stamp(Date.now() - t0)})`);
  if (errors.length) console.log(`  ! page errors:\n    ${errors.slice(0, 6).join("\n    ")}`);
  return { name: shot.name, frames: 0, wall: 0, ready: 0 };
}

async function renderClip(shot) {
  if (peek) return peekClip(shot);
  const t0 = Date.now();
  const { context, page, cdp, errors, late } = await openShot(shot.name, shot.size);
  const ready = Date.now() - t0;
  const file = join(out, `${shot.name}.mp4`);
  const framesDir = join(out, shot.name);
  if (keepFrames) { rmSync(framesDir, { recursive: true, force: true }); mkdirSync(framesDir, { recursive: true }); }
  const fps = draft ? 30 : 60;
  const ff = spawn("ffmpeg", [
    "-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-c:v", "mjpeg", "-i", "-",
    // The frames are full-range sRGB JPEGs: convert to the limited-range BT.709 that editors expect.
    "-vf", "scale=in_range=full:out_range=limited:out_color_matrix=bt709,format=yuv420p",
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
    "-c:v", "libx264", "-preset", draft ? "veryfast" : "slow", "-crf", draft ? "23" : "14",
    "-r", String(fps), "-movflags", "+faststart", file,
  ], { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise((res, rej) => ff.on("close", (c) => (c === 0 ? res() : rej(new Error(`ffmpeg exited ${c}`)))));
  const write = (buf) => new Promise((res) => { if (ff.stdin.write(buf)) res(); else ff.stdin.once("drain", res); });

  let n = 0, k = 0, repeats = 0, lastHash = "";
  const t1 = Date.now();
  const spent = { warm: 0, draw: 0, grab: 0, write: 0 };
  let mark = performance.now();
  const lap = (key) => { const now = performance.now(); spent[key] += now - mark; mark = now; };
  for (;;) {
    const r = await page.evaluate(() => window.film.frame());
    lap(r.record ? "draw" : "warm");
    if (r.record && (!draft || k++ % 2 === 0)) {
      const buf = await grab(cdp, "jpeg");
      lap("grab");
      if (check) {
        const h = createHash("md5").update(buf).digest("hex");
        if (h === lastHash) { repeats++; console.log(`  ${shot.name}: frame ${n} repeats frame ${n - 1}`); }
        lastHash = h;
      }
      if (keepFrames) writeFileSync(join(framesDir, `${String(n).padStart(5, "0")}.jpg`), buf);
      await write(buf);
      lap("write");
      n++;
    }
    if (r.done) break;
  }
  ff.stdin.end();
  await done;
  const wall = Date.now() - t1;
  await context.close();
  console.log(`${shot.name}: ${n} frames → ${file} · ready ${stamp(ready)}, ${stamp(wall)} for ${shot.warmup ?? 2}s warm-up + ${+shot.duration.toFixed(2)}s (${(n / (wall / 1000)).toFixed(1)} captured frames/s)${check ? ` · ${repeats} repeated` : ""}`);
  console.log(`  time: warm-up ${stamp(spent.warm)}, drawing ${(spent.draw / Math.max(1, n)).toFixed(1)} ms/frame, capture ${(spent.grab / Math.max(1, n)).toFixed(1)} ms/frame, encode wait ${(spent.write / Math.max(1, n)).toFixed(1)} ms/frame`);
  if (late.length) console.log(`  ! fetched during the shot (may pop in): ${[...new Set(late)].slice(0, 5).join(", ")}`);
  if (errors.length) console.log(`  ! page errors:\n    ${errors.slice(0, 6).join("\n    ")}`);
  return { name: shot.name, frames: n, wall, ready };
}

async function renderStill(still) {
  const t0 = Date.now();
  const { context, page, cdp, errors } = await openShot(still.name, still.size);
  for (;;) { const r = await page.evaluate(() => window.film.frame()); if (r.done) break; }
  const file = join(out, "stills", still.file);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, await grab(cdp, "png"));
  await context.close();
  console.log(`${still.name} → ${file} (${stamp(Date.now() - t0)})`);
  if (errors.length) console.log(`  ! page errors:\n    ${errors.slice(0, 6).join("\n    ")}`);
}

// ---- which shots ----

const listing = await browser.newPage();
await listing.goto(`${base}/dev/film.html?list`, { waitUntil: "load" });
await listing.waitForFunction(() => !!window.filmShots, null, { timeout: 60_000 });
const catalog = await listing.evaluate(() => window.filmShots);
await listing.close();

if (names[0] === "list" || (!names.length && !stills)) {
  if (!names.length) console.log("usage: pnpm film <shot…|all> [--draft] [--peek] [--jobs n] · pnpm film:stills [still…]\n");
  console.log("clips:");
  for (const s of catalog.shots) console.log(`  ${s.name.padEnd(22)} ${String(s.duration).padStart(4)}s  ${s.note}`);
  console.log("stills:");
  for (const s of catalog.stills) console.log(`  ${s.name.padEnd(22)} ${s.file}  ${s.note}`);
} else {
  const pool = stills ? catalog.stills : catalog.shots;
  const want = !names.length || names.includes("all") ? pool : names.map((n) => pool.find((s) => s.name === n) ?? (() => { throw new Error(`No ${stills ? "still" : "shot"} called ${n}. Try: pnpm film list`); })());
  mkdirSync(out, { recursive: true });
  const t0 = Date.now();
  const queue = [...want];
  const results = [];
  await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, async () => {
    while (queue.length) {
      const s = queue.shift();
      results.push(await (stills ? renderStill(s) : renderClip(s)));
    }
  }));
  if (!stills && results.length > 1) {
    const frames = results.reduce((a, r) => a + r.frames, 0);
    console.log(`all: ${frames} frames in ${stamp(Date.now() - t0)} (${(frames / ((Date.now() - t0) / 1000)).toFixed(1)} frames/s overall)`);
  }
}

await browser.close();
await server?.close();
