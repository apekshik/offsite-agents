import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { existsSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

// Demo mode and the UI gallery: the real app and its components against an in-browser fake backend (src/demo), with
// no Convex, no sign-in and no runner. `pnpm dev:demo` serves it; `pnpm build:demo` writes a static copy to
// dist-demo (demo.html becomes its index.html, gallery.html stays). The production app (vite.config.ts, index.html)
// is untouched by any of this.

const root = fileURLToPath(new URL(".", import.meta.url));
const out = resolve(root, "dist-demo");

/** The two seams: src/convex.ts and src/auth.ts resolve to their demo stand-ins, for every importer outside src/demo. */
function demoSeams(): Plugin {
  const swap = new Map([
    [resolve(root, "src/convex.ts"), resolve(root, "src/demo/convex.ts")],
    [resolve(root, "src/auth.ts"), resolve(root, "src/demo/auth.ts")],
  ]);
  const demoDir = resolve(root, "src/demo") + "/";
  return {
    name: "offsite-demo-seams",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (!importer || importer.startsWith(demoDir) || !/(^|\/)(convex|auth)(\.ts)?$/.test(source)) return null;
      const hit = await this.resolve(source, importer, { ...options, skipSelf: true });
      return hit && swap.has(hit.id) ? swap.get(hit.id)! : null;
    },
  };
}

/** `/` is the demo, in dev and in the static build. */
function demoIndex(): Plugin {
  return {
    name: "offsite-demo-index",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url === "/" || req.url?.startsWith("/?")) req.url = `/demo.html${req.url.slice(1)}`;
        next();
      });
    },
    closeBundle() {
      const from = resolve(out, "demo.html");
      if (existsSync(from)) renameSync(from, resolve(out, "index.html"));
    },
  };
}

export default defineConfig({
  plugins: [demoSeams(), demoIndex(), react()],
  // Nothing from .env reaches the demo: it needs no deployment and no keys.
  envPrefix: ["VITE_DEMO_"],
  server: { port: 5190, strictPort: false },
  preview: { port: 5191 },
  build: {
    outDir: out,
    emptyOutDir: true,
    target: "es2022",
    chunkSizeWarningLimit: 4000,
    rollupOptions: { input: { demo: resolve(root, "demo.html"), gallery: resolve(root, "gallery.html") } },
  },
});
