// Adapted from Beam (github.com/SupraluminalIntelligence/beam, MIT).
import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listProfiles, profileEnv, resolveProfile } from "./profile.ts";

const roots: string[] = [];
afterEach(async () => { delete process.env["OFFSITE_HOME"]; for (const r of roots.splice(0)) await rm(r, { recursive: true, force: true }); });

it("isolates concurrent Codex profiles without mutating the parent or inheriting its API key", () => {
  const parent = { CODEX_HOME: "/original", OPENAI_API_KEY: "secret", PATH: "/bin" };
  const work = profileEnv("codex", { configDir: "/work" }, parent);
  const personal = profileEnv("codex", { configDir: "/personal" }, parent);
  expect(work["CODEX_HOME"]).toBe("/work"); expect(personal["CODEX_HOME"]).toBe("/personal");
  expect(work["OPENAI_API_KEY"]).toBeUndefined(); expect(work["PATH"]).toBe("/bin");
  expect(parent).toEqual({ CODEX_HOME: "/original", OPENAI_API_KEY: "secret", PATH: "/bin" });
});

it("isolates Claude authentication and provider overrides but preserves the default CLI environment", () => {
  const parent = { CLAUDE_CONFIG_DIR: "/original", CLAUDE_CODE_OAUTH_TOKEN: "secret", ANTHROPIC_API_KEY: "key", CLAUDE_CODE_USE_BEDROCK: "1" };
  expect(profileEnv("claude", { configDir: "/work" }, parent)).toEqual({ CLAUDE_CONFIG_DIR: "/work" });
  expect(profileEnv("claude", undefined, parent)).toEqual(parent);
});

it("resolves a crew member's profile name to its folder, and refuses one that is not there", async () => {
  const home = await mkdtemp(join(tmpdir(), "offsite-profiles-")); roots.push(home);
  process.env["OFFSITE_HOME"] = home;
  await mkdir(join(home, "profiles", "claude", "work"), { recursive: true });
  expect(await resolveProfile("claude", null)).toBeUndefined();
  expect(await resolveProfile("claude", "work")).toEqual({ configDir: join(home, "profiles", "claude", "work") });
  expect(await resolveProfile("claude", home)).toEqual({ configDir: home });
  await expect(resolveProfile("codex", "work")).rejects.toThrow(/No codex profile "work"/);
  expect((await listProfiles("claude")).map((p) => p.name)).toEqual(["work"]);
});
