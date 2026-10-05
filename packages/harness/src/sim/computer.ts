import { pick } from "./random.ts";
import { keyword, slugify } from "./repo.ts";
import type { SimContext } from "./session.ts";

// Computah, the main orchestrator, scripted. Each turn it checks on the crew, then: plans the captain's request (one task, or
// a shared-types task first and two parts that depend on it when the ask clearly has parts); says where things
// stand while work is out; reviews every task and finishes the thread once they have all landed.

interface Status { repos?: { name: string }[]; tasks: { id: string; key: string; title: string; state: string; assignee: string | null; repo?: string | null }[] }
interface Planned { key: string; assignee: string | null; state: string }
interface PlanTask { key: string; title: string; brief: string; dependsOn: string[]; assignee: string; repo?: string }

const parse = <T>(s: string, fallback: T): T => { try { return JSON.parse(s) as T; } catch { return fallback; } };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : s);

/** The parts of an ask: bullet lines, or clauses joined by "and", "plus", "also", "then", ";". */
export function partsOf(request: string): string[] {
  const bullets = request.split("\n").filter((l) => /^\s*([-*•]|\d+[.)])\s+/.test(l)).map((l) => l.replace(/^\s*([-*•]|\d+[.)])\s+/, "").trim());
  if (bullets.length >= 2) return bullets;
  const flat = request.replace(/\s+/g, " ").trim().replace(/[.!]+$/, "");
  return flat.split(/\s*(?:;|,\s*and\s+|\band also\b|\bplus\b|\balso\b|\bthen\b|\band\b)\s*/i).map((p) => p.trim()).filter((p) => p.split(/\s+/).length >= 2);
}

/** The repo a piece of text names, by word: "add a route to the api" → "api". */
export function repoNamed(text: string, repos: string[]): string | null {
  const t = text.toLowerCase();
  return repos.find((r) => new RegExp(`(^|[^a-z0-9-])${r.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9-]|$)`).test(t)) ?? null;
}
/** Serving repos go first: what the others call lands before them. */
const SERVES = /^(api|server|backend|service|services|core|shared|types|contracts|lib)\b/;

/**
 * One task unless the ask clearly has parts; then a small shared-types task lands first and the parts build on it.
 * With several repos: parts that name different repos become a task per repo, the serving one (the API) first and
 * each after it depending on the one before; otherwise everything goes in the repo the ask names, or the first.
 */
export function planFor(request: string, taken: Set<string>, repos: string[] = []): PlanTask[] {
  const ask = request.replace(/\s+/g, " ").trim();
  const unique = (base: string) => { let k = keyFor(base); for (let n = 2; taken.has(k); n++) k = `${keyFor(base, 29)}-${n}`; taken.add(k); return k; };
  const many = repos.length > 1;
  const home = many ? repoNamed(ask, repos) ?? repos[0]! : undefined;
  const inRepo = (t: PlanTask): PlanTask => (home ? { ...t, repo: t.repo ?? home } : t);
  if (many) {
    const placed = partsOf(request).slice(0, 4).map((p) => p.replace(/[,;:.!]+$/, "")).map((p) => ({ p, repo: repoNamed(p, repos) }));
    const distinct = new Set(placed.map((x) => x.repo).filter(Boolean));
    if (placed.length >= 2 && distinct.size >= 2) {
      const ordered = placed.map((x) => ({ ...x, repo: x.repo ?? home! })).sort((a, b) => Number(!SERVES.test(a.repo)) - Number(!SERVES.test(b.repo)));
      const tasks: PlanTask[] = [];
      for (const [i, x] of ordered.entries()) {
        const prev = tasks[i - 1];
        const others = ordered.filter((o) => o !== x).map((o) => `"${o.p}" (in ${o.repo})`).join(" and ");
        tasks.push({
          key: unique(x.p), title: clip(cap(x.p), 120), repo: x.repo,
          brief: `The captain asked: "${ask}".\n\nYour part: ${x.p}. It is in the ${x.repo} repo; teammates are doing ${others}.${prev ? ` "${prev.title}" (in ${prev.repo}) lands first: build on what it provides rather than guessing at it.` : " Yours lands first: keep its interface small and say in your report exactly what it provides."}`,
          dependsOn: prev ? [prev.key] : [], assignee: "any",
        });
      }
      return tasks;
    }
  }
  const parts = partsOf(request).slice(0, 2);
  const words = ask.split(" ").length;
  if (parts.length < 2 || words < 8) {
    return [inRepo({ key: unique(ask), title: clip(cap(ask.replace(/[.!]+$/, "")), 120), brief: `The captain asked: "${ask}".\n\nDo exactly that, kept small and focused. Read the relevant code first, follow the project's conventions, and run its tests before you finish.`, dependsOn: [], assignee: "any" })];
  }
  const subject = keyword(ask);
  const shared = unique(subject === "todo" ? "shared-types" : `${subject}-types`);
  const tasks: PlanTask[] = [{
    key: shared,
    title: "Shared types and interfaces",
    brief: `The captain asked: "${ask}".\n\nThis splits into parts that will be built in parallel: ${parts.map((p) => `"${p}"`).join(" and ")}. Your job is only the contract they share: add the types, interfaces or API shapes both parts need, in one small module, with a short comment on each. No feature work; the others start when this lands.`,
    dependsOn: [], assignee: "any",
  }];
  for (const p of parts) {
    tasks.push({
      key: unique(p), title: clip(cap(p), 120),
      brief: `The captain asked: "${ask}".\n\nYour part: ${p}. The shared types landed first (task "${shared}"): build on them rather than redefining anything. Stay inside your area; a teammate is doing ${parts.filter((x) => x !== p).map((x) => `"${x}"`).join(", ")} at the same time.`,
      dependsOn: [shared], assignee: "any",
    });
  }
  return tasks.map(inRepo);
}

const FILLER = new Set(["a", "an", "the", "and", "that", "this", "of", "to", "for", "with", "in", "on", "it", "its", "then", "please"]);
/** A short task key from words: "a settings page that lists the invoices" → "settings-page-that-lists". */
function keyFor(text: string, max = 32): string {
  const words = slugify(text, 64).split("-");
  while (words.length > 1 && FILLER.has(words[0]!)) words.shift();
  let key = "";
  for (const w of words) { if ((key ? key.length + 1 : 0) + w.length > max) break; key = key ? `${key}-${w}` : w; }
  const parts = (key || slugify(text, max)).split("-");
  while (parts.length > 1 && FILLER.has(parts.at(-1)!)) parts.pop();
  return parts.join("-");
}

const who = (p: Planned | undefined) => (p?.assignee ? p.assignee : "someone free");

export async function computerScript(ctx: SimContext): Promise<void> {
  const { r, text } = ctx;
  const request = text.split(/\n\nMessages for you:/)[0]!.trim();
  // Notes from the ship start "@juniper landed …", "@juniper could not finish …" or "The captain stopped …".
  const wake = /^(@[\w-]+ (landed|could not finish)|The captain stopped)/m.test(request);
  const chat = !wake && request.split(/\s+/).length < 4;
  if (!wake) await ctx.say(pick(r, ["Aye, captain. Checking who's aboard.", "On it. Let me see who's free.", "Understood. One moment while I check the crew."]));
  const status = parse<Status>(await ctx.tool("crew_status", {}), { tasks: [] });
  const tasks = status.tasks ?? [];
  const repos = (status.repos ?? []).map((r) => r.name);
  const many = repos.length > 1;
  const open = tasks.filter((t) => ["todo", "doing", "review"].includes(t.state));
  const landed = tasks.filter((t) => t.state === "landed");
  const failed = tasks.filter((t) => t.state === "failed");

  if (tasks.length && (wake || chat)) {
    if (open.length) {
      const inFlight = open.map((t) => `"${t.title}"${t.assignee ? ` (@${t.assignee})` : ""}`).join(", ");
      await ctx.say(`${landed.length} of ${tasks.length} landed. Still going: ${inFlight}.`);
      return;
    }
    if (failed.length) {
      await ctx.say(`${failed.map((t) => `"${t.title}"`).join(", ")} didn't make it. Holding the pull request: send it back, or shall I re-plan it?`);
      return;
    }
    if (!wake) { await ctx.say("Anytime, captain."); return; }
    if (!landed.length) { await ctx.say("Nothing landed, so there's nothing to open a pull request for."); return; }
    // Finish on the note that says everything is in ("3 of 3 tasks have landed"), once: an earlier note can arrive
    // after the last task already landed.
    const counts = [...request.matchAll(/(\d+) of (\d+) tasks have landed/g)];
    if (ctx.memory["finished"] || (counts.length && !counts.some((m) => m[1] === m[2]))) { await ctx.say("Noted."); return; }
    ctx.memory["finished"] = true;
    // Every task is in: review each, then one branch and one pull request.
    await ctx.say(`${landed.length === 1 ? "It has" : `All ${landed.length} tasks have`} landed. Reviewing before I open the pull request.`);
    const notes: string[] = [];
    for (const t of landed) {
      const review = parse<{ stat?: { files?: number; add?: number; del?: number } }>(await ctx.tool("review_task", { task: t.key }), {});
      const s = review.stat;
      notes.push(`- ${t.title}${many && t.repo ? ` in ${t.repo}` : ""}${s ? ` (${s.files ?? 0} ${s.files === 1 ? "file" : "files"}, +${s.add ?? 0} −${s.del ?? 0})` : ""}`);
      await ctx.think(0.5, 2);
    }
    const main = landed.find((t) => !/^shared/i.test(t.key)) ?? landed[0]!;
    const out = await ctx.tool("finish_thread", { title: clip(cap(main.title), 120), summary: notes.join("\n") });
    await ctx.say(`Looks right. ${out}`);
    return;
  }
  if (wake) { await ctx.say("Noted."); return; }
  if (chat) { await ctx.say("Tell me what you'd like built and I'll get the crew on it."); return; }

  // A request: plan it (on top of whatever this thread already has).
  const plan = planFor(request, new Set(tasks.map((t) => t.key)), repos);
  await ctx.think(1, 3);
  const planned = parse<Planned[]>(await ctx.tool("plan_tasks", { tasks: plan }), []);
  const byKey = new Map(planned.map((p) => [p.key, p]));
  const across = new Set(plan.map((t) => t.repo)).size > 1;
  if (across) {
    const steps = plan.map((t, i) => `${i ? "then " : ""}"${t.title}" in ${t.repo} (${who(byKey.get(t.key))})`).join(", ");
    await ctx.say(`This spans ${new Set(plan.map((t) => t.repo)).size} repos, so a task in each, in order: ${steps}. Each lands on the thread's branch in its own repo; I'll review everything and open a pull request in each.`);
  } else if (plan.length === 1) {
    await ctx.say(`One task: ${plan[0]!.title}. ${cap(who(byKey.get(plan[0]!.key)))} has it, in their own worktree. I'll review it when it lands.`);
  } else {
    const [shared, ...rest] = plan;
    await ctx.say(`This splits cleanly into ${rest.length} parts, so ${plan.length} tasks. First the shared types (${who(byKey.get(shared!.key))}), so both sides build on one contract. Then ${rest.map((t) => `"${t.title}" (${who(byKey.get(t.key))})`).join(" and ")} in parallel once that lands. I'll review everything before the pull request.`);
  }
}
