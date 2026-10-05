import type { Harness } from "@offsite/contracts";
import type { HarnessAdapter, HarnessStatus } from "./adapter.ts";
import { claudeAdapter } from "./claude/index.ts";
import { codexAdapter } from "./codex/index.ts";
import { listProfiles } from "./profile.ts";
import { simAdapter } from "./sim/index.ts";

export * from "./adapter.ts";
export * from "./profile.ts";
export * from "./path.ts";
export * from "./version.ts";
export * from "./queue.ts";
export * from "./tools.ts";
export * from "./usage.ts";
export { claudeAdapter, probeClaude } from "./claude/index.ts";
export { codexAdapter, probeCodex } from "./codex/index.ts";
export { JsonRpcChild } from "./codex/rpc.ts";
export { CodexSession, toolSchema } from "./codex/session.ts";
export * from "./sim/index.ts";

export const adapters: Record<Harness, HarnessAdapter> = { claude: claudeAdapter, codex: codexAdapter, sim: simAdapter };

/** A probe result, and which account it is for (null: the CLI's default login). */
export type ProfileStatus = HarnessStatus & { profile: string | null };

/** Probe every harness on this machine: each CLI's default login, then each named profile. Never spends anything. */
export async function probeAll(opts: { profiles?: boolean } = {}): Promise<ProfileStatus[]> {
  const [claude, codex] = await Promise.all([claudeAdapter.probe(), codexAdapter.probe()]);
  const out: ProfileStatus[] = [{ ...claude, profile: null }, { ...codex, profile: null }];
  if (opts.profiles !== false) {
    for (const harness of ["claude", "codex"] as const) {
      for (const p of await listProfiles(harness)) out.push({ ...(await adapters[harness].probe(p.profile)), profile: p.name });
    }
  }
  return out;
}
