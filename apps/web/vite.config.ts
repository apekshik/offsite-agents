import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL(".", import.meta.url));
const repo = resolve(root, "../..");

// Dev sign-in (scripts/devauth.mjs): a signed token for /?dev=<name>, from this machine only,
// while `vite` runs. Never part of a build. Adapted from Ready Player One.
function devAuth(env: Record<string, string>): Plugin {
  return {
    name: "offsite-dev-auth",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__dev/token", async (req, res) => {
        const local = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress ?? "");
        const user = new URL(req.url ?? "", "http://x").searchParams.get("user") ?? "";
        if (!local) { res.statusCode = 403; res.end("dev sign-in is for this machine only"); return; }
        if (!env["DEV_AUTH_PRIVATE_KEY"]) { res.statusCode = 503; res.end("No DEV_AUTH_PRIVATE_KEY: run `node scripts/devauth.mjs`"); return; }
        if (!/^[a-z0-9_-]{1,20}$/i.test(user)) { res.statusCode = 400; res.end("?dev=<name>: letters, digits, - and _"); return; }
        const { devToken } = await import(resolve(repo, "scripts/devauth.mjs"));
        res.setHeader("content-type", "text/plain");
        res.setHeader("cache-control", "no-store");
        res.end(devToken(env["DEV_AUTH_PRIVATE_KEY"], user.toLowerCase()));
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // .env.local at the repo root carries CONVEX_URL (from `convex dev`) and the dev sign-in key.
  const env = { ...loadEnv(mode, repo, ""), ...loadEnv(mode, root, "") };
  return {
    plugins: [react(), devAuth(env)],
    envDir: repo,
    // The browser gets VITE_* plus the deployment URL and WorkOS's public client id. Never a secret.
    envPrefix: ["VITE_", "CONVEX_URL", "WORKOS_CLIENT_ID"],
    server: { port: 5180, strictPort: false },
    build: { target: "es2022", chunkSizeWarningLimit: 4000 },
  };
});
