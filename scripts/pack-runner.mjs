// Packs packages/runner (the `offsite-agents` CLI) into apps/web/dist/offsite-agents.tgz, so the site serves the
// runner it was built with: `npx https://offsiteagents.app/offsite-agents.tgz` (RUNNER_SPEC in @offsite/contracts).
// `pnpm build` runs it after the web build. `npm pack` runs build.mjs first (prepack), exactly as `npm publish` will.
// See docs/deploy.md.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const runner = join(repo, "packages/runner");
const dist = join(repo, "apps/web/dist");
const out = join(dist, "offsite-agents.tgz");

if (!existsSync(dist)) throw new Error("apps/web/dist is missing: build the web app first (pnpm build does both).");
const tmp = mkdtempSync(join(tmpdir(), "offsite-pack-"));
try {
  // stdout carries the prepack banner, then the JSON (a line starting with "["); notices go to stderr.
  const json = execFileSync("npm", ["pack", "--json", "--pack-destination", tmp], { cwd: runner, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  const [packed] = JSON.parse(json.slice(Math.max(0, json.search(/^\[/m))));
  if (!packed?.filename) throw new Error(`npm pack said: ${json}`);
  if (!packed.files.some((f) => f.path === "dist/offsite.mjs")) throw new Error("The packed runner has no dist/offsite.mjs.");
  copyFileSync(join(tmp, packed.filename), out);
  console.log(`Packed ${packed.name}@${packed.version} (${(packed.size / 1024).toFixed(1)} kB, ${packed.files.length} files) to ${out}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
