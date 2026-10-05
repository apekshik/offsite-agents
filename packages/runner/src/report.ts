import type { RunEvent } from "@offsite/contracts";

/**
 * A crew member's account of their work, read from their run's events. Each turn ends with what the agent said after
 * its last step: first the reply to the brief, then one reply per steer (a message from the computer or the captain,
 * a conflict to resolve). The report is every turn's closing words in order, so a short answer to a late steer adds
 * to the main account instead of replacing it. Fed the events as the ship gets them (content.final already cut to
 * the closing paragraph), which is the same for every harness.
 */
export class Accounts {
  private readonly turns: string[] = [];
  /** Streamed since the latest step, this turn. */
  private tail = "";
  /** This turn's closing paragraph, from its latest content.final. */
  private closing = "";

  push(e: RunEvent): void {
    switch (e.type) {
      case "turn.started": this.close(); break;
      case "item.started": this.tail = ""; this.closing = ""; break;
      case "content.delta": this.tail += e.delta; break;
      case "content.final": this.closing = e.text; break;
      case "turn.completed": this.close(); break;
    }
  }

  /** Set what the run says it did outright (a designed look's own line, say), in place of anything streamed. */
  replace(text: string): void {
    this.turns.length = 0;
    this.tail = ""; this.closing = text;
  }

  private current(): string {
    const tail = this.tail.trim(), closing = this.closing.trim();
    return closing.length >= tail.length ? closing : tail;
  }

  private close() {
    const text = this.current();
    if (text && this.turns.at(-1) !== text) this.turns.push(text);
    this.tail = ""; this.closing = "";
  }

  /** The report so far, a turn still in progress included. */
  report(max = 8000): string {
    const now = this.current();
    const all = now && this.turns.at(-1) !== now ? [...this.turns, now] : this.turns;
    return stripAttribution(all.join("\n\n")).slice(0, max).trim();
  }
}

// Lines harnesses add to say an AI wrote something: Claude Code's "🤖 Generated with [Claude Code](…)" and its
// co-author trailers, a session link, and the like from Codex. Offsite's commits, pull requests and summaries never
// carry them.
const FOOTER = [
  /^(?:🤖\s*)?(?:generated|created|written|made)\s+(?:with|by|using)\s+\[?(?:claude(?:\s+code)?|codex|chatgpt|openai codex)\]?(?:\([^)]*\))?[.!]?$/i,
  /^co-authored-by:\s*.*(?:claude|anthropic|codex|openai|chatgpt).*$/i,
  /^(?:claude-session|session):\s*https?:\/\/\S+$/i,
  /^https?:\/\/claude\.ai\/code\/\S+$/i,
];
const RULE = /^(?:-{3,}|\*{3,}|_{3,})$/;

/** The text without a trailing AI-attribution footer (and the rule or blank lines above it). Everything else stays. */
export function stripAttribution(text: string): string {
  const lines = text.replace(/\s+$/, "").split("\n");
  let cut = lines.length, found = false;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim();
    if (!line) continue;
    if (FOOTER.some((re) => re.test(line))) { found = true; cut = i; continue; }
    if (found && RULE.test(line)) { cut = i; continue; }
    break;
  }
  return found ? lines.slice(0, cut).join("\n").replace(/\s+$/, "") : text.replace(/\s+$/, "");
}
