import { COMPUTER_TOOLS, CREW_TOOLS, type ToolSpec } from "@offsite/contracts";
import type { OffsiteTool } from "@offsite/harness";
import { commitsAhead, finishThread, syncTask, taskDiff } from "@offsite/git";
import { readable, type Backend, type ThreadPr } from "./backend.ts";

// Offsite's tools, implemented: the computer's call the ship (and git, for review and the pull request); a crew
// member's sync with the team in git and ask the captain through the ship. Results are text the model reads: JSON
// for data, a sentence for actions. A failure throws the reason in words the agent can act on.

/** Waits for the captain's answer to an ask_captain question (it arrives in runner.work). */
export type AwaitAnswer = (q: { questionId: string; requestId: string }) => Promise<string>;

const json = (v: unknown) => JSON.stringify(v, null, 1);
const tool = (spec: ToolSpec, run: (args: Record<string, unknown>) => Promise<string>): OffsiteTool => ({
  name: spec.name, description: spec.description, args: spec.args,
  run: async (args) => { try { return await run(args); } catch (e) { throw new Error(readable(e)); } },
});
const str = (v: unknown) => (typeof v === "string" ? v : undefined);

function askCaptain(backend: Backend, runId: string, awaitAnswer: AwaitAnswer): OffsiteTool {
  return tool(COMPUTER_TOOLS.ask_captain, async (a) => {
    const options = Array.isArray(a["options"]) ? (a["options"] as string[]) : undefined;
    const q = await backend.tools.askCaptain(runId, String(a["question"]), options);
    const answer = await awaitAnswer(q);
    return answer.trim() ? `The captain answered: ${answer}` : "The captain didn't answer. Use your judgement.";
  });
}

/** The computer's repos on this machine (name, checkout, default branch) and the thread's branch name, the same in each. */
export interface ComputerPlace { repos: { name: string; path: string; defaultBranch: string }[]; threadBranch: string }

/**
 * finish_thread: push the thread's branch and open a pull request in every repo with landed work, then tell the ship.
 * A repo on another machine can't be pushed from here; its work stays on the branch there.
 */
async function finishAll(backend: Backend, runId: string, place: ComputerPlace, title: string, summary: string): Promise<string> {
  const status = await backend.tools.crewStatus(runId);
  const tasks = status.tasks ?? [];
  const open = tasks.filter((t) => ["todo", "doing", "review"].includes(t.state));
  if (open.length) throw new Error(`Not every task has landed: ${open.map((t) => `${t.key} (${t.state})`).join(", ")}`);
  const named = [...new Set(tasks.filter((t) => t.state === "landed").map((t) => t.repo ?? place.repos[0]?.name).filter((x): x is string => !!x))];
  // The ship's order (the first repo first), then any not on this machine.
  const order = [...place.repos.map((r) => r.name).filter((n) => named.includes(n)), ...named.filter((n) => !place.repos.some((r) => r.name === n))];
  const branch = place.threadBranch;
  const many = order.length > 1;
  const body = `${summary}${many ? `\n\nThis change spans ${order.length} repos (${order.join(", ")}), each with its own pull request from the branch ${branch}.` : ""}\n\n— Planned by the ship's computer, built by the crew on Offsite.`;
  const prs: ThreadPr[] = [];
  const said: string[] = [];
  for (const name of order) {
    const local = place.repos.find((r) => r.name === name);
    const say = (m: string) => said.push(many ? `${name}: ${m}` : m);
    if (!local) { prs.push({ repo: name, url: null, branch }); say(`it's on another machine, so its work stays on the branch ${branch} there.`); continue; }
    if (!(await commitsAhead(local.path, branch, local.defaultBranch).catch(() => 1))) { prs.push({ repo: name, url: null, branch }); say(`nothing new on ${branch}, so no pull request.`); continue; }
    const r = await finishThread({ repo: local.path, branch, base: local.defaultBranch, title, body });
    prs.push({ repo: name, url: r.prUrl, branch });
    say(r.message);
  }
  await backend.tools.finishThread(runId, title, summary, prs);
  return said.join("\n") || "Finished. No task landed any work, so there was nothing to push.";
}

export function computerTools(backend: Backend, runId: string, place: ComputerPlace, awaitAnswer: AwaitAnswer): OffsiteTool[] {
  const T = COMPUTER_TOOLS;
  return [
    tool(T.crew_status, async () => json(await backend.tools.crewStatus(runId))),
    tool(T.plan_tasks, async (a) => json(await backend.tools.planTasks(runId, a["tasks"] as Parameters<Backend["tools"]["planTasks"]>[1]))),
    tool(T.assign_task, async (a) => json(await backend.tools.assignTask(runId, String(a["task"]), str(a["crew"])))),
    tool(T.hire_crew, async (a) => json(await backend.tools.hireCrew(runId, {
      ...(str(a["name"]) ? { name: str(a["name"])! } : {}),
      ...(a["harness"] === "claude" || a["harness"] === "codex" ? { harness: a["harness"] } : {}),
      ...(str(a["specialty"]) ? { specialty: str(a["specialty"])! } : {}),
    }))),
    tool(T.message_crew, async (a) => json(await backend.tools.messageCrew(runId, String(a["crew"]), String(a["text"])))),
    askCaptain(backend, runId, awaitAnswer),
    tool(T.review_task, async (a) => {
      const info = await backend.tools.reviewTask(runId, String(a["task"]));
      const local = place.repos.find((r) => r.name === info.repo) ?? (info.repo ? null : place.repos[0]);
      if (!local) return json({ ...info, stat: null, landed: info.state === "landed", diff: `(the repo "${info.repo}" is on another machine; read the report)` });
      const diff = info.branch ? await taskDiff(local.path, info.threadBranch ?? place.threadBranch, info.branch).catch(() => null) : null;
      return json({ ...info, stat: diff?.stat ?? null, landed: diff?.landed ?? false, diff: diff?.diff || "(no changes found on the task's branch)" });
    }),
    tool(T.send_back, async (a) => json(await backend.tools.sendBack(runId, String(a["task"]), String(a["notes"])))),
    tool(T.finish_thread, async (a) => finishAll(backend, runId, place, String(a["title"]), String(a["summary"]))),
  ];
}

export interface CrewPlace { repo: string; worktree: string; threadBranch: string; author: string }

export function crewTools(backend: Backend, runId: string, place: CrewPlace, awaitAnswer: AwaitAnswer): OffsiteTool[] {
  return [
    tool(CREW_TOOLS.sync_with_team, async () => {
      const r = await syncTask({ repo: place.repo, worktree: place.worktree, threadBranch: place.threadBranch, author: place.author });
      if (!r.ok) {
        return `Teammates' work conflicts with yours in: ${r.conflict.join(", ")}. Those files now hold conflict markers (<<<<<<< yours, >>>>>>> theirs). ` +
          "Resolve them, keeping what both sides meant, check it still builds, then carry on. Don't run git commands: the ship commits for you.";
      }
      return r.upToDate ? "Already up to date with the thread's branch." : `Synced: brought in ${r.brought} commit${r.brought === 1 ? "" : "s"} your teammates landed. Your work in progress is intact.`;
    }),
    askCaptain(backend, runId, awaitAnswer),
  ];
}
