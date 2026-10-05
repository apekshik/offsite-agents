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
