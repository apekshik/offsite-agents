// Bundles the CLI for npm (`offsite-agents`): Offsite's own workspace packages (contracts, harness, git) go in, npm
// dependencies stay external and install with it. `npm pack` and `npm publish` run this first (prepack).
import { build } from "esbuild";
import { chmod, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const external = ["@anthropic-ai/claude-agent-sdk", "convex", "convex/*", "zod", "zod/*"];
await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await build({
  entryPoints: { offsite: "src/cli.ts" },
  outdir: "dist",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external,
  legalComments: "inline",
  logLevel: "info",
});
// Stamp the bundle with a hash of itself, so a runner installed from a URL can tell when the site serves a newer one
// (npx keys a URL install by the URL, not its contents). The site publishes the same id in /runner-version.json.
const bundle = await readFile("dist/offsite.mjs", "utf8");
const id = createHash("sha256").update(bundle).digest("hex").slice(0, 16);
await writeFile("dist/offsite.mjs", bundle.replaceAll("__OFFSITE_BUILD_ID__", id));
await writeFile("dist/build-id", id + "\n");
await chmod("dist/offsite.mjs", 0o755);
for (const f of ["LICENSE", "NOTICE"]) await copyFile(`../../${f}`, `dist/${f}`);
