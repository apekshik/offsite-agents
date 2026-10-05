import * as THREE from "three";
import {
  Captain, Collision, ComputerBot, CrewFigure, Input, LIGHT, Laptop, SELF_LAYER, Walker,
  buildAvatar, createPipeline, createRenderer, findRoute, pick, routeToPoint, sanitizeAvatar, sanitizeLook, CAPTAIN_PRESET,
  type AutopilotGoal, type BotMood, type BuiltWorld, type Interactable, type Pipeline, type Quality, type Tone, type WorldModule,
} from "@offsite/kit";
import { COMPUTER_NAME, isWorking, type AvatarSpec, type Look, type Slot, type Vec3 } from "@offsite/contracts";
import { scene as sceneBridge, ui, type UiState, type WalkTarget } from "../bridge.ts";
import { Director, type CrewView, type Direction, type Hangout } from "./director.ts";
import { CrewBody, SPEED, type Stage } from "./crew.ts";
import { Splash, type Effect } from "./fx.ts";
import { CrewScreen, describeSlot, faceOf, takeOverLaptop, type HelmContent, type ScreenContent } from "./screens.ts";
import { DEFAULT_SURFACE, disposeObject, makeMore, makePackage, packageSpots, type Surface } from "./dropoff.ts";
import { audio, busyLevel, flightPhase, type Emitter } from "../audio/index.ts";

// The game: one world, the captain, and the crew as the backend sees them. The Game component feeds
// it world.snapshot; everything else (where people go, what they do there, the helicopter, pings)
// happens here, every frame. It meets the interface only through ../bridge.ts.

export interface Snapshot {
  office?: { name: string };
  crew: (CrewView & { avatar: unknown; look: unknown })[];
  questions: { crewId: string; prompt: string; crewName?: string }[];
}

/** The threads, for the helm's screen (threads.list). */
export interface ThreadSummary { title: string; state: string; tasks: { total: number; landed: number }; openQuestions: number }

/** A finished task, for the drop-off's packages and the desks (diffs.deliveries). */
export interface Delivery {
  taskId: string;
  threadId: string;
  title: string;
  crewId: string | null;
  crewName: string;
  landedAt: number;
  diff: { added: number; removed: number; files: number } | null;
  /** The captain has opened its changes: no package for it. */
  seen: boolean;
}

/**
 * The film rig's way in (src/film, a dev page): restage the director's plan and move the camera
 * after the captain's rig has. Unset (null) in the app.
 */
export interface FilmHooks {
  /** Where crew go and what they do, given the director's plan (staging a scene). */
  stage?(directions: Direction[], now: number): Direction[];
  /** After the captain each frame: place the camera. Return true to redraw shadows this frame. */
  camera?(camera: THREE.PerspectiveCamera, dt: number): boolean;
}

const TAGS = ["#4fe3ff", "#ffc861", "#6dffa8", "#c7a6ff", "#ff9cac", "#8fd8ff"];
const short = (s: string, n = 34) => (s.length > n ? `${s.slice(0, n - 1).replace(/\s+\S*$/, "")}…` : s);
const sizeOf = (d: Delivery["diff"]) => (d ? ` · +${d.added} −${d.removed}` : "");

export interface GameOptions {
  canvas: HTMLCanvasElement;
  world: WorldModule;
  quality?: Quality;
  captain: { avatar: unknown; look: unknown } | null;
}

/** At most this many name tags at once (nearest first), plus anyone asking, pinged or in focus. */
const MAX_PLATES = 9;
/** At most this many speech bubbles up at once, and only this close to the camera, unless in focus. */
const MAX_BUBBLES = 4;
const BUBBLE_RANGE = 26;
/** Footsteps and close-up typing are heard within this many metres of the camera. */
const STEP_RANGE = 12;
const TYPING_RANGE = 7;
/** At most this many crew typing are heard up close (the typing bed covers the rest). */
const MAX_TYPISTS = 3;
const TYPING_ACTS = new Set(["type", "laptop", "lounge-laptop"]);
/** How close two people get on foot before they ease apart, metres. */
const PERSONAL_SPACE = 0.62;
/** Walking over to someone (the phone's "Walk over"): stop this far short, metres. */
const WALK_UP_TO = 1.2;

/** A world that can show how busy the ship is (lights in the office, music…): BuiltWorld's optional hook. */
type BusyWorld = BuiltWorld & { setBusy?: (level: number) => void };

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** "Desk 21" from desk-21. */
function deskLabel(id: string): string {
  const n = /(\d+)$/.exec(id)?.[1];
  return n ? `Desk ${n}` : "Desk";
}

function spec(avatar: unknown): AvatarSpec {
  return sanitizeAvatar(avatar) as AvatarSpec;
}
function look(l: unknown): Look | null {
  return l ? (sanitizeLook(l) as Look | null) : null;
}

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 6000);
  private pipeline!: Pipeline;
  private world!: BuiltWorld;
  private collision!: Collision;
  private captain!: Captain;
  private input!: Input;
  private director!: Director;
  private slots = new Map<string, Slot>();
  private bodies = new Map<string, CrewBody>();
  private stage!: Stage;
  private effects: Effect[] = [];
  /** Banter lines already said (group:round:line), so each is said once. */
  private said = new Set<string>();
  /** Fraction of the crew at work, eased, for the world's setBusy. */
  private busy = 0;
  private busySent = -1;
  /** Crew a film or the interface wants to see talking, whatever the distance. */
  private focusIds = new Set<string>();
  private bot: { id: string; holder: THREE.Group; bot: ComputerBot } | null = null;
  /** Screens with their own canvas: the boards, and desks someone has sat at. */
  private monitors = new Map<string, CrewScreen>();
  private deskMats = new Map<string, THREE.MeshBasicMaterial>();
  private idleScreen = (() => { const s = new CrewScreen("desk"); s.show({ kind: "idle", desk: "" }); return s; })();
  /** Whose desk each desk is: the last crew member to sit there, until someone else does. */
  private deskOwner = new Map<string, string>();
  /** Laptops on laps, painted like the desks (screens.ts). */
  private laptops = new Map<string, { laptop: Laptop; screen: CrewScreen }>();
  private screenFor = new Map<string, ScreenContent | null>();
  private threads: ThreadSummary[] = [];
  private activity = new Map<string, Direction["activity"]>();
  /** Screens that show the ship rather than one person: the helm's, the office wall. */
  private boards = new Set<string>();
  /** Monitors someone is working at (and the helm's). Only these animate: each redraw is a texture upload. */
  private liveMonitors = new Set<string>(["helm"]);
  private snapshot: Snapshot | null = null;
  /** Finished tasks, newest first; unseen ones are packages on the drop-off. */
  private deliveries: Delivery[] = [];
  private directions: Direction[] = [];
  private shelf = new THREE.Group();
  private packages = new Map<string, { obj: THREE.Group; d: Delivery }>();
  private moreSign: THREE.Sprite | null = null;
  private shelfKey = "";
  private usesKey = "";
  private lastPlan = 0;
  private ping: { crewId: string; at: number; beacon: THREE.Group; line: THREE.Line; routedAt: number } | null = null;
  private waterY = 0;
  private timer = new THREE.Timer();
  private raf = 0;
  private unsub: (() => void) | null = null;
  private disposed = false;
  /** Set by the film page only (src/film). */
  film: FilmHooks | null = null;
  // ---- sound (src/audio) ----
  private sounds: Emitter[] = [];
  private swim: Emitter | null = null;
  private swimming = false;
  private unbindMute: (() => void) | null = null;
  /** busyLevel (audio/mix.ts) of the crew at work, eased, for the ambience beds. */
  private busySound = 0;
  private ambienceAt = -1;
  private stepAt = new Map<string, number>();
  private typists = new Map<string, Emitter>();
  private typistsAt = -1;
  private aloft = new Set<THREE.Object3D>();
  private readonly ear = new THREE.Vector3();

  private readonly o: GameOptions;

  private constructor(o: GameOptions) {
    this.o = o;
    this.renderer = createRenderer(o.canvas, { quality: o.quality ?? "high" });
  }

  static async start(o: GameOptions): Promise<Game> {
    const g = new Game(o);
    await g.build();
    return g;
  }

  private async build() {
    const { renderer, scene, camera, o } = this;
    this.pipeline = createPipeline(renderer, scene, camera, { quality: o.quality ?? "high" });
    this.world = await o.world.build({ renderer, scene, camera, quality: o.quality ?? "high", assets: "/" });
    if (this.disposed) return;
    scene.add(this.world.root);
    // The captain keeps a shadow in first person.
    this.world.root.traverse((x) => { if (x instanceof THREE.DirectionalLight && x.castShadow) x.shadow.camera.layers.enable(SELF_LAYER); });
    this.waterY = typeof this.world.root.userData["waterY"] === "number" ? this.world.root.userData["waterY"] : 0;

    this.collision = new Collision().add(...this.world.colliders).build();
    this.shelf.name = "dropoff-packages";
    scene.add(this.shelf);
    for (const s of this.world.layout.slots) this.slots.set(s.id, s);
    const collision = this.collision;
    this.director = new Director(this.world.layout.slots, {
      // A standing spot made up for a group: deck underfoot, and nothing in the way from where they gather.
      walkable: (p: Vec3, from: Vec3) => {
        const f = collision.floorBelow(p[0], p[1] + 0.6, p[2], 1.2);
        if (f === null || Math.abs(f - p[1]) > 0.2) return false;
        const o = new THREE.Vector3(from[0], from[1] + 1.0, from[2]);
        const d = new THREE.Vector3(p[0] - from[0], 0, p[2] - from[2]);
        const len = d.length();
        if (len < 1e-3) return true;
        return !collision.raycast(o, d.normalize(), len + 0.35);
      },
    });

    // Desk monitors are meshes named screen:<slotId>; the helm's is screen:helm.
    this.world.root.traverse((x) => {
      if (!(x instanceof THREE.Mesh) || !x.name.startsWith("screen:")) return;
      const id = x.name.slice("screen:".length);
      // Desks show their crew; the helm (and any other big screen, like the office wall) the ship.
      // Free desks share one calm texture; a desk gets its own canvas once someone sits there.
      const desk = this.slots.get(id)?.kind === "desk";
      if (desk) {
        const mat = new THREE.MeshBasicMaterial({ map: this.idleScreen.texture, toneMapped: false });
        x.material = mat;
        this.deskMats.set(id, mat);
        return;
      }
      const screen = new CrewScreen("helm", hash(x.name));
      this.boards.add(id);
      x.material = new THREE.MeshBasicMaterial({ map: screen.texture, toneMapped: false });
      this.monitors.set(id, screen);
    });

    this.input = new Input({ element: o.canvas, suspended: () => ui.typing() });
    const spawn = this.world.layout.slots.find((s) => s.kind === "captain-spawn");
    const me = o.captain;
    this.captain = new Captain({
      camera, collision: this.collision, input: this.input,
      avatar: buildAvatar(me?.avatar ? spec(me.avatar) : CAPTAIN_PRESET.spec, me?.avatar ? look(me.look) : CAPTAIN_PRESET.look),
      interactables: this.world.interactables,
      // A little above the floor: starting exactly on it can miss it and drop you a deck.
      ...(spawn ? { spawn: { pos: [spawn.pos[0], spawn.pos[1] + 0.3, spawn.pos[2]], facing: spawn.facing } } : {}),
      view: ui.get().view,
      // Click grabs the mouse in both views; Esc lets go. The crosshair then points at things.
      lockInThird: true,
    });
    scene.add(this.captain.object);
    this.captain.onPrompt = (it) => ui.set({ prompt: it ? { id: it.id, label: it.label } : null });
    this.captain.onUse = (it) => {
      if (it.id === "helm") this.openInterface({ helm: true });
      // A package on the drop-off, or a desk whose crew member delivered something: its changes.
      const taskId = it.id.startsWith("box:") ? it.id.slice(4) : it.id.startsWith("desk:") ? it.id.split(":")[2] : null;
      const d = taskId ? this.deliveries.find((x) => x.taskId === taskId) : undefined;
      if (d) this.openReview(d);
    };
    this.captain.onView = (view) => ui.set({ view });
    this.captain.onPointerLock = (pointerLocked) => ui.set({ pointerLocked });
    this.captain.onClick = (ndc) => {
      const hit = pick(ndc, camera, [...this.bodies.values()].map((b) => b.fig.object));
      const body = [...this.bodies.values()].find((b) => b.fig.object === hit);
      if (body) { this.openInterface({ crewCard: body.id }); return; } // let go of the mouse so the card's buttons work
      const pkg = this.packageAt(ndc);
      if (pkg) this.openReview(pkg);
    };
    this.unsub = ui.subscribe(() => this.onUi(ui.get()));
    this.onUi(ui.get());

    this.stage = {
      scene, nav: this.world.layout.nav, collision: this.collision,
      slot: (id) => this.director.slot(id),
      captain: this.captain.object,
      say: (b, text, ms) => this.say(b, text, ms),
      fx: (e) => {
        if (!e.object.parent) scene.add(e.object);
        this.effects.push(e);
        // A cannonball hitting the water, or someone climbing out and shaking off.
        if (e instanceof Splash) audio.play("cannonball", e.at, { volume: e.big ? 1 : 0.3 });
      },
      sfx: (sound, where, o) => audio.play(sound, where, o),
      delivered: (id) => {
        this.director.delivered(id, Date.now());
        const d = this.dropoff;
        if (d) audio.play("package-thump", { x: d.pos[0], y: d.pos[1] + 0.95, z: d.pos[2] }, { delay: 0.15 });
      },
      headOf: (id) => {
        const b = this.bodies.get(id);
        return b ? b.fig.object.localToWorld(b.fig.rig.headTop(new THREE.Vector3()).add(new THREE.Vector3(0, -0.25, 0))) : null;
      },
    };

    this.startSound();

    sceneBridge.locate = (id) => this.locate(id);
    sceneBridge.captain = () => {
      const p = this.captain.position;
      return { x: p.x, y: p.y, z: p.z };
    };
    sceneBridge.where = (id) => {
      const t = this.bodies.get(id)?.dir?.target;
      if (t?.kind === "captain") return { slotId: "captain", kind: "captain", tags: [] };
      const s = t?.kind === "slot" ? this.director.slot(t.slotId) : undefined;
      return s ? { slotId: s.id, kind: s.kind, tags: s.tags ?? [] } : null;
    };

    addEventListener("resize", this.resize);
    this.resize();
    // For poking at it from the console while developing.
    if (import.meta.env.DEV) Object.assign(window, { offsite: { game: this, captain: this.captain, world: this.world, director: this.director, audio, ui } });
    this.loop();
  }

  // ---- sound ----

  /** The listener on the camera, M to mute, and the loops that never move: the bar, the hot tub, the pool, the server room. */
  private startSound() {
    audio.attach(this.camera, this.scene);
    this.unbindMute = audio.bindMuteKey();
    const slots = this.world.layout.slots;
    const middle = (list: Slot[]) => list.length
      ? { x: list.reduce((n, s) => n + s.pos[0], 0) / list.length, y: list.reduce((n, s) => n + s.pos[1], 0) / list.length, z: list.reduce((n, s) => n + s.pos[2], 0) / list.length }
      : null;
    const bar = this.director.barCentre;
    if (bar) this.sounds.push(audio.emitter("bar-music", { x: bar[0], y: bar[1] + 1.2, z: bar[2] }));
    const tub = middle(slots.filter((s) => s.kind === "hot-tub"));
    if (tub) this.sounds.push(audio.emitter("hot-tub", tub));
    const pool = middle(slots.filter((s) => s.kind === "pool"));
    if (pool) {
      this.swim = audio.emitter("pool-swim", pool, { volume: 0 });
      this.sounds.push(this.swim);
    }
    // Computah's core (an object the world names), or the middle of the spots round it.
    const core = this.world.root.getObjectByName("ship-computer");
    const hum = core
      ? (() => { const v = core.getWorldPosition(new THREE.Vector3()); return { x: v.x, y: v.y + 1.5, z: v.z }; })()
      : middle(slots.filter((s) => s.kind === "core" && !s.id.includes("aisle")));
    if (hum) this.sounds.push(audio.emitter("server-hum", hum));
  }

  /** Every frame: the beds, the helicopters, footsteps, splashing, typing close by. */
  private updateSound(t: number, wall: number) {
    if (t - this.ambienceAt > 0.25) {
      this.ambienceAt = t;
      audio.setAmbience({ night: LIGHT.uNight.value, busy: this.busySound });
    }
    // Helicopters: the world's flights and the helicopter flying each.
    const flying = (this.world as BuiltWorld).aircraft?.(wall) ?? [];
    const now = new Set<THREE.Object3D>();
    for (const f of flying) {
      const { phase, ms } = flightPhase(f, wall);
      audio.helicopter(f.object, phase, ms);
      now.add(f.object);
    }
    for (const o of this.aloft) if (!now.has(o)) audio.helicopter(o, "away");
    this.aloft = now;
    // Footsteps: anyone walking near the camera, a step per stride; the captain too.
    const ear = this.camera.getWorldPosition(this.ear);
    const step = (key: string, obj: THREE.Object3D, speed: number) => {
      if (speed < 0.5) { this.stepAt.delete(key); return; }
      const next = this.stepAt.get(key);
      if (next === undefined) { this.stepAt.set(key, t + 0.12); return; }
      if (t < next) return;
      this.stepAt.set(key, t + Math.max(0.28, 0.75 / speed));
      audio.play("footstep", obj, { volume: Math.min(1, 0.55 + speed / 6) });
    };
    let wet = false;
    for (const b of this.bodies.values()) {
      if (!b.fig.object.visible) continue;
      if (b.inWater) wet = true;
      const near = b.fig.object.position.distanceTo(ear) < STEP_RANGE;
      step(b.id, b.fig.object, near && !b.inWater ? b.walker.speed : 0);
    }
    step("captain", this.captain.object, this.captain.groundSpeed);
    if (wet !== this.swimming && this.swim) {
      this.swimming = wet;
      this.swim.setVolume(wet ? 1 : 0, 1.2);
    }
    // Typing up close: the nearest few at a keyboard, twice a second.
    if (t - this.typistsAt > 0.5) {
      this.typistsAt = t;
      const near = [...this.bodies.values()]
        .filter((b) => b.fig.object.visible && b.arrived && TYPING_ACTS.has(b.fig.act ?? "") && b.dir && isWorking(b.dir.activity))
        .map((b) => ({ b, d: b.fig.object.position.distanceTo(ear) }))
        .filter((x) => x.d < TYPING_RANGE)
        .sort((p, q) => p.d - q.d)
        .slice(0, MAX_TYPISTS);
      const keep = new Set(near.map((x) => x.b.id));
      for (const [id, e] of this.typists) if (!keep.has(id)) { e.stop(0.6); this.typists.delete(id); }
      for (const { b } of near) if (!this.typists.has(b.id)) this.typists.set(b.id, audio.emitter("typing", b.fig.object));
    }
  }

  private stopSound() {
    this.unbindMute?.();
    this.unbindMute = null;
    for (const e of this.sounds) e.stop(0);
    for (const e of this.typists.values()) e.stop(0);
    for (const o of this.aloft) audio.helicopter(o, "away");
    this.sounds = [];
    this.typists.clear();
    this.aloft.clear();
    audio.detach();
  }

  private openInterface(patch: Partial<UiState>) {
    if (document.pointerLockElement) document.exitPointerLock();
    ui.set(patch);
  }

  /** A delivered task's changes: the interface opens them (the phone, or the helm's third column). */
  private openReview(d: Delivery) {
    this.openInterface({ review: { threadId: d.threadId, taskId: d.taskId }, threadId: d.threadId, crewCard: null });
  }

  private phoneWas = "";
  private pingWas: UiState["ping"] = null;
  private walkWas: UiState["walkTo"] = null;
  private onUi(s: UiState) {
    // The 3D phone in your hands follows the one on screen: out or away, folded (cover) or open.
    const phoneNow = `${s.phone}:${s.phoneUnfolded}`;
    if (phoneNow !== this.phoneWas) {
      this.phoneWas = phoneNow;
      this.captain.setPhoneOut(s.phone === "open", s.phoneUnfolded);
      if (s.phone === "open" && document.pointerLockElement) document.exitPointerLock();
    }
    if (s.helm && document.pointerLockElement) document.exitPointerLock();
    if (s.ping !== this.pingWas) {
      this.pingWas = s.ping;
      this.setPing(s.ping);
    }
    if (s.walkTo !== this.walkWas) {
      this.walkWas = s.walkTo;
      this.setWalk(s.walkTo);
    }
  }

  // ---- walking over: "Walk over", "Walk to the helm", H and 1–9 on the phone ----

  /** Start (or stop: null) the captain walking by themselves. The phone can stay open meanwhile. */
  private setWalk(to: WalkTarget | null) {
    if (!to) { this.captain.stopWalking(true); return; }
    const goal = this.walkGoal(to);
    if (!goal) { this.endWalk(to, "failed"); return; }
    this.captain.walkTo(goal, (outcome) => this.endWalk(to, outcome));
  }

  /** The walk is over: clear walkTo (unless a newer walk has replaced it) and say how it went. Never from inside onUi. */
  private endWalk(to: WalkTarget, outcome: "arrived" | "failed" | "stopped") {
    queueMicrotask(() => {
      if (ui.get().walkTo !== to) return;
      this.walkWas = null;
      ui.set({ walkTo: null, walkEnd: { to, outcome, at: Date.now() } });
    });
  }

  /** Where a walk goes and how to get there, or null when this world has no way there. */
  private walkGoal(to: WalkTarget): AutopilotGoal | null {
    const nav = this.world.layout.nav;
    if (!nav.nodes.length) return null;
    if (to.kind === "helm") {
      const helm = this.world.layout.slots.find((s) => s.kind === "helm");
      if (!helm) return null;
      const spot = new THREE.Vector3(...helm.pos);
      return { target: () => spot, route: (from) => findRoute(nav, from, helm), stopShort: 0, face: helm.facing };
    }
    const body = this.bodies.get(to.crewId);
    if (!body) return null;
    return {
      // Gone if they leave the ship (or the world hides them: on the helicopter).
      target: () => (this.bodies.get(to.crewId) === body && body.fig.object.visible ? body.fig.object.position : null),
      route: (from, at) => findRoute(nav, from, at),
      stopShort: WALK_UP_TO,
      face: "target",
      replanEvery: 0.5,
    };
  }

  private resize = () => this.pipeline.setSize(innerWidth, innerHeight);

  /** The newest crew list from the backend. */
  setSnapshot(snap: Snapshot) {
    this.snapshot = snap;
    if (!this.world) return;
    const now = Date.now();
    this.world.setArrivals(snap.crew.filter((c) => c.role === "crew" && c.arrivesAt > now - 60_000).map((c) => c.arrivesAt));
    this.plan(now);
  }

  /** Finished tasks (diffs.deliveries): packages on the drop-off, and what each desk offers. */
  setDeliveries(list: Delivery[]) {
    this.deliveries = list;
    if (!this.world) return;
    this.refreshShelf();
    this.refreshUses();
  }

  /** The threads, for the helm's screen. */
  setThreads(threads: ThreadSummary[]) {
    this.threads = threads;
    this.paintHelm();
  }

  private plan(now: number) {
    const snap = this.snapshot;
    if (!snap || !this.director) return;
    this.lastPlan = now;
    let directions = this.director.plan(snap.crew, now);
    if (this.film?.stage) directions = this.film.stage(directions, now);
    const seen = new Set<string>();
    for (const d of directions) {
      const view = snap.crew.find((c) => c._id === d.crewId)!;
      seen.add(d.crewId);
      this.direct(view, d, snap.questions.find((q) => q.crewId === d.crewId)?.prompt ?? null);
    }
    for (const [id, b] of this.bodies) if (!seen.has(id)) this.removeBody(b);
    this.paintScreens(snap, directions);
    this.directComputer(snap.crew.find((c) => c.role === "computer"), now);
    this.directions = directions;
    this.refreshShelf();
    this.refreshUses();
  }

  private makeBody(view: Snapshot["crew"][number], d: Direction): CrewBody {
    const fig = new CrewFigure({ spec: spec(view.avatar), look: look(view.look), name: view.name, seed: hash(view._id) % 1000 });
    fig.water = this.waterY;
    // A brisk walk: the ship is 140 m long.
    const walker = new Walker(fig.object, { speed: SPEED.walk, floor: (x, y, z) => this.collision.floorBelow(x, y + 0.6, z, 1.6) });
    const start = (d.spawnSlot && this.slots.get(d.spawnSlot)) || (d.target.kind === "slot" ? this.director.slot(d.target.slotId) : null)
      || this.world.layout.slots.find((s) => s.kind === "crew-spawn");
    if (start) fig.object.position.set(...start.pos);
    if (d.spawnSlot) fig.setBackpack(true);
    this.scene.add(fig.object);
    const body = new CrewBody(this.stage, { id: view._id, name: view.name, fig, walker });
    this.bodies.set(view._id, body);
    // Someone already aboard when the page loads is simply where they belong.
    if (!d.spawnSlot && d.target.kind === "slot") {
      const slot = this.director.slot(d.target.slotId);
      if (slot) body.place(slot, d);
    }
    return body;
  }

  private removeBody(b: CrewBody) {
    this.stepAt.delete(b.id);
    this.typists.get(b.id)?.stop(0);
    this.typists.delete(b.id);
    this.scene.remove(b.fig.object);
    b.dispose();
    this.bodies.delete(b.id);
  }

  private direct(view: Snapshot["crew"][number], d: Direction, question: string | null) {
    let body = this.bodies.get(d.crewId);
    if (!d.visible) {
      if (body) body.fig.object.visible = false;
      return;
    }
    body ??= this.makeBody(view, d);
    const { fig } = body;
    fig.object.visible = true;
    const tone: Tone = d.activity === "asking" ? "warn" : d.activity === "failed" ? "danger" : d.activity === "landed" ? "ok" : d.activity === "idle" ? "dim" : "accent";
    fig.setLabel(view.name, d.label, tone);
    fig.setAsking(d.marker === "asking");
    body.direct(d, question, Date.now());
    // Their screen (the desk's monitor, or the laptop on their lap) is painted in paintScreens.
  }

  /** Crew to keep in view: their bubbles show whatever the distance, and their name tags always. Null clears it. */
  focus(ids: string[] | null) {
    this.focusIds = new Set(ids ?? []);
  }

  /** Say a line over someone's head, if there's room for another bubble and they're near enough to read it. */
  private say(b: CrewBody, text: string, ms?: number) {
    const always = this.focusIds.has(b.id) || ui.get().ping?.crewId === b.id;
    if (!always) {
      if (!b.fig.object.visible || !b.fig.inSight) return;
      const at = b.fig.object.getWorldPosition(this.v);
      if (at.distanceTo(this.camera.position) > BUBBLE_RANGE) return;
      let up = 0;
      for (const o of this.bodies.values()) if (o.fig.bubble.showing && o !== b) up++;
      if (up >= MAX_BUBBLES) return;
    }
    b.fig.say(text, ms);
    this.labelsAt = -1; // whoever talks gets their name tag next frame
  }

  // ---- crew screens (screens.ts) ----

  private contentFor(view: Snapshot["crew"][number], d: Direction, question: string | null): ScreenContent | null {
    const face = faceOf(view.avatar, view.look);
    const task = view.live?.taskTitle ?? view.live?.threadTitle ?? "";
    const step = view.live?.step?.summary ?? view.lastStep ?? "";
    const since = (view.live as { startedAt?: number | null } | null)?.startedAt ?? null;
    switch (d.activity) {
      case "asking": return { kind: "asking", name: view.name, face, task, prompt: question ?? "", step };
      case "landed": return { kind: "landed", name: view.name, face, task: view.lastEnded?.taskTitle ?? task, diff: view.lastEnded?.diff ?? null };
      case "failed": return { kind: "failed", name: view.name, face, task: view.lastEnded?.taskTitle ?? task, step };
      case "idle": case "arriving": return null;
      default: return { kind: "working", activity: d.activity, name: view.name, face, task, step, since };
    }
  }

  /** Desks show their owner's work (or where they've gone); laptops show their holder's. Only changes repaint. */
  private paintScreens(snap: Snapshot, directions: Direction[]) {
    const dirs = new Map(directions.map((d) => [d.crewId, d]));
    this.activity = new Map(directions.map((d) => [d.crewId, d.activity]));
    const views = new Map(snap.crew.map((c) => [c._id, c]));
    this.liveMonitors = new Set();
    for (const d of directions) {
      const slot = d.target.kind === "slot" ? this.director.slot(d.target.slotId) : undefined;
      if (slot?.kind !== "desk" || !d.screen || !this.deskMats.has(slot.id)) continue;
      for (const [desk, owner] of this.deskOwner) if (owner === d.crewId && desk !== slot.id) this.deskOwner.delete(desk);
      this.deskOwner.set(slot.id, d.crewId);
    }
    for (const [desk, owner] of this.deskOwner) if (!views.has(owner)) this.deskOwner.delete(desk);
    for (const d of directions) {
      const view = views.get(d.crewId);
      if (view) this.screenFor.set(d.crewId, this.contentFor(view, d, snap.questions.find((q) => q.crewId === d.crewId)?.prompt ?? null));
    }
    for (const [id, mat] of this.deskMats) {
      const owner = this.deskOwner.get(id);
      const d = owner ? dirs.get(owner) : undefined;
      const view = owner ? views.get(owner) : undefined;
      let screen = this.monitors.get(id);
      if (!owner || !d || !view) {
        if (screen) { mat.map = this.idleScreen.texture; screen.dispose(); this.monitors.delete(id); }
        continue;
      }
      if (!screen) {
        screen = new CrewScreen("desk", hash(id));
        this.monitors.set(id, screen);
        mat.map = screen.texture;
      }
      const content = this.screenFor.get(owner) ?? null;
      if (content) screen.show(content);
      else {
        const t = d.target.kind === "slot" ? this.director.slot(d.target.slotId) : undefined;
        screen.show({ kind: "off", name: view.name, where: t ? describeSlot(t.kind, t.id, t.tags) : "somewhere on deck", desk: deskLabel(id) });
      }
      if (screen.animating) this.liveMonitors.add(id);
    }
    for (const [crewId, l] of this.laptops) {
      const c = this.screenFor.get(crewId);
      if (!views.has(crewId)) { l.screen.dispose(); this.laptops.delete(crewId); continue; }
      if (c) l.screen.show(c);
    }
    this.paintHelm();
  }

  /** A laptop appears when they sit down with it: paint it like their desk would be. */
  private watchLaptop(b: CrewBody) {
    const p = b.fig.rig.prop;
    if (!(p instanceof Laptop)) return;
    const have = this.laptops.get(b.id);
    if (have?.laptop === p) return;
    const screen = have?.screen ?? new CrewScreen("laptop", hash(b.id));
    p.screen.typing = false;
    takeOverLaptop(p.lid, p.screen.texture, screen.texture);
    this.laptops.set(b.id, { laptop: p, screen });
    const c = this.screenFor.get(b.id);
    if (c) screen.show(c);
  }

  private paintHelm() {
    const snap = this.snapshot;
    if (!this.boards.size || !snap) return;
    const computer = snap.crew.find((c) => c.role === "computer");
    const crew = snap.crew.filter((c) => c.role === "crew");
    const order = (t: ThreadSummary) => (t.openQuestions ? 0 : t.state === "working" ? 1 : t.state === "open" ? 2 : 3);
    const content: HelmContent = {
      ship: snap.office?.name ?? "Your ship",
      computer: { busy: !!computer?.live, title: computer?.live?.threadTitle ?? "Thinking", step: computer?.live?.step?.summary ?? "" },
      threads: [...this.threads].sort((a, b) => order(a) - order(b)).slice(0, 4)
        .map((t) => ({ title: t.title, state: t.state, landed: t.tasks.landed, total: t.tasks.total, asking: t.openQuestions })),
      waiting: snap.questions.map((q) => {
        const c = snap.crew.find((x) => x._id === q.crewId);
        return { name: c?.role === "computer" ? COMPUTER_NAME : q.crewName ?? c?.name ?? "Someone", face: c && c.role === "crew" ? faceOf(c.avatar, c.look) : null, prompt: q.prompt };
      }),
      aboard: crew.map((c) => ({ name: c.name, face: faceOf(c.avatar, c.look), activity: this.activity.get(c._id) ?? "idle" })),
    };
    for (const id of this.boards) this.monitors.get(id)?.show(content);
  }

  private directComputer(view: CrewView | undefined, now: number) {
    if (!view) return;
    const d = this.director.computer(view, now);
    if (!d) return;
    if (!this.bot) {
      const holder = new THREE.Group();
      const slot = d.slotId ? this.slots.get(d.slotId) : undefined;
      if (slot) { holder.position.set(slot.pos[0], slot.pos[1] + 1.25, slot.pos[2]); holder.rotation.y = slot.facing; }
      this.scene.add(holder);
      this.bot = { id: view._id, holder, bot: new ComputerBot(holder, { scale: 0.55 }) };
    }
    this.bot.bot.setMood(d.mood as BotMood);
  }

  // ---- the drop-off: a package per delivered task the captain hasn't opened ----

  private get dropoff(): Slot | undefined { return this.world.layout.slots.find((s) => s.kind === "dropoff"); }

  /** Unseen deliveries, minus any still being carried there. Rebuilt only when that list changes. */
  private refreshShelf() {
    const slot = this.dropoff;
    if (!slot || !this.snapshot) return;
    const carried = new Set<string>();
    for (const d of this.directions) {
      if (!d.carrying) continue;
      const id = this.snapshot.crew.find((c) => c._id === d.crewId)?.lastEnded?.taskId;
      if (id) carried.add(id);
    }
    const waiting = this.deliveries.filter((d) => !d.seen && !carried.has(d.taskId));
    const key = waiting.map((d) => `${d.taskId}:${d.diff?.added ?? ""}`).join(",");
    if (key === this.shelfKey) return;
    this.shelfKey = key;
    for (const p of this.packages.values()) disposeObject(p.obj);
    this.packages.clear();
    if (this.moreSign) { disposeObject(this.moreSign); this.moreSign = null; }
    const surface = (this.world.root.userData["dropoffSurface"] as Surface | undefined) ?? DEFAULT_SURFACE;
    const { spots, more } = packageSpots(slot, waiting.map((d) => d.taskId), surface);
    spots.forEach((at, i) => {
      const d = waiting[i]!;
      const obj = makePackage(TAGS[hash(d.crewId ?? d.crewName) % TAGS.length]!, d.taskId);
      obj.position.set(at.x, at.y, at.z);
      obj.rotation.y = at.yaw;
      obj.userData["taskId"] = d.taskId;
      this.shelf.add(obj);
      this.packages.set(d.taskId, { obj, d });
    });
    if (more) {
      this.moreSign = makeMore(waiting.length - spots.length);
      this.moreSign.position.set(more.x, more.y, more.z);
      this.shelf.add(this.moreSign);
    }
  }

  /** What E can use besides the world's own: each package, and each desk whose crew member has delivered something. */
  private refreshUses() {
    const uses: Interactable[] = [];
    for (const { obj, d } of this.packages.values()) {
      uses.push({ id: `box:${d.taskId}`, label: `Open ${d.crewName}'s changes · ${short(d.title, 30)}${sizeOf(d.diff)}`, at: obj.position.clone(), radius: 1.7 });
    }
    const dirs = new Map(this.directions.map((d) => [d.crewId, d]));
    for (const [desk, owner] of this.deskOwner) {
      const dir = dirs.get(owner);
      if (!dir || isWorking(dir.activity) || dir.activity === "asking") continue;
      const d = this.deliveries.find((x) => x.crewId === owner);
      const slot = this.slots.get(desk);
      if (!d || !slot) continue;
      uses.push({ id: `desk:${desk}:${d.taskId}`, label: `See ${d.crewName}'s last delivery · ${short(d.title, 30)}${sizeOf(d.diff)}`, at: new THREE.Vector3(slot.pos[0], slot.pos[1] + 1.1, slot.pos[2]), radius: 2.0 });
    }
    const key = uses.map((u) => `${u.id}|${u.label}`).join(",");
    if (key === this.usesKey) return;
    this.usesKey = key;
    this.captain.setInteractables([...this.world.interactables, ...uses]);
  }

  /** The package under ndc (the crosshair is 0, 0), within reach. */
  private packageAt(ndc: THREE.Vector2): Delivery | null {
    if (!this.packages.size) return null;
    const hit = pick(ndc, this.camera, [...this.packages.values()].map((p) => p.obj), 12);
    return hit ? [...this.packages.values()].find((p) => p.obj === hit)?.d ?? null : null;
  }

  // ---- pings: "Find" on the phone ----

  private setPing(p: UiState["ping"]) {
    if (this.ping) {
      this.ping.beacon.removeFromParent();
      this.ping.line.removeFromParent();
      this.ping.line.geometry.dispose();
      this.ping = null;
    }
    const body = p ? this.bodies.get(p.crewId) : undefined;
    if (!p || !body) return;
    const beacon = new THREE.Group();
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.18, 30, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: "#4fe3ff", transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
    );
    beam.position.y = 15;
    beacon.add(beam);
    body.fig.object.add(beacon);
    const line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: "#4fe3ff", transparent: true, opacity: 0.85, toneMapped: false }));
    this.scene.add(line);
    this.ping = { crewId: p.crewId, at: p.at, beacon, line, routedAt: 0 };
  }

  private updatePing(t: number) {
    const ping = this.ping;
    if (!ping) return;
    const body = this.bodies.get(ping.crewId);
    const me = this.captain.position;
    if (!body || me.distanceTo(body.fig.object.position) < 3 || Date.now() - ping.at > 120_000) {
      ui.set({ ping: null });
      return;
    }
    if (t - ping.routedAt > 0.5) {
      ping.routedAt = t;
      const to = body.fig.object.position;
      const pts = routeToPoint(this.world.layout.nav, [me.x, me.y, me.z], [to.x, to.y, to.z]);
      ping.line.geometry.dispose();
      ping.line.geometry = new THREE.BufferGeometry().setFromPoints([me.clone(), ...pts].map((v) => v.clone().setY(v.y + 0.08)));
    }
  }

  // ---- the bridge's per-frame answers ----

  /**
   * Name tags show through nothing: one hidden behind a wall or a deck, or far off, is hidden. With
   * a big crew only the nearest few show, so the deck doesn't turn into a wall of labels. Anyone
   * who needs you, whom you pinged, are aiming at or have in focus always shows.
   */
  private labelsAt = 0;
  private updateLabels(t: number) {
    if (t - this.labelsAt < 0.25) return;
    this.labelsAt = t;
    const eye = this.camera.getWorldPosition(new THREE.Vector3());
    const at = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const pinged = ui.get().ping?.crewId;
    const aimed = ui.get().aim?.crewId;
    const seen: { b: CrewBody; dist: number; always: boolean }[] = [];
    for (const b of this.bodies.values()) {
      b.fig.plate.sprite.visible = false;
      b.fig.inSight = false;
      if (!b.fig.object.visible) continue;
      b.fig.plate.sprite.getWorldPosition(at);
      const dist = at.distanceTo(eye);
      const always = b.dir?.marker === "asking" || b.id === pinged || b.id === aimed || this.focusIds.has(b.id);
      let ok = always || dist < 70;
      if (ok && !always) {
        dir.subVectors(at, eye).normalize();
        const hit = this.collision.raycast(eye, dir, dist);
        ok = !hit || hit.t > dist - 0.6;
      }
      b.fig.inSight = ok;
      if (ok) seen.push({ b, dist, always });
    }
    // Who keeps a tag: anyone who must, then whoever is talking, then the nearest. A tag that would
    // sit on top of one already shown (a huddle of four at the rail) waits its turn.
    const talking = (b: CrewBody) => b.fig.bubble.showing;
    seen.sort((p, q) => Number(q.always) - Number(p.always) || Number(talking(q.b)) - Number(talking(p.b)) || p.dist - q.dist);
    const taken: { x: number; y: number; w: number; h: number }[] = [];
    const k = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    let shown = 0;
    for (const s of seen) {
      if (!s.always && shown >= MAX_PLATES) break;
      const sp = s.b.fig.plate.sprite;
      sp.getWorldPosition(at);
      const ndc = at.clone().project(this.camera);
      // The tag hangs up from its anchor: its middle is half its height above.
      const h = sp.scale.y / (s.dist * k * 2), w = sp.scale.x / (s.dist * k * 2 * this.camera.aspect);
      const box = { x: ndc.x, y: ndc.y + h, w, h };
      if (!s.always && taken.some((o) => Math.abs(o.x - box.x) < (o.w + box.w) * 0.85 && Math.abs(o.y - box.y) < (o.h + box.h) * 0.85)) continue;
      taken.push(box);
      sp.visible = true;
      if (!s.always) shown++;
    }
    // A bubble over someone whose tag is hidden goes too, unless they're in focus.
    for (const b of this.bodies.values()) {
      if (b.fig.bubble.showing && !b.fig.plate.sprite.visible && !this.focusIds.has(b.id) && b.dir?.marker !== "asking") b.fig.bubble.clear();
    }
  }

  // ---- off duty: hangouts talking, people giving each other room ----

  /** Plays each group's banter (director.beat): who says what, who listens, who laughs, a toast. */
  private updateBanter(wall: number) {
    const groups = new Map<string, Hangout>();
    for (const b of this.bodies.values()) if (b.dir?.group && b.arrived && !b.busy) groups.set(b.dir.group.id, b.dir.group);
    for (const g of groups.values()) {
      const beat = this.director.beat(g, wall);
      if (!beat) continue;
      const here = g.members.map((id) => this.bodies.get(id)).filter((b): b is CrewBody => !!b && b.arrived && !b.busy && b.fig.object.visible);
      if (here.length < 2) continue;
      beat.lines.forEach((line, i) => {
        if (wall < line.at || wall >= line.at + line.ms) return;
        const key = `${g.id}:${beat.round}:${i}`;
        if (this.said.has(key)) return;
        const speaker = here.find((b) => b.id === line.speaker);
        if (!speaker) return;
        this.said.add(key);
        this.say(speaker, line.text, line.ms - (wall - line.at));
        speaker.talkUntil = line.at + line.ms - 300;
        if (!speaker.fig.rig.gestureId || speaker.fig.rig.gestureId === "listen") speaker.fig.gesture("talk");
        const head = this.stage.headOf(speaker.id);
        for (const b of here) {
          if (b === speaker) continue;
          if (head) b.fig.lookAt(head);
          if (!b.fig.rig.gestureId) b.fig.gesture("listen");
        }
        speaker.fig.lookAt(null);
      });
      for (const l of beat.laughs) {
        const key = `${g.id}:${beat.round}:laugh:${l.who}`;
        if (wall < l.at || wall > l.at + 600 || this.said.has(key)) continue;
        this.said.add(key);
        this.bodies.get(l.who)?.fig.gesture("laugh");
      }
      if (beat.cheersAt !== null && wall >= beat.cheersAt && wall < beat.cheersAt + 600) {
        const key = `${g.id}:${beat.round}:cheers`;
        if (!this.said.has(key)) {
          this.said.add(key);
          const raised = here.filter((b) => b.fig.rig.prop?.kind === "drink");
          for (const b of raised) b.fig.gesture("cheers");
          // The glasses meet 0.7 s into the gesture, over the middle of the group.
          if (raised.length >= 2) {
            const mid = new THREE.Vector3();
            for (const b of raised) mid.add(this.stage.headOf(b.id) ?? b.fig.object.position);
            audio.play("clink", mid.divideScalar(raised.length), { delay: 0.7 });
          }
        }
      }
    }
    // Done talking: back to listening (or nothing, out of a group).
    for (const b of this.bodies.values()) {
      if (b.fig.rig.gestureId !== "talk" || wall < b.talkUntil) continue;
      b.fig.gesture(b.dir?.group ? "listen" : null);
    }
    if (this.said.size > 2000) this.said = new Set([...this.said].slice(-500));
  }

  /**
   * Light separation: two people on foot closer than arm's length ease apart, and two walking at
   * each other each step to their right. Only bodies under way move; anyone seated or settling
   * into a spot stays put.
   */
  private separate(dt: number) {
    const list = [...this.bodies.values()].filter((b) => b.fig.object.visible);
    for (let i = 0; i < list.length; i++) {
      const a = list[i]!, pa = a.fig.object.position;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j]!, pb = b.fig.object.position;
        if (Math.abs(pa.y - pb.y) > 1) continue;
        const dx = pb.x - pa.x, dz = pb.z - pa.z, d2 = dx * dx + dz * dz;
        if (d2 > 6.25) continue;
        const am = a.striding, bm = b.striding;
        if (!am && !bm) continue;
        const d = Math.sqrt(d2) || 1e-3;
        const nx = d2 > 1e-6 ? dx / d : (hash(a.id + b.id) % 2 ? 1 : -1), nz = d2 > 1e-6 ? dz / d : 0;
        if (d < PERSONAL_SPACE) {
          const push = Math.min(0.08, (PERSONAL_SPACE - d) * 4 * dt);
          const share = am && bm ? 0.5 : 1;
          if (am) { pa.x -= nx * push * share; pa.z -= nz * push * share; }
          if (bm) { pb.x += nx * push * share; pb.z += nz * push * share; }
        }
        if (am && bm && d < 2.4) {
          const ya = a.fig.object.rotation.y, yb = b.fig.object.rotation.y;
          const fa = [Math.sin(ya), Math.cos(ya)], fb = [Math.sin(yb), Math.cos(yb)];
          const facing = fa[0]! * fb[0]! + fa[1]! * fb[1]!;
          const toward = fa[0]! * nx + fa[1]! * nz;
          if (facing < -0.5 && toward > 0.6) {
            const step = 0.55 * dt * (1 - d / 2.4);
            pa.x += -Math.cos(ya) * step; pa.z += Math.sin(ya) * step;
            pb.x += -Math.cos(yb) * step; pb.z += Math.sin(yb) * step;
          }
        }
      }
    }
  }

  /** How busy the ship is, for a world that shows it. */
  private updateBusy(dt: number) {
    const w = this.world as BusyWorld;
    let on = 0, all = 0;
    for (const b of this.bodies.values()) {
      if (!b.fig.object.visible || !b.dir) continue;
      all++;
      if (isWorking(b.dir.activity)) on++;
    }
    const k = 1 - Math.exp(-0.8 * dt);
    this.busySound += (busyLevel(on, all) - this.busySound) * k;
    if (!w.setBusy) return;
    this.busy += ((all ? on / all : 0) - this.busy) * k;
    if (Math.abs(this.busy - this.busySent) > 0.002) {
      this.busySent = this.busy;
      w.setBusy(this.busy);
    }
  }

  /** Who the crosshair is on: the nearest crew member under the middle of the screen, within reach. */
  private aimAt = 0;
  private updateAim(t: number) {
    if (t - this.aimAt < 0.1) return;
    this.aimAt = t;
    let aim: UiState["aim"] = null;
    if (ui.get().pointerLocked) {
      const hit = pick(new THREE.Vector2(0, 0), this.camera, [...this.bodies.values()].filter((b) => b.fig.object.visible).map((b) => b.fig.object));
      const body = [...this.bodies.values()].find((b) => b.fig.object === hit);
      if (body && body.fig.object.position.distanceTo(this.captain.position) < 25) aim = { crewId: body.id, name: body.name, line: body.dir?.label ?? "" };
      else {
        const d = this.packageAt(new THREE.Vector2(0, 0));
        if (d) aim = { crewId: "", name: d.crewName, line: `${short(d.title)}${sizeOf(d.diff)}`, hint: "Click to see the changes" };
      }
    }
    const was = ui.get().aim;
    if (was?.crewId !== aim?.crewId || was?.line !== aim?.line || was?.name !== aim?.name) ui.set({ aim });
  }

  private v = new THREE.Vector3();
  private locate(id: string) {
    const body = this.bodies.get(id);
    if (!body || !body.fig.object.visible) return null;
    // headTop is in the body's own frame: into the world before projecting.
    const head = body.fig.object.localToWorld(body.fig.rig.headTop(this.v).add(new THREE.Vector3(0, 0.6, 0)));
    const distance = head.distanceTo(this.camera.position);
    const p = head.project(this.camera);
    const onScreen = p.z < 1 && Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1;
    // Behind the camera the projection flips: mirror it, so an edge arrow points the way to turn.
    if (p.z > 1) { p.x = -p.x; p.y = -p.y; }
    return { x: ((p.x + 1) / 2) * innerWidth, y: ((1 - p.y) / 2) * innerHeight, onScreen, distance };
  }

  // ---- the loop ----

  private loop = (now?: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    this.timer.update(now);
    const dt = Math.min(0.05, this.timer.getDelta());
    const t = this.timer.getElapsed();
    const wall = Date.now();
    // Time moves people too (afterglow ends, the helicopter lands, idle crew wander).
    if (wall - this.lastPlan > 1000) this.plan(wall);
    this.world.update(dt, wall);
    this.captain.update(dt, t);
    if (this.film?.camera?.(this.camera, dt)) this.pipeline.cut();
    for (const b of this.bodies.values()) {
      if (!b.fig.object.visible) continue;
      b.update(dt, t, wall, this.camera);
    }
    this.separate(dt);
    this.updateBanter(wall);
    this.effects = this.effects.filter((e) => {
      if (e.update(dt)) return true;
      e.object.removeFromParent();
      e.dispose();
      return false;
    });
    this.updateBusy(dt);
    this.bot?.bot.update(dt, this.camera.position);
    for (const id of this.liveMonitors) this.monitors.get(id)?.update(dt);
    for (const b of this.bodies.values()) if (b.dir?.screen && b.fig.object.visible) this.watchLaptop(b);
    for (const l of this.laptops.values()) l.screen.update(dt);
    this.updatePing(t);
    this.updateLabels(t);
    this.updateAim(t);
    this.updateSound(t, wall);
    this.pipeline.render(dt);
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    removeEventListener("resize", this.resize);
    this.unsub?.();
    sceneBridge.locate = () => null;
    sceneBridge.captain = () => null;
    sceneBridge.where = () => null;
    this.stopSound();
    for (const b of [...this.bodies.values()]) this.removeBody(b);
    for (const e of this.effects) { e.object.removeFromParent(); e.dispose(); }
    this.effects = [];
    for (const p of this.packages.values()) disposeObject(p.obj);
    if (this.moreSign) disposeObject(this.moreSign);
    for (const m of this.monitors.values()) m.dispose();
    this.idleScreen.dispose();
    for (const l of this.laptops.values()) l.screen.dispose();
    this.captain?.dispose();
    this.world?.dispose();
    this.pipeline?.dispose();
    this.renderer.dispose();
  }
}
