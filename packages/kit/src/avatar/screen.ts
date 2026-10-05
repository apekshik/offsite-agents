// A small code editor drawn to a canvas: the screen of a crew member's laptop. The app writes
// what they are working on (the file, the last step); left alone it types a snippet of its own,
// a few characters at a time, so a desk full of crew looks busy.

import * as THREE from "three";

const SNIPPETS: string[][] = [
  [
    "// settings.tsx",
    "export function Settings() {",
    "  const [dark, setDark] = useState(false);",
    "  useEffect(() => {",
    "    document.body.classList.toggle('dark', dark);",
    "  }, [dark]);",
    "  return <Toggle on={dark} onChange={setDark} />;",
    "}",
  ],
  [
    "import { test, expect } from 'vitest';",
    "",
    "test('lands one task at a time', async () => {",
    "  const q = new Queue();",
    "  await q.push(task('a'), task('b'));",
    "  expect(q.landed).toEqual(['a', 'b']);",
    "});",
  ],
  [
    "async function sync(branch: string) {",
    "  const head = await git.revParse(branch);",
    "  if (head === last) return;  // nothing new",
    "  await git.rebase(`offsite/${branch}`);",
    "  last = head;",
    "}",
  ],
  [
    "$ pnpm test",
    "  ✓ contracts (12)",
    "  ✓ harness/claude (31)",
    "  ✓ git/landing (9)",
    "",
    "Test Files  3 passed (3)",
    "     Tests  52 passed (52)",
  ],
  [
    "type Slot = { id: string; kind: SlotKind };",
    "",
    "function pick(free: Slot[], want: SlotKind[]) {",
    "  for (const k of want) {",
    "    const s = free.find((f) => f.kind === k);",
    "    if (s) return s;",
    "  }",
    "  return null;",
    "}",
  ],
];

const KEYWORDS = /^(const|let|var|function|return|import|export|from|if|else|await|async|for|of|new|class|type|interface|extends|true|false|null|test|expect)\b/;
const COLORS = { bg: "#0b1018", gutter: "#3a4656", text: "#d8e1ea", key: "#4fe3ff", str: "#ffc861", com: "#6c7a8b", num: "#ff9ec4", fn: "#9dffc8", bar: "#121a26", ok: "#6dffa8" };

export interface ScreenOptions { width?: number; height?: number; seed?: number }

export class CodeScreen {
  readonly canvas = document.createElement("canvas");
  readonly texture: THREE.CanvasTexture;
  private ctx: CanvasRenderingContext2D;
  private lines: string[] = [];
  private title = "";
  /** How much of the text shows, in characters, while it types itself out. */
  private shown = 0;
  private total = 0;
  private wait = 0;
  private since = 0;
  private dirty = true;
  private cursor = 0;
  private snippet: number;
  /** Still showing its own snippets: the app has not written anything. */
  private own = true;
  /** True: it types the text out and starts again; false: it shows the text whole. */
  typing = true;
  /** Characters a second. */
  speed = 16;

  constructor({ width = 512, height = 320, seed = 0 }: ScreenOptions = {}) {
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext("2d")!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.snippet = Math.abs(Math.floor(seed)) % SNIPPETS.length;
    this.setText(SNIPPETS[this.snippet]!, "");
    this.shown = Math.floor(this.total * ((seed * 0.37) % 1)); // start partway, so screens differ
  }

  /** Show these lines (the newest last). With typing on, they type themselves out. */
  write(lines: string[], title = this.title) {
    this.own = false;
    this.setText(lines, title);
    this.dirty = true;
  }

  private setText(lines: string[], title: string) {
    this.lines = lines.slice(-12).map((l) => l.slice(0, 64));
    this.title = title;
    this.total = this.lines.reduce((n, l) => n + l.length + 1, 0);
    this.shown = this.typing ? 0 : this.total;
  }

  update(dt: number) {
    this.since += dt;
    if (this.typing) {
      if (this.shown < this.total) this.shown = Math.min(this.total, this.shown + dt * this.speed * (1.1 + 0.5 * Math.sin(this.since * 7.3 + this.snippet)));
      else if ((this.wait += dt) > 3) {
        // Done: a pause, then the next snippet (its own text, if the app never wrote any).
        this.wait = 0;
        this.snippet = (this.snippet + 1) % SNIPPETS.length;
        if (this.own) this.setText(SNIPPETS[this.snippet]!, "");
        else this.shown = 0;
      }
    }
    const blink = Math.floor(this.since * 2.2) % 2;
    if (blink !== this.cursor) { this.cursor = blink; this.dirty = true; }
    // Redraw at most ~12 times a second.
    if (this.since > 0.08 && (this.dirty || this.typing)) {
      this.since = 0;
      this.draw();
    }
  }

  private draw() {
    this.dirty = false;
    const { ctx, canvas } = this;
    const W = canvas.width, H = canvas.height, s = W / 512;
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, W, H);
    // Title bar: three dots and a tab.
    ctx.fillStyle = COLORS.bar;
    ctx.fillRect(0, 0, W, 30 * s);
    ["#ff5d6c", "#ffc861", "#6dffa8"].forEach((c, i) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc((16 + i * 16) * s, 15 * s, 5 * s, 0, Math.PI * 2); ctx.fill(); });
    ctx.fillStyle = "#1b2635";
    ctx.fillRect(66 * s, 6 * s, 150 * s, 24 * s);
    ctx.fillStyle = COLORS.text;
    ctx.font = `${13 * s}px ui-monospace, Menlo, monospace`;
    ctx.textBaseline = "middle";
    ctx.fillText(this.title || "offsite", 76 * s, 18 * s);
    // The code.
    const lineH = 22 * s, x0 = 44 * s;
    ctx.font = `${15 * s}px ui-monospace, Menlo, monospace`;
    let left = Math.floor(this.shown), y = 30 * s + lineH * 0.9;
    let cx = x0, cy = y;
    for (let i = 0; i < this.lines.length && left >= 0; i++) {
      const full = this.lines[i]!;
      const part = full.slice(0, Math.max(0, left));
      left -= full.length + 1;
      ctx.fillStyle = COLORS.gutter;
      ctx.textAlign = "right";
      ctx.fillText(String(i + 1), 30 * s, y);
      ctx.textAlign = "left";
      cx = x0 + this.drawCode(part, x0, y);
      cy = y;
      y += lineH;
      if (y > H) break;
    }
    if (this.cursor) { ctx.fillStyle = COLORS.key; ctx.fillRect(cx + 1, cy - 8 * s, 8 * s, 16 * s); }
    this.texture.needsUpdate = true;
  }

  // One line with simple colouring; returns its width.
  private drawCode(text: string, x: number, y: number) {
    const ctx = this.ctx;
    let rest = text, at = x;
    const put = (s: string, c: string) => { ctx.fillStyle = c; ctx.fillText(s, at, y); at += ctx.measureText(s).width; };
    if (/^\s*(\/\/|#)/.test(rest)) { put(rest, COLORS.com); return at - x; }
    if (/^\s*[✓$]/.test(rest)) { put(rest, rest.includes("✓") ? COLORS.ok : COLORS.text); return at - x; }
    while (rest.length) {
      let m: RegExpMatchArray | null;
      if ((m = rest.match(/^(['"`])(?:[^\\]|\\.)*?\1/))) put(m[0], COLORS.str);
      else if ((m = rest.match(/^\/\/.*/))) put(m[0], COLORS.com);
      else if ((m = rest.match(KEYWORDS))) put(m[0], COLORS.key);
      else if ((m = rest.match(/^\d+(\.\d+)?/))) put(m[0], COLORS.num);
      else if ((m = rest.match(/^[A-Za-z_$][\w$]*(?=\()/))) put(m[0], COLORS.fn);
      else if ((m = rest.match(/^[A-Za-z_$][\w$]*/))) put(m[0], COLORS.text);
      else if ((m = rest.match(/^\s+/))) put(m[0], COLORS.text);
      else m = [rest[0]!], put(m[0], COLORS.text);
      rest = rest.slice(m[0].length);
    }
    return at - x;
  }

  dispose() { this.texture.dispose(); }
}
