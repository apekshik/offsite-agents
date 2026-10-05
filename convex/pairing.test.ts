/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { BUSY, PAIRING } from "./machines";

const modules = import.meta.glob("./**/!(*.*.*)*.*s");

afterEach(() => { vi.useRealTimers(); });

function ship() {
  const t = convexTest(schema, modules);
  const alice = t.withIdentity({ tokenIdentifier: "dev|alice", name: "alice" });
  const mallory = t.withIdentity({ tokenIdentifier: "dev|mallory", name: "mallory" });
  return { t, alice, mallory };
}

describe("pairing a machine", () => {
  it("pauses a captain's lookups after too many wrong codes, even for a right one", async () => {
    const { t, alice, mallory } = ship();
    await alice.mutation(api.users.ensure, {});
    await mallory.mutation(api.users.ensure, {});
    const { userCode } = await t.mutation(internal.machines.startCode, { name: "Alice's Mac", hostname: "alice.local" });
    for (let i = 0; i < PAIRING.missesPerUser; i++) {
      const r = await mallory.mutation(api.machines.lookup, { userCode: `ZZZZ-ZZ${String(i).padStart(2, "2")}` });
      expect(r.ok).toBe(false);
    }
    const guessed = await mallory.mutation(api.machines.approve, { userCode });
    expect(guessed).toMatchObject({ ok: false, error: expect.stringMatching(/Too many/) });
    // Alice, who started it, is not held up by Mallory's misses.
    expect(await alice.mutation(api.machines.lookup, { userCode })).toMatchObject({ ok: true, name: "Alice's Mac" });
    expect(await alice.mutation(api.machines.approve, { userCode })).toMatchObject({ ok: true, name: "Alice's Mac" });
  });

  it("shows the approval screen what the machine said it runs on, and copes with runners that don't say", async () => {
    const { t, alice } = ship();
    await alice.mutation(api.users.ensure, {});
    const withOs = await t.mutation(internal.machines.startCode, { name: "Studio", hostname: "studio.local", os: "macOS 26.4" });
    expect(await alice.mutation(api.machines.lookup, { userCode: withOs.userCode })).toEqual({ ok: true, name: "Studio", hostname: "studio.local", os: "macOS 26.4" });
    const older = await t.mutation(internal.machines.startCode, { name: "Box", hostname: "box" });
    expect(await alice.mutation(api.machines.lookup, { userCode: older.userCode })).toEqual({ ok: true, name: "Box", hostname: "box", os: null });
  });

  it("caps new codes across everyone", async () => {
    const { t } = ship();
    for (let i = 0; i < PAIRING.startsPerMinute; i++) await t.mutation(internal.machines.startCode, { name: "m", hostname: "h" });
    await expect(t.mutation(internal.machines.startCode, { name: "m", hostname: "h" })).rejects.toThrow(BUSY);
  });

  it("sweeps codes past their time, including an approved one never collected", async () => {
    vi.useFakeTimers();
    const { t, alice } = ship();
    await alice.mutation(api.users.ensure, {});
    const { userCode, deviceCode } = await t.mutation(internal.machines.startCode, { name: "Mac", hostname: "mac.local" });
    await alice.mutation(api.machines.approve, { userCode });
    vi.advanceTimersByTime(30 * 60_000);
    expect(await t.mutation(internal.machines.sweep, {})).toMatchObject({ codes: 1 });
    expect(await t.mutation(internal.machines.pollCode, { deviceCode })).toEqual({ status: "expired" });
  });

  it("lets a runner mark delivered only what its own runs were handed", async () => {
    const { t, alice, mallory } = ship();
    const pairAs = async (who: typeof alice, name: string) => {
      await who.mutation(api.users.ensure, {});
      const { userCode, deviceCode } = await t.mutation(internal.machines.startCode, { name, hostname: `${name}.local` });
      const r = await who.mutation(api.machines.approve, { userCode });
      if (!r.ok) throw new Error(r.error);
      const poll = await t.mutation(internal.machines.pollCode, { deviceCode }) as { token: string };
      return { machineId: r.machineId, token: poll.token };
    };
    const a = await pairAs(alice, "alice-mac");
    const m = await pairAs(mallory, "mallory-mac");
    const officeId = await alice.mutation(api.offices.create, { name: "Sea Legs", world: "yacht" });
    await alice.mutation(api.offices.setRepo, { officeId, machineId: a.machineId, path: "~/code/app", defaultBranch: "main" });
    await alice.mutation(api.threads.create, { officeId, text: "Add dark mode" });
    const { queued } = await t.query(api.runner.work, { token: a.token });
    const runId = queued[0]!.runId;
    await t.mutation(api.runner.claim, { token: a.token, runId });
    await t.mutation(api.runner.events, { token: a.token, runId, events: [{ type: "request.opened", requestId: "r1", kind: "input", prompt: "Which colour?", options: null }] });
    const [question] = await alice.query(api.questions.open, { officeId });
    await alice.mutation(api.questions.answer, { questionId: question!._id, answer: "Navy" });

    await t.mutation(api.runner.delivered, { token: m.token, questionIds: [question!._id] });
    expect((await t.query(api.runner.work, { token: a.token })).live[0]!.answers).toHaveLength(1);
    await t.mutation(api.runner.delivered, { token: a.token, questionIds: [question!._id] });
    expect((await t.query(api.runner.work, { token: a.token })).live[0]!.answers).toHaveLength(0);
  });
});

describe("sign-in providers", () => {
  const load = async (env: Record<string, string | undefined>) => {
    const saved = { WORKOS_CLIENT_ID: process.env["WORKOS_CLIENT_ID"], DEV_AUTH_JWKS: process.env["DEV_AUTH_JWKS"] };
    for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    vi.resetModules();
    try { return ((await import("./auth.config")).default.providers as { issuer: string }[]).map((p) => p.issuer); }
    finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
  };

  it("accepts only WorkOS where DEV_AUTH_JWKS is not set, as on production", async () => {
    const issuers = await load({ WORKOS_CLIENT_ID: "client_123", DEV_AUTH_JWKS: undefined });
    expect(issuers).toEqual(["https://api.workos.com/", "https://api.workos.com/user_management/client_123"]);
  });

  it("adds the dev issuer only where DEV_AUTH_JWKS is set", async () => {
    const issuers = await load({ WORKOS_CLIENT_ID: "client_123", DEV_AUTH_JWKS: "data:text/plain;base64,e30=" });
    expect(issuers).toContain("http://localhost/offsite-dev");
  });
});
