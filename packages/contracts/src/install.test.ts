import { expect, it } from "vitest";
import { RUNNER_COMMAND, RUNNER_SPEC, runnerCommand } from "./install.ts";

it("builds every runner command from the one install spec", () => {
  // The site's tarball until the npm package is published, then the package name.
  expect(RUNNER_SPEC === "offsite-agents" || /^https:\/\/offsiteagents\.app\/[\w.-]+\.tgz$/.test(RUNNER_SPEC)).toBe(true);
  expect(RUNNER_COMMAND).toBe(`npx ${RUNNER_SPEC}`);
  expect(runnerCommand("install")).toBe(`npx ${RUNNER_SPEC} install`);
});
