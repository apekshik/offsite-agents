import { describe, expect, it } from "vitest";
import type { Slot } from "@offsite/contracts";
import { Director, workHabit, type CrewView } from "./director.ts";

const slot = (id: string, kind: Slot["kind"]): Slot => ({ id, kind, pos: [0, 0, 0], facing: 0, nav: "n" });
const SLOTS: Slot[] = [
  slot("desk-1", "desk"), slot("desk-2", "desk"),
  slot("lounger-1", "lounger"), slot("lounger-2", "lounger"),
  slot("hammock-1", "hammock"),
  slot("bar-1", "bar-stool"), slot("pool-1", "pool"), slot("fish-1", "fishing"), slot("rail-1", "rail"),
  slot("drop", "dropoff"), slot("spawn", "crew-spawn"), slot("bot", "computer"),
];

const T0 = 1_800_000_000_000;
const person = (id: string, over: Partial<CrewView> = {}): CrewView => ({
  _id: id, name: id, handle: id, role: "crew", arrivesAt: T0 - 600_000, live: null, lastEnded: null, lastStep: null, asking: false, ...over,
});
const working = (kind: string, task = "Settings toggle"): CrewView["live"] => ({
  runId: "r", kind: "task", state: "working", threadTitle: "Dark mode", taskTitle: task, step: { kind, summary: `${kind} things`, since: T0 },
});

describe("the director", () => {
  it("keeps a worker in one seat for the whole task, whatever the step", () => {
    const d = new Director(SLOTS);
    const a = d.plan([person("juniper", { live: working("edit") })], T0)[0]!;
    const b = d.plan([person("juniper", { live: working("bash") })], T0 + 5000)[0]!;
    const c = d.plan([person("juniper", { live: working("read") })], T0 + 9000)[0]!;
    expect(a.target).toEqual(b.target);
    expect(b.target).toEqual(c.target);
    expect(a.label).toBe("Editing · Settings toggle");
    expect(a.screen).toContain("edit things");
  });

  it("never seats two people in one place", () => {
    const d = new Director(SLOTS);
    const crew = ["a", "b", "c", "d", "e", "f"].map((id) => person(id, { live: working("edit") }));
    const plan = d.plan(crew, T0);
    const ids = plan.flatMap((p) => (p.target.kind === "slot" ? [p.target.slotId] : []));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(5); // two desks, two loungers, one hammock
  });

  it("sends someone with a question to the captain, and a finisher to the bridge with a box", () => {
    const d = new Director(SLOTS);
    const [ask] = d.plan([person("otis", { live: working("edit"), asking: true })], T0);
    expect(ask!.target).toEqual({ kind: "captain" });
    expect(ask!.marker).toBe("asking");
    const [done] = d.plan([person("otis", { lastEnded: { state: "landed", endedAt: T0 - 1000 } })], T0);
    expect(done!.target).toEqual({ kind: "slot", slotId: "drop" });
    expect(done!.walkAct).toBe("carry");
    expect(done!.props).toContain("box");
  });

  it("finishes a delivery even when \"just landed\" runs out on the way", () => {
    const d = new Director(SLOTS);
    const done = person("otis", { lastEnded: { state: "landed", endedAt: T0 - 1000, taskTitle: "Theme types" } });
    expect(d.plan([done], T0)[0]!.target).toEqual({ kind: "slot", slotId: "drop" });
    // A minute later, still walking: still delivering.
    const late = d.plan([done], T0 + 60_000)[0]!;
    expect(late.activity).toBe("landed");
    expect(late.label).toBe("Delivering · Theme types");
    expect(late.carrying).toBe(true);
    d.delivered("otis", T0 + 61_000);
    const there = d.plan([done], T0 + 62_000)[0]!;
    expect(there.activity).toBe("landed");
    expect(there.label).toBe("Delivered · Theme types");
    expect(there.carrying).toBe(false);
    expect(d.plan([done], T0 + 61_000 + Director.CELEBRATE_MS + 1)[0]!.activity).toBe("idle");
  });

  it("drops a delivery for new work", () => {
    const d = new Director(SLOTS);
    d.plan([person("otis", { lastEnded: { state: "landed", endedAt: T0 - 1000 } })], T0);
    const busy = d.plan([person("otis", { live: working("edit") })], T0 + 30_000)[0]!;
    expect(busy.activity).toBe("editing");
  });

  it("keeps new arrivals in the helicopter until they step out", () => {
    const d = new Director(SLOTS);
    const [inbound] = d.plan([person("wren", { arrivesAt: T0 + 5000 })], T0);
    expect(inbound!.visible).toBe(false);
    expect(inbound!.activity).toBe("arriving");
    const [out] = d.plan([person("wren", { arrivesAt: T0 - 5000 })], T0);
    expect(out!.visible).toBe(true);
    expect(out!.spawnSlot).toBe("spawn");
  });

  it("lets idle crew settle somewhere, then wander after a while", () => {
    const d = new Director(SLOTS);
    const first = d.plan([person("marlo")], T0)[0]!;
    const soon = d.plan([person("marlo")], T0 + 60_000)[0]!;
    expect(soon.target).toEqual(first.target);
    const later = d.plan([person("marlo")], T0 + 5 * 60_000)[0]!;
    expect(later.target.kind).toBe("slot");
  });

  it("gives everyone a habit, mostly desks", () => {
    const habits = Array.from({ length: 200 }, (_, i) => workHabit(`crew-${i}`)[0]);
    const desks = habits.filter((h) => h === "desk").length;
    expect(desks).toBeGreaterThan(80);
    expect(desks).toBeLessThan(150);
  });

  it("never sends anyone to a slot someone on deck is using", () => {
    const d = new Director(SLOTS);
    d.reserve(["hammock-1"]);
    const crew = ["a", "b", "c", "d", "e", "f"].map((id) => person(id, { live: working("edit") }));
    const ids = d.plan(crew, T0).flatMap((p) => (p.target.kind === "slot" ? [p.target.slotId] : []));
    expect(ids).not.toContain("hammock-1");
    expect(ids.length).toBe(4);
    // Off duty too, whoever's turn it is to swing in a hammock.
    for (let t = 0; t < 20; t++) {
      const idle = d.plan(["g", "h", "i", "j"].map((id) => person(id)), T0 + t * 240_000);
      expect(idle.some((p) => p.target.kind === "slot" && p.target.slotId === "hammock-1")).toBe(false);
    }
  });

  it("moves someone on when the captain takes their slot", () => {
    const fan = Array.from({ length: 400 }, (_, i) => `h${i}`).find((h) => workHabit(h)[0] === "hammock")!;
    const d = new Director(SLOTS);
    const reader = person(fan, { live: working("read") });
    expect(d.plan([reader], T0)[0]!.target).toEqual({ kind: "slot", slotId: "hammock-1" });
    // They went to ask the captain something; meanwhile the captain lay down in their hammock.
    d.reserve(["hammock-1"]);
    const moved = d.plan([reader], T0 + 5000)[0]!;
    expect(moved.target.kind).toBe("slot");
    expect(moved.target).not.toEqual({ kind: "slot", slotId: "hammock-1" });
    // ...and stay there for the rest of the task once the captain is up again.
    d.reserve([]);
    expect(d.plan([reader], T0 + 10_000)[0]!.target).toEqual(moved.target);
  });

  it("reads the computer's mood from its run", () => {
    const d = new Director(SLOTS);
    const bot = person("computer", { role: "computer" });
    expect(d.computer(bot, T0)?.mood).toBe("idle");
    expect(d.computer({ ...bot, live: { ...working("offsite")!, kind: "computer" } }, T0)?.mood).toBe("idea");
    expect(d.computer(bot, T0)?.slotId).toBe("bot");
  });
});

// ---------- off duty, the scramble, and determinism ----------

import { ALL_LINES, BANTER, beatAt, lineMs } from "./banter.ts";
import { BUCKET_MS, WAVE_STEP_MS, soloAct, stoolClusters, type Direction } from "./director.ts";

/** A small ship with a round bar, a hot tub, chairs round a table, rails, desks and loungers. */
function ship(): Slot[] {
  const out: Slot[] = [];
  const at = (id: string, kind: Slot["kind"], x: number, z: number, facing: number, extra: Partial<Slot> = {}) =>
    out.push({ id, kind, pos: [x, 10, z], facing, nav: "n", ...extra });
  for (let i = 0; i < 12; i++) at(`desk-${i + 1}`, "desk", -10 + (i % 6) * 2, -20 + Math.floor(i / 6) * 3, 0, { seat: 0.47 });
  for (let i = 0; i < 6; i++) at(`lounger-${i + 1}`, "lounger", 8, 20 + i * 1.5, -Math.PI / 2, { seat: 0.36 });
  // Stools round a bar at (0, 40), from 120° to 330°, facing in.
  for (let i = 0; i < 8; i++) {
    const a = ((120 + (i * 210) / 7) / 180) * Math.PI, x = Math.cos(a) * 3, z = 40 + Math.sin(a) * 3;
    at(`bar-stool-${i + 1}`, "bar-stool", x, z, Math.atan2(-x, 40 - z), { seat: 0.76 });
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2, x = -6 + Math.cos(a) * 1.3, z = 30 + Math.sin(a) * 1.3;
    at(`hot-tub-${i + 1}`, "hot-tub", x, z, Math.atan2(-6 - x, 30 - z), { seat: 0.47 });
  }
  at("deck-chair-1", "deck-chair", -1.3, 15, 0, { seat: 0.42 });
  at("deck-chair-2", "deck-chair", 1.3, 15, 0, { seat: 0.42 });
  for (let i = 0; i < 6; i++) at(`rail-${i + 1}`, "rail", -11, 10 + i * 5, -Math.PI / 2);
  for (let i = 0; i < 3; i++) at(`pool-${i + 1}`, "pool", -3, 22 + i * 2, 0);
  at("fish-1", "fishing", 0, 60, 0);
  at("hammock-1", "hammock", 9, 0, 0, { seat: 0.62 });
  at("drop", "dropoff", 0, -30, 0);
  at("spawn", "crew-spawn", 0, -40, 0);
  return out;
}

const NAMES = ["ada", "bo", "cy", "di", "ed", "flo", "gus", "hal", "ivy", "jo", "kit", "lu", "max", "ned", "oz", "pia", "quin", "rae", "sol", "tia"];
const crewOf = (n: number) => NAMES.slice(0, n).map((id) => person(id));
const slotIds = (plan: Direction[]) => plan.flatMap((p) => (p.target.kind === "slot" ? [p.target.slotId] : []));

/** Runs a director over a scripted afternoon: who has work when. Returns every plan. */
function afternoon(n: number, script: (t: number, id: string, i: number) => CrewView["live"]): Direction[][] {
  const d = new Director(ship());
  const plans: Direction[][] = [];
  for (let t = 0; t <= 6 * 60_000; t += 1000) {
    const crew = NAMES.slice(0, n).map((id, i) => person(id, { live: script(t, id, i) }));
    plans.push(d.plan(crew, T0 + t));
  }
  return plans;
}

describe("the crew off duty", () => {
  it("forms groups of two to four at once, each in its own place", () => {
    const d = new Director(ship());
    const plan = d.plan(crewOf(14), T0);
    const groups = d.hangouts();
    expect(groups.length).toBeGreaterThan(1);
    const grouped = groups.flatMap((g) => g.members);
    expect(grouped.length).toBeGreaterThanOrEqual(6);
    for (const g of groups) {
      expect(g.members.length).toBeGreaterThanOrEqual(2);
      expect(g.members.length).toBeLessThanOrEqual(5); // four, plus a bartender at the bar
    }
    expect(new Set(grouped).size).toBe(grouped.length);
    const ids = slotIds(plan);
    expect(new Set(ids).size).toBe(ids.length);
    // Group members say where they are on their nameplate, and know their group.
    const member = plan.find((p) => p.group)!;
    expect(member.label).toMatch(/^Off duty · /);
    expect(member.gait).toBe("stroll");
  });

  it("never seats anyone where a group sits, with twenty aboard", () => {
    const d = new Director(ship());
    for (let t = 0; t < 5 * 60_000; t += 1000) {
      const plan = d.plan(crewOf(20), T0 + t);
      const ids = slotIds(plan).map((id) => id.replace(/~g$/, ""));
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("breaks groups up and forms new ones over a few minutes", () => {
    const d = new Director(ship());
    const seen = new Set<string>();
    const sizes: number[] = [];
    for (let t = 0; t < 8 * 60_000; t += 1000) {
      d.plan(crewOf(12), T0 + t);
      for (const g of d.hangouts()) { seen.add(g.id); sizes.push(g.members.length); }
    }
    expect(seen.size).toBeGreaterThan(6);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(5);
  });

  it("puts someone behind the bar when nobody is working, and sends them to work when there's some", () => {
    const d = new Director(ship());
    let barkeep: string | null = null, t = 0, at: Direction | undefined;
    for (; t < 10 * 60_000 && !barkeep; t += 1000) {
      const plan = d.plan(crewOf(8), T0 + t);
      barkeep = d.barkeep;
      at = plan.find((p) => p.crewId === barkeep);
    }
    expect(barkeep).not.toBeNull();
    expect(at!.act).toBe("bartend");
    expect(at!.approach?.length).toBeGreaterThan(1);
    const busy = crewOf(8).map((c, i) => (i === 7 ? { ...c, live: working("edit") } : c));
    d.plan(busy, T0 + t + 1000);
    expect(d.barkeep).toBeNull();
  });

  it("has the first one done wait at the bar for the next one, then toast", () => {
    const d = new Director(ship());
    const two = ["ada", "bo"];
    const crew = (t: number) => crewOf(6).map((c) => {
      const ends = c._id === "ada" ? 60_000 : c._id === "bo" ? 90_000 : -1;
      if (!two.includes(c._id)) return c;
      return t < ends ? { ...c, live: working("edit") } : { ...c, lastEnded: { state: "landed", endedAt: T0 + ends } };
    });
    let toast: ReturnType<Director["hangouts"]>[number] | undefined;
    for (let t = 0; t < 200_000; t += 1000) {
      const plan = d.plan(crew(t), T0 + t);
      // Deliveries finish when they reach the drop-off: pretend they walk there at once.
      for (const p of plan) if (p.carrying) d.delivered(p.crewId, T0 + t);
      const g = d.hangouts().find((h) => h.mood === "cheers" && h.members.includes("ada") && h.members.includes("bo"));
      if (g) { toast = g; break; }
    }
    expect(toast).toBeDefined();
    const beat = beatAt(toast!.id, toast!.members, toast!.formedAt, toast!.mood, toast!.formedAt + 1000)!;
    expect(beat.cheersAt).not.toBeNull();
  });
});

describe("the scramble", () => {
  it("buzzes everyone who gets work in a wave, a beat apart, nearest the bridge first, then they run", () => {
    const d = new Director(ship());
    const crew = crewOf(10);
    d.plan(crew, T0);
    d.plan(crew, T0 + 1000);
    const lucky = ["bo", "di", "flo", "hal"];
    const busy = crew.map((c) => (lucky.includes(c._id) ? { ...c, live: working("edit") } : c));
    const where = new Map(d.plan(crew, T0 + 2000).map((p) => [p.crewId, p.target.kind === "slot" ? d.slot(p.target.slotId)!.pos[2] : 0]));
    const plan = d.plan(busy, T0 + 3000);
    const runs = plan.filter((p) => p.scramble).sort((a, b) => a.scramble!.rank - b.scramble!.rank);
    expect(runs.map((p) => p.crewId).sort()).toEqual([...lucky].sort());
    for (const p of runs) expect(p.gait).toBe("run");
    // A wave: each buzz after the last, by about a step.
    for (let i = 1; i < runs.length; i++) {
      const gap = runs[i]!.scramble!.delay - runs[i - 1]!.scramble!.delay;
      expect(gap).toBeGreaterThan(WAVE_STEP_MS - 100);
      expect(gap).toBeLessThan(WAVE_STEP_MS + 100);
    }
    // Ordered by where they were, forward first.
    const zs = runs.map((p) => where.get(p.crewId)!);
    expect([...zs].sort((a, b) => a - b)).toEqual(zs);
    // Someone handed work a second later joins the same wave, after the others.
    const later = busy.map((c) => (c._id === "ada" ? { ...c, live: working("read") } : c));
    const p2 = d.plan(later, T0 + 4000).find((p) => p.crewId === "ada")!;
    expect(p2.scramble!.rank).toBe(4);
    expect(T0 + 4000 + p2.scramble!.delay).toBeGreaterThanOrEqual(T0 + 3000 + 4 * WAVE_STEP_MS);
    // Nobody who was already at work scrambles.
    const p3 = d.plan(later.map((c) => (c._id === "bo" ? { ...c, live: working("bash") } : c)), T0 + 5000).find((p) => p.crewId === "bo")!;
    expect(p3.scramble!.at).toBe(T0 + 3000);
  });

  it("strolls back when the work is done", () => {
    const d = new Director(ship());
    const busy = [person("ada", { live: working("edit") })];
    d.plan(busy, T0);
    const free = [person("ada", { lastEnded: { state: "failed", endedAt: T0 } })];
    expect(d.plan(free, T0 + 1000)[0]!.gait).toBe("walk");
    const later = d.plan(free, T0 + 60_000)[0]!;
    expect(later.activity).toBe("idle");
    expect(later.gait).toBe("stroll");
    expect(later.scramble).toBeNull();
  });

  it("sends someone syncing with the team to a teammate's desk", () => {
    const d = new Director(ship());
    const sync: CrewView["live"] = { ...working("offsite")!, step: { kind: "offsite", summary: "Sync with the team", since: T0 } };
    const deskers = Array.from({ length: 50 }, (_, i) => `h${i}`).filter((h) => workHabit(h)[0] === "desk");
    const crew = ["ada", "bo", "cy"].map((id, i) => person(id, { handle: deskers[i]!, live: working("edit") }));
    d.plan(crew, T0);
    const plan = d.plan(crew.map((c) => (c._id === "bo" ? { ...c, live: sync } : c)), T0 + 1000);
    const bo = plan.find((p) => p.crewId === "bo")!;
    expect(bo.act).toBe("huddle");
    expect(bo.target.kind === "slot" && bo.target.slotId.startsWith("huddle:")).toBe(true);
    expect(plan.filter((p) => p.company === "bo").length).toBe(1);
  });
});

describe("determinism", () => {
  const script = (t: number, id: string, i: number): CrewView["live"] => {
    const on = (t > 60_000 + i * 700 && t < 150_000 + i * 9000) || (t > 240_000 && i % 3 === 0);
    return on ? working(["edit", "read", "bash"][i % 3]!, `Task ${id}`) : null;
  };

  it("plays the same afternoon the same way twice", () => {
    const a = afternoon(16, script);
    const b = afternoon(16, script);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("decides groups by the clock's buckets, not by how often it is asked", () => {
    const once = new Director(ship());
    const often = new Director(ship());
    for (let t = 0; t <= 3 * 60_000; t += 250) {
      const crew = crewOf(12);
      const b = often.plan(crew, T0 + t);
      if (t % BUCKET_MS === 0) {
        const a = once.plan(crew, T0 + t);
        expect(JSON.stringify(a.map((p) => [p.crewId, p.target, p.act]))).toBe(JSON.stringify(b.map((p) => [p.crewId, p.target, p.act])));
      }
    }
  });
});

describe("banter", () => {
  it("has plenty of short lines in sentence case", () => {
    expect(BANTER.flat().length).toBeGreaterThanOrEqual(80);
    for (const l of ALL_LINES) {
      expect(l.length).toBeLessThanOrEqual(40);
      expect(l[0]).toBe(/^I\b|^I'm|^Rust|^DNS/.test(l) ? l[0] : l[0]!.toLowerCase());
    }
    for (const ex of BANTER) expect(ex.length === 2 || ex.length === 3).toBe(true);
  });

  it("takes turns, one line after another, the same way every time", () => {
    const members = ["ada", "bo", "cy"];
    const a = beatAt("g1", members, T0, "chat", T0 + 25_000)!;
    const b = beatAt("g1", members, T0, "chat", T0 + 25_000)!;
    expect(a).toEqual(b);
    for (let i = 1; i < a.lines.length; i++) {
      expect(a.lines[i]!.speaker).not.toBe(a.lines[i - 1]!.speaker);
      expect(a.lines[i]!.at).toBeGreaterThanOrEqual(a.lines[i - 1]!.at + lineMs(a.lines[i - 1]!.text) - 300);
    }
    expect(a.until - a.from).toBeGreaterThanOrEqual(10_000);
    // Consecutive rounds say different things.
    const next = beatAt("g1", members, T0, "chat", a.until + 10)!;
    expect(next.lines[0]!.text).not.toBe(a.lines[0]!.text);
  });
});

describe("the yacht's other spaces", () => {
  it("finds the round bar among straight bars on other decks", () => {
    const slots = ship();
    // A galley counter and a beach bar below: stools in a row, all facing one way.
    for (let i = 0; i < 4; i++) slots.push({ id: `galley-${i}`, kind: "bar-stool", pos: [6, 4, 10 + i * 0.7], facing: -Math.PI / 2, nav: "n", seat: 0.76 });
    for (let i = 0; i < 5; i++) slots.push({ id: `beach-${i}`, kind: "bar-stool", pos: [-2, 4, 50 + i * 0.75], facing: -Math.PI / 2, nav: "n", seat: 0.76 });
    const d = new Director(slots);
    const c = d.barCentre!;
    expect(Math.hypot(c[0], c[2] - 40)).toBeLessThan(0.05);
    expect(c[1]).toBe(10);
    expect(stoolClusters(slots).map((g) => g.length).sort()).toEqual([4, 5, 8]);
  });

  it("jogs on a treadmill, lifts at the bench, sinks into a bean bag, tinkers in the garage, watches the core", () => {
    const at = (kind: Slot["kind"], tags: string[], id: string = kind): Slot => ({ id, kind, pos: [0, 0, 0], facing: 0, nav: "n", tags });
    expect(soloAct(at("gym", ["gym", "run"]), 0.9).act).toBe("jog");
    expect(soloAct(at("gym", ["gym", "bench"]), 0.1).act).toBe("lift-bench");
    expect(soloAct(at("gym", ["gym", "weights"]), 0.1).act).toBe("lift");
    expect(soloAct(at("cinema", ["cinema"]), 0.9).act).toBe("sofa");
    expect(soloAct(at("sauna", ["spa"]), 0.5).act).toBe("sauna");
    expect(soloAct(at("workshop", ["garage"]), 0.5).act).toBe("tinker");
    expect(soloAct(at("core", ["server-room"], "core-1"), 0.9).act).toBe("rail");
    expect(soloAct(at("core", ["server-room"], "core-aisle-s"), 0.9).act).toBe("mingle");
  });
});
