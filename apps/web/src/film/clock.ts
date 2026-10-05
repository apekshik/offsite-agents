// The film's clock. Date, performance.now, requestAnimationFrame, setTimeout and setInterval all
// run on virtual time that moves only when the film steps it (exactly 1/60 s a frame), so a shot
// renders the same, frame for frame, however long each frame takes to draw and capture. CSS
// animations and transitions are put on the same clock (syncAnimations), and Math.random is seeded.
//
// The film page (main.tsx) imports this first, before anything that reads the time: ES modules
// evaluate in import order, so React's scheduler, three's Timer and the app all see these.
//
// While nothing steps it, time stands still: timers that are already due still run (so a promise
// chain with a setTimeout(0) in it finishes loading), but nothing later fires and no frame is drawn.

type Timer = { id: number; due: number; addedAt: number; seq: number; fn: () => void; every: number | null };

const real = {
  setTimeout: window.setTimeout.bind(window),
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  now: performance.now.bind(performance),
  random: Math.random,
};

const params = new URLSearchParams(location.search);

/**
 * Story time zero: 19:00 on 20 June 2026 in Los Angeles. The same as epoch.ts; repeated here
 * because this file imports nothing (dev pages load it on its own, first).
 */
export const BASE_EPOCH = Date.UTC(2026, 5, 21, 2, 0, 0);

export const FRAME_MS = 1000 / 60;

/** Milliseconds since the page loaded, as performance.now and rAF timestamps read them. */
let elapsed = 1000;
/** Date.now() = wallOffset + elapsed. */
let wallOffset = BASE_EPOCH - elapsed;
let started = false;
let seq = 0;
let nextId = 1;
let timers: Timer[] = [];
const frames = new Map<number, FrameRequestCallback>();
let pumping = false;

const wall = () => wallOffset + elapsed;

function insert(t: Timer) {
  let i = timers.length;
  while (i > 0 && (timers[i - 1]!.due > t.due || (timers[i - 1]!.due === t.due && timers[i - 1]!.seq > t.seq))) i--;
  timers.splice(i, 0, t);
  if (t.due <= elapsed) pump();
}

function add(handler: TimerHandler, ms: number | undefined, args: unknown[], repeat: boolean): number {
  const delay = Math.max(repeat ? 1 : 0, Number(ms) || 0);
  const fn = typeof handler === "function" ? () => (handler as (...a: unknown[]) => void)(...args) : () => {};
  const t: Timer = { id: nextId++, due: elapsed + delay, addedAt: elapsed, seq: seq++, fn, every: repeat ? delay : null };
  insert(t);
  return t.id;
}

function clear(id: number | undefined) {
  if (id === undefined) return;
  const i = timers.findIndex((t) => t.id === id);
  if (i >= 0) timers.splice(i, 1);
}

/** Fires timers due by `until`, in order, with the clock at each one's time. A zero delay set while running waits for the pump. */
function runDue(until: number) {
  const cutoff = seq;
  for (let guard = 0; guard < 100_000; guard++) {
    const i = timers.findIndex((t) => t.due <= until && (t.seq < cutoff || t.due > t.addedAt));
    if (i < 0) return;
    const t = timers.splice(i, 1)[0]!;
    if (t.due > elapsed) elapsed = t.due;
    if (t.every !== null) insert({ ...t, due: t.due + t.every, addedAt: elapsed, seq: seq++ });
    try { t.fn(); } catch (e) { console.error(e); }
  }
}

function pump() {
  if (pumping) return;
  pumping = true;
  real.setTimeout(() => { pumping = false; runDue(elapsed); }, 0);
}

// ---- the overrides ----

const RealDate = Date;
class FilmDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) super(wall());
    else super(...(args as [number]));
  }
  static override now() { return wall(); }
}
window.Date = FilmDate as DateConstructor;
Object.defineProperty(performance, "now", { value: () => elapsed, configurable: true, writable: true });
window.requestAnimationFrame = (cb: FrameRequestCallback) => { const id = nextId++; frames.set(id, cb); return id; };
window.cancelAnimationFrame = (id: number) => { frames.delete(id); };
window.setTimeout = ((h: TimerHandler, ms?: number, ...a: unknown[]) => add(h, ms, a, false)) as typeof window.setTimeout;
window.setInterval = ((h: TimerHandler, ms?: number, ...a: unknown[]) => add(h, ms, a, true)) as typeof window.setInterval;
window.clearTimeout = clear as typeof window.clearTimeout;
window.clearInterval = clear as typeof window.clearInterval;

/** mulberry32: the same numbers every load. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
Math.random = seeded(Number(params.get("seed") ?? 7));

// ---- CSS animations on the same clock ----

const animStart = new WeakMap<Animation, number>();

/** Puts every CSS animation and transition at its virtual time. Call after the DOM settles, before a capture. */
function syncAnimations() {
  for (const a of document.getAnimations()) {
    let start = animStart.get(a);
    if (start === undefined) {
      start = elapsed;
      animStart.set(a, start);
      a.pause();
    }
    const t = elapsed - start;
    const end = Number(a.effect?.getComputedTiming().endTime ?? Infinity);
    if (Number.isFinite(end) && t >= end) a.finish();
    else a.currentTime = t;
  }
}

export const clock = {
  /** Virtual ms since the epoch (what Date.now() says). */
  now: wall,
  /** Virtual ms since the page loaded (performance.now). */
  elapsed: () => elapsed,
  /** Before the first step: set what Date.now() says. */
  setWall(ms: number) {
    if (started) throw new Error("The film clock is already running");
    wallOffset = ms - elapsed;
  },
  /** Moves time on by ms: timers fire in order, then one animation frame is drawn. */
  step(ms = FRAME_MS) {
    started = true;
    const until = elapsed + ms;
    runDue(until);
    elapsed = until;
    const due = [...frames.values()];
    frames.clear();
    for (const cb of due) {
      try { cb(elapsed); } catch (e) { console.error(e); }
    }
  },
  syncAnimations,
  real,
};

export type FilmClock = typeof clock;
