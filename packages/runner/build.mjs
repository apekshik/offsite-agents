// Bundles the CLI for publishing: Offsite's own packages go in, npm dependencies stay external (installed with it).
import { build } from "esbuild";
import { copyFile, mkdir, rm } from "node:fs/promises";

const external = ["@anthropic-ai/claude-agent-sdk", "convex", "convex/*", "zod", "zod/*"];
await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await build({
  entryPoints: { offsite: "src/cli.ts", index: "src/index.ts" },
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
for (const f of ["LICENSE", "NOTICE"]) await copyFile(`../../${f}`, `dist/${f}`);
