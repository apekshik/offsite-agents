// Adapted from Beam (github.com/SupraluminalIntelligence/beam, MIT).
import { z } from "zod";
import type { HarnessAdapter, HarnessStatus, Session, StartSession } from "../adapter.ts";
import { which } from "../path.ts";
import { withTimeout } from "../version.ts";
import { JsonRpcChild } from "./rpc.ts";
import { CodexSession } from "./session.ts";
import { profileEnv, type HarnessProfile } from "../profile.ts";

/**
 * Codex via `codex app-server` JSON-RPC over stdio, with the captain's own `codex` and CODEX_HOME. Probe:
 * initialize, account/read, model/list. { chatgpt: email, planType } means a subscription, { apiKey } an API
 * key, nothing means `codex login`. No turn is started, so nothing is spent.
 */
const PLAN: Record<string, string> = { free: "Free", go: "Go", plus: "Plus", pro: "Pro", prolite: "Pro Lite", team: "Team", business: "Business", enterprise: "Enterprise", edu: "Edu" };

export const CLIENT_INFO = { name: "offsite", title: "Offsite", version: "0.0.1" };

const ModelPage = z.object({
  data: z.array(z.object({ model: z.string(), displayName: z.string(), hidden: z.boolean().optional(), supportedReasoningEfforts: z.array(z.object({ reasoningEffort: z.string() })) })),
  nextCursor: z.string().nullable(),
});

export async function probeCodex(profile?: HarnessProfile, cwd?: string): Promise<HarnessStatus> {
  const base = { harness: "codex" as const, plan: null, email: null, models: [] as HarnessStatus["models"] };
  const bin = await which("codex");
  if (!bin) return { ...base, installed: false, version: null, auth: "unknown", message: "Codex (`codex`) is not on PATH. Install it, then run `codex login`." };
  const rpc = new JsonRpcChild(bin, ["app-server"], profileEnv("codex", profile), cwd ?? profile?.configDir);
  try {
    const init = await withTimeout(rpc.request<{ userAgent?: string }>("initialize", { clientInfo: CLIENT_INFO, capabilities: { experimentalApi: true } }), 15_000, "codex initialize");
    rpc.notify("initialized");
    const version = init.userAgent?.match(/\/(\d+\.\d+\.\d+\S*)/)?.[1] ?? null;
    const acct = await withTimeout(rpc.request<{ account?: { type: string; email?: string | null; planType?: string } | null; requiresOpenaiAuth: boolean }>("account/read", {}), 10_000, "codex account/read");
    const models: HarnessStatus["models"] = [];
    let cursor: string | null = null;
    do {
      const page = ModelPage.parse(await withTimeout(rpc.request("model/list", { cursor, limit: 100 }), 10_000, "codex model/list"));
      models.push(...page.data.filter((m) => !m.hidden).map((m) => ({ id: m.model, name: m.displayName, efforts: m.supportedReasoningEfforts.map((e) => e.reasoningEffort) })));
      cursor = page.nextCursor;
    } while (cursor);
    const ok = { ...base, models, installed: true, version };
    const a = acct.account;
    if (!a) return acct.requiresOpenaiAuth
      ? { ...ok, auth: "unauthenticated", message: "Not signed in. Run `codex login`." }
      : { ...ok, auth: "authenticated", plan: "external", message: null };
    if (a.type === "chatgpt") return { ...ok, auth: "authenticated", plan: a.planType ? `ChatGPT ${PLAN[a.planType] ?? a.planType}` : "ChatGPT", email: a.email ?? null, message: null };
    if (a.type === "apiKey") return { ...ok, auth: "authenticated", plan: "API key", message: null };
    return { ...ok, auth: "authenticated", plan: a.type, message: null };
  } catch (e) {
    return { ...base, installed: true, version: null, auth: "unknown", message: `Could not verify sign-in: ${(e as Error).message}` };
  } finally {
    rpc.kill();
  }
}

export const codexAdapter: HarnessAdapter = {
  kind: "codex",
  probe: probeCodex,
  async start(input: StartSession): Promise<Session> {
    const bin = await which("codex");
    if (!bin) throw new Error("Codex (`codex`) is not on PATH on this machine. Install it and run `codex login`.");
    return CodexSession.start(input, new JsonRpcChild(bin, ["app-server"], { ...profileEnv("codex", input.profile), ...input.env }, input.cwd));
  },
};
