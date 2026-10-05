import { ACTIVITY_LABEL, ACTIVITY_SPOTS, ARRIVAL, crewActivity, isWorking, type CrewActivity, type RunState, type Slot, type SlotKind, type Vec3 } from "@offsite/contracts";
import { beatAt, type Beat, type GroupMood } from "./banter.ts";
import { hash, rand, shuffled } from "./rng.ts";

// The director decides where each crew member goes and what they do there, from what they are
// working on. It is pure apart from what it remembers (seats, hangouts, who just got work), and
// every choice it makes is a hash of who and which slice of the clock (rng.ts), so the same crew
// and the same clock always play out the same way. The world calls it every time the snapshot
// changes and once a second besides, and gets calm, stable answers: someone at a desk stays at
// that desk for the whole task, someone sunbathing stays on that lounger for a while.
//
// Off duty, crew form little groups (two to four, at the bar, a table, the hot tub or the rail)
// that trade lines (banter.ts) and break up again after a minute or so; when nobody is working one
// of them may play bartender. When the captain hands out work, everyone who gets some scrambles:
// a wave of buzzing phones, then a run to their desks, each a beat after the last.

/** What the director reads about each crew member: a row of world.snapshot. */
export interface CrewView {
  _id: string;
  name: string;
  handle: string;
  role: "computer" | "crew";
  arrivesAt: number;
  live: {
    runId: string;
    kind: "computer" | "task" | "look";
    state: string;
    threadTitle: string | null;
    taskTitle: string | null;
    step: { kind: string; summary: string; since: number } | null;
  } | null;
  lastEnded: { state: string; endedAt: number; taskTitle?: string | null; taskId?: string | null; threadId?: string | null; diff?: { added: number; removed: number; files: number } | null } | null;
  lastStep: string | null;
  asking: boolean;
}

/** Poses the kit knows (packages/kit/src/avatar acts); the game maps any it lacks to the nearest. */
export type Act =
  | "type" | "laptop" | "lounge-laptop" | "sunbathe" | "hammock" | "fish" | "carry" | "slump" | "think"
  | "celebrate" | "rail" | "swim" | "soak" | "stool" | "wave" | "stand"
  | "drink" | "sit-drink" | "lean-back" | "nap" | "nap-hammock" | "nap-chair" | "dance" | "cards" | "selfie"
  | "stretch" | "bartend" | "huddle" | "pace" | "sofa" | "hammock-rest" | "mingle" | "jog" | "sauna" | "tinker"
  | "lift" | "lift-bench";

export type Prop = "laptop" | "box" | "rod" | "drink";

export type Gait = "run" | "walk" | "stroll";

export interface Hangout {
  id: string;
  mood: GroupMood;
  /** Everyone in the conversation (the bartender first, at the bar). */
  members: string[];
  formedAt: number;
  /** Where they gather: what they face. */
  centre: Vec3;
}

export interface Direction {
  crewId: string;
  activity: CrewActivity;
  /** False while they are still in the helicopter. */
  visible: boolean;
  /** Where they appear the first time they are visible (just off the helipad, for new arrivals). */
  spawnSlot: string | null;
  target: { kind: "slot"; slotId: string } | { kind: "captain" } | { kind: "none" };
  /** The pose on the way there, when it isn't plain walking (carrying a package). */
  walkAct: Act | null;
  /** The pose once there. */
  act: Act;
  props: Prop[];
  marker: "asking" | null;
  /** The nameplate's second line: "Editing · Settings toggle". */
  label: string;
  /** Walking a finished task's package to the drop-off (it isn't on the counter yet). */
  carrying: boolean;
  /** What their screen shows (the laptop, or the desk's monitor), when they have one. */
  screen: string[] | null;
  /** How they get there: running to work when it's handed out, strolling off duty. */
  gait: Gait;
  /** They were off duty and just got work: their phone buzzes `delay` ms after `at`, then they run. */
  scramble: { at: number; delay: number; rank: number } | null;
  /** Points to walk after the graph and before the slot (round behind the bar). */
  approach: Vec3[] | null;
  /** The hangout they are part of, off duty. */
  group: Hangout | null;
  /** Someone else is at their desk, looking at their screen with them. */
  company: string | null;
}

export interface ComputerDirection {
  crewId: string;
  slotId: string | null;
  mood: "idle" | "think" | "focus" | "idea" | "greet" | "proud" | "sad";
  screen: string[];
}

const LEISURE_ROTATE_MS = 4 * 60_000;
/** Group decisions happen once per bucket, so they don't depend on how often plan is called. */
export const BUCKET_MS = 4000;
/** Crew who get work within this long of the first one run in the same wave. */
const WAVE_WINDOW_MS = 2500;
/** The gap between one runner and the next in a wave. */
export const WAVE_STEP_MS = 240;
const SCRAMBLE_MS = 30_000;
const BARTENDER_MS = 2 * 60_000;
/** A cheers waits this long for the next one done. */
const CHEERS_WAIT_MS = 100_000;
/** Roughly this share of the off-duty crew are in a group at any time. */
const GROUP_SHARE = 0.6;

const bucketOf = (t: number) => Math.floor(t / BUCKET_MS) * BUCKET_MS;
/** The first bucket boundary at or after t. */
const bucketAfter = (t: number) => Math.ceil(t / BUCKET_MS) * BUCKET_MS;

/** A stable number from a string, for per-person habits. */
function strHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Where someone likes to work: most at desks, some on a lounger with a laptop, a few in a hammock. */
export function workHabit(handle: string): SlotKind[] {
  const r = (strHash(handle) % 100) / 100;
  if (r < 0.55) return ["desk", "lounger", "deck-chair", "hammock"];
  if (r < 0.85) return ["lounger", "deck-chair", "desk", "hammock"];
  return ["hammock", "lounger", "desk", "deck-chair"];
}

function workAct(kind: SlotKind | undefined, activity: CrewActivity, crewId: string, now: number): Act {
  if (kind === "desk") {
    if (activity === "thinking" || activity === "reading") {
      // Thinking: hand on chin, or up and pacing behind the chair for a while.
      return activity === "thinking" && rand(crewId, Math.floor(now / 15_000), "pace") < 0.5 ? "pace" : "think";
    }
    return "type";
  }
  if (kind === "lounger") return "lounge-laptop";
  if (kind === "hammock") return "hammock";
  return "laptop";
}

const has = (s: Slot | undefined, tag: string) => !!s?.tags?.includes(tag);

/** What someone does on their own at a spot. `r` (0..1) is theirs for as long as they stay. */
export function soloAct(slot: Slot | undefined, r: number): { act: Act; props: Prop[]; pastime: string } {
  const kind = slot?.kind;
  switch (kind) {
    case "lounger": return r < 0.4 ? { act: "nap", props: [], pastime: "napping" } : { act: "sunbathe", props: [], pastime: "sunbathing" };
    case "pool": return { act: "swim", props: [], pastime: "swimming" };
    case "hot-tub": return { act: "soak", props: [], pastime: "in the hot tub" };
    case "bar-stool": return { act: "stool", props: ["drink"], pastime: "at the bar" };
    case "hammock": return r < 0.6 ? { act: "nap-hammock", props: [], pastime: "napping" } : { act: "hammock-rest", props: [], pastime: "swinging" };
    case "fishing": return { act: "fish", props: ["rod"], pastime: "fishing" };
    case "rail":
      if (r < 0.45) return { act: "rail", props: [], pastime: "watching the sea" };
      if (r < 0.65) return { act: "selfie", props: [], pastime: "taking selfies" };
      if (r < 0.82) return { act: "stretch", props: [], pastime: "stretching" };
      return { act: "dance", props: [], pastime: "dancing" };
    // A treadmill: a jog; the bench and the rack: curls; anywhere else in the gym, a stretch.
    case "gym":
      if (has(slot, "run")) return { act: "jog", props: [], pastime: "on the treadmill" };
      if (has(slot, "bench")) return { act: "lift-bench", props: [], pastime: "lifting" };
      if (has(slot, "weights")) return r < 0.7 ? { act: "lift", props: [], pastime: "lifting" } : { act: "stretch", props: [], pastime: "stretching" };
      return r < 0.5 ? { act: "jog", props: [], pastime: "working out" } : { act: "stretch", props: [], pastime: "stretching" };
    // Bean bags and the sofa have their own seat heights (Slot.seat): sunk in, or asleep in the dark.
    case "cinema": return r < 0.25 ? { act: "nap-chair", props: [], pastime: "asleep at the movies" } : { act: "sofa", props: [], pastime: "at the movies" };
    case "sauna": return { act: "sauna", props: [], pastime: "in the sauna" };
    case "workshop": return { act: "tinker", props: [], pastime: "tinkering" };
    // Leaning on the rail round the core, or (by the racks, where there's no rail) just watching it.
    case "core": return slot?.id.includes("aisle") || r < 0.4 ? { act: "mingle", props: [], pastime: "watching the core" } : { act: "rail", props: [], pastime: "watching the core" };
    case "deck-chair":
      if (r < 0.35) return { act: "nap-chair", props: [], pastime: "napping" };
      if (r < 0.7) return { act: "sit-drink", props: ["drink"], pastime: "having a drink" };
      return { act: "sofa", props: [], pastime: "taking it easy" };
    default: return { act: "stand", props: [], pastime: "off duty" };
  }
}

// ---------- places to hang out ----------

type SpotKind = "bar" | "tub" | "table" | "rail";

interface Bar {
  stools: Slot[];      // round the counter, in order
  centre: Vec3;
  bartender: Slot;
  approach: Vec3[] | null;
}

interface Group {
  id: string;
  spot: SpotKind;
  mood: GroupMood;
  formedAt: number;
  until: number;
  centre: Vec3;
  /** Where each member is: a real slot, or a standing spot made for the group. */
  seatOf: Map<string, Slot>;
  /** Real slots it holds (stools, seats, the rail) for as long as it lasts. */
  reserves: Set<string>;
  /** Its places, in the order members take them. */
  pool: Slot[];
  /** In the order they joined. */
  members: string[];
}

const yawTo = (from: Vec3, to: Vec3) => Math.atan2(to[0] - from[0], to[2] - from[2]);
const dir = (yaw: number): [number, number] => [Math.sin(yaw), Math.cos(yaw)];
const angleDelta = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const dist2 = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[2] - b[2]);

/** The point nearest every stool's line of sight: the middle of a round bar. */
function fitCentre(stools: Slot[]): Vec3 | null {
  let a = 0, b = 0, c = 0, bx = 0, bz = 0;
  for (const s of stools) {
    const [dx, dz] = dir(s.facing);
    // (I - d dᵀ) for this line, accumulated.
    const m00 = 1 - dx * dx, m01 = -dx * dz, m11 = 1 - dz * dz;
    a += m00; b += m01; c += m11;
    bx += m00 * s.pos[0] + m01 * s.pos[2];
    bz += m01 * s.pos[0] + m11 * s.pos[2];
  }
  const det = a * c - b * b;
  if (Math.abs(det) < 1e-3) return null;
  return [(c * bx - b * bz) / det, stools[0]!.pos[1], (a * bz - b * bx) / det];
}

/**
 * Bar stools that stand together: on one deck, each within reach of the next. A ship can have
 * several bars (a round one on deck, a straight one in the galley); each is its own cluster.
 */
export function stoolClusters(slots: Slot[]): Slot[][] {
  const left = slots.filter((s) => s.kind === "bar-stool");
  const out: Slot[][] = [];
  while (left.length) {
    const group = [left.shift()!];
    for (let i = 0; i < group.length; i++) {
      for (let j = left.length - 1; j >= 0; j--) {
        const a = group[i]!, b = left[j]!;
        if (Math.abs(a.pos[1] - b.pos[1]) < 0.3 && dist2(a.pos, b.pos) < 2.5) group.push(...left.splice(j, 1));
      }
    }
    out.push(group);
  }
  return out;
}

function findBar(slots: Slot[]): Bar | null {
  // The round bar: the biggest cluster of stools whose lines of sight meet over one point.
  let raw: Slot[] = [], found: Vec3 | null = null;
  for (const c of stoolClusters(slots).sort((a, b) => b.length - a.length)) {
    if (c.length < 3) break;
    const at = fitCentre(c);
    if (!at) continue;
    const r = c.reduce((n, s) => n + dist2(s.pos, at), 0) / c.length;
    const facingIn = c.every((s) => { const [dx, dz] = dir(s.facing); return (dx * (at[0] - s.pos[0]) + dz * (at[2] - s.pos[2])) / Math.max(1e-3, dist2(s.pos, at)) > 0.8; });
    if (r < 1.2 || r > 6 || !facingIn) continue;
    raw = c;
    found = at;
    break;
  }
  if (!found) return null;
  const centre = found;
  const angle = (s: Slot) => Math.atan2(s.pos[2] - centre[2], s.pos[0] - centre[0]);
  const stools = [...raw].sort((p, q) => angle(p) - angle(q));
  const tagged = slots.find((s) => has(s, "bartender"));
  if (tagged) return { stools, centre, bartender: tagged, approach: null };
  // Behind the counter, facing the stools; in through the side without stools.
  const r = stools.reduce((n, s) => n + dist2(s.pos, centre), 0) / stools.length;
  let mx = 0, mz = 0;
  for (const s of stools) { mx += s.pos[0] - centre[0]; mz += s.pos[2] - centre[2]; }
  const ml = Math.hypot(mx, mz);
  if (ml < 1e-3) return null;
  const u: [number, number] = [mx / ml, mz / ml];
  const inner = r * 0.52, y = centre[1];
  const at = (ang: number, rad: number): Vec3 => [centre[0] + Math.cos(ang) * rad, y, centre[2] + Math.sin(ang) * rad];
  const out = Math.atan2(-u[1], -u[0]);
  const approach: Vec3[] = [at(out, r + 0.8), at(out, inner)];
  for (let k = 1; k < 4; k++) approach.push(at(out + (k * Math.PI) / 4, inner));
  const pos = at(out + Math.PI, inner);
  const bartender: Slot = { id: "bartender", kind: "bar-stool", pos, facing: Math.atan2(u[0], u[1]), nav: stools[Math.floor(stools.length / 2)]!.nav, tags: ["bar"] };
  return { stools, centre, bartender, approach };
}

/** Seats whose lines of sight meet over one spot (chairs round a coffee table), or tagged tables. */
function findTables(slots: Slot[]): Slot[][] {
  const seats = slots.filter((s) => s.kind === "deck-chair" || has(s, "table") || has(s, "mess"));
  const ahead = (s: Slot): Vec3 => { const [dx, dz] = dir(s.facing); return [s.pos[0] + dx * 1.1, s.pos[1], s.pos[2] + dz * 1.1]; };
  const out: Slot[][] = [];
  const used = new Set<string>();
  for (const s of seats) {
    if (used.has(s.id)) continue;
    const set = seats.filter((o) => !used.has(o.id) && Math.abs(o.pos[1] - s.pos[1]) < 0.3 && dist2(ahead(o), ahead(s)) < 2.2 && dist2(o.pos, s.pos) < 4.2);
    if (set.length < 2) continue;
    for (const o of set.slice(0, 4)) used.add(o.id);
    out.push(set.slice(0, 4));
  }
  return out;
}

/** Standing spots for n people round a point just inboard of a rail slot, facing in. */
function railCircle(rail: Slot, n: number): { centre: Vec3; spots: { pos: Vec3; facing: number; atRail: boolean }[] } {
  const [ox, oz] = dir(rail.facing); // out to sea
  const centre: Vec3 = [rail.pos[0] - ox * 0.75, rail.pos[1], rail.pos[2] - oz * 0.75];
  const rad = n >= 4 ? 0.85 : 0.75;
  const base = Math.atan2(ox, oz);
  const offsets = n === 2 ? [0, Math.PI] : n === 3 ? [0, (2 * Math.PI) / 3, (-2 * Math.PI) / 3] : [Math.PI / 4, (3 * Math.PI) / 4, (-3 * Math.PI) / 4, -Math.PI / 4];
  const spots = offsets.slice(0, n).map((o) => {
    const [dx, dz] = dir(base + o);
    const pos: Vec3 = [centre[0] + dx * rad, centre[1], centre[2] + dz * rad];
    return { pos, facing: yawTo(pos, centre), atRail: Math.abs(o) < 0.5 };
  });
  return { centre, spots };
}

export interface DirectorOptions {
  /** Whether a body can stand at p, coming from `from` (a standing spot made up for a group). Default: yes. */
  walkable?: (p: Vec3, from: Vec3) => boolean;
}

export class Director {
  private readonly byId = new Map<string, Slot>();
  /** Spots the director made up: standing in a group, behind the bar, beside a desk. */
  private readonly made = new Map<string, Slot>();
  /** crewId → the slot they hold, and what for. */
  private readonly seats = new Map<string, { slotId: string; mode: "work" | "leisure" | "dropoff"; since: number }>();
  /** A delivery in progress: it finishes (walk there, celebrate a moment) even if "just landed" runs out on the way. */
  private readonly errands = new Map<string, { deliveredAt: number | null }>();
  /** On duty or off, and since when; who just got work; who just finished. */
  private readonly duty = new Map<string, { on: boolean; since: number }>();
  private readonly scrambles = new Map<string, { at: number; delay: number; rank: number }>();
  private wave: { at: number; size: number } | null = null;
  private readonly doneAt = new Map<string, number>();
  private readonly cooling = new Map<string, number>();
  private readonly groups = new Map<string, Group>();
  private bartender: { crewId: string; until: number } | null = null;
  private bucket = -1;
  private planned = false;
  private groupSeq = 0;
  static readonly CELEBRATE_MS = 6000;

  private readonly slots: Slot[];
  private readonly bar: Bar | null;
  private readonly tubSeats: Slot[];
  private readonly tables: Slot[][];
  private readonly rails: Slot[];
  private readonly walkable: (p: Vec3, from: Vec3) => boolean;

  constructor(slots: Slot[], o: DirectorOptions = {}) {
    this.slots = slots;
    for (const s of slots) this.byId.set(s.id, s);
    this.walkable = o.walkable ?? (() => true);
    this.bar = findBar(slots);
    if (this.bar && !this.byId.has(this.bar.bartender.id)) this.made.set(this.bar.bartender.id, this.bar.bartender);
    const tub = slots.filter((s) => s.kind === "hot-tub");
    if (tub.length) {
      const cx = tub.reduce((n, s) => n + s.pos[0], 0) / tub.length, cz = tub.reduce((n, s) => n + s.pos[2], 0) / tub.length;
      this.tubSeats = [...tub].sort((p, q) => Math.atan2(p.pos[2] - cz, p.pos[0] - cx) - Math.atan2(q.pos[2] - cz, q.pos[0] - cx));
    } else this.tubSeats = [];
    this.tables = findTables(slots);
    this.rails = slots.filter((s) => s.kind === "rail");
  }

  /** A slot by id: the world's own, or one the director made up. */
  slot(id: string): Slot | undefined { return this.byId.get(id) ?? this.made.get(id); }

  /** The game says they reached the drop-off with their package. */
  delivered(crewId: string, now: number) {
    const e = this.errands.get(crewId);
    if (e && e.deliveredAt === null) e.deliveredAt = now;
  }

  /** What a hangout is saying around `now` (banter.ts), for the game to show. */
  beat(g: Hangout, now: number): Beat | null {
    return beatAt(g.id, g.members, g.formedAt, g.mood, now);
  }

  private taken(except: string): Set<string> {
    const t = new Set<string>();
    for (const [crewId, seat] of this.seats) if (crewId !== except) t.add(seat.slotId);
    for (const g of this.groups.values()) for (const id of g.reserves) t.add(id);
    if (this.bartender) t.add(this.bar!.bartender.id);
    return t;
  }

  /** The first free slot of the first kind in `kinds` that has one, spread out by a per-person offset. */
  private freeSlot(crewId: string, kinds: readonly SlotKind[], salt = 0): Slot | null {
    const taken = this.taken(crewId);
    for (const kind of kinds) {
      const free = this.slots.filter((s) => s.kind === kind && !taken.has(s.id));
      if (free.length) return free[(strHash(crewId) + salt) % free.length]!;
    }
    return null;
  }

  private hold(crewId: string, slot: Slot | null, mode: "work" | "leisure" | "dropoff", now: number): Slot | null {
    // Leisure is timed by the clock's buckets, so it doesn't matter how often we're asked.
    if (slot) this.seats.set(crewId, { slotId: slot.id, mode, since: mode === "leisure" ? bucketOf(now) : now });
    else this.seats.delete(crewId);
    return slot;
  }

  private activityOf(c: CrewView, now: number): CrewActivity {
    let activity = crewActivity({
      now,
      arrivesAt: c.arrivesAt,
      live: c.live && { state: c.live.state as RunState },
      openItem: c.live?.step ? { kind: c.live.step.kind } : null,
      asking: c.asking,
      lastEnded: c.lastEnded && { state: c.lastEnded.state as RunState, endedAt: c.lastEnded.endedAt },
    });
    // New work or a question beats a delivery; otherwise a delivery under way keeps going.
    const errand = this.errands.get(c._id);
    if (activity === "landed" && !errand) this.errands.set(c._id, { deliveredAt: null });
    else if (errand && activity !== "landed") {
      const done = errand.deliveredAt !== null && now - errand.deliveredAt > Director.CELEBRATE_MS;
      if (isWorking(activity) || activity === "asking" || done) this.errands.delete(c._id);
      else activity = "landed";
    }
    return activity;
  }

  plan(crew: CrewView[], now: number): Direction[] {
    const present = new Set(crew.map((c) => c._id));
    for (const m of [this.seats, this.errands, this.duty, this.scrambles, this.doneAt, this.cooling] as Map<string, unknown>[]) {
      for (const id of [...m.keys()]) if (!present.has(id)) m.delete(id);
    }
    const members = crew.filter((c) => c.role === "crew");
    const acts = new Map<string, CrewActivity>();
    for (const c of members) acts.set(c._id, this.activityOf(c, now));
    const visible = (c: CrewView) => now >= c.arrivesAt + ARRIVAL.stepOutMs;

    this.trackDuty(members, acts, now);
    const offDuty = members.filter((c) => acts.get(c._id) === "idle" && visible(c)).map((c) => c._id).sort();
    const offSet = new Set(offDuty);
    const anyWorking = members.some((c) => isWorking(acts.get(c._id)!));
    this.tidyGroups(offSet, now);
    this.castBartender(offDuty, anyWorking, now);
    this.cheersForTheDone(offDuty, now);
    const bucket = Math.floor(now / BUCKET_MS);
    if (bucket !== this.bucket) {
      this.bucket = bucket;
      this.formGroups(offDuty, now, !this.planned);
    }
    this.planned = true;

    // Workers choose first, so a desk is never taken by someone just sunbathing.
    const order = [...members].sort((a, b) => Number(!!b.live) - Number(!!a.live));
    const out: Direction[] = [];
    const deskOf = new Map<string, Slot>();
    for (const c of order) {
      const d = this.direct(c, acts.get(c._id)!, now);
      out.push(d);
      const s = d.target.kind === "slot" ? this.slot(d.target.slotId) : undefined;
      if (s?.kind === "desk" && isWorking(d.activity)) deskOf.set(c._id, s);
    }
    this.huddles(order, out, deskOf, now);
    return out;
  }

  // ---------- on and off duty ----------

  private trackDuty(crew: CrewView[], acts: Map<string, CrewActivity>, now: number) {
    const joined: { id: string; z: number }[] = [];
    for (const c of crew) {
      const a = acts.get(c._id)!;
      const on = a !== "idle" && a !== "arriving";
      const was = this.duty.get(c._id);
      if (!was) { this.duty.set(c._id, { on, since: now }); continue; }
      if (was.on === on) continue;
      this.duty.set(c._id, { on, since: now });
      if (on && isWorking(a)) {
        // Off duty, and now there's work: run for it.
        const at = this.whereIs(c._id);
        joined.push({ id: c._id, z: at ? at.pos[2] : 0 });
      } else if (!on) {
        this.doneAt.set(c._id, now);
        this.scrambles.delete(c._id);
      }
    }
    if (!joined.length) {
      for (const [id, s] of this.scrambles) if (now - s.at > SCRAMBLE_MS) this.scrambles.delete(id);
      return;
    }
    if (!this.wave || now - this.wave.at > WAVE_WINDOW_MS) this.wave = { at: now, size: 0 };
    // Nearest the bridge first (forward is -z), so the news travels down the ship.
    joined.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : 1));
    for (const j of joined) {
      const rank = this.wave.size++;
      // Everyone's buzz is a step after the one before, counted from the start of the wave.
      const delay = Math.max(0, this.wave.at + rank * WAVE_STEP_MS - now) + (hash(j.id, this.wave.at) % 90);
      this.scrambles.set(j.id, { at: now, delay, rank });
    }
  }

  /** Where someone is spending their time off: behind the bar, in a group, or their own seat. */
  private whereIs(crewId: string): Slot | undefined {
    if (this.bartender?.crewId === crewId) return this.bar?.bartender;
    const g = this.groupOf(crewId)?.seatOf.get(crewId);
    if (g) return g;
    const seat = this.seats.get(crewId);
    return seat ? this.slot(seat.slotId) : undefined;
  }

  // ---------- hangouts ----------

  private dissolve(g: Group, now: number) {
    this.groups.delete(g.id);
    for (const m of g.members) {
      this.cooling.set(m, bucketAfter(now + 20_000 + (hash(m, g.id) % 15_000)));
      // Off to somewhere new on their own.
      this.seats.delete(m);
    }
  }

  private tidyGroups(off: Set<string>, now: number) {
    for (const g of [...this.groups.values()]) {
      g.members = g.members.filter((m) => off.has(m));
      for (const m of [...g.seatOf.keys()]) if (!g.members.includes(m)) g.seatOf.delete(m);
      const waiting = g.mood === "cheers" && g.members.length === 1 && now - g.formedAt < CHEERS_WAIT_MS;
      if (now >= g.until || (g.members.length < 2 && !waiting)) this.dissolve(g, now);
    }
    if (this.bartender && !off.has(this.bartender.crewId)) this.bartender = null;
  }

  private groupOf(crewId: string): Group | undefined {
    for (const g of this.groups.values()) if (g.members.includes(crewId)) return g;
    return undefined;
  }

  private castBartender(off: string[], anyWorking: boolean, now: number) {
    if (!this.bar) return;
    if (this.bartender && (anyWorking || now >= this.bartender.until)) {
      this.cooling.set(this.bartender.crewId, bucketAfter(now + 30_000));
      this.seats.delete(this.bartender.crewId);
      this.bartender = null;
    }
    if (this.bartender || anyWorking || off.length < 3) return;
    const period = Math.floor(now / BARTENDER_MS);
    if (rand("bartender", period) > 0.75) return;
    const free = off.filter((id) => !this.groupOf(id));
    if (!free.length) return;
    const crewId = [...free].sort((a, b) => hash(a, period) - hash(b, period))[0]!;
    this.bartender = { crewId, until: (period + 1) * BARTENDER_MS };
    this.seats.delete(crewId);
  }

  /** The first one done grabs a drink; the next one done joins them for a toast. */
  private cheersForTheDone(off: string[], now: number) {
    for (const id of off) {
      const done = this.doneAt.get(id);
      if (done === undefined) continue;
      this.doneAt.delete(id);
      if (now - done > 5000 || this.groupOf(id) || this.bartender?.crewId === id) continue;
      const open = [...this.groups.values()].find((g) => g.mood === "cheers" && g.members.length < 3 && now - g.formedAt < CHEERS_WAIT_MS);
      if (open) {
        const used = new Set([...open.seatOf.values()].map((s) => s.id));
        const spot = open.pool.find((s) => !used.has(s.id));
        if (!spot) continue;
        this.seats.delete(id);
        open.members.push(id);
        open.seatOf.set(id, spot);
        // The toast is now.
        open.formedAt = now;
        open.until = bucketAfter(now + 50_000);
        continue;
      }
      if (rand(id, done, "cheers") < 0.25) continue; // not everyone fancies a drink
      const g = this.makeGroup([id], now, ["bar", "rail"], "cheers");
      if (g) g.until = bucketAfter(now + CHEERS_WAIT_MS + 50_000);
    }
  }

  private formGroups(off: string[], now: number, first: boolean) {
    const grouped = new Set([...this.groups.values()].flatMap((g) => g.members));
    const eligible = off.filter((id) => {
      if (grouped.has(id) || this.bartender?.crewId === id) return false;
      if ((this.cooling.get(id) ?? 0) > now) return false;
      const seat = this.seats.get(id);
      return first || !seat || seat.mode !== "leisure" || now - seat.since > 15_000;
    });
    const target = Math.floor(off.length * GROUP_SHARE);
    let have = grouped.size;
    let formed = 0;
    const pool = shuffled(eligible, hash("form", this.bucket));
    while (have < target && pool.length >= 2 && formed < (first ? 8 : 1)) {
      if (!first && rand("form", this.bucket, formed) > 0.7) break;
      const want = 2 + (hash("size", this.bucket, formed) % 3);
      const size = Math.min(want, pool.length);
      const kinds = shuffled<SpotKind>(this.bartender ? ["bar", "bar", "tub", "table", "rail", "rail"] : ["bar", "tub", "table", "rail", "rail", "rail"], hash("spot", this.bucket, formed));
      const g = this.makeGroup(pool.slice(0, size), now, [...new Set(kinds)], null);
      if (!g) break;
      for (const m of g.members) pool.splice(pool.indexOf(m), 1);
      have += g.members.length;
      formed++;
    }
  }

  /** A group of these crew at the first kind of spot that has room. */
  private makeGroup(who: string[], now: number, kinds: SpotKind[], mood: GroupMood | null): Group | null {
    const taken = new Set<string>();
    for (const [crewId, seat] of this.seats) if (!who.includes(crewId)) taken.add(seat.slotId);
    for (const g of this.groups.values()) for (const id of g.reserves) taken.add(id);
    const id = `g${++this.groupSeq}`;
    const seed = hash(id, now);
    const need = mood === "cheers" ? 3 : who.length;
    for (const kind of kinds) {
      let seats: Slot[] | null = null, centre: Vec3 | null = null, gmood: GroupMood = mood ?? "chat", railId: string | null = null;
      if (kind === "bar" && this.bar) {
        const n = this.bar.stools.length;
        const starts = shuffled([...Array(n).keys()], seed);
        for (const s of starts) {
          if (s + need > n) continue;
          const run = this.bar.stools.slice(s, s + need);
          if (run.some((x) => taken.has(x.id))) continue;
          seats = run;
          break;
        }
        if (seats) {
          centre = [seats.reduce((n, s) => n + s.pos[0], 0) / seats.length, seats[0]!.pos[1], seats.reduce((n, s) => n + s.pos[2], 0) / seats.length];
          // Turned on the stool toward each other, a little.
          const c = centre;
          seats = seats.map((s) => {
            const turn = Math.max(-0.9, Math.min(0.9, angleDelta(s.facing, yawTo(s.pos, c)) * 0.6));
            const v: Slot = { ...s, id: `${s.id}~g`, facing: s.facing + (dist2(s.pos, c) > 0.2 ? turn : 0) };
            this.made.set(v.id, v);
            return v;
          });
          centre = this.bartender ? this.bar.bartender.pos : this.bar.centre;
          if (!mood) gmood = this.bartender ? "bar" : "chat";
        }
      } else if (kind === "tub" && this.tubSeats.length >= need) {
        const n = this.tubSeats.length;
        for (const s of shuffled([...Array(n).keys()], seed)) {
          const run = Array.from({ length: need }, (_, k) => this.tubSeats[(s + k) % n]!);
          if (run.some((x) => taken.has(x.id))) continue;
          seats = run;
          break;
        }
        if (seats) {
          const all = this.tubSeats;
          centre = [all.reduce((n, s) => n + s.pos[0], 0) / all.length, seats[0]!.pos[1], all.reduce((n, s) => n + s.pos[2], 0) / all.length];
          if (!mood) gmood = "tub";
        }
      } else if (kind === "table" && mood !== "cheers") {
        const fits = shuffled(this.tables, seed).find((t) => t.length >= need && t.every((x) => !taken.has(x.id)));
        if (fits) {
          seats = fits.slice(0, need);
          centre = [seats.reduce((n, s) => n + s.pos[0], 0) / seats.length, seats[0]!.pos[1], seats.reduce((n, s) => n + s.pos[2], 0) / seats.length];
          gmood = "cards";
        }
      } else if (kind === "rail") {
        for (const rail of shuffled(this.rails, seed)) {
          if (taken.has(rail.id)) continue;
          const { centre: c, spots } = railCircle(rail, Math.min(4, Math.max(2, need)));
          if (!spots.every((s) => this.walkable(s.pos, c))) continue;
          seats = spots.map((s, i) => {
            const v: Slot = { id: `${id}:${i}`, kind: "rail", pos: s.pos, facing: s.facing, nav: rail.nav, tags: s.atRail ? ["at-rail"] : [] };
            this.made.set(v.id, v);
            return v;
          });
          centre = c;
          if (!mood) gmood = rand(id, "dance") < 0.22 ? "dance" : "chat";
          railId = rail.id;
          break;
        }
      }
      if (!seats || !centre) continue;
      const reserves = new Set(seats.map((s) => s.id.replace(/~g$/, "")).filter((x) => this.byId.has(x)));
      if (railId) reserves.add(railId);
      const g: Group = {
        id, spot: kind, mood: gmood, formedAt: now, until: bucketAfter(now + 45_000 + (hash(id, "life") % 50_000)), centre,
        seatOf: new Map(), reserves, pool: seats, members: [],
      };
      who.forEach((m, i) => {
        g.members.push(m);
        g.seatOf.set(m, seats![i]!);
        this.seats.delete(m);
      });
      this.groups.set(id, g);
      return g;
    }
    return null;
  }

  private hangout(g: Group): Hangout {
    // The bartender talks with one group across the bar at a time: the one that's been there longest.
    const first = [...this.groups.values()].find((x) => x.mood === "bar");
    const talkers = g.mood === "bar" && this.bartender && first === g ? [this.bartender.crewId, ...g.members] : [...g.members];
    const withBarkeep = talkers.length > g.members.length;
    return { id: g.id, mood: g.mood === "bar" && !withBarkeep ? "chat" : g.mood, members: talkers, formedAt: g.formedAt, centre: g.centre };
  }

  // ---------- someone at your desk ----------

  /** sync_with_team: walk over to a teammate's desk and look at their screen with them. */
  private huddles(order: CrewView[], out: Direction[], deskOf: Map<string, Slot>, now: number) {
    out.forEach((d, i) => {
      const c = order[i]!;
      const step = c.live?.step;
      if (!step || step.kind !== "offsite" || !/sync/i.test(step.summary) || !isWorking(d.activity)) return;
      const mates = [...deskOf.entries()].filter(([id]) => id !== c._id);
      if (!mates.length) return;
      const thread = c.live?.threadTitle;
      const mine = d.target.kind === "slot" ? this.slot(d.target.slotId) : undefined;
      const score = ([id, s]: [string, Slot]) => {
        const same = order.find((x) => x._id === id)?.live?.threadTitle === thread ? 0 : 1000;
        return same + (mine ? dist2(mine.pos, s.pos) : 0) + (hash(id, step.since) % 7) * 0.01;
      };
      const [mateId, desk] = mates.sort((a, b) => score(a) - score(b))[0]!;
      const [fx, fz] = dir(desk.facing);
      const side = hash(c._id, desk.id) % 2 ? 1 : -1;
      const pos: Vec3 = [desk.pos[0] + fz * 0.62 * side - fx * 0.3, desk.pos[1], desk.pos[2] - fx * 0.62 * side - fz * 0.3];
      const screen: Vec3 = [desk.pos[0] + fx * 0.8, desk.pos[1], desk.pos[2] + fz * 0.8];
      const spot: Slot = { id: `huddle:${desk.id}`, kind: "desk", pos, facing: yawTo(pos, screen), nav: desk.nav, tags: ["office"] };
      this.made.set(spot.id, spot);
      d.target = { kind: "slot", slotId: spot.id };
      d.act = "huddle";
      d.props = [];
      const mate = out.find((x) => x.crewId === mateId);
      if (mate) mate.company = c._id;
      void now;
    });
  }

  // ---------- one crew member ----------

  private direct(c: CrewView, activity: CrewActivity, now: number): Direction {
    const title = c.live?.taskTitle ?? c.live?.threadTitle ?? null;
    const short = title && title.length > 26 ? `${title.slice(0, 25).replace(/\s+\S*$/, "")}…` : title;
    const doneTitle = c.lastEnded?.taskTitle;
    // On the way to the drop-off with the package: "Delivering"; once it's on the counter, "Delivered".
    const carrying = activity === "landed" && (this.errands.get(c._id)?.deliveredAt ?? null) === null;
    const landedWord = carrying ? "Delivering" : ACTIVITY_LABEL.landed;
    const label = short && isWorking(activity) ? `${ACTIVITY_LABEL[activity]} · ${short}`
      : activity === "landed" && doneTitle ? `${landedWord} · ${doneTitle.length > 26 ? `${doneTitle.slice(0, 25).replace(/\s+\S*$/, "")}…` : doneTitle}`
      : activity === "landed" ? landedWord
      : ACTIVITY_LABEL[activity];
    const recentArrival = now - c.arrivesAt < 90_000;
    const spawn = recentArrival ? this.slots.find((s) => s.kind === "crew-spawn")?.id ?? null : null;
    const visible = now >= c.arrivesAt + ARRIVAL.stepOutMs;
    const scramble = isWorking(activity) ? this.scrambles.get(c._id) ?? null : null;
    const base = {
      crewId: c._id, activity, visible, spawnSlot: spawn, walkAct: null, marker: null, label, carrying,
      gait: (scramble && now - scramble.at < SCRAMBLE_MS ? "run" : activity === "idle" ? "stroll" : "walk") as Gait,
      scramble, approach: null, group: null, company: null,
    } as const;
    const seat = this.seats.get(c._id);
    const current = seat ? this.slot(seat.slotId) : undefined;

    if (activity === "arriving") {
      return { ...base, target: { kind: "none" }, act: "stand", props: [], screen: null };
    }

    if (activity === "asking") {
      // Keep their seat to come back to; go find the captain.
      return { ...base, target: { kind: "captain" }, act: "wave", props: [], marker: "asking", screen: null };
    }

    if (isWorking(activity) || activity === "failed") {
      let slot = seat?.mode === "work" ? current ?? null : null;
      if (!slot) slot = this.hold(c._id, this.freeSlot(c._id, workHabit(c.handle)), "work", now);
      const act = activity === "failed" ? "slump" : workAct(slot?.kind, activity, c._id, now);
      const step = c.live?.step?.summary ?? c.lastStep;
      return {
        ...base,
        target: slot ? { kind: "slot", slotId: slot.id } : { kind: "none" },
        act,
        props: slot?.kind === "desk" ? [] : ["laptop"],
        screen: [c.name, title ?? "", step ?? ""].filter(Boolean),
      };
    }

    if (activity === "landed") {
      let slot = seat?.mode === "dropoff" ? current ?? null : null;
      slot ??= this.hold(c._id, this.freeSlot(c._id, ["dropoff"]), "dropoff", now);
      return { ...base, target: slot ? { kind: "slot", slotId: slot.id } : { kind: "none" }, walkAct: "carry", act: "celebrate", props: ["box"], screen: null };
    }

    // Off duty: behind the bar, in a group, or somewhere on their own.
    if (this.bartender?.crewId === c._id && this.bar) {
      const bt = this.bar.bartender;
      return {
        ...base, label: `${ACTIVITY_LABEL.idle} · bartending`, target: { kind: "slot", slotId: bt.id }, act: "bartend", props: [], screen: null,
        approach: this.bar.approach,
      };
    }
    const g = this.groupOf(c._id);
    const spot = g?.seatOf.get(c._id);
    if (g && spot) {
      const { act, props, pastime } = this.groupAct(g, spot, c._id);
      return { ...base, label: `${ACTIVITY_LABEL.idle} · ${pastime}`, target: { kind: "slot", slotId: spot.id }, act, props, screen: null, group: this.hangout(g) };
    }
    let slot: Slot | null = null;
    if (seat?.mode === "leisure" && current && now - seat.since < LEISURE_ROTATE_MS) slot = current;
    if (!slot) {
      const kinds = ACTIVITY_SPOTS.idle;
      const turn = Math.floor(now / LEISURE_ROTATE_MS) + (strHash(c.handle) % kinds.length);
      const rotated = [...kinds.slice(turn % kinds.length), ...kinds.slice(0, turn % kinds.length)];
      slot = this.hold(c._id, this.freeSlot(c._id, rotated, turn), "leisure", now);
    }
    const since = this.seats.get(c._id)?.since ?? 0;
    const { act, props, pastime } = soloAct(slot ?? undefined, rand(c._id, slot?.id ?? "", since));
    return { ...base, label: `${ACTIVITY_LABEL.idle} · ${pastime}`, target: slot ? { kind: "slot", slotId: slot.id } : { kind: "none" }, act, props, screen: null };
  }

  private groupAct(g: Group, spot: Slot, crewId: string): { act: Act; props: Prop[]; pastime: string } {
    switch (g.spot) {
      case "bar": return { act: "stool", props: ["drink"], pastime: g.mood === "cheers" ? "celebrating" : "at the bar" };
      case "tub": return { act: "soak", props: [], pastime: "in the hot tub" };
      case "table": return { act: "cards", props: [], pastime: "playing cards" };
      case "rail":
        if (g.mood === "dance") return { act: "dance", props: [], pastime: "dancing" };
        if (spot.tags?.includes("at-rail")) return { act: "lean-back", props: [], pastime: "hanging out" };
        return g.mood === "cheers" || rand(crewId, g.id, "drink") < 0.75 ? { act: "drink", props: ["drink"], pastime: g.mood === "cheers" ? "celebrating" : "hanging out" } : { act: "mingle", props: [], pastime: "hanging out" };
    }
  }

  /** Computah: it hovers by the helm, and its face says how it's doing. */
  computer(c: CrewView | undefined, now: number): ComputerDirection | null {
    if (!c) return null;
    const slot = this.slots.find((s) => s.kind === "computer")?.id ?? this.slots.find((s) => s.kind === "helm")?.id ?? null;
    const ended = c.lastEnded && now - c.lastEnded.endedAt < 8_000 ? c.lastEnded.state : null;
    const mood: ComputerDirection["mood"] = c.asking ? "greet"
      : c.live ? (c.live.step && (c.live.step.kind === "offsite" || c.live.step.kind === "agent") ? "idea" : c.live.step ? "focus" : "think")
      : ended === "failed" ? "sad"
      : ended === "landed" ? "proud"
      : "idle";
    const screen = c.live
      ? [c.live.threadTitle ?? "Thinking", c.live.step?.summary ?? "Planning…"]
      : ["All quiet", "Open the phone (F) or ask me here"];
    return { crewId: c._id, slotId: slot, mood, screen };
  }

  /** Behind the round bar: the spot, and the way round the counter to it (a film stages a bartender with it). */
  get behindTheBar(): { slot: Slot; approach: Vec3[] | null } | null {
    return this.bar ? { slot: this.bar.bartender, approach: this.bar.approach } : null;
  }

  /** The middle of the round bar (where its music plays), or null if the world has none. */
  get barCentre(): Vec3 | null { return this.bar?.centre ?? null; }

  /** For tests and the dev page: the hangouts as they stand, and who is behind the bar. */
  hangouts(): Hangout[] { return [...this.groups.values()].map((g) => this.hangout(g)); }
  get barkeep(): string | null { return this.bartender?.crewId ?? null; }
}
