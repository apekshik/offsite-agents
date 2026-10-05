import { demo } from "./session.ts";

// Stands in for src/convex.ts in demo mode (vite.demo.config.ts swaps it in): the app's Convex client is the
// in-browser fake. Keep the exports in step with src/convex.ts (coverage.test.ts checks).
export const convex = demo.asClient();
