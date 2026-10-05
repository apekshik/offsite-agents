import { describe, expect, it } from "vitest";
import { api } from "../../../../convex/_generated/api";
import { BASE_EPOCH as EPOCH } from "./epoch.ts";
import { eventsAt, REQUEST, shipAt, T } from "./story.ts";
import { FilmBackend } from "./backend.ts";

const crewAt = (s: number) => shipAt(EPOCH, s).snapshot.crew.filter((c) => c.role === "crew");

describe("the scripted ship", () => {
  it("has thirteen aboard, Mira flown in at the start and Ezra hired with the plan", () => {
    expect(crewAt(0)).toHaveLength(13);
    expect(crewAt(T.miraLands).map((c) => c.name)).toContain("Mira");
    expect(crewAt(T.plan - 1)).toHaveLength(14);
    const ezra = crewAt(T.plan + 1).find((c) => c.name === "Ezra")!;
    expect(ezra.arrivesAt).toBe(EPOCH + T.ezraLands * 1000);
  });

  it("is off duty in the evening, until the captain asks", () => {
    expect(crewAt(100).every((c) => !c.live)).toBe(true);
    expect(shipAt(EPOCH, T.send - 0.1).threads.find((t) => t.title === REQUEST)).toBeUndefined();
    const after = shipAt(EPOCH, T.send + 0.1);
    expect(after.threads[0]!.title).toBe(REQUEST);
    expect(after.messages.get("thread_dark")!.map((m) => m.text)).toEqual([REQUEST]);
  });

  it("streams Computah's reply, then shows its plan of eight tasks", () => {
    const mid = shipAt(EPOCH, T.reply + 1).messages.get("thread_dark")!.at(-1)!;
    expect(mid.streaming).toBe(true);
    expect(shipAt(EPOCH, T.plan - 0.1).tasks.get("thread_dark")).toHaveLength(0);
    const plan = shipAt(EPOCH, T.plan + 0.1);
    expect(plan.tasks.get("thread_dark")).toHaveLength(8);
    expect(plan.messages.get("thread_dark")!.at(-1)!.kind).toBe("plan");
  });

  it("sends six crew to work within a few seconds of the plan", () => {
    const working = crewAt(T.scramble + 4).filter((c) => c.live);
    expect(working.map((c) => c.name).sort()).toEqual(["Kofi", "Marlo", "Nova", "Otis", "Sable", "Wren"]);
  });

  it("has everyone at work at night, with packages waiting", () => {
    const night = shipAt(EPOCH, T.night);
    expect(night.snapshot.crew.filter((c) => c.role === "crew" && c.live)).toHaveLength(15);
    expect(night.deliveries.filter((d) => !d.seen).length).toBeGreaterThanOrEqual(4);
    const otis = crewAt(T.otisLands + 1).find((c) => c.name === "Otis")!;
    expect(otis.live).toBeNull();
    expect(otis.lastEnded?.state).toBe("landed");
  });

  it("finishes the thread with a pull request in each repo", () => {
    const done = shipAt(EPOCH, T.finished + 1).threads.find((t) => t.title === REQUEST)!;
    expect(done.state).toBe("done");
    expect(done.prs.map((p) => p.repo)).toEqual(["web", "api"]);
    expect(done.tasks).toEqual({ total: 8, landed: 8 });
  });

  it("gives each run its steps as events, in order", () => {
    const ev = eventsAt(EPOCH, T.night, "run_e2e");
    expect(ev.length).toBeGreaterThan(4);
    ev.forEach((e, i) => expect(e.seq).toBe(i));
  });
});

describe("the fake Convex client", () => {
  it("answers the interface's queries and keeps an answer's identity until it changes", () => {
    const b = new FilmBackend(EPOCH, 100);
    const watch = b.watchQuery(api.world.snapshot, { officeId: FilmBackend.office });
    let told = 0;
    watch.onUpdate(() => told++);
    const first = watch.localQueryResult();
    b.update(100.5);
    expect(watch.localQueryResult()).toBe(first);
    expect(told).toBe(0);
    b.update(T.send + 1);
    expect(told).toBe(1);
    expect(watch.localQueryResult()).not.toBe(first);
  });

  it("starts the scripted thread when the captain sends", async () => {
    const b = new FilmBackend(EPOCH, T.send);
    expect(await b.mutation(api.threads.create, { officeId: FilmBackend.office, text: REQUEST })).toBe("thread_dark");
  });
});
