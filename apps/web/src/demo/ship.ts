import type { FunctionReference, FunctionReturnType } from "convex/server";
import { COMPUTER_NAME, type FolderResult, type FoundRepo, type RunEvent } from "@offsite/contracts";
import { CREW_PRESETS, randomCrewAvatar } from "@offsite/kit";
import type { api } from "../../../../convex/_generated/api";
import type { Id, TableNames } from "../../../../convex/_generated/dataModel";
import type { CrewRow, MachineRow, MessageRow, QuestionRow, TaskRow, ThreadRow } from "../overlay/ship.tsx";
import { API_FILES, API_PATCH, diffAt, eventsAt, OFFICE, REPOS as STORY_REPOS, shipAt, SWEEP_FILES, SWEEP_PATCH, type ShipState } from "../film/story.ts";

// Demo mode's ship: everything the interface asks Convex for, answered in the browser, in real time, from what you do.
//
// The base is the film's scripted ship (src/film/story.ts): its cast, their looks, and at night its whole busy evening
// playing out in real time. On top of that sits what you do here: the ship you make, the machine you "pair", the repos
// you pick, and every thread you start, which gets a scripted Computah (a reply, maybe a question for you, a plan),
// crew who scramble to it (or a new hire on the helicopter when everyone is busy), a permission to answer, landings
// with diffs, and pull requests at the end.
//
// QUERIES and MUTATIONS list every Convex function demo mode answers; src/demo/coverage.test.ts fails when the
// interface uses one that isn't here. Anything else warns in the console (once per name) instead of crashing.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R<F extends FunctionReference<any, any>> = FunctionReturnType<F>;
type Args = Record<string, unknown>;
type Kind = "read" | "search" | "edit" | "write" | "bash" | "web" | "plan" | "agent";

const id = <T extends TableNames>(s: string) => s as Id<T>;

export type Scene = "day" | "night";

export interface DemoSetup {
  /** Golden hour with everyone off duty, or night with the film's evening of work under way. */
  scene: Scene;
  /** Has a ship (else the way aboard starts at "Make your ship"). */
  office: boolean;
  /** Has a paired machine. */
  machine: boolean;
  /** Has repos on the ship. */
  repos: boolean;
  /** Story crew aboard, by key. Null: the whole cast. */
  cast?: string[] | null;
  /** How long the runner takes to answer a folder scan or listing, ms. */
  folderDelayMs?: number;
  /** Fixtures for the gallery's empty and error states. */
  /** The machine is offline (seen an hour ago). */
  offline?: boolean;
  /** Reading a diff fails. */
  failDiffs?: boolean;
  /** The folder scan finds no repos. */
  noRepos?: boolean;
  /** The runner can't look in folders: this error. */
  folderError?: string;
}

/** The starting crew a new ship gets (offices.ts STARTING_CREW), from the film's cast. */
export const STARTING_CAST = ["wren", "otis", "kofi", "sable", "marlo", "nova", "juniper"];

/** Story seconds the day scene holds at: golden hour, Mira long landed, nobody asked anything yet. */
const DAY_AT = 60;
/** The night scene plays the film's evening from here, in real time, until everything has landed. */
const NIGHT_FROM = 9000;
const NIGHT_TO = 10_050;

/** How long after the plan a new hire's helicopter lands. */
const HELI_MS = 14_000;
const HIRES = ["Ezra", "Rumi", "Zola", "Felix", "Iris", "Milo", "Saga", "Bea", "Cass", "Dex", "Echo", "Ada"];
const COMPUTER = id<"crew">("crew_computer");
const USER = id<"users">("user_captain");

// ---- what you add ----

interface DQuestion { id: string; askAt: number; answeredAt: number | null; answer: string | null; kind: "approval" | "input"; prompt: string; options: string[] | null }
interface DTask {
  key: string; title: string; brief: string; repo: string | null; crewId: string; steps: [Kind, string][];
  diff: { added: number; removed: number; files: number }; question: { prompt: string; options: string[] } | null;
  stoppedAt: number | null;
}
interface DMessage { at: number; author: "captain" | "computer" | "system" | string; kind: "text" | "plan" | "report" | "system"; text: string; stream?: number; task?: string }
interface DThread {
  n: number; id: string; title: string; at: number; slug: string;
  /** Computah needs a decision before it plans. */
  ask: DQuestion | null;
  /** Nothing can run: no machine or no repo. */
  blocked: string | null;
  tasks: DTask[];
  /** Task questions, by task key, once asked. */
  questions: Map<string, DQuestion>;
  hiredCrew: string[];
  reply: string;
  plan: string;
  prs: number;
}
interface Hire { id: string; thread: string | null; name: string; handle: string; harness: "claude" | "codex" | "sim"; specialty: string | null; avatar: unknown; look: unknown; hiredAt: number; arrivesAt: number }
interface FolderReq { id: string; at: number; result: FolderResult | null; error: string | null; path: string | null }

/** A small, stable number from a string. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const slugOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "work";

export class DemoShip {
  /** When the demo started (ms). Skipping ahead moves it back. */
  private t0: number;
  readonly scene: Scene;
  private readonly clock: () => number;
  private folderDelay: number;
  private fixtures: { offline: boolean; failDiffs: boolean; noRepos: boolean; folderError: string | null };

  // The ship and its people.
  private officeMade: boolean;
  private officeName = "Sea Legs";
  private defaultHarness: "claude" | "codex" | "sim" = "claude";
  private cast: Set<string> | null;
  private me = { name: "Captain", avatar: null as unknown, look: null as unknown };
  private machines: { _id: Id<"machines">; name: string; hostname: string; pairedAt: number }[] = [];
  private repos: { _id: Id<"repos">; name: string; machineId: Id<"machines">; path: string; defaultBranch: string; setupCommand: string | null; createdAt: number }[] = [];
  private patches = new Map<string, Partial<Pick<CrewRow, "name" | "specialty" | "harness" | "effort" | "model" | "avatar" | "look">>>();
  private dismissed = new Set<string>();
  private hires: Hire[] = [];
  private threads: DThread[] = [];
  /** Follow-ups and replies in any thread (the story's too), by thread id. */
  private extra = new Map<string, DMessage[]>();
  private answeredStory = new Set<string>();
  private stoppedStory = new Map<string, number>();
  private seen = new Set<string>();
  private folders = new Map<string, FolderReq>();
  private editors = new Map<string, number>();
  private looks = new Map<string, { at: number; look: unknown }>();
  private n = 0;
  private invite: { token: string; createdAt: number; expiresAt: number } | null = null;
  private baseCache: { key: string; state: ShipState } | null = null;

  constructor(setup: DemoSetup, clock: () => number = () => Date.now()) {
    this.clock = clock;
    this.t0 = clock();
    this.scene = setup.scene;
    this.officeMade = setup.office;
    this.cast = setup.cast === undefined ? (setup.office ? null : new Set(STARTING_CAST)) : setup.cast && new Set(setup.cast);
    this.folderDelay = setup.folderDelayMs ?? 1600;
    this.fixtures = { offline: !!setup.offline, failDiffs: !!setup.failDiffs, noRepos: !!setup.noRepos, folderError: setup.folderError ?? null };
    if (setup.machine) this.machines.push({ _id: id<"machines">("machine_studio"), name: "Studio", hostname: "studio.local", pairedAt: this.t0 - 86_400_000 });
    if (setup.repos && setup.machine) {
      for (const r of STORY_REPOS) this.repos.push({ ...r, setupCommand: r.setupCommand, createdAt: this.t0 - 86_400_000 });
    }
  }

  // ---- time ----

  now() { return this.clock(); }
  /** Seconds since the demo started. */
  elapsed() { return (this.now() - this.t0) / 1000; }
  /** Everything happens `seconds` sooner: the night's story, and every thread you started. */
  skip(seconds: number) {
    const ms = seconds * 1000;
    this.t0 -= ms;
    for (const th of this.threads) this.shift(th, -ms);
    for (const h of this.hires) { h.hiredAt -= ms; h.arrivesAt -= ms; }
    for (const list of this.extra.values()) for (const m of list) m.at -= ms;
    for (const r of this.folders.values()) r.at -= ms;
  }

  /** Moves one thread of yours `ms` later (negative: sooner). */
  private shift(th: DThread, ms: number) {
    th.at += ms;
    if (th.ask) { th.ask.askAt += ms; if (th.ask.answeredAt !== null) th.ask.answeredAt += ms; }
    for (const q of th.questions.values()) { q.askAt += ms; if (q.answeredAt !== null) q.answeredAt += ms; }
    for (const t of th.tasks) if (t.stoppedAt !== null) t.stoppedAt += ms;
  }

  /** Lines a thread up so its first landing happens `seconds` from now (answering what it asks): for toasts. */
  landIn(threadId: string, seconds: number) {
    const th = this.threads.find((t) => t.id === threadId);
    if (!th) return;
    this.answerAll(threadId);
    const first = Math.min(...th.tasks.map((t) => this.taskEnd(th, t)));
    if (Number.isFinite(first)) this.shift(th, this.now() + seconds * 1000 - first);
  }

  private storyS() {
    return this.scene === "night" ? Math.min(NIGHT_FROM + this.elapsed(), NIGHT_TO) : DAY_AT;
  }
  private epoch() {
    return this.t0 - (this.scene === "night" ? NIGHT_FROM : DAY_AT) * 1000;
  }
  /** The story's ship now (cached per tenth of a second). */
  private base(): ShipState {
    const s = Math.round(this.storyS() * 10) / 10;
    const key = `${this.epoch()}:${s}:${this.seen.size}`;
    if (this.baseCache?.key !== key) this.baseCache = { key, state: shipAt(this.epoch(), s, new Set([...this.seen].map((x) => x.replace(/^task_/, "")))) };
    return this.baseCache.state;
  }
  /** Story threads only exist on a ship that came with them. */
  private storyOn() { return this.cast === null; }

  // ---- setup actions (the demo badge, the gallery) ----

  hasOffice() { return this.officeMade; }
  hasMachine() { return this.machines.length > 0; }

  /** A runner pairs, as if `npx …` had been run and approved. */
  pairMachine(name = "MacBook Pro") {
    const n = this.machines.length + 1;
    const m = { _id: id<"machines">(`machine_demo${n}`), name, hostname: `${slugOf(name)}.local`, pairedAt: this.now() };
    this.machines.push(m);
    return m;
  }

  /** Starts a thread, as if you'd asked `secondsAgo` ago. */
  startThread(text: string, secondsAgo = 0): string {
    return this.createThread(text, this.now() - secondsAgo * 1000);
  }

  /** Answers everything a thread will ask, a moment after it asks (allow; the first option): for states that start later on. */
  answerAll(threadId: string) {
    const th = this.threads.find((t) => t.id === threadId);
    if (!th) return;
    if (th.ask && th.ask.answeredAt === null) { th.ask.answeredAt = th.ask.askAt + 1500; th.ask.answer = th.ask.options?.[0] ?? "Yes"; }
    th.tasks.forEach((t, i) => {
      if (!t.question || th.questions.get(t.key)?.answeredAt != null) return;
      const askAt = this.taskStart(th, t, i) + 9000;
      th.questions.set(t.key, { id: `question_${t.key}`, askAt, answeredAt: askAt + 1500, answer: "allow", kind: "approval", prompt: t.question.prompt, options: t.question.options });
    });
  }

  /** Brings someone aboard by helicopter, landing in `inSeconds`. */
  hire(name?: string, inSeconds = 12): string {
    const taken = new Set([...this.crewRows().map((c) => c.name), ...this.hires.map((h) => h.name)].map((x) => x.toLowerCase()));
    const nm = name ?? HIRES.find((x) => !taken.has(x.toLowerCase())) ?? `Crew ${this.hires.length + 1}`;
    const handle = slugOf(nm);
    const r = randomCrewAvatar(`demo-${handle}`);
    const h: Hire = { id: `crew_hire_${handle}`, thread: null, name: nm, handle, harness: this.defaultHarness, specialty: null, avatar: r.spec, look: r.look, hiredAt: this.now(), arrivesAt: this.now() + inSeconds * 1000 };
    this.hires.push(h);
    return h.id;
  }

  // ---- crew ----

  /** Everyone aboard right now, as world.snapshot draws them. */
  private crewRows(): CrewRow[] {
    const now = this.now();
    const base = this.base().snapshot.crew;
    const out: CrewRow[] = [];
    for (const c of base) {
      if (c.role === "crew" && this.cast && !this.cast.has(c.handle)) continue;
      if (this.dismissed.has(c._id)) continue;
      let row: CrewRow = { ...c, ...(this.patches.get(c._id) ?? {}) };
      if (c.role === "computer" && !this.storyOn()) row = { ...row, live: null, lastEnded: null };
      if (!this.storyOn() && c.role === "crew") row = { ...row, live: null, lastEnded: null, lastStep: null, asking: false };
      const stopped = row.live ? this.stoppedStory.get(row.live.runId) : undefined;
      if (stopped !== undefined && row.live) {
        row = { ...row, lastEnded: { state: "interrupted", endedAt: stopped, kind: row.live.kind, taskTitle: row.live.taskTitle, taskId: row.live.taskId, threadId: row.live.threadId, diff: null }, live: null };
      }
      out.push(row);
    }
    for (const h0 of this.hires) {
      if (this.dismissed.has(h0.id)) continue;
      const h = this.hireTimes(h0);
      if (!h) continue;
      out.push({
        _id: id<"crew">(h.id), _creationTime: h.hiredAt, officeId: id<"offices">(OFFICE), role: "crew", name: h.name, handle: h.handle,
        avatar: h.avatar, look: h.look, specialty: h.specialty, harness: h.harness, model: null, effort: "high", profile: null,
        hiredAt: h.hiredAt, arrivesAt: h.arrivesAt, dismissedAt: null, live: null, lastEnded: null, lastStep: null, asking: false,
        ...(this.patches.get(h.id) ?? {}),
      } as CrewRow);
    }
    for (const [cid, lk] of this.looks) {
      const i = out.findIndex((c) => c._id === cid);
      if (i >= 0 && lk.at <= now) out[i] = { ...out[i]!, look: lk.look };
    }
    // What your threads have them doing.
    const views = this.threads.map((th) => this.view(th, now));
    const story = new Set(this.base().snapshot.questions.filter((q) => !this.answeredStory.has(q._id)).map((q) => q.crewId as string));
    return out.map((c) => {
      let live = c.live, lastEnded = c.lastEnded, lastStep = c.lastStep;
      let asking = c.asking && story.has(c._id);
      for (const v of views) {
        const l = v.live.get(c._id);
        if (l) { if (l.live || !live) live = l.live; lastStep = l.lastStep; asking = asking || l.asking; }
        const e = v.ended.get(c._id);
        if (e && (!lastEnded || e.endedAt >= lastEnded.endedAt) && !l) { lastEnded = e; lastStep = null; }
      }
      return { ...c, live, lastEnded, lastStep, asking };
    });
  }

  /** Free to take work: aboard, not working, not already given a task of yours that hasn't ended. */
  private freeCrew(): CrewRow[] {
    const busy = new Set(this.threads.flatMap((th) => th.tasks.filter((t) => this.taskEnd(th, t) > this.now() && t.stoppedAt === null).map((t) => t.crewId)));
    return this.crewRows().filter((c) => c.role === "crew" && !c.live && !busy.has(c._id) && c.arrivesAt <= this.now() + 60_000);
  }

  // ---- your threads ----

  private createThread(text: string, at: number): string {
    const n = ++this.n;
    const title = text.trim().replace(/\s+/g, " ").slice(0, 120);
    const th: DThread = {
      n, id: `thread_d${n}`, title, at, slug: slugOf(title), ask: null, blocked: null, tasks: [], questions: new Map(), hiredCrew: [], reply: "", plan: "", prs: 400 + n * 13,
    };
    if (!this.machines.length || !this.repos.length) {
      th.blocked = !this.machines.length
        ? "I can't start yet: no machine is connected, so there's nowhere for the crew to work. Connect one from the phone's **Ship** tab (in the demo, the badge in the corner pairs one), then ask again."
        : "I can't start yet: the ship has no repos. Add one from the phone's **Ship** tab, then ask again.";
      this.threads.unshift(th);
      return th.id;
    }
    // One task per part of the ask ("x and y, z"), at most three; one part gets a test task beside it.
    const parts = title.split(/\s*(?:,|;|\band\b|\bplus\b|\balso\b)\s*/i).map((p) => p.replace(/^(please|then|can you|could you)\s+/i, "").trim()).filter((p) => p.length > 2 && !/^hire\b/i.test(p)).slice(0, 3);
    const single = parts.length < 2;
    const titles = single ? [cap(parts[0] ?? title), "Cover it with tests"] : parts.map(cap);
    const free = this.freeCrew();
    const wantHire = /\bhire\b/i.test(title) || free.length < titles.length;
    th.tasks = titles.map((t, i): DTask => {
      // A lone ask and its tests stay in one repo; separate parts spread over the ship's repos.
      const repo = this.repos[single ? 0 : i % this.repos.length]!.name;
      const key = `d${n}_${i}`;
      const words = slugOf(t).split("-");
      const area = words.find((w) => w.length > 3) ?? "app";
      const h = hash(key + t);
      return {
        key, title: t, brief: `${t}. Keep it small, with tests.`, repo, crewId: "",
        steps: [["read", `Read src/${area}/index.ts`], ["search", `rg -n "${area}" src`], ["edit", `Edit src/${area}/${cap(area)}.tsx`], ["write", `Write src/${area}/${area}.test.ts`], ["bash", "pnpm test"]],
        diff: { added: 20 + (h % 180), removed: (h >>> 8) % 40, files: 1 + ((h >>> 16) % 7) },
        question: i === 0 ? { prompt: repo === "api" ? "pnpm db:migrate --env dev" : "pnpm add -D @testing-library/user-event", options: ["allow", "always", "deny"] } : null,
        stoppedAt: null,
      };
    });
    // Every second thread, Computah checks something with you before it plans.
    if (n % 2 === 0 || /\?\s*$|\bask me\b/i.test(title)) {
      th.ask = { id: `question_d${n}_ask`, askAt: at + 2500, answeredAt: null, answer: null, kind: "input", prompt: `Before I plan “${title}”: should it go out behind a feature flag, or straight to everyone?`, options: ["Behind a flag", "Straight to everyone"] };
    }
    th.tasks.forEach((t, i) => {
      const last = i === th.tasks.length - 1;
      const someone = free[i];
      if (someone && !(wantHire && last)) { t.crewId = someone._id; return; }
      // Nobody free (or you asked for a hire): Computah hires, and they fly in once it has planned.
      const hid = this.hire(undefined, 16);
      this.hires.find((x) => x.id === hid)!.thread = th.id;
      th.hiredCrew.push(hid);
      t.crewId = hid;
    });
    const names = th.tasks.map((t) => `**${this.crewName(t.crewId)}**`);
    const hired = !th.hiredCrew.length ? "" : /\bhire\b/i.test(title) ? ` As asked, I've hired ${names.at(-1)}; they're on the helicopter.` : ` Everyone else is busy, so I've hired ${names.at(-1)}; they're on the helicopter.`;
    const where = (t: DTask) => (this.repos.length > 1 ? ` in **${t.repo}**` : "");
    th.reply = single
      ? `On it. ${names[0]} builds it${where(th.tasks[0]!)}, and ${names[1]} covers it with tests once there's something to test.${hired}`
      : `On it: ${th.tasks.length} tasks. ${th.tasks.map((t, i) => `${names[i]} takes ${t.title.charAt(0).toLowerCase() + t.title.slice(1)}${where(t)}`).join("; ")}.${hired}`;
    th.plan = `${th.tasks.length} tasks across ${[...new Set(th.tasks.map((t) => t.repo))].join(" and ")}.`;
    this.threads.unshift(th);
    return th.id;
  }

  /** A hire's times: one Computah hires lands HELI_MS after its plan, and isn't aboard before it hires them. */
  private hireTimes(h: Hire): Hire | null {
    if (!h.thread) return h;
    const th = this.threads.find((x) => x.id === h.thread);
    const plan = th ? this.planAt(th) : Infinity;
    if (!Number.isFinite(plan) || this.now() < plan - 1200) return null;
    return { ...h, hiredAt: plan - 1200, arrivesAt: plan + HELI_MS };
  }

  /** When Computah plans: a few seconds after you ask, or after you answer its question. */
  private planAt(th: DThread): number {
    if (th.blocked) return Infinity;
    if (th.ask) return th.ask.answeredAt === null ? Infinity : th.ask.answeredAt + 3500;
    return th.at + 6000;
  }
  private taskStart(th: DThread, t: DTask, i: number): number {
    const plan = this.planAt(th);
    const hire = this.hires.find((h) => h.id === t.crewId && h.thread === th.id);
    return Math.max(plan + 1000 + i * 600, hire ? plan + HELI_MS + 1500 : 0);
  }
  private taskDuration(t: DTask, i: number) { return 26_000 + i * 8000 + (hash(t.key) % 6) * 1000; }
  /** When it lands (Infinity while it waits on you); a stopped task ends when stopped. */
  private taskEnd(th: DThread, t: DTask): number {
    const i = th.tasks.indexOf(t);
    const start = this.taskStart(th, t, i);
    if (t.stoppedAt !== null) return t.stoppedAt;
    let end = start + this.taskDuration(t, i);
    const q = th.questions.get(t.key);
    if (t.question) {
      const askAt = start + 9000;
      if (!q || q.answeredAt === null) return this.now() >= askAt ? Infinity : end;
      end += q.answeredAt - askAt;
    }
    return end;
  }

  /** One thread of yours at `now`: its rows, its messages, and what it has the crew doing. */
  private view(th: DThread, now: number) {
    const live = new Map<string, { live: CrewRow["live"]; lastStep: string | null; asking: boolean }>();
    const ended = new Map<string, NonNullable<CrewRow["lastEnded"]>>();
    const messages: DMessage[] = [{ at: th.at, author: "captain", kind: "text", text: th.title }];
    const questions: QuestionRow[] = [];
    const tasks: TaskRow[] = [];
    const events = new Map<string, { seq: number; at: number; event: RunEvent }[]>();
    const plan = this.planAt(th);
    const branch = `offsite/${th.slug}`;
    const tid = id<"threads">(th.id);
    let computer: { live: NonNullable<CrewRow["live"]> | null; ended: number | null; asking: boolean } = { live: null, ended: null, asking: false };
    const cLive = (from: number, step: [Kind, string], stepAt: number, run: string) => ({
      runId: id<"runs">(run), kind: "computer", state: "working", threadId: tid, threadTitle: th.title, taskId: null, taskTitle: null, repo: null,
      step: { itemId: `${run}-${stepAt}`, kind: step[0], summary: step[1], since: stepAt }, startedAt: from,
    } as NonNullable<CrewRow["live"]>);

    if (th.blocked) {
      if (now >= th.at + 1500) messages.push({ at: th.at + 1500, author: "computer", kind: "text", text: th.blocked, stream: 1.2 });
      else computer = { live: cLive(th.at, ["read", "Looking for a machine"], th.at, `run_${th.id}_c`), ended: null, asking: false };
    } else {
      // Computah reads, maybe asks you, replies and plans.
      const thinkTo = Math.min(plan, th.ask && now >= th.ask.askAt && th.ask.answeredAt === null ? th.ask.askAt : plan);
      if (th.ask && now >= th.ask.askAt) {
        if (th.ask.answeredAt === null) {
          computer.asking = true;
          questions.push(this.questionRow(th.ask, th, COMPUTER, COMPUTER_NAME, `run_${th.id}_c`));
        } else {
          messages.push({ at: th.ask.answeredAt, author: "captain", kind: "text", text: th.ask.answer ?? "" });
        }
      }
      if (now >= th.at && now < thinkTo) {
        const steps: [number, [Kind, string]][] = [[th.at, ["read", `Reading ${this.repos.map((r) => r.name).join(" and ")}`]], [th.at + 1500, ["search", "Looking at how it's done today"]], [plan - 2500, ["plan", "Planning"]]];
        if (th.hiredCrew.length) steps.push([plan - 1200, ["agent", `Hiring ${this.crewName(th.hiredCrew[0]!)}`]]);
        const cur = [...steps].reverse().find(([x]) => x <= now) ?? steps[0]!;
        computer = { ...computer, live: cLive(th.at, cur[1], cur[0], `run_${th.id}_c`) };
      }
      const heard = th.ask?.answer ? `${cap(th.ask.answer.replace(/[.!]+$/, ""))} it is. ` : "";
      if (now >= plan - 3000 && Number.isFinite(plan)) messages.push({ at: plan - 3000, author: "computer", kind: "text", text: heard + th.reply, stream: 2.2 });
      if (now >= plan) messages.push({ at: plan, author: "computer", kind: "plan", text: th.plan });
    }

    // The crew's tasks.
    let allEnded = th.tasks.length > 0 && Number.isFinite(plan);
    let lastLand = 0;
    th.tasks.forEach((t, i) => {
      if (now < plan) return;
      const start = this.taskStart(th, t, i);
      const end = this.taskEnd(th, t);
      const runId = `run_task_${t.key}`;
      const q = th.questions.get(t.key);
      const askAt = start + 9000;
      if (t.question && !q && now >= askAt && t.stoppedAt === null) {
        th.questions.set(t.key, { id: `question_${t.key}`, askAt, answeredAt: null, answer: null, kind: "approval", prompt: t.question.prompt, options: t.question.options });
      }
      const openQ = th.questions.get(t.key);
      const waiting = !!openQ && openQ.answeredAt === null && t.stoppedAt === null;
      const stopped = t.stoppedAt !== null && now >= t.stoppedAt;
      const landed = !stopped && now >= end;
      const state: TaskRow["state"] = stopped ? "cancelled" : landed ? "landed" : now >= end - 1200 ? "review" : now >= start ? "doing" : "todo";
      if (!landed && !stopped) allEnded = false;
      if (landed) lastLand = Math.max(lastLand, end);
      // Where they are in their steps (frozen while they wait on you).
      const every = 5000;
      const runFor = (waiting ? openQ!.askAt : Math.min(now, end)) - start - (openQ?.answeredAt != null ? openQ.answeredAt - openQ.askAt : 0);
      const k = Math.max(0, Math.floor(runFor / every));
      const step = t.steps[k % t.steps.length]!;
      const stepSince = start + k * every + (openQ?.answeredAt != null && openQ.answeredAt < now ? openQ.answeredAt - openQ.askAt : 0);
      if (state === "doing" || state === "review") {
        live.set(t.crewId, {
          live: {
            runId: id<"runs">(runId), kind: "task", state: state === "review" ? "landing" : "working", threadId: tid, threadTitle: th.title,
            taskId: id<"tasks">(`task_${t.key}`), taskTitle: t.title, repo: t.repo,
            step: waiting ? { itemId: `${t.key}-ask`, kind: "bash", summary: t.question!.prompt, since: openQ!.askAt } : { itemId: `${t.key}-${k}`, kind: step[0], summary: step[1], since: stepSince },
            startedAt: start,
          } as NonNullable<CrewRow["live"]>,
          lastStep: k > 0 ? t.steps[(k - 1) % t.steps.length]![1] : null,
          asking: waiting,
        });
      }
      if (landed || stopped) {
        ended.set(t.crewId, { state: landed ? "landed" : "interrupted", endedAt: landed ? end : t.stoppedAt!, kind: "task", taskTitle: t.title, taskId: id<"tasks">(`task_${t.key}`), threadId: tid, diff: landed ? t.diff : null });
      }
      if (waiting) questions.push(this.questionRow(openQ!, th, id<"crew">(t.crewId), this.crewName(t.crewId), runId));
      if (landed) messages.push({ at: end, author: t.crewId, kind: "report", text: `${t.title}: done, with tests, in ${t.diff.files} file${t.diff.files === 1 ? "" : "s"}.${openQ?.answer === "deny" ? " I skipped the step you denied." : ""}`, task: t.key });
      tasks.push({
        _id: id<"tasks">(`task_${t.key}`), _creationTime: plan, threadId: tid, officeId: id<"offices">(OFFICE), key: t.key,
        repoId: this.repos.find((r) => r.name === t.repo)?._id ?? null, title: t.title, brief: t.brief, dependsOn: [], assignee: id<"crew">(t.crewId), state,
        branch: state === "todo" ? null : `${branch}/${t.key}`, report: landed ? "Done." : null, notes: null, createdAt: plan,
        landedAt: landed ? end : null, diff: landed ? t.diff : null, seenAt: this.seen.has(`task_${t.key}`) ? end : null, repo: t.repo,
      } as TaskRow);
      // Its run, as events, for the crew tab's Watch.
      const ev: { seq: number; at: number; event: RunEvent }[] = [];
      const push = (at: number, event: RunEvent) => ev.push({ seq: ev.length, at, event });
      if (now >= start) {
        push(start, { type: "session.started", resumeCursor: null });
        push(start, { type: "turn.started", turnId: "t1" });
        for (let j = Math.max(0, k - 12); j <= k; j++) {
          const [kind, summary] = t.steps[j % t.steps.length]!;
          const at = start + j * every;
          push(at, { type: "item.started", itemId: `${t.key}-${j}`, kind, summary });
          if (j < k || landed) push(at + every * 0.8, { type: "item.completed", itemId: `${t.key}-${j}`, summary, detail: null, ok: true, ms: every * 0.8 });
          if (j === 1 && openQ) {
            push(openQ.askAt, { type: "request.opened", requestId: openQ.id, kind: "approval", prompt: openQ.prompt, options: openQ.options });
            if (openQ.answeredAt !== null) push(openQ.answeredAt, { type: "request.resolved", requestId: openQ.id, decision: openQ.answer ?? "allow" });
          }
        }
        if (landed) push(end, { type: "content.final", text: `${t.title}: done, with tests.` });
      }
      events.set(runId, ev);
    });

    // Computah reviews, opens the pull requests, and finishes.
    const landedTasks = tasks.filter((t) => t.state === "landed");
    const reviewAt = lastLand + 3000, doneAt = reviewAt + 7000;
    const done = allEnded && landedTasks.length > 0 && now >= doneAt;
    if (allEnded && landedTasks.length && now >= reviewAt && now < doneAt) {
      computer = { ...computer, live: cLive(reviewAt, now < reviewAt + 4500 ? ["read", `Reviewing ${landedTasks.length} task${landedTasks.length === 1 ? "" : "s"}`] : ["bash", "gh pr create"], now < reviewAt + 4500 ? reviewAt : reviewAt + 4500, `run_${th.id}_review`) };
    }
    if (done) {
      computer = { ...computer, ended: doneAt };
      const repos = [...new Set(landedTasks.map((t) => t.repo).filter((r): r is string => !!r))];
      messages.push({
        at: doneAt, author: "system", kind: "system",
        text: `${th.title}\n${landedTasks.length === 1 ? "One task landed" : `All ${landedTasks.length} tasks landed`}, reviewed and tested together: ${landedTasks.map((t) => t.title.charAt(0).toLowerCase() + t.title.slice(1)).join("; ")}.\n\nPull request${repos.length === 1 ? "" : "s"}: ${repos.map((r, i) => `**${r} #${th.prs + i}**`).join(" and ")}, on ${branch}.`,
      });
    } else if (computer.live === null && Number.isFinite(plan) && now >= plan) {
      computer = { ...computer, ended: plan };
    }
    for (const m of this.extra.get(th.id) ?? []) if (m.at <= now) messages.push(m);
    messages.sort((a, b) => a.at - b.at);

    const repos = [...new Set(landedTasks.map((t) => t.repo).filter((r): r is string => !!r))];
    const prs = done ? repos.map((r, i) => ({ repo: r, url: `https://github.com/acme/${r}/pull/${th.prs + i}` as string | null, branch })) : [];
    const diff = landedTasks.length ? landedTasks.reduce((a, t) => ({ added: a.added + t.diff!.added, removed: a.removed + t.diff!.removed, files: a.files + t.diff!.files }), { added: 0, removed: 0, files: 0 }) : null;
    const row = {
      _id: tid, title: th.title, state: done ? "done" : tasks.some((t) => t.state !== "todo" && t.state !== "cancelled") ? "working" : "open",
      branch: tasks.some((t) => t.branch) ? branch : null, prUrl: prs[0]?.url ?? null, repos: [...new Set(tasks.map((t) => t.repo).filter((r): r is string => !!r))], prs,
      createdAt: th.at, lastMessageAt: Math.max(...messages.map((m) => m.at)), crewIds: [...new Set(tasks.map((t) => t.assignee).filter((x): x is Id<"crew"> => !!x))],
      tasks: { total: tasks.length, landed: landedTasks.length }, diff, openQuestions: questions.length, startedBy: null,
    } as ThreadRow;
    if (computer.live || computer.asking) live.set(COMPUTER, { live: computer.live, lastStep: null, asking: computer.asking });
    else if (computer.ended !== null) ended.set(COMPUTER, { state: "landed", endedAt: computer.ended, kind: "computer", taskTitle: null, taskId: null, threadId: tid, diff: null });
    return { row, messages, tasks, questions, live, ended, events, done };
  }

  private questionRow(q: DQuestion, th: DThread, crewId: Id<"crew">, crewName: string, runId: string): QuestionRow {
    return {
      _id: id<"questions">(q.id), _creationTime: q.askAt, officeId: id<"offices">(OFFICE), threadId: id<"threads">(th.id), runId: id<"runs">(runId), crewId,
      requestId: q.id, kind: q.kind, prompt: q.prompt, options: q.options, answer: null, answeredAt: null, deliveredAt: null, askedOf: null, createdAt: q.askAt, crewName,
    } as QuestionRow;
  }

  private crewName(crewId: string) {
    return this.hires.find((h) => h.id === crewId)?.name ?? this.base().snapshot.crew.find((c) => c._id === crewId)?.name ?? "Someone";
  }

  private message(m: DMessage, threadId: string, i: number): MessageRow {
    const now = this.now();
    const streaming = m.stream !== undefined && now < m.at + m.stream * 1000;
    const text = streaming ? m.text.slice(0, Math.max(1, Math.floor(m.text.length * ((now - m.at) / (m.stream! * 1000))))) : m.text;
    return {
      _id: id<"messages">(`message_${threadId}_${m.at}_${i}`), _creationTime: m.at, threadId: id<"threads">(threadId),
      author: m.author === "captain" ? { kind: "captain" } : m.author === "system" ? { kind: "system" } : { kind: "crew", crewId: id<"crew">(m.author === "computer" ? COMPUTER : m.author) },
      kind: m.kind, text, runId: null, taskId: m.task ? id<"tasks">(`task_${m.task}`) : null, streaming, createdAt: m.at,
    } as MessageRow;
  }

  // ---- the answers ----

  private views() { const now = this.now(); return this.threads.map((th) => ({ th, v: this.view(th, now) })); }

  private office(): R<typeof api.offices.get> {
    if (!this.officeMade) return undefined as unknown as R<typeof api.offices.get>;
    const first = this.repos[0];
    const machine = first ? this.machines.find((m) => m._id === first.machineId) : undefined;
    return {
      _id: id<"offices">(OFFICE), _creationTime: this.t0 - 86_400_000 * 30, ownerId: USER, name: this.officeName, world: "yacht",
      defaultHarness: this.defaultHarness, createdAt: this.t0 - 86_400_000 * 30,
      role: "owner", owner: { _id: USER, name: this.me.name }, membersCanAsk: true,
      repos: this.repos.map((r) => ({ _id: r._id, name: r.name, machineId: r.machineId, path: r.path, defaultBranch: r.defaultBranch, setupCommand: r.setupCommand })),
      machine: machine ? { _id: machine._id, name: machine.name, lastSeenAt: this.now() } : null,
    } as R<typeof api.offices.get>;
  }

  snapshot(): R<typeof api.world.snapshot> {
    const crew = this.crewRows();
    const storyQs = this.storyOn() ? this.base().snapshot.questions.filter((q) => !this.answeredStory.has(q._id)) : [];
    const mine = this.views().flatMap(({ v }) => v.questions);
    return {
      office: { _id: id<"offices">(OFFICE), name: this.officeName, world: "yacht", hasRepo: this.repos.length > 0, repos: this.repos.map((r) => r.name) },
      crew,
      questions: [...storyQs, ...mine].sort((a, b) => a.createdAt - b.createdAt),
    } as R<typeof api.world.snapshot>;
  }

  threadList(): R<typeof api.threads.list> {
    const mine = this.views().map(({ v }) => v.row);
    const answered = new Set(this.answeredStory);
    const story = this.storyOn() ? this.base().threads.map((t) => {
      const extra = this.extra.get(t._id) ?? [];
      const last = Math.max(t.lastMessageAt, ...extra.filter((m) => m.at <= this.now()).map((m) => m.at));
      const open = this.base().snapshot.questions.filter((q) => q.threadId === t._id && !answered.has(q._id)).length;
      return { ...t, lastMessageAt: last, openQuestions: open };
    }) : [];
    return [...mine, ...story].sort((a, b) => b.lastMessageAt - a.lastMessageAt) as R<typeof api.threads.list>;
  }

  messages(threadId: string): R<typeof api.messages.list> {
    const mine = this.views().find(({ th }) => th.id === threadId);
    const now = this.now();
    if (mine) return mine.v.messages.map((m, i) => this.message(m, threadId, i)) as R<typeof api.messages.list>;
    const story = this.storyOn() ? this.base().messages.get(threadId) ?? [] : [];
    const extra = (this.extra.get(threadId) ?? []).filter((m) => m.at <= now).map((m, i) => this.message(m, threadId, 1000 + i));
    return [...story, ...extra].sort((a, b) => a.createdAt - b.createdAt) as R<typeof api.messages.list>;
  }

  tasks(threadId: string): R<typeof api.tasks.list> {
    const mine = this.views().find(({ th }) => th.id === threadId);
    if (mine) return mine.v.tasks as R<typeof api.tasks.list>;
    return (this.storyOn() ? this.base().tasks.get(threadId) ?? [] : []) as R<typeof api.tasks.list>;
  }

  deliveries(): R<typeof api.diffs.deliveries> {
    const mine = this.views().flatMap(({ v }) => v.tasks.filter((t) => t.state === "landed").map((t) => ({
      taskId: t._id, threadId: t.threadId, title: t.title, crewId: t.assignee!, crewName: this.crewName(t.assignee!), landedAt: t.landedAt!, diff: t.diff!, seen: this.seen.has(t._id),
    })));
    const story = this.storyOn() ? this.base().deliveries : [];
    return [...mine, ...story].sort((a, b) => b.landedAt - a.landedAt).slice(0, 40) as R<typeof api.diffs.deliveries>;
  }

  diff(threadId: string, taskId: string | null): R<typeof api.diffs.get> {
    const th = this.threads.find((t) => t.id === threadId);
    const now = this.now();
    if (!th) {
      if (!this.storyOn() || !this.base().threads.some((t) => t._id === threadId)) return null as unknown as R<typeof api.diffs.get>;
      return diffAt(this.epoch(), this.storyS(), threadId.replace(/^thread_/, ""), taskId ? taskId.replace(/^task_/, "") : null);
    }
    const v = this.view(th, now);
    const task = taskId ? v.tasks.find((t) => t._id === taskId) ?? null : null;
    const crew = task?.assignee ? this.crewRows().find((c) => c._id === task.assignee) : undefined;
    const tasks = task ? [task] : v.tasks;
    const landed = tasks.filter((t) => t.state === "landed");
    const repos = this.repos.filter((r) => tasks.some((t) => t.repo === r.name && t.state !== "todo"));
    return {
      thread: { _id: v.row._id, title: th.title, branch: v.row.branch ?? `offsite/${th.slug}`, state: v.row.state, prs: v.row.prs.map((p) => ({ repo: p.repo, url: p.url })), lastLandedAt: Math.max(0, ...landed.map((t) => t.landedAt ?? 0)) },
      task: task && { _id: task._id, key: task.key, title: task.title, state: task.state, branch: task.branch, diff: task.diff, landedAt: task.landedAt },
      crew: crew ? { _id: crew._id, name: crew.name, avatar: crew.avatar, look: crew.look } : null,
      repos: repos.map((r, i) => {
        const web = i % 2 === 0;
        const sum = landed.filter((t) => t.repo === r.name).reduce((a, t) => ({ added: a.added + t.diff!.added, removed: a.removed + t.diff!.removed, files: a.files + t.diff!.files }), { added: 0, removed: 0, files: 0 });
        const machine = this.machines.find((m) => m._id === r.machineId);
        return {
          repo: { _id: r._id, name: r.name, defaultBranch: r.defaultBranch },
          machine: machine ? { name: machine.name, online: !this.fixtures.offline } : null,
          diff: this.fixtures.failDiffs ? {
            state: "failed" as const, requestedAt: now - 2000, computedAt: null, sha: null, base: null, stats: null, files: [], patch: "", truncated: false,
            error: "git diff failed: the worktree for this task is gone (was it cleaned up by hand?).",
          } : landed.length || task?.state === "doing" ? {
            state: "ready" as const, requestedAt: now - 2000, computedAt: now - 1000, sha: "9f3c2e1", base: "a41b7d0",
            stats: task?.diff ?? sum, files: web ? SWEEP_FILES : API_FILES, patch: web ? SWEEP_PATCH : API_PATCH, truncated: false, error: null,
          } : null,
        };
      }),
    } as R<typeof api.diffs.get>;
  }

  events(runId: string): R<typeof api.runs.events> {
    for (const { v } of this.views()) { const e = v.events.get(runId); if (e) return e as R<typeof api.runs.events>; }
    if (this.storyOn()) return eventsAt(this.epoch(), this.storyS(), runId);
    return [];
  }

  me_(): R<typeof api.users.me> {
    return { _id: USER, name: this.me.name, email: null, avatar: this.me.avatar, look: this.me.look, aboardId: null } as R<typeof api.users.me>;
  }

  machineRows(): MachineRow[] {
    return this.machines.map((m) => ({
      _id: m._id, name: m.name, hostname: m.hostname, lastSeenAt: this.fixtures.offline ? this.now() - 3_600_000 : this.now(), online: !this.fixtures.offline,
      probe: [
        { harness: "claude", installed: true, version: "2.1.0", auth: "authenticated", email: null, plan: "max", message: null, profile: null },
        { harness: "codex", installed: true, version: "0.42.0", auth: "authenticated", email: null, plan: "pro", message: null, profile: null },
      ],
    })) as MachineRow[];
  }

  repoRows(): R<typeof api.repos.list> {
    return this.repos.map((r) => {
      const m = this.machines.find((x) => x._id === r.machineId);
      return { ...r, _creationTime: r.createdAt, officeId: id<"offices">(OFFICE), removedAt: null, machine: m ? { _id: m._id, name: m.name, lastSeenAt: this.now() } : null };
    }) as R<typeof api.repos.list>;
  }

  crewList(): R<typeof api.crew.list> {
    return this.crewRows().map(({ live: _l, lastEnded: _e, lastStep: _s, asking: _a, ...c }) => c) as R<typeof api.crew.list>;
  }

  folder(requestId: string): R<typeof api.folders.get> {
    const r = this.folders.get(requestId);
    if (!r) return null;
    const ready = this.now() >= r.at + this.folderDelay;
    return {
      _id: id<"folderRequests">(r.id), kind: r.result?.kind ?? (r.path === null ? "scan" : "browse"), path: r.path, state: ready ? (r.error ? "failed" : "ready") : "pending", requestedAt: r.at,
      answeredAt: ready ? r.at + this.folderDelay : null, result: ready ? r.result : null, error: ready ? r.error : null,
    } as R<typeof api.folders.get>;
  }

  // ---- what you do ----

  private act(name: string, a: Args): unknown {
    const now = this.now();
    switch (name) {
      case "users:ensure": return USER;
      case "users:setName": this.me.name = String(a["name"] ?? "Captain").slice(0, 20); return null;
      case "users:board": return null;
      case "users:setAvatar": this.me.avatar = a["avatar"]; this.me.look = a["look"] ?? null; return null;
      case "offices:create": {
        this.officeMade = true;
        this.officeName = String(a["name"] ?? "").trim() || "Sea Legs";
        if (a["defaultHarness"]) this.defaultHarness = a["defaultHarness"] as typeof this.defaultHarness;
        return OFFICE;
      }
      case "offices:update": {
        if (typeof a["name"] === "string" && a["name"].trim()) this.officeName = a["name"].trim().slice(0, 40);
        if (a["defaultHarness"]) this.defaultHarness = a["defaultHarness"] as typeof this.defaultHarness;
        return null;
      }
      case "machines:lookup": return { ok: true, name: "MacBook Pro", hostname: "macbook-pro.local", os: "darwin" };
      case "machines:approve": { const m = this.pairMachine(); return { ok: true, machineId: m._id, name: m.name }; }
      case "machines:deny": return null;
      case "machines:revoke": {
        this.machines = this.machines.filter((m) => m._id !== a["machineId"]);
        this.repos = this.repos.filter((r) => r.machineId !== a["machineId"]);
        return null;
      }
      case "repos:add": return this.addRepo(a);
      case "repos:addMany": return (a["repos"] as Args[]).map((r) => { this.addRepo({ ...r }); return this.repos.at(-1)!.name; });
      case "repos:update": {
        const r = this.repos.find((x) => x._id === a["repoId"]);
        if (!r) throw new Error("No such repo");
        Object.assign(r, { name: String(a["name"] ?? r.name), path: String(a["path"] ?? r.path), defaultBranch: String(a["defaultBranch"] ?? r.defaultBranch), setupCommand: (a["setupCommand"] as string | null | undefined) ?? r.setupCommand });
        return null;
      }
      case "repos:remove": this.repos = this.repos.filter((r) => r._id !== a["repoId"]); return null;
      case "folders:scan": return this.folderRequest("scan", null);
      case "folders:browse": return this.folderRequest("browse", String(a["path"] ?? "~"));
      case "threads:create": return this.createThread(String(a["text"] ?? ""), now);
      case "threads:send": {
        const tid = String(a["threadId"]);
        const text = String(a["text"] ?? "").trim();
        const list = this.extra.get(tid) ?? [];
        list.push({ at: now, author: "captain", kind: "text", text });
        const to = /^@(\w+)/.exec(text)?.[1];
        const who = to ? this.crewRows().find((c) => c.handle === to.toLowerCase()) : undefined;
        list.push({ at: now + 1800, author: "computer", kind: "text", text: who ? `Passed to **${who.name}**. They'll pick it up at their next step.` : "Noted. I'll fold that into the plan and tell whoever it touches.", stream: 1.2 });
        this.extra.set(tid, list);
        return null;
      }
      case "questions:answer": {
        const qid = String(a["questionId"]);
        const answer = String(a["answer"] ?? "");
        for (const th of this.threads) {
          if (th.ask?.id === qid && th.ask.answeredAt === null) { th.ask.answeredAt = now; th.ask.answer = answer; return null; }
          for (const q of th.questions.values()) if (q.id === qid && q.answeredAt === null) { q.answeredAt = now; q.answer = answer; return null; }
        }
        this.answeredStory.add(qid);
        return null;
      }
      case "runs:interrupt": {
        const runId = String(a["runId"]);
        for (const th of this.threads) for (const t of th.tasks) if (`run_task_${t.key}` === runId && t.stoppedAt === null) { t.stoppedAt = now; return null; }
        this.stoppedStory.set(runId, now);
        return null;
      }
      case "crew:hire": {
        const hid = this.hire(typeof a["name"] === "string" ? a["name"] : undefined);
        const h = this.hires.find((x) => x.id === hid)!;
        if (a["harness"]) h.harness = a["harness"] as Hire["harness"];
        if (typeof a["specialty"] === "string") h.specialty = a["specialty"];
        if (a["avatar"]) h.avatar = a["avatar"];
        return hid;
      }
      case "crew:update": {
        const { crewId, ...rest } = a;
        this.patches.set(String(crewId), { ...(this.patches.get(String(crewId)) ?? {}), ...rest });
        return null;
      }
      case "crew:dismiss": this.dismissed.add(String(a["crewId"])); return null;
      case "crew:describeLook": {
        const pick = CREW_PRESETS[hash(String(a["prompt"])) % CREW_PRESETS.length]!;
        // The look "comes back from the runner" a few seconds later (Creator.tsx waits for it on the row).
        this.looks.set(String(a["crewId"]), { at: now + 4000, look: pick.look });
        return `run_look_${now}`;
      }
      case "diffs:request": return null;
      case "diffs:seen": {
        if (a["taskId"]) this.seen.add(String(a["taskId"]));
        if (a["threadId"]) for (const t of this.tasks(String(a["threadId"])) ?? []) if (t.state === "landed") this.seen.add(t._id);
        return null;
      }
      case "diffs:openEditor": { const e = `editor_${now}`; this.editors.set(e, now); return e; }
      // Friends aboard: the demo captain sails alone, but can make and revoke an invite link.
      case "invites:create": { this.invite = { token: `DEMO${(now % 100000).toString(36).toUpperCase()}`, createdAt: now, expiresAt: now + 7 * 86_400_000 }; return { token: this.invite.token, expiresAt: this.invite.expiresAt }; }
      case "invites:revoke": this.invite = null; return null;
      case "invites:accept": return { officeId: OFFICE, ship: this.officeName, role: "owner", joined: false };
      case "members:remove": case "members:leave": return null;
      case "presence:join": return { now };
      case "presence:beat": return { now, replaced: false };
      case "presence:leave": return null;
      case "signals:send": return { sent: false };
      case "signals:ack": return null;
      default:
        warnOnce(`mutation ${name}`);
        return null;
    }
  }

  private addRepo(a: Args) {
    const path = String(a["path"] ?? "").trim();
    if (!path) throw new Error("Which folder? Type its path on that machine.");
    const base = String(a["name"] ?? path.replace(/[\\/]+$/, "").split(/[\\/]/).at(-1) ?? "repo").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "repo";
    let name = base, i = 2;
    while (this.repos.some((r) => r.name === name)) name = `${base}-${i++}`;
    const r = {
      _id: id<"repos">(`repo_${name}`), name, machineId: (a["machineId"] as Id<"machines">) ?? this.machines[0]?._id ?? id<"machines">("machine_studio"), path,
      defaultBranch: String(a["defaultBranch"] ?? "main"), setupCommand: (a["setupCommand"] as string | null | undefined) ?? null, createdAt: this.now(),
    };
    this.repos.push(r);
    return r._id;
  }

  private folderRequest(kind: "scan" | "browse", path: string | null): string {
    const rid = `folders_${this.folders.size + 1}`;
    const result = kind === "scan" ? scanResult(this.now()) : browseResult(path ?? "~", this.now());
    if (result.kind === "scan" && this.fixtures.noRepos) result.repos = [];
    this.folders.set(rid, { id: rid, at: this.now(), path, result: this.fixtures.folderError ? null : result, error: this.fixtures.folderError });
    return rid;
  }

  /** What a query answers. */
  query(name: string, a: Args): unknown {
    const handler = QUERIES[name as QueryName];
    if (!handler) { warnOnce(`query ${name}`); return undefined; }
    return handler(this, a);
  }

  /** What a mutation does. */
  mutate(name: string, a: Args): unknown {
    if (!(MUTATIONS as readonly string[]).includes(name)) { warnOnce(`mutation ${name}`); return null; }
    return this.act(name, a);
  }

  // For the queries table.
  /** @internal */ _office() { return this.office(); }
  /** @internal */ _offices(): R<typeof api.offices.mine> {
    const o = this.office();
    return (o ? [{ ...o, repoCount: this.repos.length }] : []) as R<typeof api.offices.mine>;
  }
  /** @internal */ _members(): R<typeof api.members.list> {
    return { me: USER, role: "owner", owner: { userId: USER, name: this.me.name, avatar: this.me.avatar ?? null, look: this.me.look ?? null }, members: [], membersCanAsk: true } as R<typeof api.members.list>;
  }
  /** @internal */ _invite(): R<typeof api.invites.current> {
    return this.invite ? { ...this.invite, used: 0 } as R<typeof api.invites.current> : null;
  }
  /** @internal */ _peek(): R<typeof api.invites.peek> {
    return { ok: true, officeId: id<"offices">(OFFICE), ship: this.officeName, world: "yacht", captain: { name: "Captain", avatar: null, look: null }, expiresAt: this.now() + 86_400_000, role: "owner" } as R<typeof api.invites.peek>;
  }
  /** @internal */ _editor(rid: string): R<typeof api.diffs.editorRequest> {
    const at = this.editors.get(rid);
    if (at === undefined) return null;
    return (this.now() >= at + 900 ? { doneAt: at + 900, ok: true, result: "Opened in your editor (demo: nothing really opens)" } : { doneAt: null, ok: null, result: null }) as R<typeof api.diffs.editorRequest>;
  }
}

/** Every Convex query demo mode answers, by its function name. */
const QUERIES = {
  "world:snapshot": (s: DemoShip) => s.snapshot(),
  "threads:list": (s: DemoShip) => s.threadList(),
  "threads:get": (s: DemoShip, a: Args) => s.threadList().find((t) => t._id === a["threadId"]) ?? null,
  "messages:list": (s: DemoShip, a: Args) => s.messages(String(a["threadId"])),
  "tasks:list": (s: DemoShip, a: Args) => s.tasks(String(a["threadId"])),
  "diffs:deliveries": (s: DemoShip) => s.deliveries(),
  "diffs:get": (s: DemoShip, a: Args) => s.diff(String(a["threadId"]), a["taskId"] ? String(a["taskId"]) : null),
  "diffs:editorRequest": (s: DemoShip, a: Args) => s._editor(String(a["requestId"])),
  "runs:events": (s: DemoShip, a: Args) => s.events(String(a["runId"])),
  "users:me": (s: DemoShip) => s.me_(),
  "offices:get": (s: DemoShip) => s._office(),
  "offices:mine": (s: DemoShip) => s._offices(),
  "machines:mine": (s: DemoShip) => s.machineRows(),
  "crew:list": (s: DemoShip) => s.crewList(),
  "repos:list": (s: DemoShip) => s.repoRows(),
  "folders:get": (s: DemoShip, a: Args) => s.folder(String(a["requestId"])),
  "members:joined": () => [],
  "members:list": (s: DemoShip) => s._members(),
  "presence:here": () => [],
  "invites:current": (s: DemoShip) => s._invite(),
  "invites:peek": (s: DemoShip) => s._peek(),
  "signals:inbox": () => [],
} satisfies Record<string, (s: DemoShip, a: Args) => unknown>;
type QueryName = keyof typeof QUERIES;

/** Every Convex mutation demo mode answers. */
const MUTATIONS = [
  "users:ensure", "users:setName", "users:setAvatar", "users:board",
  "offices:create", "offices:update",
  "machines:lookup", "machines:approve", "machines:deny", "machines:revoke",
  "repos:add", "repos:addMany", "repos:update", "repos:remove",
  "folders:scan", "folders:browse",
  "threads:create", "threads:send",
  "questions:answer", "runs:interrupt",
  "crew:hire", "crew:update", "crew:dismiss", "crew:describeLook",
  "diffs:request", "diffs:seen", "diffs:openEditor",
  "invites:create", "invites:revoke", "invites:accept", "members:remove", "members:leave",
  "presence:join", "presence:beat", "presence:leave", "signals:send", "signals:ack",
] as const;

export const DEMO_QUERIES: readonly string[] = Object.keys(QUERIES);
export const DEMO_MUTATIONS: readonly string[] = MUTATIONS;

const warned = new Set<string>();
function warnOnce(what: string) {
  if (warned.has(what)) return;
  warned.add(what);
  console.warn(`[demo] no fake answer for ${what}: add one in apps/web/src/demo/ship.ts (it does nothing here)`);
}

// ---- what the "runner" finds on your machine ----

const DAY = 86_400_000;
const found = (name: string, path: string, slug: string | null, ago: number, now: number, setup: string | null = "pnpm install", branch = "main"): FoundRepo => ({
  name, path, branch, defaultBranch: "main", remote: slug ? { host: "github.com", slug } : null, lastCommitAt: now - ago, setupCommand: setup,
});

function scanResult(now: number): FolderResult {
  return {
    kind: "scan", home: "/Users/captain", truncated: false, timedOut: false, roots: ["~/Developer", "~/code"],
    repos: [
      found("acme-web", "~/Developer/acme-web", "acme/web", 2 * 3_600_000, now, "pnpm install", "feat/billing"),
      found("acme-api", "~/Developer/acme-api", "acme/api", 5 * 3_600_000, now),
      found("design-system", "~/Developer/design-system", "acme/design-system", 3 * DAY, now),
      found("dotfiles", "~/code/dotfiles", "captain/dotfiles", 40 * DAY, now, null),
      found("blog", "~/code/blog", "captain/blog", 120 * DAY, now, "npm install"),
      found("scratch", "~/code/scratch", null, 400 * DAY, now, null, "master"),
    ],
  };
}

function browseResult(path: string, now: number): FolderResult {
  const at = path === "~" || path === "" ? "~" : path.replace(/\/+$/, "");
  const kids: Record<string, string[]> = { "~": ["Developer", "code", "Documents", "Downloads"], "~/Developer": ["acme-web", "acme-api", "design-system", "experiments"], "~/code": ["blog", "dotfiles", "scratch"] };
  const repos = new Set(["acme-web", "acme-api", "design-system", "blog", "dotfiles", "scratch"]);
  const names = kids[at] ?? [];
  const leaf = at.split("/").at(-1) ?? "";
  return {
    kind: "browse", home: "/Users/captain", path: at, parent: at === "~" ? null : at.split("/").slice(0, -1).join("/") || "~",
    repo: repos.has(leaf) ? found(leaf, at, null, 9 * DAY, now) : null,
    folders: names.map((n) => ({ name: n, path: `${at}/${n}`, repo: repos.has(n) ? found(n, `${at}/${n}`, n.startsWith("acme") ? `acme/${n.slice(5)}` : null, (hash(n) % 30) * DAY, now) : null })),
    truncated: false,
  };
}
