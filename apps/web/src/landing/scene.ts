// The landing page's backdrop: the real yacht at night, a slow camera round it, a few crew
// off duty on the sun deck and at their desks, and a helicopter now and then. Loaded on demand
// (Landing.tsx imports it dynamically), so the sign-in path never waits for three.js.
//
// It looks after itself: it caps the pixel ratio, pauses while the tab is hidden, and if the frame
// rate stays poor it first renders smaller, then gives up (onSlow), and the page keeps its poster.

import * as THREE from "three";
import { BANTER } from "../game/banter.ts";
import { hash } from "../game/rng.ts";
import { CREW_PRESETS, CrewFigure, Walker, actFor, createPipeline, createRenderer, type Quality } from "@offsite/kit";
import type { CrewActivity, Slot } from "@offsite/contracts";
import { buildYacht, type YachtWorld } from "@offsite/world-yacht";
import { poseAt, type Pose } from "./path.ts";

/** Night: stars, the moon on the water, the deck lights on. */
export const LANDING_HOUR = 21.5;
/** Busy enough that the office and the core glow. */
export const LANDING_BUSY = 0.6;
/** Seconds between helicopters. */
const HELI_EVERY = 46;

export interface LandingOptions {
  quality?: Quality;
  /** Most device pixels per CSS pixel. */
  maxPixelRatio?: number;
  /** Most pixels to draw a frame (the pixel ratio comes down on very large screens). */
  maxPixels?: number;
  /** Where on the loop the camera starts, seconds (0 is the poster's frame). */
  start?: number;
  /** Shift the picture this far right, as a fraction of the width (room for the text on the left). */
  shift?: number;
  /** Shift the picture up, as a fraction of the height (room for the text below, on a phone). */
  shiftY?: number;
  /** Crew on deck. */
  crew?: boolean;
  /** The frame rate stayed poor even at a low resolution: stop and keep the poster. */
  onSlow?: () => void;
}

export interface LandingScene {
  /** Starts (or resumes) the loop. */
  play(): void;
  /** Stops drawing (the tab is hidden, or the page is going). */
  pause(): void;
  /** Holds the camera at a point on the loop, or at a pose of its own, and draws (for posters and checks). */
  still(t: number, pose?: Pose): void;
  resize(width: number, height: number): void;
  /** What it's doing: frames a second over the last measure, the pixel ratio, the build time. */
  stats(): { fps: number; pixelRatio: number; buildMs: number; compiledMs: number };
  dispose(): void;
}

interface Placed { fig: CrewFigure; walker: Walker }
interface Group { members: Placed[]; centre: THREE.Vector3; next: number; round: number; line: number }

// Who is where: a few at the bar and in the hot tub, someone on a lounger and at the stern rail,
// and some still at their desks (the office glows anyway; these make it look lived in).
const OFF_DUTY: { slot: string; group?: "bar" | "tub" }[] = [
  { slot: "bar-stool-3", group: "bar" }, { slot: "bar-stool-4", group: "bar" }, { slot: "bar-stool-6", group: "bar" },
  { slot: "hot-tub-2", group: "tub" }, { slot: "hot-tub-4", group: "tub" }, { slot: "hot-tub-6", group: "tub" },
  { slot: "lounger-5" }, { slot: "rail-sun-aft2" }, { slot: "hammock-d2p35" },
];
const AT_WORK = 7;

export async function createLandingScene(canvas: HTMLCanvasElement, o: LandingOptions = {}): Promise<LandingScene> {
  const quality = o.quality ?? "high";
  const maxRatio = o.maxPixelRatio ?? 1.25;
  const maxPixels = o.maxPixels ?? 2_400_000;
  const renderer = createRenderer(canvas, { quality, pixelRatio: 1 });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.5, 6000);
  const pipeline = createPipeline(renderer, scene, camera, { quality });
  // Ambient occlusion is the frame's most expensive pass and hardly shows at night from out here.
  pipeline.setPasses({ occlusion: false });

  const t0 = performance.now();
  const world: YachtWorld = await buildYacht({ renderer, scene, camera, quality, assets: "/" }, { hour: LANDING_HOUR, busy: LANDING_BUSY });
  scene.add(world.root);
  const buildMs = performance.now() - t0;

  // ---- the crew ----
  const placed: Placed[] = [];
  const groups = new Map<string, Group>();
  if (o.crew !== false) {
    const bySlot = new Map(world.layout.slots.map((s) => [s.id, s]));
    const desks = world.layout.slots.filter((s) => s.kind === "desk");
    const put = (slot: Slot, i: number, activity: CrewActivity) => {
      const p = CREW_PRESETS[i % CREW_PRESETS.length]!;
      const fig = new CrewFigure({ spec: p.spec, look: p.look, name: p.name, seed: i * 7 + 3 });
      fig.water = 0;
      fig.plate.sprite.visible = false;
      scene.add(fig.object);
      const walker = new Walker(fig.object);
      walker.place(slot);
      fig.setAct(actFor(activity, slot.kind));
      const one = { fig, walker };
      placed.push(one);
      return one;
    };
    OFF_DUTY.forEach(({ slot, group }, i) => {
      const s = bySlot.get(slot);
      if (!s) return;
      const one = put(s, i, "idle");
      if (!group) return;
      const g = groups.get(group) ?? { members: [], centre: new THREE.Vector3(), next: 3 + groups.size * 5, round: groups.size * 7, line: 0 };
      g.members.push(one);
      groups.set(group, g);
    });
    for (const g of groups.values()) {
      for (const m of g.members) g.centre.add(m.fig.object.position);
      g.centre.divideScalar(g.members.length);
    }
    // Desks spread through the office, so the glass shows people all along it.
    for (let k = 0; k < AT_WORK && desks.length; k++) {
      const s = desks[Math.floor(((k + 0.5) / AT_WORK) * desks.length)]!;
      put(s, OFF_DUTY.length + k, "editing");
    }
  }

  // ---- helicopters: one arriving every HELI_EVERY seconds, the first soon after the page opens ----
  const opened = Date.now();
  const arrivals = (now: number) => {
    const first = opened + 24_000;
    const k = Math.max(0, Math.floor((now - first) / (HELI_EVERY * 1000)));
    return [first + (k - 1) * HELI_EVERY * 1000, first + k * HELI_EVERY * 1000, first + (k + 1) * HELI_EVERY * 1000].filter((t) => t >= first);
  };
  let arrivalKey = "";
  const fly = (now: number) => {
    const a = arrivals(now), key = a.join();
    if (key !== arrivalKey) { arrivalKey = key; world.setArrivals(a); }
  };

  // ---- the camera ----
  const shift = o.shift ?? 0, shiftY = o.shiftY ?? 0;
  let width = 1, height = 1;
  let held: Pose | null = null;
  function place(t: number) {
    const p = held ?? poseAt(t);
    camera.position.set(...p.pos);
    camera.lookAt(...p.at);
    // A narrow screen sees less across: widen the lens a little so the yacht still fits.
    const aspect = width / Math.max(1, height);
    const fit = aspect < 1.5 ? Math.min(1.45, 1.5 / aspect) : 1;
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(p.fov) / 2) * fit));
    camera.updateProjectionMatrix();
  }
  function applyShift() {
    if (shift || shiftY) camera.setViewOffset(width, height, -shift * width, shiftY * height, width, height);
    else camera.clearViewOffset();
  }

  let ratio = 1, ratioCap = Infinity;
  function resize(w: number, h: number) {
    width = Math.max(1, Math.round(w));
    height = Math.max(1, Math.round(h));
    const dpr = window.devicePixelRatio || 1;
    ratio = Math.min(dpr, maxRatio, Math.sqrt(maxPixels / (width * height)), ratioCap);
    renderer.setPixelRatio(ratio);
    pipeline.setSize(width, height);
    applyShift();
  }

  // ---- banter: lines traded in bubbles, only while the camera is close enough to read them ----
  const _cam = new THREE.Vector3();
  function banter(dt: number) {
    for (const [name, g] of groups) {
      g.next -= dt;
      if (g.next > 0) continue;
      const ex = BANTER[hash(name, g.round) % BANTER.length]!;
      if (g.line >= ex.length) { g.round++; g.line = 0; g.next = 7; continue; }
      g.next = 3.4;
      const near = camera.getWorldPosition(_cam).distanceTo(g.centre) < 34;
      const who = g.members[(hash(name, g.round, "who") + g.line) % g.members.length]!;
      if (near) who.fig.say(ex[g.line]!);
      g.line++;
    }
  }

  // ---- the loop ----
  let clock = o.start ?? 0;
  let raf = 0, playing = false, last = 0, figTime = 0;
  const step = (dt: number, t: number) => {
    const now = Date.now();
    fly(now);
    place(t);
    world.update(dt, now);
    figTime += dt;
    banter(dt);
    for (const { fig, walker } of placed) {
      fig.update(dt, figTime, { speed: 0, seat: walker.seat, camera });
      fig.plate.sprite.visible = false;
    }
    pipeline.render(dt);
  };

  // Frame rate: after a warm-up, measured over windows of a couple of seconds of real time. Poor twice in a row:
  // render smaller; still poor at the smallest: give up.
  let fps = 0, wFrames = 0, wTime = 0, warm = 2.5, poor = 0;
  const POOR_FPS = 26;
  function measure(dt: number) {
    if (warm > 0) { warm -= dt; return; }
    wFrames++;
    wTime += dt;
    if (wTime < 2) return;
    fps = wFrames / wTime;
    wFrames = 0;
    wTime = 0;
    if (fps >= POOR_FPS) { poor = 0; return; }
    if (++poor < 2) return;
    poor = 0;
    if (ratio > 0.6) {
      ratioCap = Math.max(0.55, ratio * 0.7);
      resize(width, height);
      warm = 1;
    } else {
      pause();
      o.onSlow?.();
    }
  }

  function frame(ts: number) {
    if (!playing) return;
    raf = requestAnimationFrame(frame);
    // The real time between frames for the frame rate; the world steps at most 0.1 s at a time.
    const real = last ? (ts - last) / 1000 : 1 / 60;
    const dt = Math.min(0.1, real);
    last = ts;
    clock += dt;
    step(dt, clock);
    measure(real);
  }
  function play() {
    if (playing) return;
    playing = true;
    last = 0;
    raf = requestAnimationFrame(frame);
  }
  function pause() {
    playing = false;
    cancelAnimationFrame(raf);
  }

  resize(canvas.clientWidth || innerWidth, canvas.clientHeight || innerHeight);
  // Compile every shader before the first frame is shown, without blocking the page where the
  // browser can (KHR_parallel_shader_compile), then draw a couple of frames to settle the sky
  // probe and the shadows.
  place(clock);
  const c0 = performance.now();
  await renderer.compileAsync(scene, camera).catch(() => {});
  const compiledMs = performance.now() - c0;
  step(1 / 60, clock);
  step(1 / 60, clock);

  return {
    play,
    pause,
    still(t, pose) {
      pause();
      clock = t;
      held = pose ?? null;
      // Settle the sky's reflections and the shadows at this spot.
      for (let i = 0; i < 3; i++) step(1 / 60, t);
    },
    resize,
    stats: () => ({ fps, pixelRatio: ratio, buildMs, compiledMs }),
    dispose() {
      pause();
      for (const { fig } of placed) fig.dispose();
      world.dispose();
      pipeline.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
