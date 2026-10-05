import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { RunEvent } from "@offsite/contracts";
import { Accounts, stripAttribution } from "./report.ts";

/**
 * Arlo's run from the first real end-to-end run (Codex, the dark-mode task), as the ship got its events: the computer
 * messaged him twice while he worked, so his run had three turns. Item details and paths are left out.
 */
const ARLO = JSON.parse(readFileSync(new URL("./fixtures/arlo-steered.json", import.meta.url), "utf8")) as RunEvent[];

const MAIN = "Implemented shared dark mode in `src/theme.js`, `src/style.css`, and `src/main.js`";
const ACCENT = "Added `--accent-fg`: white in light mode, navy `#0b1a3a` in dark mode.";
const LAST = "Added the identical no-flash script to counter.html’s head, before the stylesheet.";

describe("a crew member's report", () => {
  it("keeps the main account from before a steer, then the replies to each steer (Arlo's run)", () => {
    const a = new Accounts();
    for (const e of ARLO) a.push(e);
    const report = a.report();
    expect(report.startsWith(MAIN)).toBe(true);
    expect(report).toContain("All 4 tests pass.");
    expect(report.indexOf(ACCENT)).toBeGreaterThan(report.indexOf(MAIN));
    expect(report.indexOf(LAST)).toBeGreaterThan(report.indexOf(ACCENT));
    expect(report.endsWith("Changes remain uncommitted for the ship to land.")).toBe(true);
    // Only each turn's closing words: not the plans it opened with, nor its progress notes between steps.
    expect(report).not.toContain("I’ll add shared theme variables");
    expect(report).not.toContain("The served page switches correctly");
    expect(report).not.toContain("I’ll sync the counter page");
  });

  it("reads Claude Code's shape too: one final per turn carrying every paragraph, cut to the closing one", () => {
    const a = new Accounts();
    const turn = (n: number, before: string, after: string): RunEvent[] => [
      { type: "turn.started", turnId: `turn${n}` },
      { type: "content.delta", delta: before },
      { type: "item.started", itemId: `i${n}`, kind: "edit", summary: "Edit src/a.ts" },
      { type: "item.completed", itemId: `i${n}`, summary: "", detail: null, ok: true, ms: 3 },
      { type: "content.delta", delta: `\n\n${after}` },
      // The runner hands on only the closing paragraph with content.final.
      { type: "content.final", text: after },
      { type: "turn.completed", turnId: `turn${n}` },
    ];
    for (const e of [...turn(1, "Looking first.", "Changed src/a.ts; tests pass."), { type: "steer.received", text: "Also b.ts" } as RunEvent, ...turn(2, "On it.", "Also changed b.ts.")]) a.push(e);
    expect(a.report()).toBe("Changed src/a.ts; tests pass.\n\nAlso changed b.ts.");
  });

  it("includes a turn still in progress, and falls back to what was streamed when no final came", () => {
    const a = new Accounts();
    a.push({ type: "turn.started", turnId: "t1" });
    a.push({ type: "content.final", text: "Done with the first part." });
    a.push({ type: "turn.completed", turnId: "t1" });
    a.push({ type: "turn.started", turnId: "t2" });
    a.push({ type: "content.delta", delta: "Stopped halfway through the second." });
    expect(a.report()).toBe("Done with the first part.\n\nStopped halfway through the second.");
  });

  it("drops an attribution footer and caps the length", () => {
    const a = new Accounts();
    a.push({ type: "turn.started", turnId: "t1" });
    a.push({ type: "content.final", text: "Fixed it.\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)" });
    a.push({ type: "turn.completed", turnId: "t1" });
    expect(a.report()).toBe("Fixed it.");
    expect(a.report(5)).toBe("Fixed");
  });
});

describe("stripping attribution footers", () => {
  it("removes a trailing footer, its co-author trailers and the rule above it", () => {
    const summary = "## Counter page\n- New counter.html\n\n## Review notes\n- No build step.\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n";
    expect(stripAttribution(summary)).toBe("## Counter page\n- New counter.html\n\n## Review notes\n- No build step.");
    expect(stripAttribution("Add dark mode\n\nBody.\n\n---\nGenerated with Claude Code\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>")).toBe("Add dark mode\n\nBody.");
    expect(stripAttribution("Body\n\nCo-authored-by: Codex <codex@openai.com>")).toBe("Body");
  });

  it("leaves everything else alone", () => {
    expect(stripAttribution("Add the counter page\n\nOffsite-Task: offsite/x-counter")).toBe("Add the counter page\n\nOffsite-Task: offsite/x-counter");
    expect(stripAttribution("We generated the client with Claude Code's help, then wrote tests.")).toBe("We generated the client with Claude Code's help, then wrote tests.");
    expect(stripAttribution("Co-authored-by: Ada Lovelace <ada@example.com>")).toBe("Co-authored-by: Ada Lovelace <ada@example.com>");
    expect(stripAttribution("🤖 Generated with [Claude Code](https://claude.com/claude-code)\n\nThen the real text.")).toBe("🤖 Generated with [Claude Code](https://claude.com/claude-code)\n\nThen the real text.");
  });
});
