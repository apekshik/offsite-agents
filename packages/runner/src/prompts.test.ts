import { expect, it } from "vitest";
import type { RunContext } from "./backend.ts";
import { computerPrompt, crewPrompt } from "./prompts.ts";

const ctx: RunContext = {
  run: { id: "run1", kind: "computer", prompt: "Add dark mode" },
  office: { id: "office1", name: "Sea Legs", repos: [{ id: "r1", name: "app", path: "/repo", defaultBranch: "main", setupCommand: null, here: true }], repoPath: "/repo", defaultBranch: "main", setupCommand: null },
  crew: { id: "c1", name: "Arlo", handle: "arlo", role: "crew", harness: "codex", model: null, effort: "high", profile: null, specialty: null },
  thread: { id: "t1", title: "Dark mode", branch: null },
  task: { id: "k1", key: "dark-mode", repo: "app", title: "Dark mode", brief: "Add it", notes: null, branch: null, dependsOn: [] },
  resumeCursor: null,
  context: "",
};

it("has the computer keep commits, pushes and pull requests out of its briefs: the ship does those", () => {
  const p = computerPrompt(ctx, "Ada", { threadBranch: "offsite/dark-mode-x", cwd: "/w/_thread", repos: ["app"] });
  expect(p).toMatch(/never tell them to commit, push, open a pull request/);
  expect(p).toMatch(/finish_thread pushes it and opens the pull request/);
  // What the crew are told, so the two agree.
  expect(crewPrompt(ctx, { cwd: "/w/dark-mode", taskBranch: "offsite/dark-mode-x-dark-mode", threadBranch: "offsite/dark-mode-x", port: null })).toMatch(/Commit nothing yourself/);
});

it("introduces Computah as the main orchestrator, and tells the crew who gave them the task", () => {
  const p = computerPrompt(ctx, "Ada", { threadBranch: "offsite/dark-mode-x", cwd: "/w/_thread", repos: ["app"] });
  expect(p).toMatch(/^You are Computah \(@computah\), the main orchestrator on .+\. You help Ada, the captain, manage the crew\./);
  expect(crewPrompt(ctx, { cwd: "/w/dark-mode", taskBranch: "offsite/dark-mode-x-dark-mode", threadBranch: "offsite/dark-mode-x", port: null })).toMatch(/Computah, the main orchestrator, gave you a task/);
});

it("tells Computah about friends aboard, and only when there are some", () => {
  const alone = computerPrompt({ ...ctx, people: [{ name: "Ada", role: "captain" }] }, "Ada", { threadBranch: "offsite/x", cwd: "/w/_thread", repos: ["app"] });
  expect(alone).not.toMatch(/friends aboard/);
  const p = computerPrompt({ ...ctx, people: [{ name: "Ada", role: "captain" }, { name: "Maya", role: "friend" }] }, "Ada", { threadBranch: "offsite/x", cwd: "/w/_thread", repos: ["app"] });
  expect(p).toMatch(/Ada has friends aboard: Maya\./);
  expect(p).toMatch(/run on Ada's machines and subscriptions/);
  expect(p).toMatch(/answer the person who asked, by name/);
});
