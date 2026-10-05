import { ConvexReactClient } from "convex/react";

const url = import.meta.env["CONVEX_URL"] as string | undefined;
if (!url) throw new Error("No CONVEX_URL: run `pnpm dev:backend` once at the repo root (it writes .env.local)");

export const convex = new ConvexReactClient(url);
