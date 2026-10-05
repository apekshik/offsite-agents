import { v } from "convex/values";
import { query } from "./_generated/server";
import { isLive, type RunState } from "@offsite/contracts";
import type { Id } from "./_generated/dataModel";
import { requireOffice } from "./lib";
import { crewOf } from "./crewlib";
import { repoOfTask, reposOf } from "./repolib";

/**
 * Everything the yacht and the phone's crew tab need in one subscription: each crew member with
 * their live run (thread, task, the step in flight), their last finished run, and whether they are
 * waiting on you. Feed each to crewActivity (@offsite/contracts) with the local clock.
 */
export const snapshot = query({
  args: { officeId: v.id("offices") },
  handler: async (ctx, { officeId }) => {
    const { office } = await requireOffice(ctx, officeId);
    const crew = await crewOf(ctx, officeId);
    const repos = await reposOf(ctx, office);
    const repoOf = async (taskId: Id<"tasks"> | null) => {
      const task = taskId ? await ctx.db.get(taskId) : null;
      return task ? repoOfTask(task, repos)?.name ?? null : null;
    };
    const open = await ctx.db.query("questions").withIndex("by_office_open", (q) => q.eq("officeId", officeId).eq("answeredAt", null)).collect();
    const titles = new Map<string, string>();
    const title = async (id: string | null, table: "threads" | "tasks") => {
      if (!id) return null;
      if (!titles.has(id)) titles.set(id, ((await ctx.db.get(id as never)) as { title?: string } | null)?.title ?? "");
      return titles.get(id)!;
    };
    const views = await Promise.all(crew.map(async (c) => {
      const recent = await ctx.db.query("runs").withIndex("by_crew", (q) => q.eq("crewId", c._id)).order("desc").take(6);
      const live = recent.find((r) => isLive(r.state as RunState)) ?? null;
      const ended = recent.find((r) => !isLive(r.state as RunState) && r.endedAt !== null) ?? null;
      return {
        ...c,
        live: live && {
          runId: live._id,
          kind: live.kind,
          state: live.state,
          threadId: live.threadId,
          threadTitle: await title(live.threadId, "threads"),
          taskId: live.taskId,
          taskTitle: await title(live.taskId, "tasks"),
          /** The repo their task is in. */
          repo: await repoOf(live.taskId),
          step: live.step,
          startedAt: live.startedAt,
        },
        lastEnded: ended && {
          state: ended.state, endedAt: ended.endedAt!, kind: ended.kind, taskTitle: await title(ended.taskId, "tasks"),
          taskId: ended.taskId, threadId: ended.threadId,
          /** A landed task's size, for the delivered desk screen and "View changes". */
          diff: ended.taskId && ended.state === "landed" ? (await ctx.db.get(ended.taskId))?.diff ?? null : null,
        },
        lastStep: live?.lastStep ?? ended?.lastStep ?? null,
        asking: open.some((q) => q.crewId === c._id),
      };
    }));
    return {
      office: { _id: office._id, name: office.name, world: office.world, hasRepo: repos.length > 0, repos: repos.map((r) => r.name) },
      crew: views,
      questions: open.sort((a, b) => a.createdAt - b.createdAt).map((q) => ({ ...q, crewName: crew.find((c) => c._id === q.crewId)?.name ?? "Someone" })),
    };
  },
});
