// Adapted from Beam (github.com/SupraluminalIntelligence/beam, MIT).
import type { UsageWindow } from "@offsite/contracts";

// Plan limits as the CLIs report them, normalized to UsageWindow: { kind, usedPercent, resetsAt (ms) }.

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const secMs = (s: number | null | undefined) => (typeof s === "number" && s > 0 ? Math.round(s * 1000) : null);

const CLAUDE_KIND: Record<string, string> = {
  five_hour: "session", seven_day: "weekly", seven_day_opus: "weekly-opus", seven_day_sonnet: "weekly-sonnet", overage: "overage",
};

/** Claude Code's rate_limit_event: one window per event, utilization as a fraction. */
export function claudeRateLimitWindows(info: { rateLimitType?: string; utilization?: number; resetsAt?: number }): UsageWindow[] {
  const kind = info.rateLimitType ? CLAUDE_KIND[info.rateLimitType] : undefined;
  if (!kind || typeof info.utilization !== "number") return [];
  return [{ kind, usedPercent: clamp(info.utilization * 100), resetsAt: secMs(info.resetsAt) }];
}

type CodexWindow = { usedPercent: number; resetsAt?: number | null; windowDurationMins?: number | null } | null | undefined;
export type CodexRateLimits = { limitId?: string | null; planType?: string | null; primary?: CodexWindow; secondary?: CodexWindow };
const HOUR = 60, WEEK = 7 * 24 * HOUR, MONTH = 28 * 24 * HOUR;

/**
 * `account/rateLimits/updated` from Codex. Primary and secondary are positions, not durations: paid plans have a
 * 5-hour and a weekly window, Free and Go one monthly. Model-specific snapshots are ignored.
 */
export function codexRateLimitWindows(snapshot: CodexRateLimits | null | undefined): UsageWindow[] {
  if (!snapshot || (snapshot.limitId && snapshot.limitId !== "codex")) return [];
  const monthly = snapshot.planType === "free" || snapshot.planType === "go";
  const out: UsageWindow[] = [];
  for (const [w, fallback] of [[snapshot.primary, monthly ? MONTH : 5 * HOUR], [snapshot.secondary, WEEK]] as const) {
    if (!w || typeof w.usedPercent !== "number") continue;
    const mins = w.windowDurationMins ?? fallback;
    out.push({ kind: mins >= MONTH ? "monthly" : mins >= WEEK ? "weekly" : "session", usedPercent: clamp(w.usedPercent), resetsAt: secMs(w.resetsAt) });
  }
  return out;
}
