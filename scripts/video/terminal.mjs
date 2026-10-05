// The launch video's terminal segment: real output from a real `offsite start` (an asciicast in
// .shots/real-run), scrubbed of anything private and re-timed for the cut.
//
// What's private in a real run, and what happens to it here:
//   - account emails on the subscription probe lines ("Claude Max · someone@…"): the account part goes
//   - the machine's name ("Someone’s MacBook Pro"): the owner's name goes
//   - home paths (/Users/<name>/…) and the ship's ids in worktree paths: shortened to ~ and …
//   - the pairing code and its link: those lines are left out entirely
// scrubbed() throws if anything that looks like an email, a home path or a person's machine is left.

import { readFileSync } from "node:fs";

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+/;
const LEFTOVERS = [
  [EMAIL, "an email address"],
  [/\/Users\/|\/home\//, "a home path"],
  [/[’']s (MacBook|Mac mini|iMac|Mac Studio|PC|laptop)/i, "a person's machine name"],
  [/\?connect=|[A-Z0-9]{4}-[A-Z0-9]{4}/, "a pairing code"],
];

/** Throws if a string still carries something private. */
export function assertClean(text, where = "terminal") {
  for (const [re, what] of LEFTOVERS) {
    const m = String(text).match(re);
    if (m) throw new Error(`${where}: still contains ${what} (${m[0].replace(/./g, (c, i) => (i < 2 ? c : "•"))})`);
  }
}

/** The cast's output as plain lines, ANSI colours stripped. */
export function castLines(file) {
  const rows = readFileSync(file, "utf8").trim().split("\n").slice(1).map((l) => JSON.parse(l));
  const text = rows.filter((r) => r[1] === "o").map((r) => r[2]).join("");
  return text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").split(/\r?\n/);
}

const scrubLine = (line) => line
  .replace(/\s*·\s*[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]+/g, "") // "Claude Max · a@b.c" → "Claude Max"
  .replace(EMAIL, "you@yours.com")
  .replace(/"[^"]*?[’']s ([^"]+)"/g, "\"$1\"") // "Someone’s MacBook Pro" → "MacBook Pro"
  .replace(/\/(Users|home)\/[^/\s]+/g, "~")
  .replace(/(~\/\.offsite\/worktrees\/)[^\s]+\/([^/\s]+)(?=[\s)]|$)/g, "$1…/$2") // worktree ids → …
  .replace(/ on (offsite\/[a-z0-9-]+)/g, (_, b) => ` on ${b.length > 30 ? `${b.slice(0, 27)}…` : b}`);

/**
 * The lines the video shows, each with its moment (seconds into the segment) and its kind, which
 * the graphics page colours. `typed` is the command, typed a character at a time.
 */
export function terminalScript(file) {
  const all = castLines(file).map(scrubLine);
  const pick = (re) => {
    const l = all.find((x) => re.test(x));
    if (!l) throw new Error(`terminal: no line matching ${re}`);
    return l;
  };
  const working = all.filter((l) => /: working in /.test(l) && !/Computer ·/.test(l)).map((l) => l.replace(/ on offsite\/\S+/, ""));
  const landed = all.filter((l) => /: landed [0-9a-f]{6,}/.test(l));
  const lines = [
    { at: 1.3, kind: "up", text: pick(/^offsite is up on /) },
    { at: 1.6, kind: "probe", text: pick(/^\s+claude\s+v/) },
    { at: 1.75, kind: "probe", text: pick(/^\s+codex\s+v/) },
    { at: 2.25, kind: "dim", text: pick(/^Waiting for work/) },
    ...working.slice(0, 2).map((text, i) => ({ at: 3.0 + i * 0.3, kind: "crew", text })),
    ...landed.slice(0, 2).map((text, i) => ({ at: 4.05 + i * 0.45, kind: "landed", text })),
    { at: 5.1, kind: "diff", text: pick(/^diff for thread /) },
  ];
  const script = { typed: "offsite start", typeFrom: 0.3, cps: 17, enterAt: 1.15, lines };
  assertClean(JSON.stringify(script));
  return script;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const s = terminalScript(process.argv[2] ?? ".shots/real-run/runner-tidy.cast");
  console.log(`$ ${s.typed}`);
  for (const l of s.lines) console.log(`${l.at.toFixed(2).padStart(5)}  ${l.text}`);
}
