import { COMPUTER_TOOLS, CREW_TOOLS, type ToolSpec } from "@offsite/contracts";
import type { OffsiteTool } from "@offsite/harness";
import { finishThread, syncTask, taskDiff } from "@offsite/git";
import { readable, type Backend } from "./backend.ts";

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

export interface ComputerPlace { repo: string; threadBranch: string; defaultBranch: string }

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
      const diff = info.branch ? await taskDiff(place.repo, info.threadBranch ?? place.threadBranch, info.branch).catch(() => null) : null;
      return json({ ...info, stat: diff?.stat ?? null, landed: diff?.landed ?? false, diff: diff?.diff || "(no changes found on the task's branch)" });
    }),
    tool(T.send_back, async (a) => json(await backend.tools.sendBack(runId, String(a["task"]), String(a["notes"])))),
    tool(T.finish_thread, async (a) => {
      const title = String(a["title"]), summary = String(a["summary"]);
      const r = await finishThread({ repo: place.repo, branch: place.threadBranch, base: place.defaultBranch, title, body: `${summary}\n\n— Planned by the ship's computer, built by the crew on Offsite.` });
      await backend.tools.finishThread(runId, title, summary, r.prUrl);
      return r.message;
    }),
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
