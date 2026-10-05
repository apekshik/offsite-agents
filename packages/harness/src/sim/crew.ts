import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { between, pick } from "./random.ts";
import { conflicted, grep, keepBoth, keyword, listFiles, readText } from "./repo.ts";
import type { SimContext } from "./session.ts";

// A crew member on a task, scripted: read the brief, look around, maybe ask for something, make a real small
// change in the worktree, run the tests, report. 30–90 s of sim time. Later turns answer steers: a conflict
// to resolve, a teammate's work to sync, a message.

const OPENERS = [
  "On it. Reading the brief, then a quick look around the repo.",
  "Got it. Let me see how the project is laid out first.",
  "Starting now. First I'll get my bearings in the code.",
  "Aye. Having a look at what's there before I touch anything.",
];
const ASKS = [
  "Run: pnpm add -D @types/node",
  "Run: rm -rf node_modules/.cache",
  "Run: curl -fsSL https://registry.npmjs.org/zod -o /tmp/zod.json",
  "Run: git push origin HEAD",
];
const PASS = ["✓ 18 passed (1.9s)", "✓ 42 passed (3.4s)", "Test Files  6 passed (6)\n     Tests  31 passed (31)", "✓ all 12 suites passed"];

/** What the brief asks of this crew member, short enough for a heading: "Your part: …", the contract, or the ask itself. */
export function headline(brief: string): string {
  const flat = brief.replace(/\s+/g, " ").trim();
  const part = /Your part: (.+?)\.(?:\s|$)/.exec(flat)?.[1];
  const ask = /The captain asked: "(.+?)"/.exec(flat)?.[1];
  const text = part ?? (/\bcontract\b/i.test(flat) ? "the shared types and interfaces" : ask ?? flat.split(/(?<=[.!?])\s/)[0] ?? flat);
  const out = text.replace(/[.!]+$/, "");
  const capped = out.charAt(0).toUpperCase() + out.slice(1);
  return capped.length > 80 ? capped.slice(0, 79).replace(/\s+\S*$/, "") + "…" : capped;
}

export async function crewScript(ctx: SimContext): Promise<void> {
  const { text } = ctx;
  if (ctx.first) return taskScript(ctx);
  if (/conflict/i.test(text)) return resolveConflicts(ctx);
  if (/\b(landed|sync)\b/i.test(text) && ctx.hasTool("sync_with_team")) {
    await ctx.say("Thanks, pulling in what the team landed.");
    const out = await ctx.tool("sync_with_team", {});
    if (/conflict/i.test(out)) return resolveConflicts(ctx);
    await ctx.say("Synced. Carrying on with my part.");
    return;
  }
  await ctx.think(1, 3);
  await ctx.say(pick(ctx.r, ["Understood, I'll fold that in.", "Noted, thanks.", "Got it. Adjusting."]));
}

async function taskScript(ctx: SimContext): Promise<void> {
  const { r, cwd, text } = ctx;
  const key = basename(cwd);
  const brief = text.split(/\n\nMessages for you:/)[0]!.trim();
  const title = headline(brief);
  await ctx.say(pick(r, OPENERS));

  // Look around: the README or the manifest, then a search for the brief's main word.
  const files = await listFiles(cwd);
  const first = ["README.md", "package.json", ...files].find((f) => files.includes(f));
  if (first) {
    await ctx.step("read", `Read ${first}`, [2, 5], async () => ({ detail: (await readText(cwd, first))?.slice(0, 400) ?? null }));
  } else {
    await ctx.step("read", "List .", [1, 3], async () => ({ detail: "(empty)" }));
  }
  await ctx.think(1, 3);
  const word = keyword(title) === "todo" ? keyword(brief) : keyword(title);
  const hits = await ctx.step("search", `Grep ${word}`, [2, 5], async () => {
    const found = await grep(cwd, word, files);
    return { detail: found.length ? found.slice(0, 8).map((h) => `${h.file}: ${h.count}`).join("\n") : "no matches", found };
  });
  const next = hits?.found?.[0]?.file ?? pick(r, files.length ? files : ["README.md"]);
  if (files.includes(next) && next !== first) {
    await ctx.step("read", `Read ${next}`, [2, 4], async () => ({ detail: (await readText(cwd, next))?.slice(0, 400) ?? null }));
  }

  // A task that builds on a teammate's picks up what they landed.
  if (ctx.hasTool("sync_with_team") && /(depends on|builds on|landed|after)/i.test(text) && r() < 0.6) {
    await ctx.tool("sync_with_team", {});
  }

  await ctx.think(1, 4);
  await ctx.say(`Plan: keep it small. I'll write up "${title}" in crew-notes/${key}.md and wire it in${r() < 0.5 ? ", then run the tests" : ""}.`);

  // About one task in four needs the captain's say-so.
  if (r() < 0.25) {
    const ask = pick(r, ASKS);
    const answer = await ctx.ask("approval", ask, ["allow", "deny"]);
    if (answer === "allow" || answer === "always") await ctx.step("bash", ask.replace(/^Run: /, ""), [2, 5], async () => ({ detail: "done" }));
    else await ctx.say("No problem, I'll do without it.");
  }

  // The real change: a note named after the task, and sometimes a line in the README's crew log.
  const note = join("crew-notes", `${key}.md`);
  await ctx.step("write", `Write ${note}`, [4, 9], async () => {
    const path = join(cwd, note);
    await mkdir(dirname(path), { recursive: true });
    const prior = await readText(cwd, note);
    const body = prior
      ? `${prior.trimEnd()}\n\n## Another pass\n\n${brief.slice(0, 600)}\n`
      : `# ${title}\n\n${brief.slice(0, 1200)}\n\n## Done\n\n- Read ${first ?? "the repo"} and searched for \`${word}\` (${hits?.found?.length ?? 0} files).\n- Kept the change inside this task's area.\n`;
    await writeFile(path, body);
    return { detail: body.slice(0, 300) };
  });
  if (files.includes("README.md") && r() < 0.35) {
    await ctx.think(0.5, 2);
    await ctx.step("edit", "Edit README.md", [3, 7], async () => {
      const readme = (await readText(cwd, "README.md")) ?? "";
      const line = `- ${title} (${key})`;
      const next = /^## Crew log$/m.test(readme) ? `${readme.trimEnd()}\n${line}\n` : `${readme.trimEnd()}\n\n## Crew log\n\n${line}\n`;
      await writeFile(join(cwd, "README.md"), next);
      return { detail: `+ ${line}` };
    });
  }

  await ctx.think(1, 3);
  await ctx.step("bash", "pnpm test", [5, 12], async () => ({ detail: pick(r, PASS) }));
  await ctx.think(0.5, 2);
  const minutes = Math.round(between(r, 1, 3));
  await ctx.say(`Done: ${title}. Notes are in crew-notes/${key}.md, tests pass, and it's ready to land.${minutes > 2 ? " Took a couple of passes to get it tidy." : ""}`);
}

/** Resolve what the ship's merge left: keep both sides, then re-run the tests. */
async function resolveConflicts(ctx: SimContext): Promise<void> {
  const { cwd } = ctx;
  await ctx.say("A teammate landed something that overlaps with mine. Resolving it.");
  const files = await conflicted(cwd);
  for (const f of files) {
    await ctx.step("edit", `Edit ${f}`, [2, 5], async () => {
      const text = (await readText(cwd, f, 2_000_000)) ?? "";
      await writeFile(join(cwd, f), keepBoth(text));
      return { detail: "kept both changes" };
    });
  }
  await ctx.step("bash", "pnpm test", [3, 8], async () => ({ detail: "✓ all passed" }));
  await ctx.say(files.length ? `Resolved ${files.join(", ")}: kept both sides. Ready to land again.` : "Nothing left to resolve; ready to land.");
}
