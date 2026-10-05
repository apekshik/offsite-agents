// Renders the landing page's night posters and the link preview (og:image) from the real scene
// (apps/web/dev/landing.html), with the local Chrome:
//
//   apps/web/public/landing/night.webp            1920×1080, the camera loop's first frame
//   apps/web/public/landing/night-portrait.webp   900×1600, from high off the starboard bow, for phones
//   apps/web/public/og.jpg                        1200×630, the yacht under the wordmark
//   and a 48×27 blurred copy of the wide poster, inlined in apps/web/index.html and
//   apps/web/src/landing/backdrop.css as a data URL, which shows at first paint while the poster loads
//
//   pnpm dev   (or any `vite` serving apps/web)
//   node scripts/landing-poster.mjs [http://localhost:5180]
//
// Needs cwebp and ffmpeg (brew install webp ffmpeg).

import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const base = process.argv[2] ?? "http://localhost:5180";
const repo = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const pub = join(repo, "apps/web/public");
const tmp = mkdtempSync(join(tmpdir(), "offsite-poster-"));
mkdirSync(join(pub, "landing"), { recursive: true });

// The same room for the text as the page leaves (Backdrop.tsx's SHIFT).
const SHIFT = 0.17;

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
});

async function still(name, [w, h], query) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.goto(`${base}/dev/landing.html?ui=0&dpr=1&pixels=4000000&${query}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__landing?.ready, null, { timeout: 120_000 });
  // Textures and the sky's reflections settle, then the frame is drawn again where it was asked for.
  await page.waitForTimeout(2500);
  await page.evaluate(() => { const q = new URLSearchParams(location.search); window.__landing.scene.still(Number(q.get("t")), window.__landing.pose); });
  await page.waitForTimeout(300);
  const out = join(tmp, `${name}.png`);
  await page.screenshot({ path: out });
  await page.close();
  return out;
}

function webp(png, out, quality) {
  execFileSync("cwebp", ["-quiet", "-q", String(quality), "-m", "6", "-sharp_yuv", png, "-o", out]);
  console.log(`${out}  ${(statSync(out).size / 1024).toFixed(0)} KB`);
}

const wide = await still("night", [1920, 1080], `t=0&shift=${SHIFT}`);
webp(wide, join(pub, "landing/night.webp"), 80);
// The placeholder: tiny, so it can live in the page itself.
const tiny = join(tmp, "tiny.png"), tinyWebp = join(tmp, "tiny.webp");
execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", wide, "-vf", "scale=48:27:flags=area", tiny]);
execFileSync("cwebp", ["-quiet", "-q", "40", tiny, "-o", tinyWebp]);
const dataUrl = `data:image/webp;base64,${readFileSync(tinyWebp).toString("base64")}`;
for (const file of ["apps/web/index.html", "apps/web/src/landing/backdrop.css"]) {
  const path = join(repo, file);
  writeFileSync(path, readFileSync(path, "utf8").replace(/data:image\/webp;base64,[A-Za-z0-9+/=]+/g, dataUrl));
}
console.log(`placeholder  ${dataUrl.length} bytes, inlined`);
const tall = await still("night-portrait", [900, 1600], "t=0&shiftY=0.16&cam=48,70,-150,0,6,-10,34");
webp(tall, join(pub, "landing/night-portrait.webp"), 76);

// The link preview: the wide frame with the wordmark and the line over it, as on the page.
const card = await still("og-bg", [1200, 630], `t=0&shift=0.2`);
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
const bg = `data:image/png;base64,${readFileSync(card).toString("base64")}`;
await page.setContent(`<!doctype html><html><head>
<link href="https://fonts.googleapis.com/css2?family=Saira:wdth,wght@50..125,300..800&display=swap" rel="stylesheet">
<style>
  html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; background: #040a18; font-family: Saira, sans-serif; }
  .bg { position: absolute; inset: 0; background: url(${bg}) center / cover; }
  .shade { position: absolute; inset: 0; background: linear-gradient(90deg, rgba(3,6,12,.88) 0%, rgba(3,6,12,.64) 30%, rgba(3,6,12,.12) 58%, rgba(3,6,12,0) 72%), radial-gradient(120% 90% at 64% 46%, transparent 55%, rgba(3,6,12,.5) 100%); }
  .text { position: absolute; left: 72px; top: 0; bottom: 0; display: flex; flex-direction: column; justify-content: center; }
  .rule { width: 52px; height: 5px; border-radius: 3px; background: #4fe3ff; box-shadow: 0 0 18px rgba(79,227,255,.6); margin: 0 0 18px 4px; }
  h1 { margin: 0; font-size: 150px; line-height: .86; font-weight: 800; font-variation-settings: "wdth" 112; letter-spacing: -.035em; color: #fff; }
  p { margin: 26px 0 0; font-size: 40px; line-height: 1.12; font-weight: 700; color: #fff; letter-spacing: -.01em; }
  p span { color: #4fe3ff; }
  .chip { margin-top: 30px; align-self: flex-start; font-size: 22px; font-weight: 500; color: #eef3f7; padding: 9px 16px; border: 1px solid rgba(79,227,255,.55); background: rgba(5,10,18,.6); border-radius: 6px; }
</style></head><body>
  <div class="bg"></div><div class="shade"></div>
  <div class="text"><div class="rule"></div><h1>Offsite</h1><p>Take your coding agents<br>on an <span>offsite</span>.</p>
  <div class="chip">Claude Code + Codex, on your own subscriptions</div></div>
</body></html>`, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
const og = join(pub, "og.jpg");
await page.screenshot({ path: og, type: "jpeg", quality: 86 });
console.log(`${og}  ${(statSync(og).size / 1024).toFixed(0)} KB`);
await browser.close();
