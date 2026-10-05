#!/usr/bin/env node
// Rebuilds docs/media, the README's pictures, from the rendered stills and the real run's
// screenshots. Both sources are local and gitignored (.shots/); the WebP copies here are committed.
//
//   pnpm film:stills                  render the stills first (.shots/film/stills/*.png)
//   node scripts/readme-media.mjs     → docs/media/*.webp, each under its budget
//   node scripts/readme-media.mjs --check   list what would be made and which sources are missing
//
// Each picture is resized to its width and encoded with cwebp, starting at a high quality and
// stepping down until it fits its budget (400 KB unless noted). The real run's pictures are listed
// one by one on purpose: some of its screenshots show the account email, and those stay out.
//
// Needs cwebp on the PATH (macOS: brew install webp; Debian/Ubuntu: apt install webp).

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stills = join(repo, ".shots/film/stills");
const real = join(repo, ".shots/real-run");
const out = join(repo, "docs/media");

const KB = 1024;
const BUDGET = 400 * KB;
const TOTAL = 8 * 1024 * KB;

/** [output name, source, width, budget?] */
const still = (name, width = 1600, budget = BUDGET) => [`${name}.webp`, join(stills, `${name}.png`), width, budget];
const MEDIA = [
  // The hero: the plain one in the README, a sharper one (from the 4K render) behind its link.
  still("hero", 1920),
  ["hero@2x.webp", join(stills, "hero@2x.png"), 2880, BUDGET],
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
const missing = MEDIA.filter(([, src]) => !existsSync(src));
if (check) {
  for (const [name, src, width, budget] of MEDIA) console.log(`${existsSync(src) ? "ok     " : "missing"} ${name.padEnd(28)} ${String(width).padStart(4)} px  ≤${Math.round(budget / KB)} KB  ← ${src.slice(repo.length + 1)}`);
  process.exit(missing.length ? 1 : 0);
}
if (missing.length) {
  console.error(`Missing sources (render them with \`pnpm film:stills\`, or keep the old copies):\n${missing.map(([, s]) => `  ${s.slice(repo.length + 1)}`).join("\n")}`);
  process.exit(1);
}
if (spawnSync("cwebp", ["-version"]).status !== 0) {
  console.error("cwebp isn't on the PATH. macOS: brew install webp; Debian/Ubuntu: apt install webp.");
  process.exit(1);
}

mkdirSync(out, { recursive: true });
const made = new Set();
let total = 0;
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
