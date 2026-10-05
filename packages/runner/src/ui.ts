import type { ProfileStatus } from "@offsite/harness";

// What the CLI prints: a few calm lines. Colour only on a terminal (NO_COLOR turns it off). Never an account's email.

const colour = (() => {
  if (process.env["NO_COLOR"]) return false;
  if (process.env["FORCE_COLOR"] && process.env["FORCE_COLOR"] !== "0") return true;
  return !!process.stdout.isTTY && process.env["TERM"] !== "dumb";
})();
const sgr = (open: number, close: number) => (s: string) => (colour ? `\x1b[${open}m${s}\x1b[${close}m` : s);
export const style = { bold: sgr(1, 22), dim: sgr(2, 22), green: sgr(32, 39), red: sgr(31, 39), amber: sgr(33, 39), cyan: sgr(36, 39), colour };

const NAMES: Record<string, string> = { claude: "Claude Code", codex: "Codex", sim: "Sim crew" };
const SIGN_IN: Record<string, string> = { claude: "claude auth login", codex: "codex login" };

/** One harness login, as a checklist line: "✓ Claude Code   Claude Max". */
export function probeLine(s: ProfileStatus): string {
  const label = `${NAMES[s.harness] ?? s.harness}${s.profile ? ` (${s.profile})` : ""}`;
  const name = label.length >= 14 ? `${label}  ` : label.padEnd(14);
  if (s.harness === "sim") return `${style.green("✓")} ${name}${style.dim("scripted, no CLI, no spending")}`;
  if (!s.installed) return `${style.dim("–")} ${style.dim(name)}${style.dim("not installed")}`;
  if (s.auth === "authenticated") return `${style.green("✓")} ${name}${s.plan ?? "signed in"}`;
  if (s.auth === "unauthenticated") {
    const how = SIGN_IN[s.harness];
    return `${style.red("✗")} ${name}not signed in${how ? style.dim(`  run \`${how}\``) : ""}`;
  }
  return `${style.amber("?")} ${name}${style.dim(s.message ? `couldn't tell: ${s.message.split("\n")[0]!.slice(0, 80)}` : "couldn't tell if it's signed in")}`;
}

/** Whether anything here can crew: at least one harness signed in (or the sim). */
export const canCrew = (probe: ProfileStatus[]) => probe.some((s) => s.harness === "sim" || (s.installed && s.auth !== "unauthenticated"));

/** The line that sits at the bottom of the terminal while the runner works. */
export function statusLine(s: { captain: string; working: number; online: boolean; sim?: boolean }): string {
  if (!s.online) return `${style.amber("○")} Can't reach your ship right now. Retrying…`;
  const what = s.working ? `${s.working} ${s.working === 1 ? "run" : "runs"} at work` : "waiting for work";
  return `${style.green("●")} Aboard for ${s.captain}${s.sim ? " with the sim crew" : ""} · ${what} ${style.dim("· Ctrl-C to stop")}`;
}

/**
 * Log lines above one status line that redraws in place, on a terminal. Elsewhere (a service's log file) plain
 * timestamped lines and no status line.
 */
export class Screen {
  private status = "";
  private readonly out: NodeJS.WritableStream;
  private readonly live: boolean;
  constructor(out: NodeJS.WritableStream = process.stdout, live = !!process.stdout.isTTY) { this.out = out; this.live = live; }
  log = (line: string): void => {
    if (!this.live) { this.out.write(`${new Date().toISOString()} ${line}\n`); return; }
    this.out.write(`\r\x1b[2K${line}\n${this.status}`);
  };
  setStatus(line: string): void {
    if (!this.live || line === this.status) return;
    this.status = line;
    this.out.write(`\r\x1b[2K${line}`);
  }
  /** Leave the status line behind (on exit). */
  end(): void { if (this.live && this.status) this.out.write("\n"); this.status = ""; }
  /** Erase the status line, for plain output after it. */
  clear(): void { if (this.live && this.status) this.out.write("\r\x1b[2K"); this.status = ""; }
}
