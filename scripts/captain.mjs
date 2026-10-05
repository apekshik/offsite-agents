// Plays the captain from a terminal, against your dev deployment: dev sign-in (OFFSITE_DEV_USER, default
// "runner-test"), a throwaway office, pairing a runner, threads. For testing the runner without the app.
//   (needs `node scripts/devauth.mjs` once)
//   node scripts/captain.mjs offices                    → your offices
//   node scripts/captain.mjs setup <repoPath>          → prints { officeId }
//   node scripts/captain.mjs approve <userCode>        → approves the runner's device code, prints machineId
//   node scripts/captain.mjs repo <officeId> <machineId> <repoPath> [setupCommand]   (adds or updates the repo on that path)
//   node scripts/captain.mjs addrepo <officeId> <machineId> <repoPath> [name] [setupCommand]
//   node scripts/captain.mjs repos <officeId>          → the ship's repos
//   node scripts/captain.mjs thread <officeId> <text>  → prints threadId
//   node scripts/captain.mjs watch <officeId> <threadId> [answer]   → polls until the thread is done, answering questions
//   node scripts/captain.mjs look <officeId> <description>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const ROOT = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const { ConvexHttpClient } = await import(`${ROOT}/node_modules/convex/dist/esm/browser/index.js`);
const { anyApi: api } = await import(`${ROOT}/node_modules/convex/dist/esm/server/index.js`);
const { devToken } = await import(`${ROOT}/scripts/devauth.mjs`);

const env = Object.fromEntries(readFileSync(`${ROOT}/.env.local`, "utf8").split("\n").map((l) => /^([A-Z_]+)=([^\s#]*)/.exec(l)).filter(Boolean).map((m) => [m[1], m[2]]));
const client = new ConvexHttpClient(env.CONVEX_URL);
client.setAuth(devToken(env.DEV_AUTH_PRIVATE_KEY, process.env.OFFSITE_DEV_USER ?? "runner-test"));
const [cmd, ...args] = process.argv.slice(2);

if (cmd === "offices") {
  await client.mutation(api.users.ensure, {});
  console.log(JSON.stringify((await client.query(api.offices.mine, {})).map((o) => ({ officeId: o._id, name: o.name, repos: o.repoCount }))));
} else if (cmd === "setup") {
  await client.mutation(api.users.ensure, {});
  const officeId = await client.mutation(api.offices.create, { name: "Runner Test", world: "yacht", defaultHarness: "sim" });
  console.log(JSON.stringify({ officeId }));
} else if (cmd === "approve") {
  console.log(JSON.stringify(await client.mutation(api.machines.approve, { userCode: args[0] })));
} else if (cmd === "repo") {
  const repoId = await client.mutation(api.offices.setRepo, { officeId: args[0], machineId: args[1], path: args[2], defaultBranch: "main" });
  if (args[3]) await client.mutation(api.repos.update, { repoId, setupCommand: args[3] });
  console.log("ok");
} else if (cmd === "addrepo") {
  const [officeId, machineId, path, name, setupCommand] = args;
  const repoId = await client.mutation(api.repos.add, { officeId, machineId, path, defaultBranch: "main", ...(name ? { name } : {}), ...(setupCommand ? { setupCommand } : {}) });
  console.log(JSON.stringify({ repoId }));
} else if (cmd === "repos") {
  for (const r of await client.query(api.repos.list, { officeId: args[0] })) console.log(JSON.stringify({ name: r.name, path: r.path, machine: r.machine?.name, defaultBranch: r.defaultBranch, setupCommand: r.setupCommand }));
} else if (cmd === "thread") {
  console.log(JSON.stringify({ threadId: await client.mutation(api.threads.create, { officeId: args[0], text: args[1] }) }));
} else if (cmd === "watch") {
  const [officeId, threadId, answer = "allow"] = args;
  const started = Date.now();
  let last = "";
  for (;;) {
    const thread = await client.query(api.threads.get, { threadId });
    const tasks = await client.query(api.tasks.list, { threadId });
    const open = await client.query(api.questions.open, { officeId });
    for (const q of open) {
      console.log(`  ? ${q.prompt.split("\n")[0]} → ${answer}`);
      await client.mutation(api.questions.answer, { questionId: q._id, answer });
    }
    const line = `${Math.round((Date.now() - started) / 1000)}s thread=${thread.state} branch=${thread.branch ?? "-"} tasks=${tasks.map((t) => `${t.key}${t.repo ? `@${t.repo}` : ""}:${t.state}`).join(",")}`;
    if (line.replace(/^\d+s /, "") !== last) { console.log(line); last = line.replace(/^\d+s /, ""); }
    if (thread.state === "done") break;
    if (Date.now() - started > 15 * 60_000) { console.log("timed out"); break; }
    await new Promise((r) => setTimeout(r, 1500));
  }
  const messages = await client.query(api.messages.list, { threadId });
  for (const m of messages) console.log(`--- [${m.kind}] ${m.author.kind}${m.streaming ? " (streaming)" : ""}\n${m.text}`);
  mkdirSync(new URL("../.shots/", import.meta.url), { recursive: true });
  writeFileSync(new URL("../.shots/last-thread.json", import.meta.url), JSON.stringify({ thread: await client.query(api.threads.get, { threadId }), tasks: await client.query(api.tasks.list, { threadId }), messages }, null, 1));
} else if (cmd === "look") {
  const crew = (await client.query(api.crew.list, { officeId: args[0] })).filter((c) => c.role === "crew" && !c.look);
  await client.mutation(api.crew.describeLook, { crewId: crew[0]._id, prompt: args[1] });
  for (let i = 0; i < 60; i++) {
    const c = (await client.query(api.crew.list, { officeId: args[0] })).find((x) => x._id === crew[0]._id);
    if (c.look) { console.log(`${c.name} has a look: ${c.look.meta?.name} with ${c.look.pieces.length} pieces`); break; }
    await new Promise((r) => setTimeout(r, 1000));
  }
} else if (cmd === "runs") {
  for (const r of await client.query(api.runs.forThread, { threadId: args[0] })) console.log(JSON.stringify({ id: r._id, kind: r.kind, state: r.state, error: r.error, step: r.step?.summary ?? null, worktree: r.worktree }));
} else if (cmd === "interrupt") {
  await client.mutation(api.runs.interrupt, { runId: args[0] });
  console.log("interrupt requested");
} else if (cmd === "events") {
  const evs = await client.query(api.runs.events, { runId: args[0] });
  for (const e of evs) console.log(JSON.stringify(e.event ?? e).slice(0, 160));
} else {
  console.error("unknown command");
  process.exit(1);
}
