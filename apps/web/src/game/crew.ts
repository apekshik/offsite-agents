import * as THREE from "three";
import {
  CrewFigure, Walker, fishCycle, routeTo, routeToPoint,
  type ActId, type Collision, type GestureId, type PropKind,
} from "@offsite/kit";
import { isWorking, type NavGraph, type Slot, type Vec3 } from "@offsite/contracts";
import type { Act, Direction } from "./director.ts";
import type { OneShotSound, PlayOptions } from "../audio/index.ts";
import { LooseGlass, Splash, type Effect } from "./fx.ts";
import { SCRAMBLE } from "./banter.ts";
import { hash, rand } from "./rng.ts";

// One crew member's body in the world: their figure and walker, and the little scripted moments
// that play out between the director's directions: the scramble when work comes in (the phone
// buzzes, the drink goes down, out of the pool, then a run for the desk), a cannonball into the
// pool, pacing behind the desk while thinking, a stretch or a coffee at work, a fish on the line.
//
// Moments are generators stepped once a frame with dt; everything they choose comes from the
// crew member's id and the clock (rng.ts), so a fixed clock replays them exactly.

/** Ground speeds, m/s: a run makes the avatar's run gait kick in (above ~2.6). */
export const SPEED = { run: 4.8, walk: 2.0, stroll: 1.35 } as const;

export const ACT: Record<Act, ActId | null> = {
  type: "type", laptop: "laptop", "lounge-laptop": "lounge-laptop", sunbathe: "sunbathe", hammock: "hammock",
  fish: "fish", carry: "carry", slump: "slump", think: "think", celebrate: "celebrate", rail: "rail",
  swim: "swim", soak: "sofa", stool: "stool", wave: "wave", stand: null,
  drink: "drink", "sit-drink": "sit-drink", "lean-back": "leanBack", nap: "nap", "nap-hammock": "nap-hammock", "nap-chair": "nap-chair",
  dance: "dance", cards: "cards", selfie: "selfie", stretch: "stretch", bartend: "bartend", huddle: "huddle", pace: null,
  sofa: "sofa", "hammock-rest": "hammock-rest", mingle: "listen", jog: "jog", sauna: "sauna", tinker: "tinker",
  lift: "lift", "lift-bench": "lift-bench",
};
const NAPS = new Set<ActId | null>(["nap", "nap-hammock", "nap-chair"]);
const CATCH_LINES = {
  fish: ["got one!", "dinner!", "look at this one", "a big one!"],
  boot: ["a boot. again.", "...a boot", "size nine", "who keeps losing these"],
  none: ["it got away", "next time"],
} as const;

/** What a body needs from the game around it. */
export interface Stage {
  scene: THREE.Scene;
  nav: NavGraph;
  collision: Collision;
  slot(id: string): Slot | undefined;
  /** Where the captain is (for following them with a question). */
  captain: THREE.Object3D;
  /**
   * Whom someone with a question walks to, when it isn't you: the person on deck it is for (a friend, or the captain
   * in a friend's view). Null or absent: you.
   */
  askee?(crewId: string): THREE.Object3D | null;
  /** Say something, if the bubble budget allows (nearby, on screen, or in focus). */
  say(body: CrewBody, text: string, ms?: number): void;
  fx(e: Effect): void;
  /** A sound once, at a place or on something (the game's audio; quiet until sound has started). */
  sfx(sound: OneShotSound, where: THREE.Object3D | THREE.Vector3, o?: PlayOptions): void;
  /** Someone reached the drop-off with their package. */
  delivered(id: string): void;
  /** Where someone's head is, to look at them. */
  headOf(id: string): THREE.Vector3 | null;
}

const v3 = (p: Vec3) => new THREE.Vector3(p[0], p[1], p[2]);
const ease = (x: number) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };
const angleDelta = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

type Moment = Generator<void, void, number>;

export class CrewBody {
  readonly id: string;
  readonly name: string;
  readonly fig: CrewFigure;
  readonly walker: Walker;
  /** What they were told last, so the same direction twice changes nothing. */
  key = "";
  dir: Direction | null = null;
  arrived = false;
  asking: string | null = null;
  /** Treading water in the pool (they climb out before going anywhere). */
  inWater = false;
  /** Talking in their group until then (ms, the shared clock). */
  talkUntil = 0;
  private moment: Moment | null = null;
  /** The way back out of a spot reached by an approach (round the bar counter), walked before going anywhere else. */
  private exit: THREE.Vector3[] | null = null;
  private scrambledAt = 0;
  private pacing: { origin: THREE.Vector3; axis: THREE.Vector3; t0: number; from: THREE.Vector3; yaw: number } | null = null;
  private paceSpeed = 0;
  private workBucket = -1;
  private fishSaid = -1;
  private wall = 0;
  private t = 0;
  private readonly stage: Stage;

  constructor(stage: Stage, o: { id: string; name: string; fig: CrewFigure; walker: Walker }) {
    this.stage = stage;
    this.id = o.id;
    this.name = o.name;
    this.fig = o.fig;
    this.walker = o.walker;
  }

  get busy() { return !!this.moment; }
  /** Moving under their own steam along a route (not settling into a seat, not scripted). */
  get striding() {
    if (this.moment || this.pacing) return false;
    const s = this.walker.state, g = this.walker.goal;
    if (!(s === "walking" || s === "following") || !g) return false;
    const p = this.fig.object.position;
    return Math.hypot(g.x - p.x, g.z - p.z) > 1.0;
  }

  /** Put them straight into their slot (crew already aboard when the page loads). */
  place(slot: Slot, d: Direction) {
    this.walker.place(slot);
    if (d.approach?.length) this.exit = d.approach.map(v3).reverse();
    this.arrived = true;
    this.key = `slot:${slot.id}`;
    this.inWater = slot.kind === "pool";
    this.fig.setAct(ACT[d.act], this.propOpt(d));
  }

  private propOpt(d: Direction): { prop?: PropKind | null } {
    // The act brings its own prop (a laptop on the lap, a rod); only leisure props are added here.
    const extra = d.props.find((p) => p === "drink" || p === "box");
    return extra ? { prop: extra } : {};
  }

  /** A new direction from the director. */
  direct(d: Direction, question: string | null, wall: number) {
    const was = this.dir;
    this.dir = d;
    this.wall = wall;
    // Work just came in for someone off duty: the scramble owns them until they're running.
    if (d.scramble && d.scramble.at !== this.scrambledAt) {
      this.scrambledAt = d.scramble.at;
      if (!was || was.activity === "idle") { this.play(this.scramble(d.scramble)); return; }
    }
    if (this.moment) return; // picked up when the moment ends
    this.steer(d, question);
  }

  private play(m: Moment) {
    this.stopPacing();
    this.moment = m;
    m.next(0); // run up to its first wait
  }

  /** Walk (or run, or stroll) to where the direction says, and do what it says there. */
  private steer(d: Direction, question: string | null = null) {
    const { fig, walker } = this;
    const key = d.target.kind === "slot" ? `slot:${d.target.slotId}` : d.target.kind;
    if (key === this.key) {
      if (this.arrived && d.target.kind === "slot") {
        const act = ACT[d.act];
        if (d.act === "pace") return; // update() walks them up and down
        if (this.pacing) { this.backToSeat(d); return; }
        if (fig.act !== act) fig.setAct(act, this.propOpt(d));
      }
      return;
    }
    const slot = d.target.kind === "slot" ? this.stage.slot(d.target.slotId) : undefined;
    // In the pool and going anywhere but this same spot: out first. Behind the bar: out the way they came.
    if (this.inWater && slot?.kind !== "pool") { this.play(this.leavePool()); return; }
    if (this.exit) { const e = this.exit; this.exit = null; this.play(this.leaveBy(e, SPEED[d.gait])); return; }
    this.key = key;
    this.arrived = false;
    this.asking = null;
    this.stopPacing();
    fig.lookAt(null);
    if (fig.rig.gestureId === "talk" || fig.rig.gestureId === "listen" || fig.rig.gestureId === "lean") fig.gesture(null);
    if (slot) {
      if (slot.kind === "pool" && !this.inWater) { this.play(this.cannonball(slot)); return; }
      fig.setAct(d.walkAct ? ACT[d.walkAct] : null, d.walkAct === "carry" ? { prop: "box" } : {});
      const speed = SPEED[d.gait];
      const pos = fig.object.position;
      const pts = d.approach?.length
        ? [...routeToPoint(this.stage.nav, pos, d.approach[0]!), ...d.approach.slice(1).map(v3), v3(slot.pos)]
        : routeTo(this.stage.nav, pos, slot);
      if (d.approach?.length) this.exit = d.approach.map(v3).reverse();
      walker.go(pts, { facing: slot.facing, seat: slot.seat ?? null }, () => this.arrive(slot), speed);
    } else if (d.target.kind === "captain") {
      fig.setAct(null);
      walker.follow(this.stage.askee?.(this.id) ?? this.stage.captain, {
        graph: this.stage.nav, distance: 1.6, speed: 2.4,
        onReach: () => {
          this.arrived = true;
          fig.setAct("talk");
          if (question && this.asking !== question) {
            this.asking = question;
            fig.say(question.length > 90 ? `${question.slice(0, 88)}…` : question, 9000);
          }
        },
      });
    } else {
      walker.stop();
      fig.setAct(null);
    }
  }

  private arrive(slot: Slot) {
    this.arrived = true;
    this.fig.setBackpack(false);
    if (slot.kind === "dropoff") this.stage.delivered(this.id);
    const now = this.dir;
    // Settling onto a bar stool: ice in the glass.
    if (slot.kind === "bar-stool" && now?.act !== "bartend") this.stage.sfx("ice", this.fig.object, { delay: 0.5 });
    if (now) this.fig.setAct(ACT[now.act], this.propOpt(now));
  }

  /** Done with a moment: carry on with whatever the director says now. */
  private resume() {
    this.moment = null;
    this.key = "";
    if (this.dir) this.steer(this.dir);
  }

  // ---------- moments ----------

  private *wait(s: number): Moment {
    let t = 0;
    while (t < s) t += yield;
  }

  private *walking(): Moment {
    while (this.walker.state === "walking" || this.walker.state === "turning" || this.walker.state === "standing") yield;
  }

  /** The phone buzzes; the drink goes down; out of the pool or up off the lounger; then a run for it. */
  private *scramble(s: { at: number; delay: number; rank: number }): Moment {
    // Our turn in the wave.
    while (this.wall < s.at + s.delay) yield;
    const { fig } = this;
    const napping = NAPS.has(fig.act);
    fig.popAlert();
    if (napping) fig.gesture("wake");
    else if (!this.inWater) fig.gesture("buzz");
    if (s.rank % 3 === 0) this.stage.say(this, SCRAMBLE[hash(this.id, s.at) % SCRAMBLE.length]!, 1600);
    yield* this.wait(0.35);
    this.letGoOfDrink(s.at);
    if (napping) { yield* this.wait(0.5); fig.gesture("buzz"); }
    yield* this.wait(this.inWater ? 0.3 : 0.75);
    if (this.inWater) yield* this.outOfThePool();
    this.resume();
  }

  /** Whatever drink they hold: put down on the counter at the bar, or dropped on the deck. */
  private letGoOfDrink(seed: number) {
    const { fig } = this;
    if (fig.rig.prop?.kind !== "drink") return;
    const prop = fig.releaseProp();
    if (!prop) return;
    this.stage.scene.attach(prop.object);
    fig.setAct(fig.act, { prop: null });
    const yaw = fig.object.rotation.y;
    const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const slot = this.key.startsWith("slot:") ? this.stage.slot(this.key.slice(5)) : undefined;
    const atBar = slot?.kind === "bar-stool" && this.arrived;
    const mode = atBar || rand(this.id, seed, "glass") < 0.35 ? "set" : "drop";
    const p = fig.object.position;
    const setAt = atBar
      ? new THREE.Vector3(p.x + fwd.x * 0.72, p.y + 1.11, p.z + fwd.z * 0.72)
      : new THREE.Vector3(p.x + fwd.x * 0.4, this.floorAt(p), p.z + fwd.z * 0.4);
    this.stage.fx(new LooseGlass(prop, { mode, seed: hash(this.id, seed), forward: fwd, floorAt: (q) => this.floorAt(q), ...(mode === "set" ? { setAt } : {}) }));
  }

  private floorAt(p: THREE.Vector3) {
    return this.stage.collision.floorBelow(p.x, p.y + 0.8, p.z, 3) ?? p.y;
  }

  /** Where the pool's edge is between this spot and the deck it's reached from. */
  private poolEdge(slot: Slot) {
    const node = this.stage.nav.nodes.find((n) => n.id === slot.nav);
    if (!node) return null;
    const S = v3(slot.pos), N = v3(node.pos);
    const dir = new THREE.Vector3(N.x - S.x, 0, N.z - S.z);
    const len = dir.length();
    if (len < 0.5) return null;
    dir.divideScalar(len);
    // March from the water toward the deck until there's deck underfoot.
    for (let s = 0.3; s < len; s += 0.1) {
      const x = S.x + dir.x * s, z = S.z + dir.z * s;
      const f = this.stage.collision.floorBelow(x, N.y + 0.6, z, 1.0);
      if (f !== null && Math.abs(f - N.y) < 0.15) {
        const E = new THREE.Vector3(x, N.y, z);
        return { E, dir, deck: N.y, water: S.y, take: E.clone().addScaledVector(dir, 0.3), wall: new THREE.Vector3(x - dir.x * 0.45, S.y, z - dir.z * 0.45) };
      }
    }
    return null;
  }

  /** Swim to the wall, haul out, shake off. */
  private *outOfThePool(): Moment {
    const { fig, walker } = this;
    const slot = this.key.startsWith("slot:") ? this.stage.slot(this.key.slice(5)) : undefined;
    const edge = slot ? this.poolEdge(slot) : null;
    walker.release();
    if (edge) {
      fig.setAct("swim");
      walker.go([edge.wall], { facing: Math.atan2(edge.dir.x, edge.dir.z) }, undefined, 1.3);
      yield* this.walking();
      walker.release();
      fig.setAct("climb");
      const from = fig.object.position.clone(), to = edge.take;
      for (let u = 0; u < 1;) {
        u = Math.min(1, u + (yield) / 0.9);
        fig.object.position.set(THREE.MathUtils.lerp(from.x, to.x, ease((u - 0.35) / 0.65)), THREE.MathUtils.lerp(from.y, to.y, ease(u / 0.7)), THREE.MathUtils.lerp(from.z, to.z, ease((u - 0.35) / 0.65)));
      }
    }
    this.inWater = false;
    fig.setAct(null);
    fig.gesture("shake");
    this.stage.fx(new Splash(fig.object.position.clone().setY(fig.object.position.y + 1.0), hash(this.id, this.wall), { big: false }));
    yield* this.wait(1.15);
  }

  private *leaveBy(path: THREE.Vector3[], speed: number): Moment {
    this.fig.setAct(null);
    this.walker.go(path, {}, undefined, speed);
    yield* this.walking();
    this.resume();
  }

  private *leavePool(): Moment {
    yield* this.outOfThePool();
    this.resume();
  }

  /** Stroll to the run-up, run, tuck, and hit the water. */
  private *cannonball(slot: Slot): Moment {
    const { fig, walker } = this;
    this.key = `slot:${slot.id}`;
    this.arrived = false;
    const edge = this.poolEdge(slot);
    if (!edge) {
      // No edge to jump from: just wade in.
      walker.goTo(this.stage.nav, slot, undefined, SPEED.stroll);
      yield* this.walking();
    } else {
      fig.setAct(null);
      const runFrom = edge.take.clone().addScaledVector(edge.dir, 2.6);
      walker.go(routeToPoint(this.stage.nav, fig.object.position, runFrom), {}, undefined, SPEED.stroll);
      yield* this.walking();
      // A moment to size it up, then go.
      walker.go([edge.take], {}, undefined, SPEED.run);
      yield* this.walking();
      walker.release();
      const S = v3(slot.pos);
      const from = fig.object.position.clone();
      const far = from.distanceTo(new THREE.Vector3(S.x, from.y, S.z));
      const land = far <= 2.6 ? S : from.clone().addScaledVector(edge.dir, -2.3).setY(S.y);
      const yaw = Math.atan2(-edge.dir.x, -edge.dir.z);
      fig.object.rotation.y = yaw;
      fig.setAct("tuck");
      const dur = 0.8, h = 1.15;
      for (let u = 0; u < 1;) {
        u = Math.min(1, u + (yield) / dur);
        fig.object.position.set(
          THREE.MathUtils.lerp(from.x, land.x, u),
          THREE.MathUtils.lerp(from.y, land.y - 0.35, u) + 4 * h * u * (1 - u),
          THREE.MathUtils.lerp(from.z, land.z, u),
        );
        fig.object.rotation.x = -0.5 * u; // tipping forward into it
      }
      fig.object.rotation.x = 0;
      this.stage.fx(new Splash(land.clone().setY(S.y + 0.05), hash(this.id, this.wall, "splash")));
      this.inWater = true;
      fig.setAct("swim");
      fig.object.position.copy(land);
      if (land !== S) {
        walker.go([S], { facing: slot.facing }, undefined, 1.2);
        yield* this.walking();
      }
    }
    walker.place(slot);
    this.inWater = true;
    this.moment = null;
    this.arrive(slot);
  }

  // ---------- pacing behind the desk ----------

  private stopPacing() {
    this.pacing = null;
    this.paceSpeed = 0;
  }

  private backToSeat(d: Direction) {
    const slot = d.target.kind === "slot" ? this.stage.slot(d.target.slotId) : undefined;
    this.stopPacing();
    if (!slot) return;
    this.arrived = false;
    this.fig.setAct(null);
    this.walker.go([v3(slot.pos)], { facing: slot.facing, seat: slot.seat ?? null }, () => this.arrive(slot), SPEED.walk);
  }

  private pace(dt: number, slot: Slot) {
    const o = this.fig.object;
    if (!this.pacing) {
      this.walker.release();
      this.fig.setAct(null);
      const f = slot.facing;
      const back = new THREE.Vector3(-Math.sin(f), 0, -Math.cos(f));
      const axis = new THREE.Vector3(-Math.cos(f), 0, Math.sin(f));
      this.pacing = { origin: v3(slot.pos).addScaledVector(back, 0.9), axis, t0: this.t, from: o.position.clone(), yaw: o.rotation.y };
    }
    const p = this.pacing;
    const u = (this.t - p.t0) / 7.5; // a lap every 7.5 s
    const x = 0.95 * Math.sin(u * Math.PI * 2);
    const vx = 0.95 * Math.cos(u * Math.PI * 2) * (Math.PI * 2) / 7.5;
    const target = p.origin.clone().addScaledVector(p.axis, x);
    const blend = ease((this.t - p.t0) / 0.8);
    o.position.lerpVectors(p.from, target, blend);
    const yaw = Math.atan2(p.axis.x * Math.sign(vx || 1), p.axis.z * Math.sign(vx || 1));
    o.rotation.y += angleDelta(o.rotation.y, yaw) * (1 - Math.exp(-8 * dt));
    this.paceSpeed = Math.abs(vx) * blend;
  }

  // ---------- every frame ----------

  update(dt: number, t: number, wall: number, camera: THREE.Camera) {
    this.t = t;
    this.wall = wall;
    const { fig, walker } = this;
    if (this.moment) {
      const r = this.moment.next(dt);
      if (r.done && this.moment) this.moment = null;
    }
    if (!this.moment) {
      const d = this.dir;
      const slot = d?.target.kind === "slot" ? this.stage.slot(d.target.slotId) : undefined;
      if (d?.act === "pace" && this.arrived && slot) this.pace(dt, slot);
      else if (this.pacing && d) this.backToSeat(d);
    }
    if (!this.pacing) walker.update(dt);
    if (this.dir?.target.kind === "captain" && this.arrived) {
      const to = this.stage.askee?.(this.id) ?? this.stage.captain;
      fig.lookAt(to.position.clone().setY(to.position.y + 1.5));
    }
    this.habits(wall, t);
    fig.setSleeping(this.arrived && !this.moment && NAPS.has(fig.act));
    fig.update(dt, t, { speed: this.pacing ? this.paceSpeed : walker.speed, seat: this.pacing ? null : walker.seat, camera });
  }

  /** Little things on a schedule: a stretch or a coffee at work, leaning in with company, a fish. */
  private habits(wall: number, t: number) {
    const d = this.dir, fig = this.fig;
    if (!d || !this.arrived || this.moment) return;
    if (d.company) {
      const head = this.stage.headOf(d.company);
      if (head) fig.lookAt(head);
      if (!fig.rig.gestureId) fig.gesture("lean");
    } else if (fig.rig.gestureId === "lean") {
      fig.gesture(null);
      fig.lookAt(null);
    }
    if (isWorking(d.activity) && !d.company) {
      const b = Math.floor(wall / 7000);
      if (b !== this.workBucket) {
        this.workBucket = b;
        if (rand(this.id, b, "habit") < 0.3 && !fig.rig.gestureId) {
          const at = fig.act;
          const pick: GestureId[] = at === "type" ? ["coffee", "coffee", "yawn", "nod"] : at === "think" ? ["nod"] : ["yawn", "nod"];
          if (at === "type" || at === "laptop" || at === "lounge-laptop" || at === "hammock" || at === "think") fig.gesture(pick[hash(this.id, b) % pick.length]!);
        }
      }
    }
    if (fig.act === "fish") {
      const f = fishCycle(t, fig.rig.seed);
      if (f.phase === "show" && f.n !== this.fishSaid) {
        this.fishSaid = f.n;
        const lines = CATCH_LINES[f.catch];
        this.stage.say(this, lines[hash(this.id, f.n) % lines.length]!, 2200);
      }
    }
  }

  dispose() {
    this.moment = null;
    this.fig.dispose();
  }
}
