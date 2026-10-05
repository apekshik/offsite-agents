// Bundles the CLI for npm (`offsite-agents`): Offsite's own workspace packages (contracts, harness, git) go in, npm
// dependencies stay external and install with it. `npm pack` and `npm publish` run this first (prepack).
import { build } from "esbuild";
import { chmod, copyFile, mkdir, rm } from "node:fs/promises";

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
await chmod("dist/offsite.mjs", 0o755);
for (const f of ["LICENSE", "NOTICE"]) await copyFile(`../../${f}`, `dist/${f}`);
