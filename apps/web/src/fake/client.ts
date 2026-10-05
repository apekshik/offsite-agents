import { getFunctionName, type FunctionReference } from "convex/server";
import type { ConvexReactClient } from "convex/react";

// A stand-in for ConvexReactClient that answers from code instead of a deployment. It is the least invasive way to
// run the real interface without a backend: every component keeps its own useQuery / useMutation calls, and
// <ConvexProvider client={fake.asClient()}> hands them this. It implements the part of the client that convex/react's
// hooks and ConvexProviderWithAuth use (watchQuery, mutation, action, auth, connection state), nothing else.
//
// Subclasses say what each function answers (answer, run) and call refresh() when their world moves on. Each query's
// answer is cached and keeps its identity until its content changes, so React only re-renders what moved.
//
// Used by the film rig (src/film/backend.ts: a scripted ship on a virtual clock) and demo mode (src/demo: a ship that
// plays out in real time and answers what you do).

export type Args = Record<string, unknown>;
type Listener = () => void;

export abstract class FakeConvexClient {
  private readonly cache = new Map<string, { json: string; value: unknown }>();
  private readonly listeners = new Set<Listener>();

  /** What a query answers right now. `undefined` reads as loading. */
  protected abstract answer(name: string, args: Args): unknown;
  /** What a mutation (or action) does and returns. Throw to make it fail the way a real one does. */
  protected abstract run(name: string, args: Args): unknown;

  /** Asks every watched query again; tells the hooks if any answer changed. */
  refresh() {
    let changed = false;
    for (const [key, entry] of this.cache) {
      const [name, json] = splitKey(key);
      const value = this.safeAnswer(name, JSON.parse(json) as Args);
      const next = JSON.stringify(value) ?? "undefined";
      if (next !== entry.json) { this.cache.set(key, { json: next, value }); changed = true; }
    }
    if (changed) for (const fn of [...this.listeners]) fn();
  }

  private safeAnswer(name: string, args: Args): unknown {
    try { return this.answer(name, args); } catch (e) { console.error(`[fake convex] ${name} threw`, e); return undefined; }
  }

  private result(name: string, args: Args): unknown {
    const key = `${name}\u0000${JSON.stringify(args)}`;
    let entry = this.cache.get(key);
    if (!entry) {
      const value = this.safeAnswer(name, args);
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
    return this.run(getFunctionName(ref), args ?? {});
  }

  async action(ref: FunctionReference<"action">, args?: Args): Promise<unknown> {
    return this.run(getFunctionName(ref), args ?? {});
  }

  connectionState() {
    return { hasInflightRequests: false, isWebSocketConnected: true, timeOfOldestInflightRequest: null, hasEverConnected: true, connectionCount: 1, connectionRetries: 0, inflightMutations: 0, inflightActions: 0 };
  }
  subscribeToConnectionState() { return () => {}; }
  /** ConvexProviderWithAuth: whoever the auth hook says is signed in, the fake backend agrees. */
  setAuth(_fetchToken: unknown, onChange?: (isAuthenticated: boolean) => void) {
    if (onChange) queueMicrotask(() => onChange(true));
  }
  clearAuth() {}
  async close() {}
  get url() { return "fake://convex"; }

  /** For <ConvexProvider client=…>: the hooks only use the methods above. */
  asClient(): ConvexReactClient { return this as unknown as ConvexReactClient; }
}

function splitKey(key: string): [string, string] {
  const i = key.indexOf("\u0000");
  return [key.slice(0, i), key.slice(i + 1)];
}
