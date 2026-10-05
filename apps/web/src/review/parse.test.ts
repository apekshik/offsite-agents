import { describe, expect, it } from "vitest";
import { highlightLine } from "./highlight.ts";
import { languageOf, parsePatch } from "./parse.ts";

const PATCH = `diff --git a/src/counter.ts b/src/counter.ts
new file mode 100644
index 0000000..e69de29
--- /dev/null
+++ b/src/counter.ts
@@ -0,0 +1,2 @@
+let n = 0;
+export const up = () => ++n;
diff --git a/app.ts b/app.ts
index 1111111..2222222 100644
--- a/app.ts
+++ b/app.ts
@@ -3,4 +3,4 @@ export function main() {
 const a = 1;
-const b = 2;
+const b = 3;
 return a + b;
\\ No newline at end of file
diff --git a/old.md b/new.md
similarity index 90%
rename from old.md
rename to new.md
diff --git a/logo.png b/logo.png
Binary files a/logo.png and b/logo.png differ
`;

describe("parsePatch", () => {
  it("numbers each side's lines and reads new, changed, renamed and binary files", () => {
    const files = parsePatch(PATCH);
    expect(files.map((f) => [f.path, f.oldPath, f.binary, f.added, f.removed])).toEqual([
      ["src/counter.ts", null, false, 2, 0],
      ["app.ts", null, false, 1, 1],
      ["new.md", "old.md", false, 0, 0],
      ["logo.png", null, true, 0, 0],
    ]);
    expect(files[0]!.hunks[0]!.lines.map((l) => [l.kind, l.old, l.new])).toEqual([["add", null, 1], ["add", null, 2]]);
    const h = files[1]!.hunks[0]!;
    expect(h.section).toBe("export function main() {");
    expect(h.lines.map((l) => `${l.kind}:${l.old ?? "-"}:${l.new ?? "-"}:${l.text}`)).toEqual([
      "ctx:3:3:const a = 1;", "del:4:-:const b = 2;", "add:-:4:const b = 3;", "ctx:5:5:return a + b;", "note:-:-:No newline at end of file",
    ]);
  });

  it("knows a file's language by its name", () => {
    expect([languageOf("src/a.tsx"), languageOf("notes/plan.md"), languageOf("Dockerfile"), languageOf("x.weird")]).toEqual(["js", "md", "shell", "text"]);
  });
});

describe("highlightLine", () => {
  it("colours keywords, strings, numbers and comments, and carries block comments across lines", () => {
    const { spans } = highlightLine(`export const up = () => count("n", 2); // go`, "js");
    expect(spans.filter(([, t]) => t).map(([s, t]) => `${t}:${s}`)).toEqual(["kw:export", "kw:const", "fn:count", 'str:"n"', "num:2", "com:// go"]);
    const first = highlightLine("a /* start", "js");
    expect(first.state.block).toBe("c");
    const second = highlightLine("still */ b", "js", first.state);
    expect(second.spans[0]).toEqual(["still */", "com"]);
    expect(second.state.block).toBeNull();
    expect(highlightLine("## Notes", "md").spans).toEqual([["## Notes", "head"]]);
    // Plain text stays plain.
    expect(highlightLine("it's 3 o'clock", "text").spans).toEqual([["it's 3 o'clock", null]]);
  });
});
