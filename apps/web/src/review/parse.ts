// A unified diff (git diff's output) as files, hunks and numbered lines, for the review view.

export type LineKind = "add" | "del" | "ctx" | "note";

export interface DiffLine {
  kind: LineKind;
  /** Line numbers in the old and new file; null where the line isn't in that side. */
  old: number | null;
  new: number | null;
  text: string;
}

export interface Hunk {
  header: string;
  /** The function or section git names after the @@, if any. */
  section: string;
  lines: DiffLine[];
}

export interface FilePatch {
  path: string;
  oldPath: string | null;
  binary: boolean;
  hunks: Hunk[];
  added: number;
  removed: number;
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/;

/** b/src/app.ts → src/app.ts; "/dev/null" stays as it is. */
const strip = (p: string) => {
  const t = p.replace(/\t.*$/, "").replace(/^"(.*)"$/, "$1");
  return t === "/dev/null" ? t : t.replace(/^[ab]\//, "");
};

export function parsePatch(patch: string): FilePatch[] {
  const files: FilePatch[] = [];
  let file: FilePatch | null = null;
  let hunk: Hunk | null = null;
  let oldNo = 0, newNo = 0;
  for (const raw of patch.split("\n")) {
    if (raw.startsWith("diff --git ")) {
      const m = /^diff --git (?:"?a\/(.+?)"?) (?:"?b\/(.+?)"?)$/.exec(raw);
      file = { path: m?.[2] ?? raw.slice(11), oldPath: null, binary: false, hunks: [], added: 0, removed: 0 };
      if (m && m[1] !== m[2]) file.oldPath = m[1]!;
      files.push(file);
      hunk = null;
      continue;
    }
    if (!file) continue;
    if (!hunk) {
      if (raw.startsWith("--- ")) { const p = strip(raw.slice(4)); if (p !== "/dev/null" && p !== file.path) file.oldPath = p; continue; }
      if (raw.startsWith("+++ ")) { const p = strip(raw.slice(4)); if (p !== "/dev/null") file.path = p; continue; }
      if (raw.startsWith("rename from ")) { file.oldPath = raw.slice(12); continue; }
      if (raw.startsWith("rename to ")) { file.path = raw.slice(10); continue; }
      if (raw.startsWith("Binary files ") || raw === "GIT binary patch") { file.binary = true; continue; }
    }
    const h = HUNK.exec(raw);
    if (h) {
      oldNo = Number(h[1]); newNo = Number(h[2]);
      hunk = { header: raw, section: h[3] ?? "", lines: [] };
      file.hunks.push(hunk);
      continue;
    }
    if (!hunk) continue;
    const c = raw[0];
    if (c === "+") { hunk.lines.push({ kind: "add", old: null, new: newNo++, text: raw.slice(1) }); file.added++; }
    else if (c === "-") { hunk.lines.push({ kind: "del", old: oldNo++, new: null, text: raw.slice(1) }); file.removed++; }
    else if (c === " ") hunk.lines.push({ kind: "ctx", old: oldNo++, new: newNo++, text: raw.slice(1) });
    else if (c === "\\") hunk.lines.push({ kind: "note", old: null, new: null, text: raw.slice(2) });
    // An empty line ends the patch (or the cut); anything else (a header we don't show) is skipped.
  }
  return files;
}

/** The file's language for colouring, from its name. */
export function languageOf(path: string): string {
  const name = path.split("/").at(-1)!.toLowerCase();
  if (name === "dockerfile") return "shell";
  if (name === "makefile") return "shell";
  const ext = name.includes(".") ? name.split(".").at(-1)! : "";
  const map: Record<string, string> = {
    ts: "js", tsx: "js", js: "js", jsx: "js", mjs: "js", cjs: "js", mts: "js", cts: "js", json: "json", jsonc: "json",
    py: "py", rb: "py", go: "c", rs: "c", c: "c", h: "c", cc: "c", cpp: "c", hpp: "c", java: "c", kt: "c", swift: "c", cs: "c", scala: "c", dart: "c", php: "c",
    css: "css", scss: "css", less: "css", html: "html", htm: "html", xml: "html", svg: "html", vue: "html", svelte: "html",
    md: "md", mdx: "md", markdown: "md", sh: "shell", bash: "shell", zsh: "shell", yml: "yaml", yaml: "yaml", toml: "yaml", ini: "yaml", sql: "sql",
  };
  return map[ext] ?? "text";
}
