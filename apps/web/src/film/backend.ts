import { getFunctionName, type FunctionReference } from "convex/server";
import type { ConvexReactClient } from "convex/react";
import { at, diffAt, eventsAt, OFFICE, shipAt, type ShipState } from "./story.ts";

// A stand-in for ConvexReactClient that answers from the scripted ship (story.ts) instead of a
// deployment. It is the least invasive way to run the real interface: every component keeps its
// own useQuery / useMutation calls, and <ConvexProvider client={backend}> hands them this. It
// implements the part of the client that convex/react's hooks use (watchQuery, mutation, action,
// connection state), nothing else.
//
// Time comes from the film: update(storySeconds) once a frame. Each query's answer is cached and
// keeps its identity until its content changes, so React only re-renders what moved.

type Args = Record<string, unknown>;
type Listener = () => void;

export class FilmBackend {
  readonly epoch: number;
  private s = 0;
  private state: ShipState;
  private readonly cache = new Map<string, { json: string; value: unknown }>();
  private readonly listeners = new Set<Listener>();
  /** Tasks the captain has opened (their packages leave the counter). */
  readonly seen = new Set<string>();
  /** Every mutation the interface sent, for the film's log. */
  readonly sent: { name: string; args: Args; s: number }[] = [];

  constructor(epoch: number, s: number) {
    this.epoch = epoch;
    this.s = s;
    this.state = shipAt(epoch, s, this.seen);
  }

  /** Story time now (seconds). */
  get story() { return this.s; }
  get ship() { return this.state; }

  /** Moves the ship to story second s; tells the hooks if any answer changed. */
  update(s: number) {
    this.s = s;
    this.state = shipAt(this.epoch, s, this.seen);
    let changed = false;
    for (const [key, entry] of this.cache) {
      const [name, json] = splitKey(key);
      const value = this.answer(name, JSON.parse(json) as Args);
      const next = JSON.stringify(value) ?? "undefined";
      if (next !== entry.json) { this.cache.set(key, { json: next, value }); changed = true; }
    }
    if (changed) for (const fn of [...this.listeners]) fn();
  }

  private answer(name: string, args: Args): unknown {
    const st = this.state, s = this.s;
    switch (name) {
      case "world:snapshot": return st.snapshot;
      case "threads:list": return st.threads;
      case "threads:get": return st.threads.find((t) => t._id === args["threadId"]) ?? null;
      case "messages:list": return st.messages.get(String(args["threadId"])) ?? [];
      case "tasks:list": return st.tasks.get(String(args["threadId"])) ?? [];
      case "diffs:deliveries": return st.deliveries;
      case "diffs:get": return diffAt(this.epoch, s, String(args["threadId"]).replace(/^thread_/, ""), args["taskId"] ? String(args["taskId"]).replace(/^task_/, "") : null);
      case "diffs:editorRequest": return { doneAt: at(this.epoch, s), ok: true, result: "Opened in Cursor" };
      case "runs:events": return eventsAt(this.epoch, s, String(args["runId"]));
      case "users:me": return st.me;
      case "offices:get": return st.office;
      case "offices:mine": return [{ ...st.office, repoCount: st.office.repos.length }];
      case "machines:mine": return st.machines;
      case "machines:pending": return null;
      case "crew:list": return st.snapshot.crew;
      case "repos:list": return st.office.repos;
      default:
        console.warn(`[film] no scripted answer for ${name}`);
        return null;
    }
  }

  private result(name: string, args: Args): unknown {
    const key = `${name}\u0000${JSON.stringify(args)}`;
    let entry = this.cache.get(key);
    if (!entry) {
      const value = this.answer(name, args);
      entry = { json: JSON.stringify(value) ?? "undefined", value };
      this.cache.set(key, entry);
    }
    return entry.value;
  }

  // ---- what convex/react calls ----

  watchQuery(query: FunctionReference<"query">, args?: Args) {
    const name = getFunctionName(query);
    const a = args ?? {};
    return {
      onUpdate: (cb: Listener) => { this.listeners.add(cb); return () => { this.listeners.delete(cb); }; },
      localQueryResult: () => this.result(name, a),
      journal: () => undefined,
    };
  }

  async mutation(ref: FunctionReference<"mutation">, args?: Args): Promise<unknown> {
    const name = getFunctionName(ref);
    const a = args ?? {};
    this.sent.push({ name, args: a, s: this.s });
    switch (name) {
      // The story already has the thread the captain is about to start.
      case "threads:create": return "thread_dark";
      case "diffs:seen": {
        if (a["taskId"]) this.seen.add(String(a["taskId"]).replace(/^task_/, ""));
        this.update(this.s);
        return null;
      }
      case "diffs:openEditor": return "editor_1";
      default: return null;
    }
  }

  async action(): Promise<unknown> { return null; }
  connectionState() {
    return { hasInflightRequests: false, isWebSocketConnected: true, timeOfOldestInflightRequest: null, hasEverConnected: true, connectionCount: 1, connectionRetries: 0, inflightMutations: 0, inflightActions: 0 };
  }
  subscribeToConnectionState() { return () => {}; }
  setAuth() {}
  clearAuth() {}
  async close() {}
  get url() { return "film://ship"; }

  /** For <ConvexProvider client=…>: the hooks only use the methods above. */
  asClient(): ConvexReactClient { return this as unknown as ConvexReactClient; }

  static readonly office = OFFICE;
}

function splitKey(key: string): [string, string] {
  const i = key.indexOf("\u0000");
  return [key.slice(0, i), key.slice(i + 1)];
}
