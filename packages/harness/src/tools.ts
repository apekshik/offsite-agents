// Adapted from Beam (github.com/SupraluminalIntelligence/beam, MIT).
import { isAbsolute, relative, resolve } from "node:path";

/** One-line, human-readable summaries of tool calls. Shared by every adapter, and read by the world and the phone. */
const short = (s: string, n = 90) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const rel = (p: unknown, cwd: string) => (typeof p === "string" ? (p.startsWith(cwd + "/") ? p.slice(cwd.length + 1) : p) : "");

/** The prefix Claude Code gives tools from Offsite's in-process MCP server. */
export const OFFSITE_MCP = "offsite";
export const mcpName = (tool: string) => `mcp__${OFFSITE_MCP}__${tool}`;

/** Offsite's own tools, as people would say them. ask_captain reads as asking, the rest as delegating. */
function describeOffsite(name: string, i: Record<string, unknown>): { kind: string; summary: string } {
  const s = (k: string) => String(i[k] ?? "");
  switch (name) {
    case "crew_status": return { kind: "offsite", summary: "Check on the crew" };
    case "plan_tasks": {
      const n = Array.isArray(i["tasks"]) ? i["tasks"].length : 0;
      return { kind: "offsite", summary: n === 1 ? "Plan one task" : `Plan ${n || "the"} tasks` };
    }
    case "assign_task": return { kind: "offsite", summary: `Assign ${s("task")}${i["crew"] ? ` to @${s("crew")}` : ""}` };
    case "hire_crew": return { kind: "offsite", summary: `Hire ${i["name"] ? s("name") : "a new crew member"}` };
    case "message_crew": return { kind: "offsite", summary: `Message @${s("crew")}: ${short(s("text"), 60)}` };
    case "ask_captain": return { kind: "ask", summary: `Ask the captain: ${short(s("question"), 70)}` };
    case "review_task": return { kind: "offsite", summary: `Review ${s("task")}` };
    case "send_back": return { kind: "offsite", summary: `Send back ${s("task")}` };
    case "finish_thread": return { kind: "offsite", summary: `Open the pull request: ${short(s("title"), 60)}` };
    case "sync_with_team": return { kind: "offsite", summary: "Sync with the team" };
    case "save_look": return { kind: "offsite", summary: "Save the look" };
    default: return { kind: "offsite", summary: name.replace(/_/g, " ") };
  }
}

export function describeTool(name: string, input: Record<string, unknown>, cwd: string): { kind: string; summary: string } {
  const i = input ?? {};
  switch (name) {
    case "Bash": return { kind: "bash", summary: short(String(i["command"] ?? "").replace(/\s+/g, " ").trim()) };
    case "Read": return { kind: "read", summary: `Read ${rel(i["file_path"], cwd)}` };
    case "Edit": return { kind: "edit", summary: `Edit ${rel(i["file_path"], cwd)}` };
    case "Write": return { kind: "write", summary: `Write ${rel(i["file_path"], cwd)}` };
    case "NotebookEdit": return { kind: "edit", summary: `Edit ${rel(i["notebook_path"], cwd)}` };
    case "Grep": return { kind: "search", summary: `Grep ${short(String(i["pattern"] ?? ""), 50)}${i["path"] ? ` in ${rel(i["path"], cwd)}` : ""}` };
    case "Glob": return { kind: "search", summary: `Glob ${String(i["pattern"] ?? "")}` };
    case "LS": return { kind: "read", summary: `List ${rel(i["path"], cwd) || "."}` };
    case "WebFetch": return { kind: "web", summary: `Fetch ${short(String(i["url"] ?? ""), 70)}` };
    case "WebSearch": return { kind: "web", summary: `Search ${short(String(i["query"] ?? ""), 60)}` };
    case "Agent": case "Task": return { kind: "agent", summary: `Subagent · ${short(String(i["description"] ?? i["prompt"] ?? ""), 70)}` };
    case "TodoWrite": return { kind: "plan", summary: "Update todo list" };
    case "ToolSearch": return { kind: "plan", summary: "Look up tools" };
    case "EnterPlanMode": return { kind: "plan", summary: "Start planning" };
    case "ExitPlanMode": return { kind: "plan", summary: "Present the plan" };
    case "AskUserQuestion": return { kind: "ask", summary: "Ask a question" };
    default: {
      const prefix = `mcp__${OFFSITE_MCP}__`;
      if (name.startsWith(prefix)) return describeOffsite(name.slice(prefix.length), i);
      const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
      if (mcp) return { kind: "tool", summary: `${mcp[1]} · ${mcp[2]} ${short(JSON.stringify(i), 60)}` };
      return { kind: "tool", summary: `${name} ${short(JSON.stringify(i), 60)}` };
    }
  }
}

export const truncate = (s: string, n = 600) => (s.length > n ? s.slice(0, n) + `\n… (${s.length - n} more chars)` : s);

/** Commands that still deserve the captain's yes, however freely the crew otherwise works. */
const DANGER = [
  /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\b/i, /\brm\s+-rf?\s+[\/~]/i, /\bsudo\b/, /\bgit\s+push\b/, /\bgit\s+reset\s+--hard/, /\bgit\s+clean\s+-[a-z]*f/,
  /\bgit\s+branch\s+-D\b/, /\bgit\s+checkout\s+(-b\s+)?(main|master)\b/, /\bgit\s+(rebase|merge|switch)\b/, /\bdrop\s+(table|database)\b/i, /\bmkfs\b/, /\bdd\s+if=/, /\bchmod\s+-R\s+777/,
  /\bcurl\b[^|]*\|\s*(ba|z)?sh\b/, /\bwget\b[^|]*\|\s*(ba|z)?sh\b/, /\bkill\s+-9\s+-1\b/, /\bshutdown\b/, /\breboot\b/, /\blaunchctl\s+(unload|remove)/, /\bdefaults\s+write\b/,
  /\bsecurity\s+(delete|set)/, /\bnpm\s+publish\b/, /\bpnpm\s+publish\b/, /\bcargo\s+publish\b/, /\btwine\s+upload\b/, /\bgh\s+(pr|release|repo)\s+(create|delete|merge)\b/,
];
export function isDangerous(name: string, input: Record<string, unknown>): boolean {
  if (name !== "Bash") return false;
  const cmd = String(input?.["command"] ?? "");
  return DANGER.some((re) => re.test(cmd));
}

/** True when `path` is outside `cwd` (relative paths are read from cwd). */
export function outside(path: string, cwd: string): boolean {
  const r = relative(cwd, resolve(cwd, path));
  return r === ".." || r.startsWith("../") || isAbsolute(r);
}

/**
 * The crew's permission policy: work freely inside your own worktree, ask the captain before anything that
 * reaches beyond it (a destructive or shared-state command, an edit outside the worktree). Returns the prompt
 * the captain sees, or null when no one needs to be asked. Git that moves branches is the ship's job, so it asks too.
 */
export function approvalPrompt(name: string, input: Record<string, unknown>, cwd: string): string | null {
  if (isDangerous(name, input)) return `Run: ${String(input["command"] ?? "").trim()}`;
  if (name === "Edit" || name === "Write" || name === "NotebookEdit" || name === "MultiEdit") {
    const p = String(input["file_path"] ?? input["notebook_path"] ?? "");
    if (p && outside(p, cwd)) return `${name} ${p} (outside this task's worktree)`;
  }
  return null;
}
