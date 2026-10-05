// How a captain gets the runner (packages/runner) onto a machine: `npx <RUNNER_SPEC>`. Everything that shows or runs
// that command reads it from here: the app's "Your machine" step and /pair page, the CLI's help and hints, the
// background service it installs, and the backend's error messages.

/**
 * What npx installs. For now the site serves the tarball of packages/runner, rebuilt on every deploy
 * (scripts/pack-runner.mjs, docs/deploy.md); npm picks the `offsite-agents` bin because it matches the package name.
 * Once the package is on npm, change this to "offsite-agents"; nothing else in code needs to change.
 */
export const RUNNER_SPEC: string = "https://offsiteagents.app/offsite-agents.tgz";

/** The command that pairs a machine (the first time) and starts its crew, or, given one, runs a subcommand. */
export const runnerCommand = (sub?: string): string => (sub ? `npx ${RUNNER_SPEC} ${sub}` : `npx ${RUNNER_SPEC}`);

/** `npx <RUNNER_SPEC>`. */
export const RUNNER_COMMAND = runnerCommand();
