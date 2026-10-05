// Shoots the live game from set places, in one browser session: the dev play page signed in as a
// dev captain, against your dev deployment, with whatever the crew are doing right now.
//
//   node scripts/scene-shots.mjs [--url http://localhost:5183] [--user apek] [--out .shots/scene] [--only office,phone]
//
// Each shot moves the captain (dev handle window.offsite), sets the view, waits, and saves a PNG.

import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const base = arg("url", "http://localhost:5183");
const user = arg("user", "apek");
const out = arg("out", ".shots/scene");
const only = arg("only", null)?.split(",");
mkdirSync(out, { recursive: true });

// Stand `back` metres from a slot, `side` metres to its right, facing it; then pick a view and pitch.
const near = (slotFilter, { back = 4, side = 1.5, up = 0.3, view = "third", pitch = -0.12, phone = false } = {}) => `
  const o = window.offsite;
  const s = o.world.layout.slots.find(${slotFilter});
  const f = s.facing;
  const fx = Math.sin(f), fz = Math.cos(f);
  const from = [s.pos[0] + fx * ${back} + fz * ${side}, s.pos[1] + ${up}, s.pos[2] + fz * ${back} - fx * ${side}];
  o.captain.teleport(from, Math.atan2(s.pos[0] - from[0], s.pos[2] - from[2]));
  o.captain.view = ${JSON.stringify(view)};
  o.captain.cameraRig.pitch = ${pitch};
  o.ui.set({ phone: ${phone ? '"open"' : '"closed"'} });
`;
const crewAt = (kinds) => `(s) => [...window.offsite.game.bodies.values()].some((b) => b.dir?.target.kind === "slot" && b.dir.target.slotId === s.id && b.arrived) && ${JSON.stringify(kinds)}.includes(s.kind)`;

const SHOTS = [
  { name: "sundeck", setup: near(`(s) => s.kind === "captain-spawn"`, { back: 0.01, side: 0, pitch: -0.18 }) },
  { name: "office", setup: near(crewAt(["desk"]), { back: 3.6, side: 2.2 }) },
  { name: "lounging", setup: near(crewAt(["lounger", "hammock", "deck-chair", "bar-stool", "hot-tub", "pool", "fishing"]), { back: 3.2, side: 1.8 }) },
  { name: "helm", setup: near(`(s) => s.kind === "helm"`, { back: 2.6, side: 1.4 }) },
  { name: "helipad", setup: near(`(s) => s.kind === "helipad"`, { back: 12, side: 3, pitch: -0.05 }) },
  { name: "phone-first", setup: near(`(s) => s.kind === "lounger"`, { back: 2, side: 0.5, view: "first", pitch: -0.25, phone: true }) },
];

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`${base}/dev/play.html?dev=${user}`, { waitUntil: "load" });
await page.waitForFunction(() => window.offsite && window.offsite.game.bodies.size > 0, null, { timeout: 60_000 });
await page.waitForTimeout(3000);
for (const shot of SHOTS) {
  if (only && !only.includes(shot.name)) continue;
  try {
    await page.evaluate(shot.setup);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${out}/${shot.name}.png` });
    console.log(`saved ${out}/${shot.name}.png`);
  } catch (e) {
    console.log(`skipped ${shot.name}: ${String(e).split("\n")[0]}`);
  }
}
await browser.close();
if (errors.length) console.log(`page errors:\n${errors.slice(0, 10).join("\n")}`);
