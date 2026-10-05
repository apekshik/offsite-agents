// Screenshot a page with the local Chrome (headless, GPU on), for checking the 3D world and the
// interface without a person at the screen.
//
//   node scripts/shot.mjs <url> <out.png> [--size 1440x900] [--wait 4000] [--eval "js to run first"]
//
// Prints the page's console errors after the shot. Shots go wherever you say; .shots/ is ignored.

import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const [url, out, ...rest] = process.argv.slice(2);
if (!url || !out) {
  console.error("usage: node scripts/shot.mjs <url> <out.png> [--size 1440x900] [--wait 4000] [--eval js]");
  process.exit(1);
}
const opt = (name, fallback) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : fallback;
};
const [width, height] = opt("size", "1440x900").split("x").map(Number);
const wait = Number(opt("wait", "4000"));
const script = opt("eval", null);

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: "load" });
if (script) await page.evaluate(script);
await page.waitForTimeout(wait);
mkdirSync(dirname(out), { recursive: true });
await page.screenshot({ path: out });
await browser.close();
console.log(`saved ${out}`);
if (errors.length) console.log(`console errors:\n${errors.slice(0, 20).join("\n")}`);
