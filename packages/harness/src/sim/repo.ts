import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

// What the sim crew actually looks at in a worktree: real files, real matches, so its steps read true.

const SKIP = new Set([".git", "node_modules", "dist", "build", ".next", ".turbo", "coverage", ".venv", "target"]);
const TEXT = /\.(md|mdx|txt|ts|tsx|js|jsx|mjs|cjs|json|ya?ml|toml|css|scss|html|py|go|rs|rb|java|kt|swift|sh|sql|vue|svelte)$/i;

/** Text files under `root`, nearest first, at most `limit`. */
export async function listFiles(root: string, limit = 400): Promise<string[]> {
  const out: string[] = [];
  const queue = [root];
  while (queue.length && out.length < limit) {
    const dir = queue.shift()!;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (e.isDirectory()) { if (!SKIP.has(e.name) && !e.name.startsWith(".")) queue.push(join(dir, e.name)); }
      else if (e.isFile() && (TEXT.test(e.name) || /^(README|LICENSE|Makefile|Dockerfile)$/i.test(e.name))) out.push(relative(root, join(dir, e.name)));
      if (out.length >= limit) break;
    }
  }
  return out;
}

export async function readText(root: string, file: string, max = 200_000): Promise<string | null> {
  const p = join(root, file);
  const s = await stat(p).catch(() => null);
  if (!s || !s.isFile() || s.size > max) return null;
  return readFile(p, "utf8").catch(() => null);
}

/** Files mentioning `word` (case-insensitive), with a match count. */
export async function grep(root: string, word: string, files: string[]): Promise<{ file: string; count: number }[]> {
  const re = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  const hits: { file: string; count: number }[] = [];
  for (const f of files.slice(0, 200)) {
    const text = await readText(root, f);
    if (!text) continue;
    const count = text.match(re)?.length ?? 0;
    if (count) hits.push({ file: f, count });
  }
  return hits.sort((a, b) => b.count - a.count);
}

const MARKERS = /^<<<<<<< .*$/m;
/** Files that still hold merge conflict markers. */
export async function conflicted(root: string): Promise<string[]> {
  const out: string[] = [];
  for (const f of await listFiles(root, 2000)) {
    const text = await readText(root, f);
    if (text && MARKERS.test(text)) out.push(f);
  }
  return out;
}

/** Resolve conflict markers by keeping both sides, ours first: right for notes and logs, which is what the sim writes. */
export function keepBoth(text: string): string {
  return text.replace(/^<<<<<<< [^\n]*\n([\s\S]*?)(?:^\|\|\|\|\|\|\| [^\n]*\n[\s\S]*?)?^=======\n([\s\S]*?)^>>>>>>> [^\n]*(?:\n|$)/gm, (_m, ours: string, theirs: string) => ours + theirs);
}

const STOP = new Set(["about", "after", "again", "their", "there", "these", "those", "which", "while", "would", "could", "should", "every", "other", "using", "where", "first", "small", "change", "changes", "worktree", "branch", "crew", "task", "tasks", "captain", "please", "make", "with", "from", "into", "that", "this", "your", "they", "them", "then", "when", "what", "have", "will"]);
/** The word in a brief most worth searching for. */
export function keyword(text: string): string {
  const words = text.toLowerCase().match(/[a-z][a-z0-9_-]{3,}/g) ?? [];
  const counts = new Map<string, number>();
  for (const w of words) if (!STOP.has(w)) counts.set(w, (counts.get(w) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0]?.[0] ?? "todo";
}

/** "add-dark-mode", from anything. */
export function slugify(s: string, max = 32): string {
  const k = s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return (k.length > max ? k.slice(0, max + 1).replace(/-[^-]*$/, "").slice(0, max) : k) || "task";
}
