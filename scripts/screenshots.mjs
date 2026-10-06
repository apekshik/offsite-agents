// Visual checks: screenshots of the UI gallery and of demo mode's key states, at desktop and phone widths, from the
// static demo build (apps/web/dist-demo). CI runs it on every push and pull request and uploads the pictures; run it
// yourself to see what a change looks like everywhere at once.
//
//   pnpm build:demo && pnpm screenshots            → .shots/ci/*.png, .shots/ci/summary.md
//   pnpm screenshots --url http://localhost:5190   against a running `pnpm dev:demo` instead
//   pnpm screenshots --only phone                  just the shots whose name contains "phone"
//   pnpm screenshots --software-gl                 draw the world the way CI does (SwiftShader, no GPU)
//
// It fails (exit 1) when a shot is blank, the page throws, or demo mode meets a Convex function it has no answer
// for. The 3D world needs WebGL: on a machine without a GPU (CI), Chrome's software renderer (SwiftShader) draws it;
// if even that can't, the world shots say so in the summary and fail.
//
// Browser: playwright-core's Chromium (`pnpm exec playwright-core install chromium`), else your installed Chrome.
import { chromium } from "playwright-core";
import { createReadStream, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (k) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
const out = resolve(repo, flag("out") ?? ".shots/ci");
const only = flag("only");
const SIZES = { desktop: { width: 1280, height: 800 }, phone: { width: 390, height: 844 } };

// The gallery's cells, by name (src/gallery/cells.tsx), and demo mode's states worth a picture (src/demo/states.ts).
const CELLS = [
  "phone-cover", "phone-threads-empty", "phone-thinking", "phone-plan", "phone-computah-asks", "phone-question", "phone-finished",
  "phone-crew-watch", "phone-crew-off", "phone-hire", "phone-ship", "phone-review", "phone-hire-moon", "phone-ship-moon",
  "hud-no-machine", "toasts", "crew-card", "crew-card-asking", "helm", "helm-review", "creator",
  "landing", "onboarding-ship", "onboarding-meet", "onboarding-machine", "onboarding-paired", "onboarding-repos", "onboarding-browse",
  "empty-no-machine-thread", "empty-ship-tab", "error-diff", "error-offline", "empty-scan", "error-scan",
];
// The world states build the whole yacht, which a software renderer takes a while over: they run at low quality, at
// desktop size only. The helm, the review and the rest of the interface are in the gallery, on the poster.
const STATES = [
  { name: "aboard", world: true, sizes: ["desktop"] }, { name: "night", world: true, sizes: ["desktop"] }, { name: "phone-open", world: true, sizes: ["desktop"] },
  { name: "aboard", as: "moon-aboard", query: "&world=moon-base", world: true, sizes: ["desktop"] },
  { name: "landing", world: false }, { name: "onboarding-repos", world: false },
];

// ---- serve the build ----

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".m4a": "audio/mp4", ".ogg": "audio/ogg", ".ktx2": "image/ktx2", ".glb": "model/gltf-binary", ".wasm": "application/wasm" };

async function serve(dir) {
  if (!existsSync(join(dir, "index.html"))) throw new Error(`${dir} has no index.html: run \`pnpm build:demo\` first (or pass --url).`);
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    let file = join(dir, path);
    if (!file.startsWith(dir)) { res.writeHead(403).end(); return; }
    if (!existsSync(file) || statSync(file).isDirectory()) file = existsSync(join(file, "index.html")) ? join(file, "index.html") : join(dir, "index.html");
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

// ---- the browser ----

async function launch() {
  // SwiftShader: WebGL without a GPU. Harmless where there is one.
  const gl = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];
  const soft = !!process.env.CI || args.includes("--software-gl");
  try {
    return await chromium.launch({ args: soft ? gl : [] });
  } catch (e) {
    if (process.env.CI) throw e;
    return chromium.launch({ channel: "chrome", args: soft ? gl : [] });
  }
}

/** How much a picture varies: a blank (one colour, or nearly) has almost no spread. Measured in the page, no deps. */
async function variety(page, png) {
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const w = 160, h = Math.max(1, Math.round((img.height / img.width) * 160));
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data;
    let sum = 0, sq = 0;
    const colours = new Set();
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      sum += l; sq += l * l;
      colours.add(((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4));
    }
    const n = d.length / 4, mean = sum / n;
    return { spread: Math.round(Math.sqrt(Math.max(0, sq / n - mean * mean)) * 10) / 10, colours: colours.size };
  }, png.toString("base64"));
}

async function shoot(browser, base, job) {
  const context = await browser.newContext({ viewport: SIZES[job.size], deviceScaleFactor: 1, ...(job.size === "phone" ? { isMobile: false, hasTouch: false } : {}) });
  const page = await context.newPage();
  const problems = [];
  page.on("pageerror", (e) => problems.push(`page error: ${e.message.split("\n")[0]}`));
  page.on("console", (m) => { if (/\[demo\] no fake answer|\[fake convex\]/.test(m.text())) problems.push(m.text()); });
  const t0 = Date.now();
  let world = null;
  try {
    await page.goto(`${base}${job.path}`, { waitUntil: "load", timeout: 30_000 });
    await page.evaluate(() => document.fonts.ready);
    if (job.kind === "cell") {
      await page.waitForSelector("body[data-ready='1']", { timeout: 15_000 });
      await page.waitForTimeout(job.name === "toasts" || job.name === "onboarding-paired" ? 3200 : 1200);
    } else if (job.world) {
      // Aboard: wait for the world to build (the boarding veil lifts), then for the state's screen.
      const built = await page.waitForFunction(() => document.querySelector(".boarding.gone") || !document.querySelector(".boarding"), null, { timeout: 150_000 }).then(() => true, () => false);
      await page.waitForTimeout(built ? 2500 : 0);
      const canvas = await page.$("#game");
      world = built && canvas ? await variety(page, await canvas.screenshot()) : { spread: 0, colours: 0 };
      if (!built) problems.push("the 3D world never finished building (no WebGL?)");
    } else {
      await page.waitForTimeout(2000);
    }
    const png = await page.screenshot({ path: join(out, `${job.file}.png`) });
    const v = await variety(page, png);
    const blank = v.spread < 3 || v.colours < 8;
    if (blank) problems.push(`looks blank (spread ${v.spread}, ${v.colours} colours)`);
    if (world && (world.spread < 3 || world.colours < 8)) problems.push(`the 3D world is blank (spread ${world.spread})`);
    return { ...job, ms: Date.now() - t0, variety: v, world, problems };
  } catch (e) {
    problems.push(String(e.message ?? e).split("\n")[0]);
    await page.screenshot({ path: join(out, `${job.file}.png`) }).catch(() => {});
    return { ...job, ms: Date.now() - t0, variety: null, world, problems };
  } finally {
    await context.close();
  }
}

async function pool(items, n, fn) {
  const results = [];
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; results[k] = await fn(items[k]); } }));
  return results;
}

// ---- go ----

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const given = flag("url");
const server = given ? null : await serve(resolve(repo, flag("dir") ?? "apps/web/dist-demo"));
const base = (given ?? server.url).replace(/\/$/, "");
const jobs = [];
for (const size of Object.keys(SIZES)) {
  for (const c of CELLS) jobs.push({ kind: "cell", name: c, size, path: `/gallery.html?cell=${c}`, file: `gallery-${c}-${size}` });
  for (const s of STATES) {
    if (s.sizes && !s.sizes.includes(size)) continue;
    const name = s.as ?? s.name;
    jobs.push({ kind: "state", name, size, world: s.world, path: `/?state=${s.name}&hold=3${s.world ? "&quality=low" : ""}${s.query ?? ""}`, file: `demo-${name}-${size}` });
  }
}
const todo = only ? jobs.filter((j) => j.file.includes(only)) : jobs;

const started = Date.now();
const browser = await launch();
const renderer = await (async () => {
  const p = await browser.newPage();
  const r = await p.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    return gl ? String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) : "no WebGL2";
  });
  await p.close();
  return r;
})();
console.log(`${todo.length} shots against ${base} · WebGL: ${renderer}`);
// The world shots each build the yacht: fewer at once on a software renderer.
const cells = await pool(todo.filter((j) => !j.world), 4, (j) => shoot(browser, base, j));
const worlds = await pool(todo.filter((j) => j.world), 2, (j) => shoot(browser, base, j));
const results = [...cells, ...worlds];
// The index, full page: every cell side by side.
if (!only) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.goto(`${base}/gallery.html`, { waitUntil: "load" });
  await page.evaluate(async () => { for (let y = 0; y < document.documentElement.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); } window.scrollTo(0, 0); });
  await page.waitForTimeout(6000);
  await page.screenshot({ path: join(out, "gallery-index.png"), fullPage: true });
  await page.close();
}
await browser.close();
server?.close();

for (const r of results) console.log(`${r.problems.length ? "✗" : "✓"} ${r.file} (${(r.ms / 1000).toFixed(1)}s)${r.problems.length ? `: ${r.problems.join("; ")}` : ""}`);
const bad = results.filter((r) => r.problems.length);
const secs = ((Date.now() - started) / 1000).toFixed(0);
const worldLine = (() => {
  const w = results.filter((r) => r.world);
  if (!w.length) return "";
  const drawn = w.filter((r) => r.world && r.world.spread >= 3).length;
  return `The 3D world drew in ${drawn} of ${w.length} world shots (WebGL: ${renderer}).`;
})();
const md = [
  `### Visual checks: ${bad.length ? `${bad.length} problem${bad.length === 1 ? "" : "s"}` : "all clear"}`,
  "",
  `${results.length} screenshots (${results.filter((r) => r.kind === "cell").length} UI gallery cells, ${results.filter((r) => r.kind === "state").length} demo states) at desktop (1280×800) and phone (390×844) widths in ${secs}s. ${worldLine}`,
  "",
  ...(bad.length ? ["| Shot | Problem |", "|---|---|", ...bad.map((r) => `| \`${r.file}\` | ${r.problems.join("; ").replace(/\|/g, "\\|")} |`), ""] : []),
  "Run them yourself: `pnpm build:demo && pnpm screenshots` (pictures in `.shots/ci`).",
].join("\n");
writeFileSync(join(out, "summary.md"), md + "\n");
writeFileSync(join(out, "summary.json"), JSON.stringify({ renderer, problems: bad.length, shots: results.map(({ file, problems, variety: v, world, ms }) => ({ file, problems, variety: v, world, ms })) }, null, 2) + "\n");
console.log(`\n${md}`);
process.exit(bad.length ? 1 : 0);
