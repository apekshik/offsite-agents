import { held, type HeldFrame } from "../bridge.ts";
import { COVER, overlayScreens, phoneScale, SPREAD } from "./fit.ts";
import { cssMatrix, drawable, lerpQuad, quadMatrix, rectQuad, sharpZoom, type Quad } from "./quad.ts";

// First person: the phone's pages on the 3D phone's glass. The same React tree as the overlay, re-hosted: while the
// game says where the glass is (bridge.held), each page is laid over its screen with a matrix3d, every frame, in the
// frame the world is drawn. Nothing is re-mounted, so the open thread, a draft, scroll and focus all survive.
//
// Three pages, as the 3D phone has three screens: the cover (outside the half that swings), that half's inside (the
// left page, showing the still copy of the list while it swings, as the overlay's leaf does), and the spread, which
// lies in the fixed half's plane: only its right half while the phone opens (the other half is still swinging), all
// of it once flat. Switching view glides the pages between the hands and the overlay's places.

type Pages = { cover: Quad; left: Quad; spread: Quad };
type Mode = "overlay" | "wait" | "in" | "held" | "out";

/** Seconds to glide between the hands and the overlay when the view switches. */
const GLIDE = 0.3;
const ease = (t: number) => { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); };
const smooth = (a: number, b: number, x: number) => ease((x - a) / (b - a));
const editable = (t: Element | null) => t instanceof HTMLElement && (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");

/** The overlay's places for the three pages, as corners. */
function overlayPages(): Pages {
  const o = overlayScreens(innerWidth, innerHeight);
  const spread = rectQuad(o.open);
  const [tl, tr, br, bl] = spread as [[number, number], [number, number], [number, number], [number, number]];
  const midTop: [number, number] = [(tl[0] + tr[0]) / 2, tl[1]], midBot: [number, number] = [(bl[0] + br[0]) / 2, bl[1]];
  return { cover: rectQuad(o.cover), left: [tl, midTop, midBot, bl], spread };
}

/** The phone wrap (Phone.tsx) in first person. start() returns the stop. */
export class HeldPhone {
  private mode: Mode = "overlay";
  private from: Pages | null = null;
  private t0 = 0;
  private last: { pages: Pages; frame: HeldFrame } | null = null;
  private raf = 0;
  private quietTimer = 0;
  /** Each page's transform as last set. */
  private laid = new Map<HTMLElement, string>();

  private wrap: HTMLElement;

  constructor(wrap: HTMLElement) { this.wrap = wrap; }

  /** Whether the pages are on the 3D phone now (or on their way there). */
  get holding() { return this.mode !== "overlay"; }

  start(firstPerson: boolean): () => void {
    // Taken out in first person: hidden until the game says where the glass is (the next frame), so it never shows in
    // the overlay's place first. If that never comes (no game), the overlay it is.
    if (firstPerson && held.live) {
      this.setMode("wait");
      this.raf = requestAnimationFrame(() => { this.raf = requestAnimationFrame(() => { if (this.mode === "wait") this.toOverlay(); }); });
    }
    const off = held.subscribe((f) => this.frame(f));
    if (held.frame) this.frame(held.frame);
    // Still while you type, scroll or click: the hands stop swaying.
    const focus = () => this.quiet();
    const touch = () => this.quiet(1400);
    this.wrap.addEventListener("focusin", focus);
    this.wrap.addEventListener("focusout", focus);
    this.wrap.addEventListener("pointerdown", touch);
    this.wrap.addEventListener("wheel", touch, { passive: true });
    this.wrap.addEventListener("keydown", touch);
    return () => {
      off();
      cancelAnimationFrame(this.raf);
      clearTimeout(this.quietTimer);
      held.still = false;
      this.wrap.removeEventListener("focusin", focus);
      this.wrap.removeEventListener("focusout", focus);
      this.wrap.removeEventListener("pointerdown", touch);
      this.wrap.removeEventListener("wheel", touch);
      this.wrap.removeEventListener("keydown", touch);
    };
  }

  /** Hold still while something here has the keyboard, and for `ms` after a touch. */
  private quiet(ms = 0) {
    clearTimeout(this.quietTimer);
    const typing = () => editable(document.activeElement) && this.wrap.contains(document.activeElement);
    // focusout fires before focus lands somewhere else: look once it has.
    queueMicrotask(() => { held.still = typing() || ms > 0; });
    if (ms > 0) this.quietTimer = window.setTimeout(() => { held.still = typing(); }, ms);
  }

  /** Put away while in your hands: calls done once the hands have lowered it out of sight (or at most a second on). */
  whenLowered(done: () => void): () => void {
    const t = window.setTimeout(() => this.lowered?.(), 1000);
    this.lowered = () => { clearTimeout(t); this.lowered = null; done(); };
    return () => { clearTimeout(t); this.lowered = null; };
  }
  private lowered: (() => void) | null = null;

  private frame(f: HeldFrame | null) {
    const now = performance.now() / 1000;
    if (!f && this.lowered) { this.lowered(); return; }
    if (!f) {
      // Put away: follow the hands down until the phone unmounts. Switched to third person: glide to the overlay.
      if ((this.mode === "held" || this.mode === "in") && this.last && !this.wrap.classList.contains("leaving")) {
        this.from = this.last.pages;
        this.t0 = now;
        this.setMode("out");
        this.glideOut();
      } else if (this.mode === "wait") this.toOverlay();
      return;
    }
    const pages: Pages = { cover: f.cover.corners, left: f.left.corners, spread: f.spread.corners };
    if (this.mode === "overlay" || this.mode === "out") {
      // On screen in the overlay (or gliding back to it): glide from where the pages are now into the hands.
      this.from = this.mode === "out" && this.last ? this.last.pages : overlayPages();
      this.t0 = now;
      cancelAnimationFrame(this.raf);
      this.setMode("in");
    } else if (this.mode === "wait") this.setMode("held");
    let shown = pages;
    if (this.mode === "in") {
      const k = ease((now - this.t0) / GLIDE);
      shown = { cover: lerpQuad(this.from!.cover, pages.cover, k), left: lerpQuad(this.from!.left, pages.left, k), spread: lerpQuad(this.from!.spread, pages.spread, k) };
      if (k >= 1) this.setMode("held");
    }
    this.last = { pages: shown, frame: f };
    this.lay(shown, f);
  }

  /** Back to the overlay's places, by itself (the game has stopped sending frames). */
  private glideOut = () => {
    if (this.mode !== "out" || !this.from || !this.last) return;
    const k = ease((performance.now() / 1000 - this.t0) / GLIDE);
    const to = overlayPages();
    const open = this.wrap.classList.contains("open") ? 1 : 0;
    const at: Pages = { cover: lerpQuad(this.from.cover, to.cover, k), left: lerpQuad(this.from.left, to.left, k), spread: lerpQuad(this.from.spread, to.spread, k) };
    // Settle on how the overlay shows it: the cover folded, the spread open.
    this.lay(at, { ...this.last.frame, open, cover: { ...this.last.frame.cover, front: !open }, left: { ...this.last.frame.left, front: false } });
    if (k >= 1) this.toOverlay();
    else this.raf = requestAnimationFrame(this.glideOut);
  };

  private toOverlay() {
    cancelAnimationFrame(this.raf);
    this.setMode("overlay");
    this.last = null;
  }

  private setMode(mode: Mode) {
    const was = this.mode;
    this.mode = mode;
    const w = this.wrap;
    if (mode === "overlay") {
      delete w.dataset["held"];
      for (const el of this.pages()) if (el) for (const k of ["transform", "zoom", "opacity", "clipPath", "zIndex", "pointerEvents", "visibility"] as const) el.style[k] = "";
      this.laid.clear();
      const still = w.querySelector<HTMLElement>(".leaf-left > .still");
      if (still) still.style.opacity = "";
      // Back in the overlay's own layout: no transition from wherever the pages were (two frames, so it lands first).
      if (was !== "overlay") {
        w.dataset["settle"] = "";
        requestAnimationFrame(() => requestAnimationFrame(() => { delete w.dataset["settle"]; }));
      }
    } else w.dataset["held"] = mode === "wait" ? "wait" : "";
  }

  private pages() {
    const q = (s: string) => this.wrap.querySelector<HTMLElement>(s);
    return [q(".leaf-cover"), q(".leaf-left"), q(".spread")] as const;
  }

  /** Lays each page over its quad, showing what faces you. */
  private lay(p: Pages, f: HeldFrame) {
    const [cover, left, spread] = this.pages();
    const open = f.open;
    // While the swinging half lies over the fixed one, it's in front of it.
    const leafOnTop = open < 0.5;
    // Chrome draws a page seen in perspective at one pixel per CSS pixel, whatever the screen: soft on a big or a
    // Retina screen. So each page is laid out as big as it's seen (zoom), and mapped down onto its glass.
    const s = phoneScale(innerWidth, innerHeight), dpr = devicePixelRatio || 1;
    const put = (el: HTMLElement | null, q: Quad, w: number, h: number, show: number, z: number, hit: boolean, scale: number) => {
      if (!el) return;
      const ok = show > 0 && drawable(q);
      el.style.visibility = ok ? "visible" : "hidden";
      if (!ok) return;
      const zoom = sharpZoom(scale, dpr);
      if (el.style.zoom !== String(zoom)) el.style.zoom = String(zoom);
      // Only when it moved: a page left alone is drawn once, not redrawn every frame.
      const m = cssMatrix(quadMatrix(w, h, q.map(([x, y]) => [x / zoom, y / zoom])));
      if (this.laid.get(el) !== m) { el.style.transform = m; this.laid.set(el, m); }
      el.style.opacity = String(show);
      el.style.zIndex = String(z);
      // The wrap lets clicks through to the backdrop round the phone; the glass takes them.
      el.style.pointerEvents = hit ? "auto" : "none";
    };
    const coverShows = f.cover.front && open < 0.999 ? 1 : 0;
    put(cover, p.cover, COVER.w, COVER.h, coverShows, leafOnTop ? 3 : 1, coverShows > 0 && open < 0.5, s.cover);
    put(left, p.left, SPREAD.w / 2, SPREAD.h, f.left.front && open < 0.999 ? 1 : 0, leafOnTop ? 3 : 2, false, s.open);
    // The spread's right half shows as the half over it swings away; all of it once the phone is flat.
    const spreadShows = smooth(0.3, 0.6, open);
    put(spread, p.spread, SPREAD.w, SPREAD.h, spreadShows, 2, spreadShows > 0.5, s.open);
    if (spread) spread.style.clipPath = open >= 0.999 ? "" : `inset(0 0 0 ${SPREAD.w / 2}px)`;
    // The left page's still copy of the list brightens as it lands, until the spread takes over from it.
    const still = left?.querySelector<HTMLElement>(".still");
    if (still) still.style.opacity = String(0.35 + 0.65 * open);
  }
}
