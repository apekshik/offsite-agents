/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FOLDER_LIMITS, type BrowseResult, type ScanResult } from "@offsite/contracts";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { FOLDERS } from "./folders";
import schema from "./schema";

const modules = import.meta.glob("./**/!(*.*.*)*.*s");

type T = ReturnType<typeof convexTest>;
type Captain = ReturnType<T["withIdentity"]>;

async function pair(t: T, captain: Captain, name = "Mac") {
  const { deviceCode, userCode } = await t.mutation(internal.machines.startCode, { name, hostname: `${name.toLowerCase()}.local` });
  const approved = await captain.mutation(api.machines.approve, { userCode });
  if (!approved.ok) throw new Error(approved.error);
  const poll = await t.mutation(internal.machines.pollCode, { deviceCode }) as { status: string; token: string };
  return { machineId: approved.machineId, token: poll.token };
}

async function ship() {
  const t = convexTest(schema, modules);
  const alice = t.withIdentity({ tokenIdentifier: "dev|alice", name: "alice" });
  await alice.mutation(api.users.ensure, {});
  const officeId = await alice.mutation(api.offices.create, { name: "Sea Legs", world: "yacht" });
  const { machineId, token } = await pair(t, alice);
  return { t, alice, officeId, machineId, token };
}

const repo = (name: string, at: number | null = 1_700_000_000_000) => ({
  name, path: `~/Developer/${name}`, branch: "main", defaultBranch: "main",
  remote: { host: "github.com", slug: `alice/${name}` }, lastCommitAt: at, setupCommand: "pnpm install",
});
const scanResult = (repos = [repo("web"), repo("api")]): ScanResult => ({
  kind: "scan", home: "/Users/alice", repos, truncated: false, timedOut: false, roots: ["~/Developer"],
});
const browseResult = (path = "~"): BrowseResult => ({
  kind: "browse", home: "/Users/alice", path, parent: null, repo: null, truncated: false,
  folders: [{ name: "Developer", path: "~/Developer", repo: null }, { name: "web", path: "~/web", repo: repo("web") }],
});

afterEach(() => { vi.useRealTimers(); });

describe("folder requests", () => {
  it("asks the machine for a scan, and the captain reads what it found", async () => {
    const { t, alice, machineId, token } = await ship();
    expect((await t.query(api.folders.work, { token })).requests).toEqual([]);
    const requestId = await alice.mutation(api.folders.scan, { machineId });
    expect(await alice.query(api.folders.get, { requestId })).toMatchObject({ kind: "scan", state: "pending", result: null });

    const work = await t.query(api.folders.work, { token });
    expect(work.requests).toEqual([{ requestId, kind: "scan", path: null, typed: false }]);
    await t.mutation(api.folders.put, { token, requestId, result: scanResult() });

    const got = await alice.query(api.folders.get, { requestId });
    expect(got).toMatchObject({ state: "ready", error: null });
    expect(got!.result).toEqual(scanResult());
    expect((await t.query(api.folders.work, { token })).requests).toEqual([]);

    // Asking again straight away reuses the answer; `again` looks afresh.
    expect(await alice.mutation(api.folders.scan, { machineId })).toBe(requestId);
    const again = await alice.mutation(api.folders.scan, { machineId, again: true });
    expect(again).not.toBe(requestId);
    // A pending scan is reused even with `again`: the runner is already looking.
    expect(await alice.mutation(api.folders.scan, { machineId, again: true })).toBe(again);
  });

  it("lists one folder, starting at home, and only goes outside home on a typed path", async () => {
    const { t, alice, machineId, token } = await ship();
    const home = await alice.mutation(api.folders.browse, { machineId });
    expect((await t.query(api.folders.work, { token })).requests).toEqual([{ requestId: home, kind: "browse", path: "~", typed: false }]);
    await t.mutation(api.folders.put, { token, requestId: home, result: browseResult() });
    expect((await alice.query(api.folders.get, { requestId: home }))!.result).toEqual(browseResult());

    // The same folder again is the same answer; another folder is a new request.
    expect(await alice.mutation(api.folders.browse, { machineId, path: "~" })).toBe(home);
    const dev = await alice.mutation(api.folders.browse, { machineId, path: "~/Developer/" });
    expect((await t.query(api.folders.work, { token })).requests).toEqual([expect.objectContaining({ requestId: dev, path: "~/Developer" })]);

    await expect(alice.mutation(api.folders.browse, { machineId, path: "/etc" })).rejects.toThrow(/home folder/);
    await expect(alice.mutation(api.folders.browse, { machineId, path: "~/../../etc", typed: true })).rejects.toThrow(/without \.\./);
    await expect(alice.mutation(api.folders.browse, { machineId, path: "code", typed: true })).rejects.toThrow(/full path/);
    const typed = await alice.mutation(api.folders.browse, { machineId, path: "/srv/code", typed: true });
    expect((await t.query(api.folders.work, { token })).requests).toContainEqual({ requestId: typed, kind: "browse", path: "/srv/code", typed: true });
  });

  it("records why the runner couldn't look, and refuses an answer in the wrong shape", async () => {
    const { t, alice, machineId, token } = await ship();
    const requestId = await alice.mutation(api.folders.browse, { machineId, path: "~/nope" });
    await expect(t.mutation(api.folders.put, { token, requestId, result: { kind: "browse", folders: "lots" } })).rejects.toThrow(/doesn't fit/);
    await expect(t.mutation(api.folders.put, { token, requestId, result: scanResult() })).rejects.toThrow(/is a browse, not a scan/);
    await t.mutation(api.folders.put, { token, requestId, error: "There's no folder at ~/nope on this machine." });
    expect(await alice.query(api.folders.get, { requestId })).toMatchObject({ state: "failed", error: "There's no folder at ~/nope on this machine.", result: null });
  });

  it("is the owner's only: nobody else reads it, asks another's machine, or answers for another machine", async () => {
    const { t, alice, machineId, token } = await ship();
    const bob = t.withIdentity({ tokenIdentifier: "dev|bob", name: "bob" });
    await bob.mutation(api.users.ensure, {});
    const bobs = await pair(t, bob, "Linux");

    const requestId = await alice.mutation(api.folders.scan, { machineId });
    await t.mutation(api.folders.put, { token, requestId, result: scanResult() });
    expect(await bob.query(api.folders.get, { requestId })).toBeNull();
    await expect(t.query(api.folders.get, { requestId })).rejects.toThrow(/Sign in/);
    await expect(bob.mutation(api.folders.scan, { machineId })).rejects.toThrow(/not yours/);
    await expect(bob.mutation(api.folders.browse, { machineId })).rejects.toThrow(/not yours/);

    // Bob's runner sees none of Alice's requests, and can't answer them.
    const pending = await alice.mutation(api.folders.scan, { machineId, again: true });
    expect((await t.query(api.folders.work, { token: bobs.token })).requests).toEqual([]);
    await expect(t.mutation(api.folders.put, { token: bobs.token, requestId: pending, result: scanResult([]) })).rejects.toThrow(/isn't this machine's/);
    await expect(t.query(api.folders.work, { token: "ofr_nope" })).rejects.toThrow(/not paired/);
  });

  it("doesn't ask an offline machine", async () => {
    vi.useFakeTimers();
    const { alice, machineId } = await ship();
    vi.advanceTimersByTime(5 * 60_000);
    await expect(alice.mutation(api.folders.scan, { machineId })).rejects.toThrow(/Mac is offline; start the runner/);
  });

  it("deletes every request ten minutes after it was asked for, answered or not", async () => {
    vi.useFakeTimers();
    const { t, alice, machineId, token } = await ship();
    const answered = await alice.mutation(api.folders.scan, { machineId });
    await t.mutation(api.folders.put, { token, requestId: answered, result: scanResult() });
    const waiting = await alice.mutation(api.folders.browse, { machineId });
    const count = () => t.run(async (ctx) => (await ctx.db.query("folderRequests").collect()).length);
    expect(await count()).toBe(2);

    vi.advanceTimersByTime(FOLDER_LIMITS.ttlMs - 1000);
    expect(await alice.query(api.folders.get, { requestId: answered })).not.toBeNull();
    vi.advanceTimersByTime(2000);
    // Past its time it reads as gone at once, and the scheduled delete removes the rows.
    expect(await alice.query(api.folders.get, { requestId: answered })).toBeNull();
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await count()).toBe(0);
    expect(await alice.query(api.folders.get, { requestId: waiting })).toBeNull();

    // A late answer to a deleted request is dropped quietly.
    expect(await t.mutation(api.folders.put, { token, requestId: answered, result: scanResult() })).toEqual({ kept: false });
  });

  it("sweeps whatever a scheduled delete missed, and forgets a disconnected machine's answers", async () => {
    const { t, alice, machineId, token } = await ship();
    const requestId = await alice.mutation(api.folders.scan, { machineId });
    await t.mutation(api.folders.put, { token, requestId, result: scanResult() });
    await t.run(async (ctx) => { await ctx.db.patch(requestId, { expiresAt: Date.now() - 1 }); });
    expect(await t.mutation(internal.folders.sweep, {})).toEqual({ deleted: 1 });

    await alice.mutation(api.folders.browse, { machineId });
    await alice.mutation(api.machines.revoke, { machineId });
    expect(await t.run(async (ctx) => (await ctx.db.query("folderRequests").collect()).length)).toBe(0);
  });

  it("rate limits scans and listings per captain", async () => {
    const { t, alice, machineId, token } = await ship();
    let last: Id<"folderRequests"> | null = null;
    for (let i = 0; i < FOLDERS.scans; i++) {
      last = await alice.mutation(api.folders.scan, { machineId, again: true });
      await t.mutation(api.folders.put, { token, requestId: last, result: scanResult() });
    }
    // Past the limit, a scan hands back the last answer rather than asking the machine again.
    expect(await alice.mutation(api.folders.scan, { machineId, again: true })).toBe(last);
    expect((await t.query(api.folders.work, { token })).requests).toEqual([]);

    for (let i = 0; i < FOLDERS.browses; i++) await alice.mutation(api.folders.browse, { machineId, path: `~/f${i}` });
    await expect(alice.mutation(api.folders.browse, { machineId, path: "~/one-more" })).rejects.toThrow(/a lot of browsing/);
    // Reusing an answer in hand doesn't count, and another captain has their own allowance.
    expect(await alice.mutation(api.folders.browse, { machineId, path: "~/f3" })).toBeTruthy();
    const bob = t.withIdentity({ tokenIdentifier: "dev|bob", name: "bob" });
    await bob.mutation(api.users.ensure, {});
    const bobs = await pair(t, bob, "Linux");
    expect(await bob.mutation(api.folders.browse, { machineId: bobs.machineId })).toBeTruthy();
  });
});

describe("adding picked repos", () => {
  it("adds several at once, each named after its folder, with -2 when taken", async () => {
    const { alice, officeId, machineId } = await ship();
    await alice.mutation(api.repos.add, { officeId, machineId, path: "~/old/web", defaultBranch: "main" });
    const names = await alice.mutation(api.repos.addMany, {
      officeId,
      repos: [
        { machineId, path: "~/Developer/web", defaultBranch: "main", setupCommand: "pnpm install" },
        { machineId, path: "~/Developer/API", defaultBranch: "master", setupCommand: null },
      ],
    });
    expect(names).toEqual(["web-2", "api"]);
    const repos = await alice.query(api.repos.list, { officeId });
    expect(repos.map((r) => [r.name, r.path, r.defaultBranch, r.setupCommand])).toEqual([
      ["web", "~/old/web", "main", null],
      ["web-2", "~/Developer/web", "main", "pnpm install"],
      ["api", "~/Developer/API", "master", null],
    ]);
  });

  it("adds none when one can't be added", async () => {
    const { t, alice, officeId, machineId } = await ship();
    await alice.mutation(api.repos.add, { officeId, machineId, path: "~/Developer/web", defaultBranch: "main" });
    await expect(alice.mutation(api.repos.addMany, {
      officeId, repos: [{ machineId, path: "~/Developer/api", defaultBranch: "main" }, { machineId, path: "~/Developer/web", defaultBranch: "main" }],
    })).rejects.toThrow(/already on this ship, as "web"/);
    expect((await alice.query(api.repos.list, { officeId })).map((r) => r.name)).toEqual(["web"]);
    await expect(alice.mutation(api.repos.addMany, {
      officeId, repos: Array.from({ length: 12 }, (_, i) => ({ machineId, path: `~/r/${i}`, defaultBranch: "main" })),
    })).rejects.toThrow(/room for 11 more/);
    const bob = t.withIdentity({ tokenIdentifier: "dev|bob", name: "bob" });
    await bob.mutation(api.users.ensure, {});
    await expect(bob.mutation(api.repos.addMany, { officeId, repos: [{ machineId, path: "~/x", defaultBranch: "main" }] })).rejects.toThrow(/No such ship/);
  });
});
