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

  it("reads the computer's mood from its run", () => {
    const d = new Director(SLOTS);
    const bot = person("computer", { role: "computer" });
    expect(d.computer(bot, T0)?.mood).toBe("idle");
    expect(d.computer({ ...bot, live: { ...working("offsite")!, kind: "computer" } }, T0)?.mood).toBe("idea");
    expect(d.computer(bot, T0)?.slotId).toBe("bot");
  });
});
