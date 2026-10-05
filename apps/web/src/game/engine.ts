import * as THREE from "three";
import {
  Captain, Collision, ComputerBot, CrewFigure, Input, Laptop, SELF_LAYER, Walker,
  buildAvatar, createPipeline, createRenderer, pick, routeToPoint, sanitizeAvatar, sanitizeLook, CAPTAIN_PRESET,
  type ActId, type BotMood, type BuiltWorld, type Pipeline, type PropKind, type Quality, type Tone, type WorldModule,
} from "@offsite/kit";
import type { AvatarSpec, Look, Slot } from "@offsite/contracts";
import { scene as sceneBridge, ui, type UiState } from "../bridge.ts";
import { Director, type Act, type CrewView, type Direction } from "./director.ts";
import { CrewScreen, describeSlot, faceOf, takeOverLaptop, type HelmContent, type ScreenContent } from "./screens.ts";

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

export interface GameOptions {
  canvas: HTMLCanvasElement;
  world: WorldModule;
  quality?: Quality;
  captain: { avatar: unknown; look: unknown } | null;
}

interface Body {
  id: string;
  name: string;
  fig: CrewFigure;
  walker: Walker;
  /** What they were told last, so the same direction twice changes nothing. */
  key: string;
  dir: Direction | null;
  arrived: boolean;
  asking: string | null;
}

const ACT: Record<Act, ActId | null> = {
  type: "type", laptop: "laptop", "lounge-laptop": "lounge-laptop", sunbathe: "sunbathe", hammock: "hammock",
  fish: "fish", carry: "carry", slump: "slump", think: "think", celebrate: "celebrate", rail: "rail",
  swim: "swim", soak: "sofa", stool: "stool", wave: "wave", stand: null,
};
const PROP: Record<string, PropKind> = { laptop: "laptop", box: "box", rod: "rod", drink: "drink" };

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
  private bodies = new Map<string, Body>();
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
  private lastPlan = 0;
  private ping: { crewId: string; at: number; beacon: THREE.Group; line: THREE.Line; routedAt: number } | null = null;
  private waterY = 0;
  private timer = new THREE.Timer();
  private raf = 0;
  private unsub: (() => void) | null = null;
  private disposed = false;

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
    for (const s of this.world.layout.slots) this.slots.set(s.id, s);
    this.director = new Director(this.world.layout.slots);

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
    this.captain.onUse = (it) => { if (it.id === "helm") this.openInterface({ helm: true }); };
    this.captain.onView = (view) => ui.set({ view });
    this.captain.onPointerLock = (pointerLocked) => ui.set({ pointerLocked });
    this.captain.onClick = (ndc) => {
      const hit = pick(ndc, camera, [...this.bodies.values()].map((b) => b.fig.object));
      const body = [...this.bodies.values()].find((b) => b.fig.object === hit);
      if (body) this.openInterface({ crewCard: body.id }); // let go of the mouse so the card's buttons work
    };
    this.unsub = ui.subscribe(() => this.onUi(ui.get()));
    this.onUi(ui.get());

    sceneBridge.locate = (id) => this.locate(id);
    sceneBridge.captain = () => {
      const p = this.captain.position;
      return { x: p.x, y: p.y, z: p.z };
    };
    sceneBridge.where = (id) => {
      const t = this.bodies.get(id)?.dir?.target;
      if (t?.kind === "captain") return { slotId: "captain", kind: "captain", tags: [] };
      const s = t?.kind === "slot" ? this.slots.get(t.slotId) : undefined;
      return s ? { slotId: s.id, kind: s.kind, tags: s.tags ?? [] } : null;
    };

    addEventListener("resize", this.resize);
    this.resize();
    // For poking at it from the console while developing.
    if (import.meta.env.DEV) Object.assign(window, { offsite: { game: this, captain: this.captain, world: this.world, ui } });
    this.loop();
  }

  private openInterface(patch: Partial<UiState>) {
    if (document.pointerLockElement) document.exitPointerLock();
    ui.set(patch);
  }

  private phoneWas = "";
  private pingWas: UiState["ping"] = null;
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

  /** The threads, for the helm's screen. */
  setThreads(threads: ThreadSummary[]) {
    this.threads = threads;
    this.paintHelm();
  }

  private plan(now: number) {
    const snap = this.snapshot;
    if (!snap || !this.director) return;
    this.lastPlan = now;
    const directions = this.director.plan(snap.crew, now);
    const seen = new Set<string>();
    for (const d of directions) {
      const view = snap.crew.find((c) => c._id === d.crewId)!;
      seen.add(d.crewId);
      this.direct(view, d, snap.questions.find((q) => q.crewId === d.crewId)?.prompt ?? null);
    }
    for (const [id, b] of this.bodies) if (!seen.has(id)) this.removeBody(b);
    this.paintScreens(snap, directions);
    this.directComputer(snap.crew.find((c) => c.role === "computer"), now);
  }

  private makeBody(view: Snapshot["crew"][number], d: Direction): Body {
    const fig = new CrewFigure({ spec: spec(view.avatar), look: look(view.look), name: view.name, seed: hash(view._id) % 1000 });
    fig.water = this.waterY;
    // A brisk walk: the ship is 140 m long.
    const walker = new Walker(fig.object, { speed: 2.0, floor: (x, y, z) => this.collision.floorBelow(x, y + 0.6, z, 1.6) });
    const start = (d.spawnSlot && this.slots.get(d.spawnSlot)) || (d.target.kind === "slot" ? this.slots.get(d.target.slotId) : null)
      || this.world.layout.slots.find((s) => s.kind === "crew-spawn");
    if (start) fig.object.position.set(...start.pos);
    if (d.spawnSlot) fig.setBackpack(true);
    this.scene.add(fig.object);
    const body: Body = { id: view._id, name: view.name, fig, walker, key: "", dir: null, arrived: false, asking: null };
    this.bodies.set(view._id, body);
    // Someone already aboard when the page loads is simply where they belong.
    if (!d.spawnSlot && d.target.kind === "slot") {
      const slot = this.slots.get(d.target.slotId);
      if (slot) { walker.place(slot); body.arrived = true; body.key = `slot:${slot.id}`; fig.setAct(ACT[d.act], this.propOpt(d)); }
    }
    return body;
  }

  private removeBody(b: Body) {
    this.scene.remove(b.fig.object);
    b.fig.dispose();
    this.bodies.delete(b.id);
  }

  private propOpt(d: Direction): { prop?: PropKind | null } {
    // The act brings its own prop (a laptop on the lap, a rod); only leisure props are added here.
    const extra = d.props.find((p) => p === "drink" || p === "box");
    return extra ? { prop: PROP[extra]! } : {};
  }

  private direct(view: Snapshot["crew"][number], d: Direction, question: string | null) {
    let body = this.bodies.get(d.crewId);
    if (!d.visible) {
      if (body) body.fig.object.visible = false;
      return;
    }
    body ??= this.makeBody(view, d);
    const { fig, walker } = body;
    fig.object.visible = true;
    const tone: Tone = d.activity === "asking" ? "warn" : d.activity === "failed" ? "danger" : d.activity === "landed" ? "ok" : d.activity === "idle" ? "dim" : "accent";
    fig.setLabel(view.name, d.label, tone);
    fig.setAsking(d.marker === "asking");
    body.dir = d;

    const key = d.target.kind === "slot" ? `slot:${d.target.slotId}` : d.target.kind;
    if (key !== body.key) {
      body.key = key;
      body.arrived = false;
      body.asking = null;
      fig.lookAt(null);
      if (d.target.kind === "slot") {
        const slot = this.slots.get(d.target.slotId)!;
        fig.setAct(d.walkAct ? ACT[d.walkAct] : null, d.walkAct === "carry" ? { prop: "box" } : {});
        walker.goTo(this.world.layout.nav, slot, () => {
          body!.arrived = true;
          fig.setBackpack(false);
          if (slot.kind === "dropoff") this.director.delivered(body!.id, Date.now());
          const now = body!.dir;
          if (now) fig.setAct(ACT[now.act], this.propOpt(now));
        });
      } else if (d.target.kind === "captain") {
        fig.setAct(null);
        walker.follow(this.captain.object, {
          graph: this.world.layout.nav, distance: 1.6, speed: 2.4,
          onReach: () => {
            body!.arrived = true;
            fig.setAct("talk");
            if (question && body!.asking !== question) {
              body!.asking = question;
              fig.say(question.length > 90 ? `${question.slice(0, 88)}…` : question, 9000);
            }
          },
        });
      } else {
        walker.stop();
        fig.setAct(null);
      }
    } else if (body.arrived && d.target.kind === "slot") {
      const act = ACT[d.act];
      if (fig.act !== act) fig.setAct(act, this.propOpt(d));
    }

    // Their screen (the desk's monitor, or the laptop on their lap) is painted in paintScreens.
  }

  // ---- crew screens (screens.ts) ----

  private contentFor(view: Snapshot["crew"][number], d: Direction, question: string | null): ScreenContent | null {
    const face = faceOf(view.avatar, view.look);
    const task = view.live?.taskTitle ?? view.live?.threadTitle ?? "";
    const step = view.live?.step?.summary ?? view.lastStep ?? "";
    const since = (view.live as { startedAt?: number | null } | null)?.startedAt ?? null;
    switch (d.activity) {
      case "asking": return { kind: "asking", name: view.name, face, task, prompt: question ?? "", step };
      case "landed": return { kind: "landed", name: view.name, face, task: view.lastEnded?.taskTitle ?? task };
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
      const slot = d.target.kind === "slot" ? this.slots.get(d.target.slotId) : undefined;
      if (slot?.kind !== "desk" || !d.screen) continue;
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
        const t = d.target.kind === "slot" ? this.slots.get(d.target.slotId) : undefined;
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
  private watchLaptop(b: Body) {
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
        return { name: q.crewName ?? c?.name ?? "Someone", face: c && c.role === "crew" ? faceOf(c.avatar, c.look) : null, prompt: q.prompt };
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
   * Name tags show through nothing: one hidden behind a wall or a deck, or far off, is hidden.
   * Anyone who needs you, or whom you pinged, always shows.
   */
  private labelsAt = 0;
  private updateLabels(t: number) {
    if (t - this.labelsAt < 0.25) return;
    this.labelsAt = t;
    const eye = this.camera.getWorldPosition(new THREE.Vector3());
    const at = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const pinged = ui.get().ping?.crewId;
    for (const b of this.bodies.values()) {
      if (!b.fig.object.visible) continue;
      b.fig.plate.sprite.getWorldPosition(at);
      const dist = at.distanceTo(eye);
      const always = b.dir?.marker === "asking" || b.id === pinged;
      let seen = always || dist < 70;
      if (seen && !always) {
        dir.subVectors(at, eye).normalize();
        const hit = this.collision.raycast(eye, dir, dist);
        seen = !hit || hit.t > dist - 0.6;
      }
      // Bubbles keep their own visibility (it is how they fade); they only show up close anyway.
      b.fig.plate.sprite.visible = seen;
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
    }
    const was = ui.get().aim;
    if (was?.crewId !== aim?.crewId || was?.line !== aim?.line) ui.set({ aim });
  }

  private v = new THREE.Vector3();
  private locate(id: string) {
    const body = this.bodies.get(id);
    if (!body || !body.fig.object.visible) return null;
    const head = body.fig.rig.headTop(this.v).add(new THREE.Vector3(0, 0.6, 0));
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
    for (const b of this.bodies.values()) {
      if (!b.fig.object.visible) continue;
      b.walker.update(dt);
      if (b.dir?.target.kind === "captain" && b.arrived) b.fig.lookAt(this.captain.position.clone().setY(this.captain.position.y + 1.5));
      b.fig.update(dt, t, { speed: b.walker.speed, seat: b.walker.seat, camera: this.camera });
    }
    this.bot?.bot.update(dt, this.camera.position);
    for (const id of this.liveMonitors) this.monitors.get(id)?.update(dt);
    for (const b of this.bodies.values()) if (b.dir?.screen && b.fig.object.visible) this.watchLaptop(b);
    for (const l of this.laptops.values()) l.screen.update(dt);
    this.updatePing(t);
    this.updateLabels(t);
    this.updateAim(t);
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
    for (const b of [...this.bodies.values()]) this.removeBody(b);
    for (const m of this.monitors.values()) m.dispose();
    this.idleScreen.dispose();
    for (const l of this.laptops.values()) l.screen.dispose();
    this.captain?.dispose();
    this.world?.dispose();
    this.pipeline?.dispose();
    this.renderer.dispose();
  }
}
