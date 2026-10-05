// The film page: the real game and the real interface on a scripted ship, on a virtual clock.
// /dev/film.html?shot=<name>          plays a shot in real time, for looking at (loops)
// /dev/film.html?shot=<name>&capture  waits for scripts/film to step it, frame by frame
// /dev/film.html                      the list of shots
// /dev/film.html?shot=<name>&sound    a preview with the game's sound on (click once to start it)
//
// The clock goes first: everything imported after it reads virtual time.
import { clock, BASE_EPOCH, FRAME_MS } from "./clock.ts";
import * as THREE from "three";
import { createRoot } from "react-dom/client";
import { ConvexProvider } from "convex/react";
import { Game } from "../game/Game.tsx";
import { Overlay } from "../overlay/Overlay.tsx";
// The diff colouring is loaded on demand in the app; here it's ready before the first frame.
import "../review/highlight.ts";
import { FilmBackend } from "./backend.ts";
import { gameHandle, ShotRunner } from "./runner.ts";
import { audio } from "../audio/index.ts";
import { SHOTS, STILLS } from "./shots.ts";
import type { Shot } from "./dsl.ts";
import "./film.css";

const params = new URLSearchParams(location.search);
// No sound here: frame capture can't record it, and the cut uses the soundtrack files
// (assets/audio/video). &sound turns it on in a preview, to hear a shot's cues while writing it.
if (!params.has("sound") || params.has("capture")) audio.disable();

const capture = params.has("capture");
const all: Shot[] = [...SHOTS, ...STILLS];
const named = all.find((s) => s.name === params.get("shot"));
// For writing shots: &story=, &warmup= and &duration= override the shot's.
const num = (k: string) => (params.has(k) ? Number(params.get(k)) : undefined);
const shot: Shot | undefined = named && {
  ...named,
  ...(num("story") !== undefined ? { story: num("story")! } : {}),
  ...(num("warmup") !== undefined ? { warmup: num("warmup")! } : {}),
  ...(num("duration") !== undefined ? { duration: num("duration")! } : {}),
  // &cam=x,y,z,tx,ty,tz[,fov]: hold the camera there instead.
  ...(params.has("cam") ? { camera: { hold: camParam(params.get("cam")!) } } : {}),
};
function camParam(v: string) {
  const [x, y, z, tx, ty, tz, fov] = v.split(",").map(Number);
  return { pos: [x!, y!, z!] as [number, number, number], at: [tx!, ty!, tz!] as [number, number, number], fov: fov || 50 };
}

// What scripts/film reads to know the shots.
const meta = (s: Shot) => ({ name: s.name, note: s.note, duration: Math.round(s.duration * 1000) / 1000, warmup: s.warmup ?? 2, size: s.size ?? [1920, 1080], file: (s as { file?: string }).file ?? null });
Object.assign(window, { filmShots: { shots: SHOTS.map(meta), stills: STILLS.map(meta) } });

// Textures still on their way: the first frame waits for them.
let loading = 0;
const mgr = THREE.DefaultLoadingManager;
const start = mgr.itemStart.bind(mgr), end = mgr.itemEnd.bind(mgr);
mgr.itemStart = (url) => { loading++; start(url); };
mgr.itemEnd = (url) => { loading--; end(url); };

const FONTS = ["300 16px Saira", "500 16px Saira", "600 16px Saira", "700 16px Saira", "400 13px 'JetBrains Mono'", "600 13px 'JetBrains Mono'"];

// Everything the page does in reaction to a frame (React rendering, its effects, the state they
// set) happens in tasks of its own, in no fixed order with ours. So after each step the film waits
// for quiet: it keeps yielding until a few rounds pass with no change to the DOM.
let mutations = 0;
new MutationObserver((list) => { mutations += list.length; }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
const tick = () => new Promise<void>((r) => { const ch = new MessageChannel(); ch.port1.onmessage = () => r(); ch.port2.postMessage(0); });

async function settle(quiet = 3, most = 60) {
  let still = 0;
  for (let i = 0; i < most && still < quiet; i++) {
    const before = mutations;
    await tick();
    still = mutations === before ? still + 1 : 0;
  }
}

function Index() {
  return (
    <div className="film-index">
      <h1>Film</h1>
      <p>Clips: <code>pnpm film &lt;shot|all&gt;</code>. Stills: <code>pnpm film:stills</code>.</p>
      <h2>Clips</h2>
      <ul>{SHOTS.map((s) => <li key={s.name}><a href={`?shot=${s.name}`}>{s.name}</a> <span>{s.duration}s · {s.note}</span></li>)}</ul>
      <h2>Stills</h2>
      <ul>{STILLS.map((s) => <li key={s.name}><a href={`?shot=${s.name}`}>{s.name}</a> <span>{s.note}</span></li>)}</ul>
    </div>
  );
}

if (!shot) {
  createRoot(document.getElementById("root")!).render(<Index />);
} else {
  const warm = shot.warmup ?? 2;
  // Date.now() after the first step is the story time where the warm-up starts.
  clock.setWall(BASE_EPOCH + (shot.story - warm) * 1000 - FRAME_MS);
  const backend = new FilmBackend(BASE_EPOCH, shot.story - warm);
  const runner = new ShotRunner(shot, backend);
  const [w, h] = shot.size ?? [1920, 1080];
  document.body.classList.add("film-nohud");
  if (!capture) document.body.classList.add("film-preview");

  createRoot(document.getElementById("root")!).render(
    <ConvexProvider client={backend.asClient()}>
      <Game officeId={FilmBackend.office} />
      <Overlay officeId={FilmBackend.office} />
    </ConvexProvider>,
  );

  let f = 0;
  const total = runner.warmupFrames + runner.frames;
  // Hook in the moment the game publishes its dev handle (in its build, before its first plan).
  let handle: unknown;
  Object.defineProperty(window, "offsite", {
    configurable: true,
    get: () => handle,
    set: (v) => { handle = v; const g = gameHandle(); if (g) runner.attach(g); },
  });

  const film = {
    shot,
    size: [w, h] as [number, number],
    warmupFrames: runner.warmupFrames,
    frames: runner.frames,
    /** True once the world is built, the crew aboard, the fonts and textures loaded. */
    async ready(): Promise<boolean> {
      const g = gameHandle();
      if (!g || !g.game.bodies.size) return false;
      await Promise.all(FONTS.map((x) => document.fonts.load(x)));
      return loading === 0 && document.fonts.status === "loaded";
    },
    /** Draws the next frame. record: it belongs in the clip (false during the warm-up). */
    async frame(): Promise<{ f: number; t: number; record: boolean; done: boolean }> {
      const t = (f - runner.warmupFrames) / 60;
      backend.update(runner.story(t));
      runner.pre(t);
      await settle();
      clock.step(FRAME_MS);
      await settle();
      clock.syncAnimations();
      const out = { f, t, record: f >= runner.warmupFrames, done: f + 1 >= total };
      f++;
      return out;
    },
    /** Who is where, for writing shots: crew key → slot, activity, position. */
    where() {
      const g = gameHandle();
      if (!g) return null;
      return [...g.game.bodies.values()].map((b) => ({
        crew: b.id.replace(/^crew_/, ""), activity: b.dir?.activity, target: b.dir?.target, arrived: b.arrived,
        pos: b.fig.object.position.toArray().map((x) => Math.round(x * 100) / 100),
      }));
    },
    slots() { return gameHandle()?.world.layout.slots ?? null; },
    backend,
    clock,
  };
  Object.assign(window, { film });

  // Looking at a shot in a browser: play it in real time, round and round (reload to restart from
  // the top: the ship's state only moves forward).
  if (!capture) {
    const tick = async () => {
      if (await film.ready()) {
        const r = await film.frame();
        if (r.done) { location.reload(); return; }
      }
      clock.real.requestAnimationFrame(() => void tick());
    };
    clock.real.setTimeout(() => void tick(), 50);
  }
}
