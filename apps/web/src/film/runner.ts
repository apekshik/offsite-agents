import * as THREE from "three";
import type { Slot } from "@offsite/contracts";
import { ui } from "../bridge.ts";
import { phone } from "../phone/state.ts";
import { openReview, closeReview } from "../review/open.ts";
import { soloAct, type Act, type Direction, type Hangout, type Prop } from "../game/director.ts";
import { beatAt, roundMs } from "../game/banter.ts";
import { BASE_EPOCH } from "./epoch.ts";
import type { FilmHooks } from "../game/engine.ts";
import { damp, dolly, orbit, turn, yawTo, type Pose, type Vec3 } from "./camera.ts";
import type { Action, Blocking, FilmGroup, Shot, Target } from "./dsl.ts";
import type { FilmBackend } from "./backend.ts";
import { crewId } from "./story.ts";

// Plays one shot against the running game: the sky, the camera, the captain, the staging and the
// interface, frame by frame. The film page (main.tsx) calls pre(t) before each frame is drawn; the
// game calls the camera hook while it draws.

export const FPS = 60;

/** The parts of the game the film reaches into (the dev handle window.offsite). */
export interface GameHandle {
  game: {
    film: FilmHooks | null;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    setSnapshot(s: unknown): void;
    /** Crew whose bubbles and tags always show (absent on older engines). */
    focus?(ids: string[] | null): void;
    bodies: Map<string, Body>;
  };
  /** The director, for the places it makes up (behind the bar, standing in a group). */
  director?: { slot(id: string): Slot | undefined; behindTheBar?: { slot: Slot; approach: Vec3[] | null } | null };
  captain: {
    object: THREE.Object3D;
    position: THREE.Vector3;
    view: "first" | "third";
    cameraRig: { yaw: number; pitch: number; dist: number };
    input: { keys: Set<string> };
    teleport(pos: [number, number, number], facing?: number): void;
  };
  world: {
    layout: { slots: Slot[]; nav: { nodes: { id: string; pos: Vec3 }[] } };
    setHour?(h: number | null): void;
    setBusy?(level: number): void;
  };
}

interface Body {
  id: string;
  fig: { object: THREE.Object3D; say(text: string, ms?: number): void };
  walker: { place(slot: Slot): void; stop(): void };
  dir: { target: { kind: string; slotId?: string }; activity: string } | null;
  arrived: boolean;
}

export const gameHandle = (): GameHandle | null => {
  const h = (window as unknown as { offsite?: GameHandle }).offsite;
  return h?.game && h.world ? h : null;
};

const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const range = (v: number | [number, number] | undefined, u: number) => (v === undefined ? undefined : typeof v === "number" ? v : lerp(v[0], v[1], u));

/**
 * What someone staged at a slot does there, unless the shot says otherwise: the director's own
 * choice for that kind of spot (soloAct), with a few picked for the film (a drink on the stool, a
 * nap in the hammock).
 */
const SLOT_ACT: Partial<Record<Slot["kind"], { act: Act; props: Prop[]; label: string }>> = {
  "bar-stool": { act: "stool", props: ["drink"], label: "at the bar" },
  "deck-chair": { act: "sit-drink", props: ["drink"], label: "having a drink" },
  "hot-tub": { act: "soak", props: [], label: "in the hot tub" },
  pool: { act: "swim", props: [], label: "swimming" },
  lounger: { act: "sunbathe", props: [], label: "sunbathing" },
  hammock: { act: "nap-hammock", props: [], label: "napping" },
  fishing: { act: "fish", props: ["rod"], label: "fishing" },
  rail: { act: "rail", props: [], label: "watching the sea" },
};
/** The nameplate's line for an act a shot asks for by name. */
const ACT_LABEL: Partial<Record<Act, string>> = {
  cards: "playing cards", dance: "dancing", selfie: "taking selfies", nap: "napping", "nap-hammock": "napping", "nap-chair": "napping",
  drink: "having a drink", "sit-drink": "having a drink", lift: "lifting", "lift-bench": "lifting", jog: "on the treadmill", stretch: "stretching",
  bartend: "bartending", tinker: "tinkering", sofa: "taking it easy", swim: "swimming", sunbathe: "sunbathing", fish: "fishing",
};
const fitFor = (slot: Slot) => {
  const f = SLOT_ACT[slot.kind];
  if (f) return f;
  const solo = soloAct(slot, 0.6);
  return { act: solo.act, props: solo.props, label: solo.pastime };
};

export class ShotRunner {
  readonly shot: Shot;
  readonly warmupFrames: number;
  readonly frames: number;
  private h: GameHandle | null = null;
  private backend: FilmBackend;
  private done = new Set<number>();
  private typing: { at: number; text: string; cps: number } | null = null;
  private followAt: Vec3 | null = null;
  private followLook: Vec3 | null = null;
  private walkIndex = 0;
  private t = 0;
  private stageKey = "";
  /** The staging now: the shot's, changed by { stage } actions. */
  private staging: Record<string, Blocking>;

  constructor(shot: Shot, backend: FilmBackend) {
    this.shot = shot;
    this.backend = backend;
    this.warmupFrames = Math.round((shot.warmup ?? 2) * FPS);
    this.frames = Math.max(1, Math.round(shot.duration * FPS));
    this.staging = { ...shot.stage };
  }

  /** Story second at shot time t. */
  story(t: number) { return this.shot.story + t; }

  /** Once the game is up: hook in, put the captain in place, set the sky. */
  attach(h: GameHandle) {
    this.h = h;
    const { shot } = this;
    h.game.film = {
      stage: (dirs, now) => this.stage(dirs, now),
      camera: (cam, dt) => this.camera(cam, dt),
    };
    const c = shot.captain;
    if (c) {
      const p = this.resolve(c.at);
      h.captain.teleport([p[0], p[1] + 0.3, p[2]], (c.facing * Math.PI) / 180);
      if (c.view) h.captain.view = c.view;
      if (c.pitch !== undefined) h.captain.cameraRig.pitch = c.pitch;
      if (c.dist !== undefined) h.captain.cameraRig.dist = c.dist;
      h.captain.object.visible = !c.hidden;
    }
    this.sky(-(shot.warmup ?? 2));
    if (shot.focus) h.game.focus?.(shot.focus.map(crewId));
    document.body.classList.toggle("film-nohud", !shot.hud);
    document.body.classList.toggle("film-nophone", shot.phoneUi === false);
  }

  private sky(t: number) {
    const u = Math.min(1, Math.max(0, t / this.shot.duration));
    const hour = range(this.shot.hour, u)!;
    this.h?.world.setHour?.(hour);
    const busy = range(this.shot.busy, u);
    if (busy !== undefined) this.h?.world.setBusy?.(busy);
  }

  // ---- targets ----

  private slot(id: string): Slot | undefined { return this.h?.world.layout.slots.find((s) => s.id === id); }

  body(key: string): Body | undefined { return this.h?.game.bodies.get(crewId(key)); }

  resolve(t: Target): Vec3 {
    if (Array.isArray(t)) return t;
    const up = t.up ?? 0;
    const add = (p: Vec3): Vec3 => [p[0], p[1] + up, p[2]];
    if ("slot" in t) {
      const s = this.slot(t.slot);
      if (!s) throw new Error(`No slot ${t.slot}`);
      return add(s.pos);
    }
    if ("kind" in t) {
      const s = this.h?.world.layout.slots.filter((x) => x.kind === t.kind)[t.nth ?? 0];
      if (!s) throw new Error(`No ${t.kind} slot #${t.nth ?? 0}`);
      return add(s.pos);
    }
    if ("node" in t) {
      const n = this.h?.world.layout.nav.nodes.find((x) => x.id === t.node);
      if (!n) throw new Error(`No nav node ${t.node}`);
      return add(n.pos);
    }
    if ("object" in t) {
      let found: THREE.Object3D | undefined;
      this.h?.game.scene.traverseVisible((o) => { if (!found && o.name === t.object) found = o; });
      if (!found) return [0, 10 + up, -52];
      const v = found.getWorldPosition(new THREE.Vector3());
      return [v.x, v.y + up, v.z];
    }
    const b = this.body(t.crew);
    if (!b) return [0, 10 + up, 0];
    const p = b.fig.object.position;
    return [p.x, p.y + (t.up ?? 1.2), p.z];
  }

  // ---- the game's hooks ----

  private stage(dirs: Direction[], now: number): Direction[] {
    this.knowMadeUpSlots(dirs);
    const { lineup } = this.shot;
    const stage = this.staging;
    if (!Object.keys(stage).length && !lineup) return dirs;
    const lined = new Set((lineup?.crew ?? [...this.backend.ship.snapshot.crew.filter((c) => c.role === "crew").map((c) => c.handle)]).map(crewId));
    const staged = (d: Direction) => {
      const b = stage?.[d.crewId.replace(/^crew_/, "")];
      return b && d.activity === "idle" && this.place(b.slot) ? b : null;
    };
    const held = new Set(dirs.map((d) => staged(d)?.slot).filter((x): x is string => !!x));
    const targeted = new Set(dirs.map((d) => (d.target.kind === "slot" ? d.target.slotId : "")));
    // Staged groups: everyone in one, in the order the staging lists them, still off duty.
    const members = new Map<string, string[]>();
    for (const [key, b] of Object.entries(stage)) {
      if (!b.group) continue;
      const d = dirs.find((x) => x.crewId === crewId(key));
      if (!d || !staged(d)) continue;
      members.set(b.group, [...(members.get(b.group) ?? []), crewId(key)]);
    }
    return dirs.map((d) => {
      if (lineup && lined.has(d.crewId)) return { ...d, target: { kind: "none" }, act: "stand", props: [], walkAct: null, group: null };
      const b = staged(d);
      if (!b) {
        // Someone the director sent to a staged seat goes to another of the same kind.
        if (d.target.kind !== "slot" || !held.has(d.target.slotId)) return d;
        const kind = this.slot(d.target.slotId)?.kind;
        const free = this.h!.world.layout.slots.find((s) => s.kind === kind && !held.has(s.id) && !targeted.has(s.id));
        if (!free) return { ...d, target: { kind: "none" } };
        targeted.add(free.id);
        return { ...d, target: { kind: "slot", slotId: free.id } };
      }
      const slot = this.place(b.slot)!;
      const behind = this.h?.director?.behindTheBar;
      const bartending = !!behind && behind.slot.id === slot.id;
      const fit = bartending ? { act: "bartend" as Act, props: [] as Prop[], label: "bartending" } : fitFor(slot);
      const named = b.act && b.act !== fit.act ? ACT_LABEL[b.act] : undefined;
      const label = named ?? fit.label ? `Off duty · ${named ?? fit.label}` : d.label;
      const g = b.group ? this.group(b.group, members.get(b.group) ?? []) : null;
      // Off the helicopter a while ago (a shot that starts after the landing): already in place, not
      // walking over from the helipad as if they'd just landed.
      const landed = this.backend.ship.snapshot.crew.find((c) => c._id === d.crewId)?.arrivesAt ?? 0;
      const spawnSlot = now - landed > 20_000 ? null : d.spawnSlot;
      // The director's own extras for its choice (a path round the bar, its groups) don't fit a staged seat.
      return {
        // An act asked for by name brings its own props (cards, a rod); the spot's extras (a drink) are for its own act.
        ...d, spawnSlot, target: { kind: "slot" as const, slotId: slot.id }, act: b.act ?? fit.act, props: b.props ?? (named || (b.act && b.act !== fit.act) ? [] : fit.props), label,
        approach: bartending ? behind!.approach : null, group: g, company: null,
      };
    });
  }

  /** A world slot, or one the director made up (behind the bar). */
  private place(id: string): Slot | undefined { return this.slot(id) ?? this.h?.director?.slot(id); }

  /**
   * A staged group, as the game's banter reads it (director.beat → banter.ts): its round `round`
   * opens `lineAt` seconds into the shot, so the director's own lines land where the shot wants them.
   */
  private group(key: string, ids: string[]): Hangout | null {
    const spec: FilmGroup | undefined = this.shot.groups?.[key];
    if (!spec || ids.length < 1) return null;
    const id = spec.id ?? `film-${key}`;
    const round = spec.round ?? 0;
    const probe = beatAt(id, ids.length > 1 ? ids : [...ids, ids[0]!], 0, spec.mood, round * roundMs(id) + 1);
    const lead = probe ? probe.lines[0]!.at - round * roundMs(id) : 600;
    const formedAt = BASE_EPOCH + Math.round((this.shot.story + spec.lineAt) * 1000) - lead - round * roundMs(id);
    const centre = this.place(Object.values(this.staging).find((b) => b.group === key)!.slot)!.pos;
    return { id, mood: spec.mood, members: ids, formedAt, centre };
  }

  /**
   * The director now makes up places (behind the bar, standing in a group) that aren't world slots.
   * Until the engine looks those up with director.slot(), teach its slot map about them. Harmless after.
   */
  private knowMadeUpSlots(dirs: Direction[]) {
    const g = this.h?.game as unknown as { slots?: Map<string, Slot>; director?: { slot?(id: string): Slot | undefined } } | undefined;
    if (!g?.slots || typeof g.director?.slot !== "function") return;
    const world = this.worldSlotIds ??= new Set(this.h!.world.layout.slots.map((s) => s.id));
    for (const d of dirs) {
      if (d.target.kind !== "slot" || world.has(d.target.slotId)) continue;
      const s = g.director.slot(d.target.slotId);
      if (s) g.slots.set(s.id, s);
    }
  }
  private worldSlotIds: Set<string> | null = null;

  private camera(cam: THREE.PerspectiveCamera, dt: number): boolean {
    const move = this.shot.camera;
    if ("captain" in move) return true;
    const u = Math.min(1, Math.max(0, this.t / this.shot.duration));
    let pose: Pose;
    if ("hold" in move || "dolly" in move) {
      pose = "hold" in move ? move.hold : dolly(move.dolly, u, move.ease);
      if (move.track) {
        const want = this.resolve(move.track);
        const first = !this.followLook || this.t <= -(this.shot.warmup ?? 2) + 0.05;
        this.followLook = first ? want : damp(this.followLook!, want, move.trackLag ?? 0.25, dt);
        pose = { ...pose, at: this.followLook };
      }
    }
    else if ("orbit" in move) pose = orbit(this.resolve(move.orbit), move, u);
    else {
      const b = this.body(move.follow);
      if (!b) return true;
      const o = b.fig.object;
      const yaw = move.frame === "world" ? 0 : o.rotation.y;
      const [ox, oy, oz] = move.offset;
      // Body frame: +z is the way they face, +x their right (-x of the avatar's own +x, which is its left).
      const want: Vec3 = [o.position.x + Math.cos(yaw) * -ox + Math.sin(yaw) * oz, o.position.y + oy, o.position.z - Math.sin(yaw) * -ox + Math.cos(yaw) * oz];
      const ahead = move.lookAhead ?? 0;
      const look: Vec3 = [o.position.x + Math.sin(yaw) * ahead, o.position.y + (move.lookUp ?? 1.3), o.position.z + Math.cos(yaw) * ahead];
      const lag = move.lag ?? 0.35;
      this.followAt = this.followAt && this.t > -(this.shot.warmup ?? 2) + 0.05 ? damp(this.followAt, want, lag, dt) : want;
      this.followLook = this.followLook && this.t > -(this.shot.warmup ?? 2) + 0.05 ? damp(this.followLook, look, lag * 0.6, dt) : look;
      pose = { pos: this.followAt, at: this.followLook, fov: move.fov ?? 50 };
    }
    cam.position.set(...pose.pos);
    cam.up.set(0, 1, 0);
    cam.lookAt(new THREE.Vector3(...pose.at));
    const fov = pose.fov ?? 50;
    if (cam.fov !== fov) { cam.fov = fov; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();
    return true;
  }

  // ---- each frame, before it is drawn ----

  /** t: this frame's shot time (negative during the warm-up). */
  pre(t: number) {
    this.t = t;
    const h = this.h;
    if (!h) return;
    this.sky(t);
    const actions = this.shot.ui ?? [];
    actions.forEach((a, i) => {
      if (this.done.has(i) || a.at > t + 1e-6) return;
      this.done.add(i);
      this.act(a.do, a.at);
    });
    if (this.typing) this.typeTo(t);
    this.walk(t);
    this.lineup();
    // A change of staging (someone just went off duty, say) is acted on at once.
    const key = JSON.stringify(this.staging) + this.backend.story.toFixed(0);
    if (Object.keys(this.staging).length && key !== this.stageKey) {
      this.stageKey = key;
      h.game.setSnapshot(this.backend.ship.snapshot);
    }
  }

  private act(a: Action, at: number) {
    if ("phone" in a) {
      if (a.phone === "away") phone.putAway();
      else if (a.phone === "cover") phone.takeOut();
      else phone.unfold();
    } else if ("type" in a) this.typing = { at, text: a.type, cps: a.cps ?? 11 };
    else if ("send" in a) {
      const el = composer();
      el?.form?.requestSubmit();
      this.typing = null;
    } else if ("thread" in a) ui.set({ threadId: a.thread ? `thread_${a.thread}` : null, review: null });
    else if ("review" in a) openReview({ threadId: `thread_${a.review.thread}`, taskId: a.review.task ? `task_${a.review.task}` : null });
    else if ("closeReview" in a) closeReview();
    else if ("helm" in a) ui.set({ helm: a.helm });
    else if ("tab" in a) phone.set({ fold: "open", tab: a.tab, crewId: a.crew ? crewId(a.crew) : null, hiring: false });
    else if ("crewCard" in a) ui.set({ crewCard: a.crewCard ? crewId(a.crewCard) : null });
    else if ("say" in a) this.body(a.say)?.fig.say(a.text, a.ms ?? 3500);
    else if ("hud" in a) document.body.classList.toggle("film-nohud", !a.hud);
    else if ("stage" in a) this.staging = { ...this.staging, ...a.stage };
    else if ("scroll" in a) { const el = document.querySelector(a.scroll); if (el) el.scrollTop = a.top; }
  }

  /** Characters appear at a typist's uneven pace: a little faster inside words, a beat at spaces. */
  private typeTo(t: number) {
    const ty = this.typing!;
    const el = composer();
    if (!el) return;
    let clock = ty.at, n = 0;
    while (n < ty.text.length) {
      const ch = ty.text[n]!;
      const beat = (1 / ty.cps) * (ch === " " ? 1.6 : 0.8 + 0.4 * (((n * 7919) % 13) / 13));
      if (clock + beat > t) break;
      clock += beat;
      n++;
    }
    const value = ty.text.slice(0, n);
    if (el.value === value) return;
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }

  /** The captain walks his path: the view turns toward the next point and W is held. */
  private walk(t: number) {
    const c = this.shot.captain, h = this.h!;
    if (!c) return;
    const rig = h.captain.cameraRig;
    if (c.pan) rig.yaw = (c.facing * Math.PI) / 180 + (c.pan * Math.PI / 180) * Math.min(1, Math.max(0, t / this.shot.duration));
    const keys = h.captain.input.keys;
    const path = c.walk ?? [];
    if (!path.length || t < (c.walkAt ?? 0) || this.walkIndex >= path.length) {
      keys.delete("KeyW");
      keys.delete("ShiftLeft");
      return;
    }
    const p = h.captain.position;
    const to = this.resolve(path[this.walkIndex]!);
    if (Math.hypot(to[0] - p.x, to[2] - p.z) < 0.7) { this.walkIndex++; return; }
    const want = yawTo([p.x, p.y, p.z], to);
    const d = turn(rig.yaw, want);
    rig.yaw += Math.sign(d) * Math.min(Math.abs(d), 2.2 / FPS);
    keys.add("KeyW");
    if (c.jog) keys.add("ShiftLeft");
  }

  private lineup() {
    const l = this.shot.lineup;
    if (!l) return;
    const keys = l.crew ?? this.backend.ship.snapshot.crew.filter((c) => c.role === "crew").map((c) => c.handle);
    const yaw = (l.facing * Math.PI) / 180;
    // Along the line: perpendicular to the way they face.
    const ax = Math.cos(yaw), az = -Math.sin(yaw);
    keys.forEach((k, i) => {
      const b = this.body(k);
      if (!b) return;
      const off = (i - (keys.length - 1) / 2) * l.spacing;
      const pos: Vec3 = [l.at[0] + ax * off, l.at[1], l.at[2] + az * off];
      const o = b.fig.object.position;
      if (Math.hypot(o.x - pos[0], o.z - pos[2]) > 0.01 || Math.abs(o.y - pos[1]) > 0.01) b.walker.place({ id: `lineup-${k}`, kind: "rail", pos, facing: yaw, nav: "" });
    });
  }
}

function composer(): HTMLInputElement | HTMLTextAreaElement | null {
  return document.querySelector<HTMLTextAreaElement>("#new-thread-big") ?? document.querySelector<HTMLInputElement>(".spread #new-thread") ?? document.querySelector<HTMLInputElement>("#new-thread");
}
