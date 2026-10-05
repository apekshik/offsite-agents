/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { INVITE_TTL_MS, MAX_MEMBERS } from "@offsite/contracts";

const modules = import.meta.glob("./**/!(*.*.*)*.*s");

type T = ReturnType<typeof convexTest>;
type Person = ReturnType<T["withIdentity"]>;

async function person(t: T, name: string): Promise<Person> {
  const p = t.withIdentity({ tokenIdentifier: `dev|${name}`, name });
  await p.mutation(api.users.ensure, {});
  return p;
}

async function pair(t: T, captain: Person, name = "Mac") {
  const { deviceCode, userCode } = await t.mutation(internal.machines.startCode, { name, hostname: `${name.toLowerCase()}.local` });
  const approved = await captain.mutation(api.machines.approve, { userCode });
  if (!approved.ok) throw new Error(approved.error);
  const poll = await t.mutation(internal.machines.pollCode, { deviceCode }) as { status: string; token: string };
  return { machineId: approved.machineId, token: poll.token };
}

/** Alice's ship with a machine and a repo; Maya joined it with a link; Eve is a stranger. */
async function ship() {
  const t = convexTest(schema, modules);
  const alice = await person(t, "alice");
  const maya = await person(t, "maya");
  const eve = await person(t, "eve");
  const officeId = await alice.mutation(api.offices.create, { name: "OASIS", world: "yacht" });
  const { machineId, token } = await pair(t, alice);
  await alice.mutation(api.repos.add, { officeId, machineId, path: "~/code/web", defaultBranch: "main" });
  const invite = await alice.mutation(api.invites.create, { officeId });
  const joined = await maya.mutation(api.invites.accept, { token: invite.token });
  expect(joined).toMatchObject({ officeId, ship: "OASIS", role: "member", joined: true });
  const ids = {
    alice: (await alice.query(api.users.me, {}))!._id,
    maya: (await maya.query(api.users.me, {}))!._id,
    eve: (await eve.query(api.users.me, {}))!._id,
  };
  return { t, alice, maya, eve, officeId, machineId, token, invite, ids };
}

describe("invites", () => {
  it("brings a friend aboard with a link, which the captain can see, replace and revoke", async () => {
    const { t, alice, maya, eve, officeId, invite, ids } = await ship();
    expect(invite.expiresAt - Date.now()).toBeGreaterThan(INVITE_TTL_MS - 60_000);
    expect(await alice.query(api.invites.current, { officeId })).toMatchObject({ token: invite.token, used: 1 });

    // The join page, signed in or not.
    const anon = await t.query(api.invites.peek, { token: invite.token });
    expect(anon).toMatchObject({ ok: true, ship: "OASIS", captain: { name: "alice" }, role: null });
    expect(await maya.query(api.invites.peek, { token: invite.token.toLowerCase() })).toMatchObject({ ok: true, role: "member" });
    expect(await t.query(api.invites.peek, { token: "NOPE" })).toEqual({ ok: false, reason: "unknown" });

    // Maya is aboard: it's the ship she boards, and it's among her joined ships.
    expect((await maya.query(api.users.me, {}))!.aboardId).toBe(officeId);
    expect(await maya.query(api.members.joined, {})).toEqual([expect.objectContaining({ _id: officeId, name: "OASIS", owner: "alice" })]);
    expect(await maya.query(api.offices.mine, {})).toEqual([]);
    const list = await alice.query(api.members.list, { officeId });
    expect(list).toMatchObject({ role: "owner", owner: { userId: ids.alice, name: "alice" }, members: [{ userId: ids.maya, name: "maya" }], membersCanAsk: true });
    expect((await maya.query(api.members.list, { officeId })).role).toBe("member");

    // Accepting again changes nothing; the captain opening their own link just boards the ship.
    expect(await maya.mutation(api.invites.accept, { token: invite.token })).toMatchObject({ role: "member", joined: false });
    expect(await alice.mutation(api.invites.accept, { token: invite.token })).toMatchObject({ role: "owner", joined: false });
    expect((await alice.query(api.members.list, { officeId })).members).toHaveLength(1);

    // A new link: the old one stops working.
    const fresh = await alice.mutation(api.invites.create, { officeId });
    expect(fresh.token).not.toBe(invite.token);
    expect(await t.query(api.invites.peek, { token: invite.token })).toEqual({ ok: false, reason: "revoked" });
    await expect(eve.mutation(api.invites.accept, { token: invite.token })).rejects.toThrow(/turned off/);

    // Revoked: nobody new comes aboard; Maya stays.
    await alice.mutation(api.invites.revoke, { officeId });
    expect(await alice.query(api.invites.current, { officeId })).toBeNull();
    await expect(eve.mutation(api.invites.accept, { token: fresh.token })).rejects.toThrow(/turned off/);
    expect((await alice.query(api.members.list, { officeId })).members).toHaveLength(1);
  });

  it("stops working after seven days", async () => {
    const { t, alice, eve, officeId } = await ship();
    const { token } = await alice.mutation(api.invites.create, { officeId });
    await t.run(async (ctx) => {
      const row = await ctx.db.query("invites").withIndex("by_token", (q) => q.eq("token", token)).unique();
      await ctx.db.patch(row!._id, { expiresAt: Date.now() - 1 });
    });
    expect(await t.query(api.invites.peek, { token })).toEqual({ ok: false, reason: "expired" });
    await expect(eve.mutation(api.invites.accept, { token })).rejects.toThrow(/expired/);
    expect(await alice.query(api.invites.current, { officeId })).toBeNull();
  });

  it("is the captain's alone to make or revoke, and a ship holds at most seven friends", async () => {
    const { t, maya, eve, alice, officeId } = await ship();
    await expect(maya.mutation(api.invites.create, { officeId })).rejects.toThrow(/Only the captain/);
    await expect(maya.mutation(api.invites.revoke, { officeId })).rejects.toThrow(/Only the captain/);
    await expect(maya.query(api.invites.current, { officeId })).rejects.toThrow(/Only the captain/);
    await expect(eve.mutation(api.invites.create, { officeId })).rejects.toThrow(/No such ship/);
    await expect(t.mutation(api.invites.accept, { token: "X" })).rejects.toThrow(/Sign in/);

    const { token } = await alice.mutation(api.invites.create, { officeId });
    for (let i = 1; i < MAX_MEMBERS; i++) await (await person(t, `friend${i}`)).mutation(api.invites.accept, { token });
    expect((await alice.query(api.members.list, { officeId })).members).toHaveLength(MAX_MEMBERS);
    await expect(eve.mutation(api.invites.accept, { token })).rejects.toThrow(/full/);
  });
});

describe("who may do what aboard", () => {
  it("lets a friend read the whole ship", async () => {
    const { t, alice, maya, officeId, token } = await ship();
    const threadId = await alice.mutation(api.threads.create, { officeId, text: "Add dark mode" });
    const work = await t.query(api.runner.work, { token });
    const c = (await t.mutation(api.runner.claim, { token, runId: work.queued[0]!.runId }))!;
    await t.mutation(api.tools.planTasks, { token, runId: c.run.id, tasks: [{ key: "dark", title: "Dark mode", brief: "Do it" }] });

    const office = await maya.query(api.offices.get, { officeId });
    expect(office).toMatchObject({ name: "OASIS", role: "member", owner: { name: "alice" }, membersCanAsk: true });
    expect(office.machine?.name).toBe("Mac");
    expect((await alice.query(api.offices.get, { officeId })).role).toBe("owner");
    expect((await maya.query(api.world.snapshot, { officeId })).crew.length).toBeGreaterThan(7);
    expect(await maya.query(api.threads.list, { officeId })).toHaveLength(1);
    expect((await maya.query(api.threads.get, { threadId })).title).toBe("Add dark mode");
    expect((await maya.query(api.messages.list, { threadId })).map((m) => m.kind)).toEqual(["text", "plan"]);
    expect(await maya.query(api.tasks.list, { threadId })).toHaveLength(1);
    expect((await maya.query(api.crew.list, { officeId })).length).toBeGreaterThan(7);
    expect((await maya.query(api.repos.list, { officeId })).map((r) => [r.name, r.path])).toEqual([["web", ""]]);
    expect(office.repos.map((r) => [r.name, r.path])).toEqual([["web", ""]]);
    expect((await alice.query(api.repos.list, { officeId }))[0]!.path).toBe("~/code/web");
    expect(await maya.query(api.questions.open, { officeId })).toEqual([]);
    expect(await maya.query(api.runs.forThread, { threadId })).toHaveLength(2);
    expect(await maya.query(api.runs.events, { runId: c.run.id as Id<"runs"> })).toEqual([]);
    expect((await maya.query(api.diffs.get, { threadId })).thread.title).toBe("Add dark mode");
    expect(await maya.query(api.diffs.deliveries, { officeId })).toEqual([]);
    await maya.mutation(api.diffs.request, { threadId });
  });

  it("gives a stranger nothing", async () => {
    const { t, alice, eve, officeId, token } = await ship();
    const threadId = await alice.mutation(api.threads.create, { officeId, text: "Secret plans" });
    const runId = (await t.query(api.runner.work, { token })).queued[0]!.runId;
    const no = /No such (ship|thread)/;
    await expect(eve.query(api.offices.get, { officeId })).rejects.toThrow(no);
    await expect(eve.query(api.world.snapshot, { officeId })).rejects.toThrow(no);
    await expect(eve.query(api.threads.list, { officeId })).rejects.toThrow(no);
    await expect(eve.query(api.threads.get, { threadId })).rejects.toThrow(no);
    await expect(eve.query(api.messages.list, { threadId })).rejects.toThrow(no);
    await expect(eve.query(api.tasks.list, { threadId })).rejects.toThrow(no);
    await expect(eve.query(api.crew.list, { officeId })).rejects.toThrow(no);
    await expect(eve.query(api.repos.list, { officeId })).rejects.toThrow(no);
    await expect(eve.query(api.questions.open, { officeId })).rejects.toThrow(no);
    await expect(eve.query(api.runs.forThread, { threadId })).rejects.toThrow(no);
    await expect(eve.query(api.runs.events, { runId })).rejects.toThrow(no);
    await expect(eve.query(api.diffs.get, { threadId })).rejects.toThrow(no);
    await expect(eve.query(api.diffs.deliveries, { officeId })).rejects.toThrow(no);
    await expect(eve.query(api.members.list, { officeId })).rejects.toThrow(no);
    await expect(eve.query(api.presence.here, { officeId })).rejects.toThrow(no);
    await expect(eve.mutation(api.threads.create, { officeId, text: "hi" })).rejects.toThrow(no);
    await expect(eve.mutation(api.threads.send, { threadId, text: "hi" })).rejects.toThrow(no);
    await expect(eve.mutation(api.presence.join, { officeId, peerId: "eeeeeeeeeeee", pos: [0, 0, 0], facing: 0, act: "walk" })).rejects.toThrow(no);
    await expect(eve.mutation(api.users.board, { officeId })).rejects.toThrow(no);
  });

  it("keeps the ship's machines, repos, crew, settings and invites the captain's", async () => {
    const { t, alice, maya, officeId, machineId, token, ids } = await ship();
    const crewId = (await alice.query(api.crew.list, { officeId })).find((c) => c.role === "crew")!._id;
    const repoId = (await alice.query(api.repos.list, { officeId }))[0]!._id;
    const threadId = await alice.mutation(api.threads.create, { officeId, text: "Go" });
    const runId = (await t.query(api.runner.work, { token })).queued[0]!.runId;
    const captainOnly = /Only the captain/;
    await expect(maya.mutation(api.crew.hire, { officeId })).rejects.toThrow(captainOnly);
    await expect(maya.mutation(api.crew.update, { crewId, name: "Bob" })).rejects.toThrow(captainOnly);
    await expect(maya.mutation(api.crew.dismiss, { crewId })).rejects.toThrow(captainOnly);
    await expect(maya.mutation(api.crew.describeLook, { crewId, prompt: "an otter" })).rejects.toThrow(captainOnly);
    await expect(maya.mutation(api.repos.add, { officeId, machineId, path: "~/code/api", defaultBranch: "main" })).rejects.toThrow(captainOnly);
    await expect(maya.mutation(api.repos.update, { repoId, name: "site" })).rejects.toThrow(captainOnly);
    await expect(maya.mutation(api.repos.remove, { repoId })).rejects.toThrow(captainOnly);
    await expect(maya.mutation(api.offices.update, { officeId, name: "Mine now" })).rejects.toThrow(captainOnly);
    await expect(maya.mutation(api.offices.update, { officeId, membersCanAsk: true })).rejects.toThrow(captainOnly);
    await expect(maya.mutation(api.offices.setRepo, { officeId, machineId, path: "~/x", defaultBranch: "main" })).rejects.toThrow(captainOnly);
    await expect(maya.mutation(api.members.remove, { officeId, userId: ids.alice })).rejects.toThrow(captainOnly);
    await expect(maya.mutation(api.threads.rename, { threadId, title: "x" })).rejects.toThrow(captainOnly);
    await expect(maya.mutation(api.threads.archive, { threadId })).rejects.toThrow(captainOnly);
    await expect(maya.mutation(api.runs.interrupt, { runId })).rejects.toThrow(captainOnly);
    await expect(maya.mutation(api.diffs.openEditor, { threadId })).rejects.toThrow(captainOnly);
    await expect(maya.mutation(api.machines.revoke, { machineId })).rejects.toThrow(/not yours/);
    await expect(maya.mutation(api.folders.scan, { machineId })).rejects.toThrow(/not yours/);
    // The work still runs only on the captain's machines: Maya has none, and Alice's runner sees the thread.
    expect(await maya.query(api.machines.mine, {})).toEqual([]);
    expect((await t.query(api.runner.work, { token })).queued).toHaveLength(1);
    // Nothing above changed anything.
    expect((await alice.query(api.offices.get, { officeId })).name).toBe("OASIS");
    expect((await alice.query(api.crew.list, { officeId })).find((c) => c._id === crewId)!.dismissedAt).toBeNull();
  });

  it("lets a friend talk to Computah in the same thread, unless the captain turns that off", async () => {
    const { t, alice, maya, officeId, token, ids } = await ship();
    const threadId = await maya.mutation(api.threads.create, { officeId, text: "Add a billing page" });
    await alice.mutation(api.threads.send, { threadId, text: "Use Stripe" });

    const messages = await alice.query(api.messages.list, { threadId });
    expect(messages.map((m) => [m.author, m.text])).toEqual([
      [{ kind: "captain", userId: ids.maya }, "Add a billing page"],
      [{ kind: "captain", userId: ids.alice }, "Use Stripe"],
    ]);
    const [row] = await alice.query(api.threads.list, { officeId });
    expect(row!.startedBy).toEqual({ userId: ids.maya, name: "maya", owner: false });

    // Computah hears who said what, and who is aboard.
    const work = await t.query(api.runner.work, { token });
    expect(work.queued).toHaveLength(1);
    const c = (await t.mutation(api.runner.claim, { token, runId: work.queued[0]!.runId }))!;
    expect(c.run.prompt).toBe("maya (a friend aboard) asks: Add a billing page\n\nalice (the captain) says: Use Stripe");
    expect(c.people).toEqual([{ name: "alice", role: "captain" }, { name: "maya", role: "friend" }]);
    expect(c.context).toContain("People aboard");
    expect(c.context).toContain("maya started this thread.");
    expect(c.context).toContain("maya: Add a billing page");
    expect(c.context).toContain("alice (captain): Use Stripe");

    // Off: Maya reads but can't ask; Alice still can.
    await alice.mutation(api.offices.update, { officeId, membersCanAsk: false });
    expect((await maya.query(api.members.list, { officeId })).membersCanAsk).toBe(false);
    await expect(maya.mutation(api.threads.create, { officeId, text: "One more thing" })).rejects.toThrow(/turned off asking/);
    await expect(maya.mutation(api.threads.send, { threadId, text: "And taxes" })).rejects.toThrow(/turned off asking/);
    await alice.mutation(api.threads.send, { threadId, text: "Still me" });
    expect(await maya.query(api.messages.list, { threadId })).toHaveLength(3);
  });

  it("asks whoever asked, and leaves permissions on the captain's machine to the captain", async () => {
    const { t, alice, maya, officeId, token, ids } = await ship();
    const threadId = await maya.mutation(api.threads.create, { officeId, text: "Pick a colour for the header" });
    const c = (await t.mutation(api.runner.claim, { token, runId: (await t.query(api.runner.work, { token })).queued[0]!.runId }))!;
    const runId = c.run.id as Id<"runs">;
    await t.mutation(api.tools.askCaptain, { token, runId, question: "Blue or green?", options: ["blue", "green"] });
    await t.mutation(api.runner.events, { token, runId, events: [{ type: "request.opened", requestId: "r1", kind: "approval", prompt: "Run pnpm install?", options: ["allow", "deny"] }] });
    const open = await maya.query(api.questions.open, { officeId });
    const ask = open.find((q) => q.kind === "input")!;
    const perm = open.find((q) => q.kind === "approval")!;
    expect(ask.askedOf).toBe(ids.maya);
    expect(perm.askedOf).toBe(ids.alice);
    expect((await maya.query(api.world.snapshot, { officeId })).questions.map((q) => q.askedOf).sort()).toEqual([ids.alice, ids.maya].sort());

    await expect(maya.mutation(api.questions.answer, { questionId: perm._id, answer: "allow" })).rejects.toThrow(/Only the captain can allow/);
    await maya.mutation(api.questions.answer, { questionId: ask._id, answer: "green" });
    await alice.mutation(api.questions.answer, { questionId: perm._id, answer: "allow" });
    const answers = (await t.query(api.runner.work, { token })).live.find((l) => l.runId === runId)!.answers;
    expect(answers.map((a) => a.answer).sort()).toEqual(["allow", "green"]);
    const said = (await alice.query(api.messages.list, { threadId })).filter((m) => m.author.kind === "captain").map((m) => [m.author.kind === "captain" ? m.author.userId : null, m.text]);
    expect(said).toEqual([[ids.maya, "Pick a colour for the header"], [ids.maya, "@computah green"], [ids.alice, "@computah allow"]]);
  });
});

describe("leaving", () => {
  it("lets a friend leave, and the captain ask one to", async () => {
    const { t, alice, maya, eve, officeId, ids } = await ship();
    await maya.mutation(api.presence.join, { officeId, peerId: "mayatab00001", pos: [1, 2, 3], facing: 0, act: "walk" });
    await expect(alice.mutation(api.members.leave, { officeId })).rejects.toThrow(/your ship/);
    await maya.mutation(api.members.leave, { officeId });
    await expect(maya.query(api.world.snapshot, { officeId })).rejects.toThrow(/No such ship/);
    await expect(maya.mutation(api.threads.create, { officeId, text: "hi" })).rejects.toThrow(/No such ship/);
    expect((await maya.query(api.users.me, {}))!.aboardId).toBeNull();
    expect(await maya.query(api.members.joined, {})).toEqual([]);
    expect(await alice.query(api.presence.here, { officeId })).toEqual([]);

    // Back with a fresh link, then asked to leave.
    const { token } = await alice.mutation(api.invites.create, { officeId });
    await maya.mutation(api.invites.accept, { token });
    await eve.mutation(api.invites.accept, { token });
    await expect(alice.mutation(api.members.remove, { officeId, userId: ids.alice })).rejects.toThrow(/stays/);
    await alice.mutation(api.members.remove, { officeId, userId: ids.maya });
    await expect(alice.mutation(api.members.remove, { officeId, userId: ids.maya })).rejects.toThrow(/aren't aboard/);
    await expect(maya.query(api.threads.list, { officeId })).rejects.toThrow(/No such ship/);
    expect((await alice.query(api.members.list, { officeId })).members.map((m) => m.name)).toEqual(["eve"]);
    void t;
  });

  it("switches between your own ship and ships you joined", async () => {
    const { maya, officeId } = await ship();
    const own = await maya.mutation(api.offices.create, { name: "Maya's Boat", world: "yacht" });
    expect((await maya.query(api.users.me, {}))!.aboardId).toBe(own);
    await maya.mutation(api.users.board, { officeId });
    expect((await maya.query(api.users.me, {}))!.aboardId).toBe(officeId);
    await maya.mutation(api.users.board, { officeId: null });
    expect((await maya.query(api.users.me, {}))!.aboardId).toBeNull();
  });
});

describe("presence and signaling", () => {
  it("shows who is on deck, takes over from an older tab, and lets the stale go", async () => {
    const { t, alice, maya, officeId, ids } = await ship();
    await alice.mutation(api.presence.join, { officeId, peerId: "alicetab0001", pos: [1, 2, 3], facing: 7, act: "helm" });
    await maya.mutation(api.presence.join, { officeId, peerId: "mayatab00001", pos: [4, 5, 6], facing: 0, act: "nonsense" });
    const here = await maya.query(api.presence.here, { officeId });
    expect(here.map((p) => [p.name, p.owner, p.peerId, p.act])).toEqual([["alice", true, "alicetab0001", "helm"], ["maya", false, "mayatab00001", "walk"]]);
    expect(here[0]!.facing).toBeCloseTo(7 - 2 * Math.PI, 1);

    expect(await maya.mutation(api.presence.beat, { officeId, peerId: "mayatab00001", pos: [9, 9, 9], facing: 1, act: "phone" })).toMatchObject({ replaced: false });
    expect((await alice.query(api.presence.here, { officeId })).find((p) => p.userId === ids.maya)).toMatchObject({ pos: [9, 9, 9], act: "phone" });
    // A second tab takes over; the first is told so.
    await maya.mutation(api.presence.join, { officeId, peerId: "mayatab00002", pos: [0, 0, 0], facing: 0, act: "walk" });
    expect(await maya.mutation(api.presence.beat, { officeId, peerId: "mayatab00001", pos: [0, 0, 0], facing: 0, act: "walk" })).toMatchObject({ replaced: true });
    expect(await alice.query(api.presence.here, { officeId })).toHaveLength(2);

    await t.run(async (ctx) => {
      for (const p of await ctx.db.query("presence").collect()) if (p.userId === ids.maya) await ctx.db.patch(p._id, { at: Date.now() - 60_000 });
    });
    expect((await alice.query(api.presence.here, { officeId })).map((p) => p.name)).toEqual(["alice"]);
    expect(await t.mutation(internal.presence.sweep, {})).toMatchObject({ presence: 1 });
    await alice.mutation(api.presence.leave, { peerId: "alicetab0001" });
    expect(await alice.query(api.presence.here, { officeId })).toEqual([]);
  });

  it("passes signals only between people on the same ship's deck, to the tab they're for", async () => {
    const { t, alice, maya, eve, officeId } = await ship();
    const other = await eve.mutation(api.offices.create, { name: "Eve's", world: "yacht" });
    await alice.mutation(api.presence.join, { officeId, peerId: "alicetab0001", pos: [0, 0, 0], facing: 0, act: "walk" });
    await maya.mutation(api.presence.join, { officeId, peerId: "mayatab00001", pos: [0, 0, 0], facing: 0, act: "walk" });
    await eve.mutation(api.presence.join, { officeId: other, peerId: "evetab000001", pos: [0, 0, 0], facing: 0, act: "walk" });

    expect(await alice.mutation(api.signals.send, { from: "alicetab0001", to: "mayatab00001", kind: "offer", data: "{}" })).toEqual({ sent: true });
    // Eve isn't aboard this ship: nothing to her, nothing from her, and she can't read Maya's mailbox or pose as Alice.
    expect(await alice.mutation(api.signals.send, { from: "alicetab0001", to: "evetab000001", kind: "offer", data: "{}" })).toEqual({ sent: false });
    expect(await eve.mutation(api.signals.send, { from: "evetab000001", to: "mayatab00001", kind: "offer", data: "{}" })).toEqual({ sent: false });
    expect(await eve.mutation(api.signals.send, { from: "alicetab0001", to: "mayatab00001", kind: "offer", data: "{}" })).toEqual({ sent: false });
    expect(await eve.query(api.signals.inbox, { peerId: "mayatab00001" })).toEqual([]);
    await expect(alice.mutation(api.signals.send, { from: "alicetab0001", to: "mayatab00001", kind: "rm -rf", data: "" })).rejects.toThrow(/Not a signal/);

    const inbox = await maya.query(api.signals.inbox, { peerId: "mayatab00001" });
    expect(inbox).toEqual([{ id: expect.any(String), from: "alicetab0001", kind: "offer", data: "{}" }]);
    await eve.mutation(api.signals.ack, { peerId: "mayatab00001", ids: inbox.map((s) => s.id) });
    expect(await maya.query(api.signals.inbox, { peerId: "mayatab00001" })).toHaveLength(1);
    await maya.mutation(api.signals.ack, { peerId: "mayatab00001", ids: inbox.map((s) => s.id) });
    expect(await maya.query(api.signals.inbox, { peerId: "mayatab00001" })).toEqual([]);
    void t;
  });
});
