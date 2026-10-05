// A small syntax colourer for the review view, loaded only when a diff is shown. Not a parser: comments, strings,
// numbers, keywords, a few language touches (markdown headings, tags, CSS properties, JSON keys). Enough to read a diff
// by; a whole highlighter library would weigh more than the rest of the review.

export type Tok = "kw" | "str" | "com" | "num" | "fn" | "tag" | "attr" | "head" | "prop" | "lit";
export type Span = [text: string, tok: Tok | null];
/** Carried from one line to the next: inside a block comment. */
export type State = { block: "c" | "html" | null };

const KW: Record<string, Set<string>> = {
  js: new Set("import export from as default const let var function return if else for while do switch case break continue new class extends implements interface type enum async await yield throw try catch finally typeof instanceof in of void delete this super static public private protected readonly declare namespace keyof satisfies".split(" ")),
  py: new Set("def class return if elif else for while in not and or is import from as with try except finally raise pass break continue lambda yield async await global nonlocal del assert self end do then module require".split(" ")),
  c: new Set("fn func let mut const var pub struct enum impl trait use mod return if else for while loop match switch case break continue type interface package import class public private protected static final void int long float double bool char string new go defer select chan map range self Self where async await".split(" ")),
  shell: new Set("if then else elif fi for in do done while case esac function return export local echo exit set unset source".split(" ")),
  sql: new Set("select from where insert into values update set delete create table alter drop index join left right inner outer on group by order having limit as and or not null primary key references".split(" ")),
};
const LIT = new Set(["true", "false", "null", "undefined", "None", "True", "False", "nil", "NaN"]);

function push(out: Span[], text: string, tok: Tok | null) {
  if (!text) return;
  const last = out.at(-1);
  if (last && last[1] === tok) last[0] += text;
  else out.push([text, tok]);
}

/** One line, coloured, and the state for the next. */
export function highlightLine(text: string, lang: string, state: State = { block: null }): { spans: Span[]; state: State } {
  if (lang === "text") return { spans: text ? [[text, null]] : [], state };
  const out: Span[] = [];
  let block = state.block;
  let i = 0;
  if (lang === "md") {
    if (/^\s{0,3}#{1,6}\s/.test(text)) return { spans: [[text, "head"]], state };
    if (/^\s*```/.test(text)) return { spans: [[text, "com"]], state };
  }
  const kw = KW[lang] ?? null;
  const hashComments = lang === "py" || lang === "shell" || lang === "yaml";
  while (i < text.length) {
    if (block) {
      const end = block === "c" ? "*/" : "-->";
      const at = text.indexOf(end, i);
      if (at < 0) { push(out, text.slice(i), "com"); i = text.length; break; }
      push(out, text.slice(i, at + end.length), "com");
      i = at + end.length; block = null;
      continue;
    }
    const rest = text.slice(i);
    const ch = text[i]!;
    if (lang !== "md" && lang !== "text" && rest.startsWith("/*")) { block = "c"; continue; }
    if ((lang === "html" || lang === "md") && rest.startsWith("<!--")) { block = "html"; continue; }
    if ((lang === "js" || lang === "c" || lang === "json") && rest.startsWith("//")) { push(out, rest, "com"); break; }
    if (hashComments && ch === "#" && (i === 0 || /\s/.test(text[i - 1]!))) { push(out, rest, "com"); break; }
    if (lang === "sql" && rest.startsWith("--")) { push(out, rest, "com"); break; }
    if (lang === "html" && ch === "<") {
      const m = /^<\/?[\w:-]+/.exec(rest);
      if (m) { push(out, m[0], "tag"); i += m[0].length; continue; }
    }
    if (lang === "html" && /[\w-]/.test(ch)) {
      const m = /^[\w:-]+(?==)/.exec(rest);
      if (m) { push(out, m[0], "attr"); i += m[0].length; continue; }
    }
    if (lang === "md") {
      const m = /^(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/.exec(rest);
      if (m) { push(out, m[0], m[0].startsWith("`") ? "str" : m[0].startsWith("[") ? "fn" : "kw"); i += m[0].length; continue; }
      push(out, ch, null); i++; continue;
    }
    if (lang !== "text" && (ch === '"' || ch === "'" || ch === "`")) {
      let j = i + 1;
      while (j < text.length && text[j] !== ch) j += text[j] === "\\" ? 2 : 1;
      const s = text.slice(i, j + 1);
      // A JSON key, or a YAML/CSS-ish "key": before a colon.
      push(out, s, lang === "json" && /^\s*:/.test(text.slice(j + 1)) ? "prop" : "str");
      i = j + 1; continue;
    }
    if (/\d/.test(ch) && (i === 0 || !/[\w$]/.test(text[i - 1]!))) {
      const m = /^(0x[\da-f]+|\d[\d_]*(\.\d+)?(e[+-]?\d+)?)/i.exec(rest)!;
      push(out, m[0], "num"); i += m[0].length; continue;
    }
    if (/[A-Za-z_$@]/.test(ch)) {
      const m = /^[@$]?[A-Za-z_$][\w$-]*/.exec(rest)!;
      let w = m[0];
      if (lang !== "css" && w.includes("-")) w = w.split("-")[0]!;
      const after = text.slice(i + w.length);
      let tok: Tok | null = null;
      if (lang === "css" && /^\s*:/.test(after) && !/[{]/.test(after)) tok = "prop";
      else if (lang === "yaml" && i === text.search(/\S/) && /^\s*:/.test(after)) tok = "prop";
      else if (LIT.has(w)) tok = "lit";
      else if (kw?.has(lang === "sql" ? w.toLowerCase() : w)) tok = "kw";
      else if (kw && /^\s*\(/.test(after)) tok = "fn";
      push(out, w, tok); i += w.length; continue;
    }
    push(out, ch, null); i++;
  }
  return { spans: out, state: { block } };
}
