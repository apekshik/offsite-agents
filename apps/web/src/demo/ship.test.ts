import { describe, expect, it } from "vitest";
import { DemoShip, type DemoSetup } from "./ship.ts";

// The demo's script, on a clock the test moves.

const ABOARD: DemoSetup = { scene: "day", office: true, machine: true, repos: true };

function ship(setup: DemoSetup = ABOARD) {
  let now = Date.UTC(2026, 9, 5, 17, 0, 0);
  const s = new DemoShip(setup, () => now);
  return { s, wait: (seconds: number) => { now += seconds * 1000; } };
}

const crew = (s: DemoShip) => s.snapshot().crew.filter((c) => c.role === "crew");

describe("demo mode's ship", () => {
  it("starts off duty with the cast aboard and nothing asked", () => {
    const { s } = ship();
    expect(crew(s).length).toBeGreaterThanOrEqual(13);
    expect(crew(s).every((c) => !c.live)).toBe(true);
    expect(s.threadList()).toEqual([]);
  });

  it("answers a new thread: Computah thinks, replies, plans, and the crew go to work", () => {
    const { s, wait } = ship();
    const id = s.mutate("threads:create", { officeId: "office_sealegs", text: "Add a dark mode toggle to settings" }) as string;
    wait(1);
    expect(s.snapshot().crew.find((c) => c.role === "computer")!.live?.threadId).toBe(id);
    wait(3);
    expect(s.messages(id).at(-1)!.streaming).toBe(true);
    wait(4);
    const tasks = s.tasks(id);
    expect(tasks).toHaveLength(2);
    expect(s.messages(id).some((m) => m.kind === "plan")).toBe(true);
    expect(crew(s).filter((c) => c.live?.threadId === id)).toHaveLength(2);
    expect(s.events(crew(s).find((c) => c.live)!.live!.runId).length).toBeGreaterThan(1);
  });

  it("asks you for permission, waits, and lands with a pull request once you answer", () => {
    const { s, wait } = ship();
    const id = s.startThread("Add a dark mode toggle to settings");
    wait(20);
    const q = s.snapshot().questions[0]!;
    expect(q.kind).toBe("approval");
    wait(120);
    expect(s.threadList()[0]!.state).not.toBe("done");
    s.mutate("questions:answer", { questionId: q._id, answer: "allow" });
    wait(60);
    const t = s.threadList().find((x) => x._id === id)!;
    expect(t.state).toBe("done");
    expect(t.prs.length).toBeGreaterThan(0);
    expect(s.deliveries().filter((d) => d.threadId === id)).toHaveLength(2);
    expect(s.diff(id, null)!.repos[0]!.diff?.state).toBe("ready");
  });

  it("checks with you before it plans on every second thread", () => {
    const { s, wait } = ship();
    s.startThread("First thing");
    const id = s.startThread("Second thing");
    wait(4);
    const ask = s.snapshot().questions.find((q) => q.threadId === id)!;
    expect(ask.kind).toBe("input");
    wait(30);
    expect(s.tasks(id)).toHaveLength(0);
    s.mutate("questions:answer", { questionId: ask._id, answer: "Behind a flag" });
    wait(4);
    expect(s.tasks(id).length).toBeGreaterThan(0);
  });

  it("hires when nobody is free, and the new hire flies in", () => {
    const { s, wait } = ship({ ...ABOARD, cast: ["wren"] });
    s.startThread("Add a billing page and a usage chart");
    wait(6.5);
    const hire = crew(s).find((c) => c.handle !== "wren")!;
    expect(hire).toBeDefined();
    expect(hire.arrivesAt).toBeGreaterThan(Date.UTC(2026, 9, 5, 17, 0, 6));
  });

  it("can't start without a machine, and says so", () => {
    const { s, wait } = ship({ scene: "day", office: true, machine: false, repos: false });
    const id = s.startThread("Anything");
    wait(5);
    expect(s.messages(id).at(-1)!.text).toMatch(/no machine/i);
    expect(s.tasks(id)).toEqual([]);
  });

  it("pairs a machine, finds repos on it and adds the ones you pick", () => {
    const { s, wait } = ship({ scene: "day", office: true, machine: false, repos: false, folderDelayMs: 1000 });
    s.mutate("machines:approve", { userCode: "ABCD-1234" });
    expect(s.machineRows()).toHaveLength(1);
    const rid = s.mutate("folders:scan", { machineId: s.machineRows()[0]!._id }) as string;
    expect(s.folder(rid)!.state).toBe("pending");
    wait(1.1);
    const found = s.folder(rid)!.result;
    expect(found?.kind === "scan" && found.repos.length).toBeGreaterThan(2);
    s.mutate("repos:addMany", { officeId: "office_sealegs", repos: [{ machineId: s.machineRows()[0]!._id, path: "~/Developer/acme-web", defaultBranch: "main", setupCommand: null }] });
    expect(s.repoRows().map((r) => r.name)).toEqual(["acme-web"]);
  });

  it("plays the film's night in real time", () => {
    const { s, wait } = ship({ ...ABOARD, scene: "night" });
    expect(crew(s).filter((c) => c.live).length).toBeGreaterThan(10);
    expect(s.threadList().length).toBeGreaterThanOrEqual(4);
    wait(110);
    expect(s.snapshot().questions.length).toBeGreaterThan(0);
  });

  it("moves to the moon and back with everyone aboard, and refuses where it can't go", () => {
    const { s } = ship();
    const before = crew(s).map((c) => c._id);
    expect(s.mutate("offices:relocate", { officeId: "office_sealegs", world: "moon-base" })).toEqual({ world: "moon-base" });
    expect(s.snapshot().office.world).toBe("moon-base");
    expect(s.query("offices:get", {})).toMatchObject({ world: "moon-base", relocatedAt: expect.any(Number) });
    expect(crew(s).map((c) => c._id)).toEqual(before);
    expect(() => s.mutate("offices:relocate", { world: "moon-base" })).toThrow(/already there/);
    expect(() => s.mutate("offices:relocate", { world: "airship" })).toThrow(/No world called/);
    s.mutate("offices:relocate", { world: "yacht" });
    expect(s.snapshot().office.world).toBe("yacht");
  });

  it("warns about, rather than fails on, functions it doesn't know", () => {
    const { s } = ship();
    expect(s.query("nowhere:atAll", {})).toBeUndefined();
    expect(s.mutate("nowhere:atAll", {})).toBeNull();
  });
});
