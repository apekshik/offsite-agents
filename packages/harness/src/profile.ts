// Adapted from Beam (github.com/SupraluminalIntelligence/beam, MIT).
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

/**
 * Several accounts on one machine: each profile is its own config directory (CLAUDE_CONFIG_DIR or CODEX_HOME),
 * signed in once with the CLI's own login. Offsite stores the directory, never what is inside it.
 */
export type HarnessProfile = { configDir: string };

export const offsiteHome = () => process.env["OFFSITE_HOME"] ?? join(homedir(), ".offsite");
/** Profiles made with `offsite profile add` live here: ~/.offsite/profiles/<harness>/<name>. */
export const profilesDir = (harness: "claude" | "codex") => join(offsiteHome(), "profiles", harness);

/** Per-child configuration. Never mutate the runner's environment or switch a global login. */
export function profileEnv(harness: "codex" | "claude", profile?: HarnessProfile, source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...source };
  if (!profile) return env;
  // Explicit profiles use their own provider authentication, never a parent process's token.
  const keys = harness === "codex"
    ? ["OPENAI_API_KEY", "CODEX_API_KEY", "OPENAI_BASE_URL", "CODEX_AUTH_JSON"]
    : ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR", "CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR", "ANTHROPIC_BASE_URL", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY"];
  for (const key of keys) delete env[key];
  env[harness === "codex" ? "CODEX_HOME" : "CLAUDE_CONFIG_DIR"] = profile.configDir;
  return env;
}

/**
 * A crew member's `profile` → a config directory. null is the CLI's default login; an absolute path is used as
 * is; any other name is a folder under ~/.offsite/profiles/<harness>/. A name with no folder is an error, so a
 * crew member never silently runs on the wrong account.
 */
export async function resolveProfile(harness: "claude" | "codex", name: string | null): Promise<HarnessProfile | undefined> {
  if (!name || name === "default") return undefined;
  const dir = isAbsolute(name) ? name : join(profilesDir(harness), name);
  const ok = await stat(dir).then((s) => s.isDirectory(), () => false);
  if (!ok) throw new Error(`No ${harness} profile "${name}" on this machine (looked for ${dir}). Run \`offsite profile add ${harness} ${name}\`.`);
  return { configDir: dir };
}

/** Every named profile on this machine, for probing. */
export async function listProfiles(harness: "claude" | "codex"): Promise<{ name: string; profile: HarnessProfile }[]> {
  const dir = profilesDir(harness);
  const names = await readdir(dir).catch(() => [] as string[]);
  const out: { name: string; profile: HarnessProfile }[] = [];
  for (const name of names.sort()) {
    if (await stat(join(dir, name)).then((s) => s.isDirectory(), () => false)) out.push({ name, profile: { configDir: join(dir, name) } });
  }
  return out;
}
