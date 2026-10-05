import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEMO_MUTATIONS, DEMO_QUERIES } from "./ship.ts";

// Demo mode answers Convex in the browser (ship.ts). It has to keep up with the real backend, or the demo quietly
// shows spinners where the app has grown. These checks fail when:
// - the interface uses a Convex query or mutation the demo has no answer for;
// - the demo answers a function the backend no longer has (renamed, removed, or a query that became a mutation);
// - src/convex.ts or src/auth.ts export something their demo stand-ins don't.
// The fix is in apps/web/src/demo/ship.ts (QUERIES, MUTATIONS) or demo/convex.ts and demo/auth.ts.

const web = fileURLToPath(new URL("../..", import.meta.url));
const repo = join(web, "../..");

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = join(dir, d.name);
    if (d.isDirectory()) return files(p);
    return /\.(ts|tsx)$/.test(d.name) && !/\.test\.tsx?$/.test(d.name) ? [p] : [];
  });
}

/** Every public Convex function, by "module:name", and whether it is a query or a mutation. */
function backend(): Map<string, "query" | "mutation"> {
  const out = new Map<string, "query" | "mutation">();
  for (const f of readdirSync(join(repo, "convex"))) {
    if (!f.endsWith(".ts") || f.endsWith(".test.ts") || f.endsWith(".d.ts")) continue;
    const src = readFileSync(join(repo, "convex", f), "utf8");
    for (const m of src.matchAll(/^export const (\w+) = (\w+)\(/gm)) {
      const kind = m[2]!;
      if (/^internal/i.test(kind)) continue;
      if (/query/i.test(kind)) out.set(`${f.slice(0, -3)}:${m[1]}`, "query");
      else if (/mutation|action/i.test(kind)) out.set(`${f.slice(0, -3)}:${m[1]}`, "mutation");
    }
  }
  return out;
}

/** The Convex functions the interface (and the game) use, with where. The fakes themselves don't count. */
function used(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const skip = ["src/demo/", "src/fake/", "src/film/", "src/gallery/"];
  for (const f of [...files(join(web, "src")), ...files(join(web, "dev"))]) {
    const rel = relative(web, f);
    if (skip.some((s) => rel.startsWith(s))) continue;
    for (const m of readFileSync(f, "utf8").matchAll(/\bapi\.(\w+)\.(\w+)\b/g)) {
      const name = `${m[1]}:${m[2]}`;
      out.set(name, [...(out.get(name) ?? []), rel]);
    }
  }
  return out;
}

const exportsOf = (path: string) => [...readFileSync(path, "utf8").matchAll(/^export (?:async )?(?:const|function|let|class) (\w+)/gm)].map((m) => m[1]!);

describe("demo mode keeps up with the backend", () => {
  const real = backend();
  const queries = new Set(DEMO_QUERIES);
  const mutations = new Set(DEMO_MUTATIONS);

  it("answers every Convex function the interface uses", () => {
    const missing: string[] = [];
    for (const [name, where] of used()) {
      const kind = real.get(name);
      if (!kind) continue; // Not a public function (dev pages may name others); typecheck catches real typos.
      const have = kind === "query" ? queries.has(name) : mutations.has(name);
      if (!have) missing.push(`${kind} ${name} (used in ${[...new Set(where)].join(", ")})`);
    }
    expect(missing, `No demo answer: add these to QUERIES or MUTATIONS in apps/web/src/demo/ship.ts`).toEqual([]);
  });

  it("only answers functions the backend has, as the right kind", () => {
    const stale = [
      ...[...queries].filter((n) => real.get(n) !== "query").map((n) => `query ${n}`),
      ...[...mutations].filter((n) => real.get(n) !== "mutation").map((n) => `mutation ${n}`),
    ];
    expect(stale, "The demo answers functions convex/ no longer has (renamed? moved?)").toEqual([]);
  });

  it("stands in for everything src/convex.ts and src/auth.ts export", () => {
    const convexReal = exportsOf(join(web, "src/convex.ts"));
    const convexDemo = exportsOf(join(web, "src/demo/convex.ts"));
    expect(convexReal.filter((n) => !convexDemo.includes(n)), "demo/convex.ts is missing exports of src/convex.ts").toEqual([]);
    // demo/auth.ts re-exports src/auth.ts and overrides what touches sign-in. Anything new in auth.ts is either
    // overridden there or, if it works as is in the demo, listed here.
    const passthrough: string[] = [];
    const authDemo = exportsOf(join(web, "src/demo/auth.ts"));
    expect(exportsOf(join(web, "src/auth.ts")).filter((n) => !authDemo.includes(n) && !passthrough.includes(n)), "demo/auth.ts doesn't override these src/auth.ts exports").toEqual([]);
  });
});
