import { ACTIVITY_LABEL, ACTIVITY_SPOTS, ARRIVAL, crewActivity, isWorking, type CrewActivity, type RunState, type Slot, type SlotKind } from "@offsite/contracts";

// The director decides where each crew member goes and what they do there, from what they are
// working on. It is pure and remembers only seats, so the world can call it every time the
// snapshot changes and get calm, stable answers: someone at a desk stays at that desk for the whole
// task, someone sunbathing stays on that lounger for a while before wandering to the bar.

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
  lastEnded: { state: string; endedAt: number; taskTitle?: string | null } | null;
  lastStep: string | null;
  asking: boolean;
}

/** Poses the kit knows (packages/kit/src/avatar acts); the game maps any it lacks to the nearest. */
export type Act =
  | "type" | "laptop" | "lounge-laptop" | "sunbathe" | "hammock" | "fish" | "carry" | "slump" | "think"
  | "celebrate" | "rail" | "swim" | "stool" | "wave" | "stand";

export type Prop = "laptop" | "box" | "rod" | "drink";

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
  /** What their screen shows (the laptop, or the desk's monitor), when they have one. */
  screen: string[] | null;
}

export interface ComputerDirection {
  crewId: string;
  slotId: string | null;
  mood: "idle" | "think" | "focus" | "idea" | "greet" | "proud" | "sad";
  screen: string[];
}

const WORK_KINDS: SlotKind[] = ["desk", "lounger", "hammock", "deck-chair"];
const LEISURE_ROTATE_MS = 4 * 60_000;

/** A stable number from a string, for per-person habits. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Where someone likes to work: most at desks, some on a lounger with a laptop, a few in a hammock. */
export function workHabit(handle: string): SlotKind[] {
  const r = (hash(handle) % 100) / 100;
  if (r < 0.55) return ["desk", "lounger", "deck-chair", "hammock"];
  if (r < 0.85) return ["lounger", "deck-chair", "desk", "hammock"];
  return ["hammock", "lounger", "desk", "deck-chair"];
}

function workAct(kind: SlotKind | undefined, activity: CrewActivity): Act {
  if (kind === "desk") return activity === "thinking" || activity === "reading" ? "think" : "type";
  if (kind === "lounger") return "lounge-laptop";
  if (kind === "hammock") return "hammock";
  return "laptop";
}

function leisureAct(kind: SlotKind | undefined): { act: Act; props: Prop[] } {
  switch (kind) {
    case "lounger": return { act: "sunbathe", props: [] };
    case "pool": case "hot-tub": return { act: "swim", props: [] };
    case "bar-stool": return { act: "stool", props: ["drink"] };
    case "hammock": return { act: "hammock", props: [] };
    case "fishing": return { act: "fish", props: ["rod"] };
    case "rail": return { act: "rail", props: [] };
    case "deck-chair": return { act: "stool", props: ["drink"] };
    default: return { act: "stand", props: [] };
  }
}

export class Director {
  private readonly byId = new Map<string, Slot>();
  /** crewId → the slot they hold, and whether it is a work seat or a leisure spot. */
  private readonly seats = new Map<string, { slotId: string; mode: "work" | "leisure" | "dropoff"; since: number }>();
  /** A delivery in progress: it finishes (walk there, celebrate a moment) even if "just landed" runs out on the way. */
  private readonly errands = new Map<string, { deliveredAt: number | null }>();
  static readonly CELEBRATE_MS = 6000;

  /** The game says they reached the drop-off with their package. */
  delivered(crewId: string, now: number) {
    const e = this.errands.get(crewId);
    if (e && e.deliveredAt === null) e.deliveredAt = now;
  }

  private readonly slots: Slot[];

  constructor(slots: Slot[]) {
    this.slots = slots;
    for (const s of slots) this.byId.set(s.id, s);
  }

  private taken(except: string): Set<string> {
    const t = new Set<string>();
    for (const [crewId, seat] of this.seats) if (crewId !== except) t.add(seat.slotId);
    return t;
  }

  /** The first free slot of the first kind in `kinds` that has one, spread out by a per-person offset. */
  private freeSlot(crewId: string, kinds: readonly SlotKind[], salt = 0): Slot | null {
    const taken = this.taken(crewId);
    for (const kind of kinds) {
      const free = this.slots.filter((s) => s.kind === kind && !taken.has(s.id));
      if (free.length) return free[(hash(crewId) + salt) % free.length]!;
    }
    return null;
  }

  private hold(crewId: string, slot: Slot | null, mode: "work" | "leisure" | "dropoff", now: number): Slot | null {
    if (slot) this.seats.set(crewId, { slotId: slot.id, mode, since: now });
    else this.seats.delete(crewId);
    return slot;
  }

  plan(crew: CrewView[], now: number): Direction[] {
    const present = new Set(crew.map((c) => c._id));
    for (const id of [...this.seats.keys()]) if (!present.has(id)) this.seats.delete(id);
    for (const id of [...this.errands.keys()]) if (!present.has(id)) this.errands.delete(id);
    const out: Direction[] = [];
    // Workers choose first, so a desk is never taken by someone just sunbathing.
    const order = [...crew.filter((c) => c.role === "crew")].sort((a, b) => Number(!!b.live) - Number(!!a.live));
    for (const c of order) out.push(this.direct(c, now));
    return out;
  }

  private direct(c: CrewView, now: number): Direction {
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
    const title = c.live?.taskTitle ?? c.live?.threadTitle ?? null;
    const short = title && title.length > 26 ? `${title.slice(0, 25).replace(/\s+\S*$/, "")}…` : title;
    const doneTitle = c.lastEnded?.taskTitle;
    const label = short && isWorking(activity) ? `${ACTIVITY_LABEL[activity]} · ${short}`
      : activity === "landed" && doneTitle ? `${ACTIVITY_LABEL.landed} · ${doneTitle.length > 26 ? `${doneTitle.slice(0, 25).replace(/\s+\S*$/, "")}…` : doneTitle}`
      : ACTIVITY_LABEL[activity];
    const recentArrival = now - c.arrivesAt < 90_000;
    const spawn = recentArrival ? this.slots.find((s) => s.kind === "crew-spawn")?.id ?? null : null;
    const visible = now >= c.arrivesAt + ARRIVAL.stepOutMs;
    const base = { crewId: c._id, activity, visible, spawnSlot: spawn, walkAct: null, marker: null, label } as const;
    const seat = this.seats.get(c._id);
    const current = seat ? this.byId.get(seat.slotId) : undefined;

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
      const act = activity === "failed" ? "slump" : workAct(slot?.kind, activity);
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

    // Off duty. Stay put for a while, then wander somewhere else.
    let slot: Slot | null = null;
    if (seat?.mode === "leisure" && current && now - seat.since < LEISURE_ROTATE_MS) slot = current;
    if (!slot) {
      const kinds = ACTIVITY_SPOTS.idle;
      const turn = Math.floor(now / LEISURE_ROTATE_MS) + (hash(c.handle) % kinds.length);
      const rotated = [...kinds.slice(turn % kinds.length), ...kinds.slice(0, turn % kinds.length)];
      slot = this.hold(c._id, this.freeSlot(c._id, rotated, turn), "leisure", now);
    }
    const { act, props } = leisureAct(slot?.kind);
    return { ...base, target: slot ? { kind: "slot", slotId: slot.id } : { kind: "none" }, act, props, screen: null };
  }

  /** The ship's computer: it hovers by the helm, and its face says how it's doing. */
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
}
