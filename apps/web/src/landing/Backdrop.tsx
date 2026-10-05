import { useEffect, useRef, useState } from "react";
import { backdropMode, deviceFacts, type BackdropMode } from "./device.ts";
import type { LandingScene } from "./scene.ts";
import "./backdrop.css";

// The night yacht behind the landing page and the way aboard. The poster shows at once (it's in
// index.html's preloads); where the device can take it, the live scene loads lazily behind it and
// crossfades in. Any trouble (no WebGL, a poor frame rate, an error) and the poster simply stays.

export const POSTER = "/landing/night.webp";
export const POSTER_PORTRAIT = "/landing/night-portrait.webp";

/** Room for the text: the live picture sits this far right of centre on a wide screen. */
const SHIFT = 0.17;

export function Backdrop({ live = false, dim = false }: { live?: boolean; dim?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [mode] = useState<BackdropMode>(() => {
    const m = backdropMode(deviceFacts());
    return live || m !== "live" ? m : "drift";
  });
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (mode !== "live" || !canvas.current) return;
    const el = canvas.current;
    let gone = false, scene: LandingScene | null = null;
    const giveUp = () => {
      setShown(false);
      // Let the poster fade back in before letting go of the GPU.
      setTimeout(() => { scene?.dispose(); scene = null; }, 1600);
    };
    const onVisible = () => { if (!scene) return; if (document.hidden) scene.pause(); else scene.play(); };
    const onResize = () => scene?.resize(innerWidth, innerHeight);
    // After the page has painted and the text has come in: nothing here should hold up the poster or Sign in.
    const idle = (fn: () => void) => ("requestIdleCallback" in window ? requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 600));
    const timer = setTimeout(() => idle(() => {
      void import("./scene.ts")
        .then(({ createLandingScene }) => createLandingScene(el, { shift: innerWidth >= 900 ? SHIFT : 0, onSlow: giveUp }))
        .then((s) => {
          if (gone) { s.dispose(); return; }
          scene = s;
          s.resize(innerWidth, innerHeight);
          if (!document.hidden) s.play();
          // A couple of frames drawn, then the crossfade.
          requestAnimationFrame(() => requestAnimationFrame(() => { if (!gone) setShown(true); }));
        })
        .catch((err) => { console.warn("The live yacht is unavailable; showing the poster", err); });
    }), 700);
    document.addEventListener("visibilitychange", onVisible);
    addEventListener("resize", onResize);
    return () => {
      gone = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      removeEventListener("resize", onResize);
      scene?.dispose();
    };
  }, [mode]);

  return (
    <div className={`backdrop ${mode} ${dim ? "dim" : ""}`} aria-hidden="true">
      <picture>
        <source media="(max-aspect-ratio: 4/5)" srcSet={POSTER_PORTRAIT} />
        <img className="bd-poster" src={POSTER} alt="" decoding="async" fetchPriority="high" />
      </picture>
      {mode === "live" ? <canvas ref={canvas} className={`bd-live ${shown ? "on" : ""}`} /> : null}
      <div className="bd-shade" />
    </div>
  );
}
