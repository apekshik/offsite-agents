// Demo mode: the real app (App.tsx, the landing page, the way aboard, the game, the phone, the helm…) against an
// in-browser fake backend, with no account, no Convex and no runner. `pnpm dev:demo`, or `pnpm build:demo` for a
// static copy in apps/web/dist-demo. See CONTRIBUTING.md.
//
// vite.demo.config.ts swaps src/convex.ts and src/auth.ts for demo/convex.ts and demo/auth.ts; nothing else in the
// app changes. /demo.html?state=<name> starts somewhere else (states.ts lists them; so does the Demo badge).
import { demo, state } from "./session.ts";
import { createRoot } from "react-dom/client";
import { App } from "../App.tsx";
import { scene, ui } from "../bridge.ts";
import { phone } from "../phone/state.ts";
import { openReview } from "../review/open.ts";
import { Badge } from "./Badge.tsx";

createRoot(document.getElementById("root")!).render(<App />);

const badge = document.createElement("div");
badge.id = "demo-badge";
document.body.append(badge);
createRoot(badge).render(<Badge demo={demo} current={state} />);

// What this state shows aboard, once the world has built (or after a while, if it can't: no WebGL).
if (state.show) {
  const started = Date.now();
  const t = setInterval(() => {
    const aboard = !!document.querySelector(".overlay");
    if (!aboard || (!scene.captain() && Date.now() - started < 15_000)) return;
    clearInterval(t);
    state.show!(demo, { phone, ui, openReview });
    demo.refresh();
  }, 200);
}
