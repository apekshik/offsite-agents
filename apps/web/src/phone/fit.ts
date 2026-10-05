import { useEffect, useState } from "react";

// How big the phone and the helm console are on screen. Both are drawn at a fixed design size and
// scaled as a whole (a transform: text stays crisp, it is re-rasterised at the new size). On a big
// screen they fill most of the window; on a small one they shrink to fit.

/** How much to shrink a w×h design so it fits a vw×vh window with a margin (never grown). */
export function shrinkToFit(w: number, h: number, vw: number, vh: number, margin = 40): number {
  return Math.min(1, (vw - margin * 2) / w, (vh - margin * 2) / h);
}

/** Big screens fill most of the window: this share of its width and of its height, whichever binds. */
export const FILL = { w: 0.92, h: 0.86 };

/** How much to scale a w×h design so it fills FILL of a vw×vh window, keeping its shape: bigger than life on a big screen. */
export function fillScale(w: number, h: number, vw: number, vh: number): number {
  return Math.min((FILL.w * vw) / w, (FILL.h * vh) / h);
}

/** The window's size, kept up to date. */
export function useViewport(): { w: number; h: number } {
  const [v, setV] = useState(() => ({ w: innerWidth, h: innerHeight }));
  useEffect(() => {
    const on = () => setV({ w: innerWidth, h: innerHeight });
    addEventListener("resize", on);
    return () => removeEventListener("resize", on);
  }, []);
  return v;
}

/** The book (1036 × 740) plus the hint bar under it, as the wrap lays them out. */
export const OPEN = { w: 1036, h: 740 };
const WRAP_H = OPEN.h + 40;
/** Room kept clear at the top for the walk chip (hud.css .walk-chip), CSS pixels. */
const TOP_CLEAR = 46;

/**
 * The phone's scale, open and folded. Open, the book fills FILL of the window; but its top stays
 * clear of the walk chip and the hint bar stays on screen. Folded (the cover), it grows too, but
 * less: about halfway from its old size (never grown, fit with a margin) to the open one.
 */
export function phoneScale(vw: number, vh: number): { open: number; cover: number } {
  // The wrap is centred 10px low: its top is vh/2 + 10 - WRAP_H·s/2.
  const open = Math.min(fillScale(OPEN.w, OPEN.h, vw, vh), (vh - 2 * (TOP_CLEAR - 10)) / WRAP_H);
  const old = shrinkToFit(OPEN.w, OPEN.h + 30, vw, vh, 28);
  const cover = Math.min(open, old + Math.max(0, open - old) * 0.45);
  return { open, cover };
}
