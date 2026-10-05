// The UI gallery: the real interface's main screens, each in one state, on fixture data, side by side. For quick
// visual checks while you change a component, and for CI's screenshots (scripts/screenshots.mjs).
//
//   /gallery.html                  every cell, in frames
//   /gallery.html?cell=<name>      one cell, full window (what each frame shows)
//   /gallery.html?group=Phone      one group's cells
//
// Served by `pnpm dev:demo` (vite.demo.config.ts), next to demo mode.
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { DemoBackend } from "../demo/backend.ts";
import { CellView, CELLS, type Cell } from "./cells.tsx";
// The diff colouring loads on demand in the app; here it's ready for the first frame.
import "../review/highlight.ts";
import "./gallery.css";

const params = new URLSearchParams(location.search);
/** When a cell's ship stops moving, ms after it loads. */
const HOLD_AFTER_MS = 3000;
const one = CELLS.find((c) => c.name === params.get("cell"));

function Single({ cell }: { cell: Cell }) {
  const [demo] = useState(() => {
    // The ship's time runs for a few seconds (so what a cell waits for happens), then holds: a cell looks the same
    // however long a screenshot takes.
    const t0 = Date.now();
    const d = new DemoBackend(cell.setup, () => Math.min(Date.now(), t0 + (cell.holdAfterMs ?? HOLD_AFTER_MS))).start();
    cell.seed?.(d);
    return d;
  });
  useEffect(() => {
    // After the first render, so the stores' subscribers are listening.
    const t = setTimeout(() => { cell.show?.(demo); demo.refresh(); document.body.dataset["ready"] = "1"; }, 150);
    return () => { clearTimeout(t); demo.stop(); };
  }, [cell, demo]);
  return <CellView cell={cell} demo={demo} />;
}

/** A frame, scaled to fit its column; the cell inside renders at its own size. */
function Frame({ cell, w, h }: { cell: Cell; w: number; h: number }) {
  const src = `?cell=${cell.name}`;
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.3);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(el.clientWidth / w));
    ro.observe(el);
    return () => ro.disconnect();
  }, [w]);
  return (
    <figure className="gl-cell" id={cell.name}>
      <div className="gl-frame" ref={box} style={{ aspectRatio: `${w} / ${h}` }}>
        <iframe src={src} title={cell.title} width={w} height={h} loading="lazy" style={{ width: w, height: h, transform: `scale(${scale})` }} />
      </div>
      <figcaption><a href={src} target="_blank" rel="noreferrer">{cell.title}</a> <code>{cell.name}</code></figcaption>
    </figure>
  );
}

function Index() {
  const group = params.get("group");
  const [size, setSize] = useState<"desktop" | "phone">("desktop");
  const [w, h] = size === "desktop" ? [1280, 800] : [390, 844];
  const groups = [...new Set(CELLS.map((c) => c.group))].filter((g) => !group || g === group);
  return (
    <div className="gallery">
      <header className="gl-head">
        <h1>Offsite · UI gallery</h1>
        <p>The real components on fixture data (src/gallery/cells.tsx). Open a cell on its own to poke at it; the demo's at <a href="/">/</a>.</p>
        <div className="gl-size" role="radiogroup" aria-label="Frame size">
          {(["desktop", "phone"] as const).map((s) => (
            <button key={s} type="button" role="radio" aria-checked={size === s} className={size === s ? "on" : ""} onClick={() => setSize(s)}>{s === "desktop" ? "Desktop 1280" : "Phone 390"}</button>
          ))}
        </div>
      </header>
      {groups.map((g) => (
        <section key={g}>
          <h2>{g}</h2>
          <div className={`gl-grid ${size}`}>
            {CELLS.filter((c) => c.group === g).map((c) => <Frame key={`${c.name}:${size}`} cell={c} w={w} h={h} />)}
          </div>
        </section>
      ))}
    </div>
  );
}

if (one) {
  document.body.classList.add("gallery-one");
  createRoot(document.getElementById("root")!).render(<Single cell={one} />);
} else {
  document.body.classList.add("gallery-index");
  createRoot(document.getElementById("root")!).render(<Index />);
}
