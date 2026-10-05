// Adapted from Beam (github.com/SupraluminalIntelligence/beam, MIT).
import { expect, it } from "vitest";
import { onShutdown } from "./shutdown.ts";

/** A runner whose steps record the order they ran in. */
function runner(opts: { landRuns?: () => Promise<string[]>; bye?: () => Promise<unknown> } = {}) {
  const steps: string[] = [];
  const logs: string[] = [];
  let exited: () => void = () => {};
  const exit = new Promise<void>((r) => { exited = r; });
  const handler = onShutdown({
    landRuns: async () => { steps.push("land:start"); const left = await (opts.landRuns?.() ?? Promise.resolve([])); steps.push("land:done"); return left; },
    bye: async () => { steps.push("bye:start"); await opts.bye?.(); steps.push("bye:done"); },
    exit: (code) => { steps.push(`exit:${code}`); exited(); },
    log: (m) => logs.push(m),
  }, 200);
  return { steps, logs, handler, exit };
}

it("lands the runs before going offline, then exits", async () => {
  const r = runner({ landRuns: () => new Promise((res) => setTimeout(() => res([]), 50)) });
  await r.handler();
  expect(r.steps).toEqual(["land:start", "land:done", "bye:start", "bye:done", "exit:0"]);
});

it("runs once however many signals arrive", async () => {
  const r = runner({ landRuns: () => new Promise((res) => setTimeout(() => res([]), 50)) });
  await Promise.all([r.handler(), r.handler(), r.handler()]);
  expect(r.steps.filter((s) => s === "land:start")).toHaveLength(1);
  expect(r.steps.filter((s) => s.startsWith("exit"))).toHaveLength(1);
});

it("still goes offline and exits when landing throws", async () => {
  const r = runner({ landRuns: async () => { throw new Error("convex down"); } });
  await r.handler();
  expect(r.steps).toEqual(["land:start", "bye:start", "bye:done", "exit:0"]);
  expect(r.logs.join("\n")).toMatch(/convex down/);
});

it("names the runs it gave up waiting for", async () => {
  const r = runner({ landRuns: async () => ["run1", "run2"] });
  await r.handler();
  expect(r.logs.join("\n")).toMatch(/2 run\(s\).*run1, run2/);
  expect(r.steps.at(-1)).toBe("exit:0");
});

it("exits when going offline fails or hangs", async () => {
  const failing = runner({ bye: async () => { throw new Error("offline"); } });
  await failing.handler();
  expect(failing.steps.at(-1)).toBe("exit:0");

  const hanging = runner({ bye: () => new Promise(() => {}) });
  const started = Date.now();
  await hanging.handler();
  await hanging.exit;
  expect(Date.now() - started).toBeLessThan(2_000);
  expect(hanging.steps).toEqual(["land:start", "land:done", "bye:start", "exit:0"]);
});
