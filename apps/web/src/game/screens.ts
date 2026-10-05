import * as THREE from "three";
import { ACTIVITY_LABEL, type CrewActivity } from "@offsite/contracts";

// What crew screens show in the world: desk monitors, laptops on loungers, the helm's big screen.
// Canvas painters after the agreed concepts (docs/design/interface/Desk*.dc.html, Laptop, Helm):
// an editor or a terminal with a slim status bar in the state's colour (cyan working, amber needs
// you, green delivered, red stuck), or a calm sunset when its owner is off duty.
//
// They are textures read at a distance, so text is large and there is little of it. A screen
// repaints only when what it shows changes (every repaint is a texture upload), plus a gentle
// typing animation a few times a second on screens someone is using.

export interface FaceColors { skin: string; hair: string; hairStyle: string; head: string }

export type ScreenContent =
  | { kind: "idle"; desk: string }
  | { kind: "working"; activity: CrewActivity; name: string; face: FaceColors; task: string; step: string; since: number | null }
  | { kind: "asking"; name: string; face: FaceColors; task: string; prompt: string; step: string }
  | { kind: "landed"; name: string; face: FaceColors; task: string; diff?: { added: number; removed: number; files: number } | null }
  | { kind: "failed"; name: string; face: FaceColors; task: string; step: string }
  | { kind: "off"; name: string; where: string; desk: string };

export interface HelmContent {
  ship: string;
  computer: { busy: boolean; title: string; step: string };
  threads: { title: string; state: string; landed: number; total: number; asking: number }[];
  waiting: { name: string; face: FaceColors | null; prompt: string }[];
  aboard: { name: string; face: FaceColors | null; activity: CrewActivity }[];
}

const C = {
  bg: "#070a10", bar: "#0d121a", line: "#1a212c", ink: "#eef3f7", ink2: "#c7d0d9", dim: "#9aa8b6", faint: "#56657a",
  accent: "#4fe3ff", amber: "#ffc861", green: "#6dffa8", red: "#ff5d6c",
  k: "#c792ea", s: "#c3e88d", f: "#82aaff", t: "#ffcb6b", c: "#56657a",
};
const SANS = '"Saira", "Helvetica Neue", Arial, sans-serif';
const MONO = '"JetBrains Mono", ui-monospace, Menlo, monospace';

const TONE: Record<CrewActivity, string> = {
  arriving: C.dim, idle: C.dim, thinking: C.accent, reading: C.accent, searching: C.accent, editing: C.accent, running: C.accent,
  browsing: C.accent, delegating: C.accent, asking: C.amber, landed: C.green, failed: C.red,
};

// Fonts arrive after the first paint: repaint every screen once they have.
const all = new Set<CrewScreen>();
let fontsReady = false;
if (typeof document !== "undefined" && document.fonts) {
  void Promise.all([document.fonts.load(`600 30px ${SANS}`), document.fonts.load(`500 20px ${SANS}`), document.fonts.load(`400 20px ${MONO}`)])
    .catch(() => {}).then(() => { fontsReady = true; for (const s of all) s.repaint(); });
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Face colours from an avatar (AvatarSpec, and a designed look's base for parts). */
export function faceOf(avatar: unknown, look?: unknown): FaceColors {
  const a = (avatar && typeof avatar === "object" ? avatar : {}) as Record<string, unknown>;
  const base = ((look as { meta?: { base?: Record<string, unknown> } } | null)?.meta?.base ?? {}) as Record<string, unknown>;
  const hex = (v: unknown, d: string) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v : d);
  return { skin: hex(a["skin"], "#e8b894"), hair: hex(a["hairColor"], "#2b1d14"), hairStyle: String(base["hair"] ?? a["hair"] ?? "short"), head: String(base["head"] ?? a["head"] ?? "box") };
}

const AREA: Record<string, string> = {
  office: "office deck", sun: "sun deck", promenade: "promenade", "side-deck": "side deck", canopy: "canopy deck",
  terrace: "aft terrace", stern: "stern", bridge: "bridge", bar: "sun deck",
};

/** "in a hammock on the promenade": where a slot is, said plainly. */
export function describeSlot(kind: string, id: string, tags: readonly string[] = []): string {
  const area = tags.map((t) => AREA[t]).find(Boolean);
  const on = (s: string) => (area ? `${s} on the ${area}` : s);
  switch (kind) {
    case "desk": return `at desk ${/(\d+)$/.exec(id)?.[1] ?? ""} on the office deck`;
    case "lounger": return on("on a lounger");
    case "hammock": return on("in a hammock");
    case "deck-chair": return on(id.startsWith("sofa") ? "on a sofa" : "in a deck chair");
    case "bar-stool": return "at the bar";
    case "pool": return "in the pool";
    case "hot-tub": return "in the hot tub";
    case "rail": return on("at the rail");
    case "fishing": return "fishing off the stern";
    case "dropoff": return "delivering to the bridge";
    case "helm": case "computer": return "at the helm";
    default: return "somewhere on deck";
  }
}

// ---- a little code, so a working screen looks like work ----

type Tok = [string, string];
const KW = /^(import|export|from|const|let|function|return|if|else|await|async|for|of|new|type|interface|extends|default|true|false|null|test|expect|describe|it)\b/;

function colour(line: string): Tok[] {
  const out: Tok[] = [];
  if (/^\s*(\/\/|#)/.test(line)) return [[line, C.c]];
  let rest = line;
  while (rest) {
    let m: RegExpMatchArray | null;
    if ((m = rest.match(/^(["'`])(?:[^\\]|\\.)*?\1/))) out.push([m[0], C.s]);
    else if ((m = rest.match(KW))) out.push([m[0], C.k]);
    else if ((m = rest.match(/^[A-Z][\w]*/))) out.push([m[0], C.t]);
    else if ((m = rest.match(/^[a-z_$][\w$]*(?=\()/i))) out.push([m[0], C.f]);
    else if ((m = rest.match(/^[\w$]+/))) out.push([m[0], C.ink2]);
    else if ((m = rest.match(/^\s+/))) out.push([m[0], C.ink2]);
    else { m = [rest[0]!] as unknown as RegExpMatchArray; out.push([m[0], C.ink2]); }
    rest = rest.slice(m[0].length);
  }
  return out;
}

function pascal(s: string): string {
  const p = s.replace(/\.[^.]+$/, "").replace(/\.(test|spec)$/, "").split(/[^a-zA-Z0-9]+/).filter(Boolean).map((w) => w[0]!.toUpperCase() + w.slice(1)).join("");
  return p || "Thing";
}

function codeFor(file: string | null, seed: number): string[] {
  const name = file?.split("/").pop() ?? "index.ts";
  const P = pascal(name), p = P[0]!.toLowerCase() + P.slice(1);
  const words = name.replace(/\.[^.]+$/, "").split(/[^a-zA-Z0-9]+/).filter(Boolean).join(" ");
  if (/\.md$/.test(name)) return [`# ${words.charAt(0).toUpperCase()}${words.slice(1)}`, "", "What changed, and why:", "", `- A ${p} page, linked from the nav`, "- Reads from the existing API", "- Tests for the empty and full cases"];
  if (/\.(test|spec)\.[jt]sx?$/.test(name)) return [`import { test, expect } from "vitest";`, `import { ${P} } from "./${P}";`, "", `test("${p} renders", () => {`, `  const view = render(${P}());`, `  expect(view.text).toContain("${P}");`, "});"];
  if (/\.css$/.test(name)) return [`.${p} {`, "  display: flex;", "  gap: 12px;", "  color: var(--ink);", "}", "", `.${p}.dark { background: #05070b; }`];
  if (/\.json$/.test(name)) return ["{", `  "name": "${p}",`, `  "version": "1.0.0",`, `  "private": true`, "}"];
  const variants = [
    [`import { use${P} } from "./${p}";`, "", `export function ${P}({ id }) {`, `  const data = use${P}(id);`, `  if (!data) return null;`, `  return <section>{data.title}</section>;`],
    [`export interface ${P} {`, "  id: string;", "  title: string;", "}", "", `export async function load${P}(id) {`, `  return api.get(\`/${p}/\${id}\`);`],
    [`const ${p} = await load(id);`, `if (!${p}) return "not found";`, "", `export default ${p};`],
  ];
  return variants[seed % variants.length]!;
}

/** The file a step is about: "Edit src/app.tsx" → src/app.tsx. */
function fileOf(step: string): string | null {
  const m = /^(?:Edit|Write|Read|Open|Create|Update)\s+(\S+\.\w+)/i.exec(step);
  return m?.[1] ?? null;
}

function clip(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ctx.measureText(`${text.slice(0, mid)}…`).width <= max) lo = mid; else hi = mid - 1; }
  return `${text.slice(0, lo).trimEnd()}…`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function drawFace(ctx: CanvasRenderingContext2D, f: FaceColors | null, x: number, y: number, s: number) {
  if (!f) {
    // The computer: a white robot head with cyan eyes.
    ctx.fillStyle = "#e9eef3";
    roundRect(ctx, x, y + s * 0.05, s, s * 0.9, s * 0.27);
    ctx.fill();
    ctx.fillStyle = C.accent;
    ctx.fillRect(x + s * 0.23, y + s * 0.35, s * 0.17, s * 0.24);
    ctx.fillRect(x + s * 0.6, y + s * 0.35, s * 0.17, s * 0.24);
    return;
  }
  ctx.save();
  roundRect(ctx, x, y, s, s, f.head === "round" ? s / 2 : s * 0.22);
  ctx.clip();
  ctx.fillStyle = f.skin;
  ctx.fillRect(x, y, s, s);
  if (f.hairStyle !== "none" && f.head !== "tv") {
    ctx.fillStyle = f.hair;
    ctx.fillRect(x, y, s, s * 0.3);
    if (f.hairStyle === "long") { ctx.fillRect(x, y, s * 0.16, s * 0.8); ctx.fillRect(x + s * 0.84, y, s * 0.16, s * 0.8); }
  }
  ctx.fillStyle = "#1a1410";
  ctx.beginPath();
  ctx.arc(x + s * 0.34, y + s * 0.62, s * 0.075, 0, Math.PI * 2);
  ctx.arc(x + s * 0.66, y + s * 0.62, s * 0.075, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function sunset(ctx: CanvasRenderingContext2D, W: number, H: number, dim = 1) {
  const sea = H * 0.5;
  ctx.fillStyle = "#081422";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#0b2238";
  ctx.fillRect(0, sea, W, H - sea);
  ctx.globalAlpha = dim;
  ctx.fillStyle = "#ffb86b";
  const cx = W * 0.71, r = H * 0.15;
  ctx.beginPath();
  ctx.arc(cx, sea - r * 0.95, r, 0, Math.PI * 2);
  ctx.fill();
  for (const [w, dy, a] of [[1.45, 0.06, 0.7], [1.0, 0.1, 0.45], [0.55, 0.14, 0.25]] as const) {
    ctx.globalAlpha = a * dim;
    ctx.fillRect(cx - (r * w), sea + H * dy, r * w * 2, Math.max(3, H * 0.007));
  }
  ctx.globalAlpha = 1;
}

// ---- one screen ----

export type ScreenSize = "desk" | "laptop" | "helm";
// Desks are many: 768 wide reads fine on a 62 cm monitor and keeps texture memory down.
const SIZES: Record<ScreenSize, [number, number]> = { desk: [768, 446], laptop: [512, 320], helm: [1280, 542] };

export class CrewScreen {
  readonly canvas = document.createElement("canvas");
  readonly texture: THREE.CanvasTexture;
  private ctx: CanvasRenderingContext2D;
  private content: ScreenContent | HelmContent | null = null;
  private key = "";
  /** Files and commands seen lately on this screen: its tabs and its terminal's history. */
  private files: string[] = [];
  private history: string[] = [];
  private shown = 0;
  private total = 0;
  private clock = 0;
  private blink = true;
  private seed: number;
  private ticks = 0;
  readonly size: ScreenSize;

  constructor(size: ScreenSize, seed = 0) {
    this.size = size;
    this.seed = seed;
    const [w, h] = SIZES[size];
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx = this.canvas.getContext("2d")!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    all.add(this);
  }

  /** Show this. Repaints only when it differs from what is up now. */
  show(c: ScreenContent | HelmContent) {
    const key = JSON.stringify(c);
    if (key === this.key) return;
    const was = this.content;
    this.key = key;
    this.content = c;
    if ("kind" in c && (c.kind === "working" || c.kind === "asking" || c.kind === "failed")) {
      const file = fileOf(c.step);
      if (file && this.files[this.files.length - 1] !== file) this.files = [...this.files.filter((f) => f !== file), file].slice(-3);
      if (c.step && this.history[this.history.length - 1] !== c.step) this.history = [...this.history, c.step].slice(-6);
      // A new step types itself out again.
      const sameStep = was && "kind" in was && "step" in was && was.step === c.step;
      if (!sameStep) this.shown = 0;
    }
    this.repaint();
  }

  /** How it moves: code typing itself out, a terminal's cursor blinking, or still. */
  private get motion(): "typing" | "blink" | null {
    const c = this.content;
    if (!c || !("kind" in c) || c.kind !== "working") return null;
    if (c.activity === "editing" || c.activity === "delegating") return "typing";
    return c.activity === "running" ? "blink" : null;
  }

  /** True while it animates: someone is at work on it. */
  get animating(): boolean {
    return this.motion !== null;
  }

  /** The gentle animation: three repaints a second while typing, a slow cursor in a terminal. */
  update(dt: number) {
    const motion = this.motion;
    if (!motion) return;
    this.clock += dt;
    if (this.clock < (motion === "typing" ? 0.33 : 0.7)) return;
    this.clock = 0;
    this.blink = !this.blink;
    if (motion === "typing") {
      // Seeded by the screen and how far it has got, so the same clock types the same way.
      this.ticks++;
      const r = hash(`${this.seed}:${this.ticks}`);
      if (this.shown < this.total) this.shown = Math.min(this.total, this.shown + 9 + (r % 7));
      else if (r % 10 === 0) this.shown = 0; // finished the snippet: start again after a beat
    }
    this.repaint();
  }

  repaint() {
    const c = this.content;
    if (!c) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.textBaseline = "alphabetic";
    if (!("kind" in c)) this.paintHelm(c);
    else if (c.kind === "idle") this.paintIdle(c.desk);
    else if (c.kind === "off") this.paintOff(c);
    else this.paintWork(c);
    ctx.restore();
    this.texture.needsUpdate = true;
    void fontsReady;
  }

  dispose() {
    all.delete(this);
    this.texture.dispose();
  }

  // ---- painters ----

  private paintIdle(desk: string) {
    const { ctx, canvas: { width: W, height: H } } = this;
    sunset(ctx, W, H, 0.45);
    ctx.fillStyle = C.ink2;
    ctx.font = `600 ${Math.round(H * 0.08)}px ${SANS}`;
    ctx.fillText("Free desk", W * 0.06, H * 0.84);
    ctx.fillStyle = "#6f8ba6";
    ctx.font = `500 ${Math.round(H * 0.035)}px ${SANS}`;
    ctx.fillText(desk ? `${desk} · waiting for whoever needs it` : "Waiting for whoever needs it", W * 0.06, H * 0.91);
  }

  private paintOff(c: Extract<ScreenContent, { kind: "off" }>) {
    const { ctx, canvas: { width: W, height: H } } = this;
    sunset(ctx, W, H);
    const x = W * 0.058;
    ctx.fillStyle = C.ink;
    ctx.font = `650 ${Math.round(H * 0.092)}px ${SANS}`;
    ctx.fillText("Off duty", x, H * 0.74);
    ctx.fillStyle = "#a9c4dc";
    ctx.font = `500 ${Math.round(H * 0.042)}px ${SANS}`;
    ctx.fillText(clip(ctx, `${c.name} is ${c.where}.`, W - x * 2), x, H * 0.83);
    ctx.fillStyle = "#6f8ba6";
    ctx.font = `500 ${Math.round(H * 0.03)}px ${SANS}`;
    ctx.fillText(`${c.desk ? `${c.desk} · ` : ""}back when there's work`, x, H * 0.9);
  }

  private paintWork(c: Extract<ScreenContent, { kind: "working" | "asking" | "landed" | "failed" }>) {
    const { ctx, canvas: { width: W, height: H } } = this;
    const laptop = this.size === "laptop";
    const s = W / 960; // the concepts are 960 wide (laptop: 640, scaled up below)
    const k = laptop ? W / 640 : s;
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);

    const terminal = c.kind !== "working" || c.activity === "running";
    const barH = laptop ? Math.round(118 * k) : Math.round(122 * s);
    const tabH = laptop ? 0 : Math.round(50 * s);
    // Tabs: the files they've had open lately, or the terminal.
    if (!laptop) {
      ctx.fillStyle = C.bar;
      ctx.fillRect(0, 0, W, tabH);
      ctx.fillStyle = C.line;
      ctx.fillRect(0, tabH - 1, W, 1);
      ctx.font = `400 ${Math.round(18 * s)}px ${MONO}`;
      const tabs = terminal ? ["Terminal"] : this.files.length ? this.files.map((f) => f.split("/").pop()!) : ["index.ts"];
      let x = 0;
      tabs.forEach((t, i) => {
        const on = i === tabs.length - 1;
        const w = ctx.measureText(t).width + 36 * s;
        if (on) { ctx.fillStyle = C.bg; ctx.fillRect(x, 0, w, tabH); }
        ctx.fillStyle = on ? (terminal ? C.dim : C.ink) : C.faint;
        ctx.fillText(t, x + 18 * s, tabH / 2 + 6 * s);
        ctx.fillStyle = C.line;
        ctx.fillRect(x + w, 0, 1, tabH);
        x += w + 1;
      });
    }

    // The body: code being written, or a terminal.
    const top = tabH + (laptop ? 22 * k : 18 * s);
    const lineH = laptop ? 36 * k : 35 * s;
    const fs = laptop ? Math.round(23 * k) : Math.round(22 * s);
    const left = laptop ? 26 * k : 24 * s;
    ctx.font = `400 ${fs}px ${MONO}`;
    const maxLines = Math.floor((H - barH - top - 8 * s) / lineH);
    if (!terminal) {
      const file = this.files[this.files.length - 1] ?? null;
      const code = codeFor(file, hash(`${file}${this.seed}`)).slice(0, maxLines);
      this.total = code.reduce((n, l) => n + l.length + 1, 0);
      const typing = c.kind === "working" && (c.activity === "editing" || c.activity === "delegating");
      let budget = typing ? this.shown : this.total;
      let y = top + lineH * 0.8, cx = left, cy = y;
      code.forEach((line, i) => {
        if (budget < 0) return;
        const part = line.slice(0, Math.max(0, budget));
        budget -= line.length + 1;
        let x = left;
        if (!laptop) {
          ctx.fillStyle = C.c;
          ctx.fillText(String(i + 1).padStart(2, " "), x, y);
          x += 46 * s;
        }
        for (const [t, col] of colour(part)) { ctx.fillStyle = col; ctx.fillText(t, x, y); x += ctx.measureText(t).width; }
        cx = x; cy = y;
        y += lineH;
      });
      if (this.blink || !typing) { ctx.fillStyle = C.accent; ctx.fillRect(cx + 2, cy - fs * 0.85, fs * 0.55, fs * 1.1); }
    } else {
      const lines: Tok[][] = [];
      const cmd = (t: string): Tok[] => [["$ ", C.faint], [t, C.ink2]];
      const past = this.history.slice(0, -1).slice(-(maxLines > 6 ? 2 : 1));
      for (const h of past) lines.push([[`  ✓ ${h}`, C.faint]]);
      if (c.kind === "working") {
        const step = c.step || "…";
        lines.push(cmd(step.replace(/^(Run|Bash)\s+/i, "")));
        if (/test|vitest|jest|pytest/.test(step)) lines.push([["  ✓ renders (12 ms)", C.faint]], [["  ✓ handles the empty case (8 ms)", C.faint]]);
        else lines.push([["  …", C.faint]]);
      } else if (c.kind === "asking") {
        lines.push([]);
        const ask = c.prompt.split("\n")[0] ?? "";
        lines.push([[`? ${/^(Run|Allow|Edit|Write)/i.test(ask) ? ask : `Allow: ${ask}`}`, C.amber]]);
        lines.push([["  Waiting for the captain…", C.ink2]]);
      } else if (c.kind === "landed") {
        lines.push(cmd("git log --oneline -1"));
        lines.push([[`${(hash(c.task) % 0xfffffff).toString(16).padStart(7, "0").slice(0, 7)} ${c.task}`, C.ink2]]);
        lines.push([]);
        lines.push([["Landed on the thread's branch", C.green]]);
        if (c.diff) lines.push([[`+${c.diff.added}`, C.green], [" ", C.dim], [`−${c.diff.removed}`, C.red], [` · ${c.diff.files} file${c.diff.files === 1 ? "" : "s"}`, C.dim]]);
      } else {
        lines.push(cmd(c.step || "…"));
        lines.push([["✕ couldn't finish", C.red]]);
      }
      const shownLines = lines.slice(-maxLines);
      let y = top + lineH * 0.8;
      for (const l of shownLines) {
        let x = left;
        for (const [t, col] of l) { ctx.fillStyle = col; const tt = clip(ctx, t, W - x - left); ctx.fillText(tt, x, y); x += ctx.measureText(tt).width; }
        y += lineH;
      }
      if (c.kind === "working" && this.blink) { ctx.fillStyle = C.accent; ctx.fillRect(left, y - lineH + lineH * 0.8 - fs * 0.85, fs * 0.55, fs * 1.1); }
    }

    // The status bar: state, task, step, who.
    const tone = c.kind === "working" ? TONE[c.activity] : c.kind === "asking" ? C.amber : c.kind === "landed" ? C.green : C.red;
    const label = c.kind === "working" ? ACTIVITY_LABEL[c.activity] : c.kind === "asking" ? ACTIVITY_LABEL.asking : c.kind === "landed" ? ACTIVITY_LABEL.landed : ACTIVITY_LABEL.failed;
    const by = H - barH;
    ctx.fillStyle = c.kind === "asking" ? "#100d06" : c.kind === "landed" ? "#06100b" : c.kind === "failed" ? "#12070a" : "#0b1118";
    ctx.fillRect(0, by, W, barH);
    ctx.fillStyle = tone;
    ctx.fillRect(0, by, W, Math.max(3, Math.round(4 * s)));
    const pad = 22 * k;
    if (laptop) {
      // Laptop: label and name on one line, the step under it.
      ctx.font = `650 ${Math.round(28 * k)}px ${SANS}`;
      ctx.fillStyle = tone;
      ctx.fillText(label, pad, by + 50 * k);
      ctx.fillStyle = C.ink;
      ctx.textAlign = "right";
      ctx.font = `650 ${Math.round(25 * k)}px ${SANS}`;
      ctx.fillText(c.name, W - pad, by + 48 * k);
      ctx.textAlign = "left";
      ctx.font = `400 ${Math.round(21 * k)}px ${MONO}`;
      ctx.fillStyle = C.dim;
      const sub = c.kind === "asking" ? "Went to find the captain" : c.kind === "landed" ? c.task : c.step || c.task;
      ctx.fillText(clip(ctx, sub, W - pad * 2), pad, by + 92 * k);
      return;
    }
    const fsz = 52 * s;
    drawFace(ctx, c.face, pad, by + (barH - fsz) / 2 + 2 * s, fsz);
    const tx = pad + fsz + 20 * s;
    // Right: the name, and how long.
    ctx.textAlign = "right";
    ctx.fillStyle = C.ink;
    ctx.font = `650 ${Math.round(30 * s)}px ${SANS}`;
    ctx.fillText(c.name, W - pad, by + 54 * s);
    const nameW = ctx.measureText(c.name).width;
    if (c.kind === "working" && c.since) {
      ctx.fillStyle = C.dim;
      ctx.font = `500 ${Math.round(20 * s)}px ${SANS}`;
      const mins = Math.max(1, Math.round((Date.now() - c.since) / 60_000));
      ctx.fillText(`${mins} min`, W - pad, by + 90 * s);
    }
    ctx.textAlign = "left";
    const maxW = W - tx - pad - Math.max(nameW, 60 * s) - 24 * s;
    ctx.font = `650 ${Math.round(32 * s)}px ${SANS}`;
    ctx.fillStyle = tone;
    ctx.fillText(label, tx, by + 54 * s);
    const lw = ctx.measureText(label).width + 16 * s;
    ctx.font = `500 ${Math.round(27 * s)}px ${SANS}`;
    ctx.fillStyle = C.ink2;
    ctx.fillText(clip(ctx, c.task, maxW - lw), tx + lw, by + 54 * s);
    const sub = c.kind === "asking" ? "Went to find the captain"
      : c.kind === "landed" ? (c.diff ? `+${c.diff.added} −${c.diff.removed} · ${c.diff.files} file${c.diff.files === 1 ? "" : "s"} · carried to the bridge` : "Carrying it to the bridge")
      : c.step;
    ctx.font = c.kind === "working" || c.kind === "failed" ? `400 ${Math.round(21 * s)}px ${MONO}` : `500 ${Math.round(22 * s)}px ${SANS}`;
    ctx.fillStyle = C.dim;
    ctx.fillText(clip(ctx, sub, maxW), tx, by + 94 * s);
  }

  private paintHelm(c: HelmContent) {
    const { ctx, canvas: { width: W, height: H } } = this;
    ctx.fillStyle = "#04060a";
    ctx.fillRect(0, 0, W, H);
    const pad = 40;
    // Top: the ship, and what the computer is doing.
    ctx.font = `650 34px ${SANS}`;
    ctx.fillStyle = C.ink;
    ctx.fillText(c.ship, pad, 62);
    const sw = ctx.measureText(c.ship).width;
    ctx.font = `500 22px ${SANS}`;
    ctx.fillStyle = C.accent;
    ctx.fillText("Bridge", pad + sw + 22, 62);
    drawFace(ctx, null, pad, 92, 40);
    ctx.font = `600 26px ${SANS}`;
    ctx.fillStyle = c.computer.busy ? C.accent : C.dim;
    ctx.fillText(c.computer.busy ? "Thinking" : "All quiet", pad + 58, 112);
    const tw = ctx.measureText(c.computer.busy ? "Thinking" : "All quiet").width;
    ctx.font = `500 24px ${SANS}`;
    ctx.fillStyle = C.ink2;
    ctx.fillText(clip(ctx, c.computer.busy ? c.computer.title : "Walk up and press E to talk to me", W * 0.58 - pad - 58 - tw - 16), pad + 58 + tw + 16, 112);
    if (c.computer.busy && c.computer.step) {
      ctx.font = `400 19px ${MONO}`;
      ctx.fillStyle = C.dim;
      ctx.fillText(clip(ctx, c.computer.step, W * 0.58 - pad - 58), pad + 58, 140);
    }

    // Left: threads.
    const colW = W * 0.58 - pad;
    let y = 190;
    ctx.font = `500 20px ${SANS}`;
    ctx.fillStyle = C.dim;
    ctx.fillText("Threads", pad, y);
    y += 16;
    if (!c.threads.length) {
      ctx.font = `500 24px ${SANS}`;
      ctx.fillStyle = C.ink2;
      ctx.fillText("No threads yet", pad, y + 40);
    }
    for (const t of c.threads.slice(0, 4)) {
      const h = 72;
      ctx.strokeStyle = t.asking ? "rgba(255,200,97,0.45)" : t.state === "working" ? "rgba(79,227,255,0.4)" : "rgba(238,243,247,0.16)";
      ctx.fillStyle = t.asking ? "rgba(255,200,97,0.07)" : t.state === "working" ? "rgba(79,227,255,0.06)" : "rgba(255,255,255,0.02)";
      ctx.lineWidth = 2;
      roundRect(ctx, pad, y, colW, h, 10);
      ctx.fill();
      ctx.stroke();
      ctx.font = `600 25px ${SANS}`;
      ctx.fillStyle = C.ink;
      ctx.fillText(clip(ctx, t.title, colW - 230), pad + 18, y + 33);
      const st = t.state === "done" ? ["Done", C.green] : t.state === "working" ? ["Working", C.accent] : ["Open", C.dim];
      ctx.font = `600 20px ${SANS}`;
      ctx.fillStyle = st[1]!;
      ctx.fillText(st[0]!, pad + 18, y + 60);
      const lw = ctx.measureText(st[0]!).width;
      ctx.font = `500 20px ${SANS}`;
      ctx.fillStyle = C.dim;
      ctx.fillText(t.total ? `· ${t.landed} of ${t.total} landed` : "", pad + 18 + lw + 10, y + 60);
      if (t.asking) {
        ctx.textAlign = "right";
        ctx.fillStyle = C.amber;
        ctx.font = `600 20px ${SANS}`;
        ctx.fillText(`${t.asking} needs you`, pad + colW - 18, y + 33);
        ctx.textAlign = "left";
      }
      if (t.state === "working" && t.total) {
        ctx.fillStyle = "rgba(238,243,247,0.1)";
        ctx.fillRect(pad + colW - 200, y + 52, 182, 6);
        ctx.fillStyle = C.accent;
        ctx.fillRect(pad + colW - 200, y + 52, (182 * t.landed) / t.total, 6);
      }
      y += h + 12;
    }

    // Right: who waits on you, else who's aboard.
    const rx = W * 0.58 + 30, rw = W - rx - pad;
    let ry = 190;
    if (c.waiting.length) {
      ctx.font = `500 20px ${SANS}`;
      ctx.fillStyle = C.amber;
      ctx.fillText("Waiting on you", rx, ry);
      ry += 16;
      for (const w of c.waiting.slice(0, 3)) {
        const h = 92;
        ctx.strokeStyle = "rgba(255,200,97,0.5)";
        ctx.fillStyle = "rgba(255,200,97,0.09)";
        ctx.lineWidth = 2;
        roundRect(ctx, rx, ry, rw, h, 10);
        ctx.fill();
        ctx.stroke();
        drawFace(ctx, w.face, rx + 16, ry + 16, 32);
        ctx.font = `600 24px ${SANS}`;
        ctx.fillStyle = C.amber;
        ctx.fillText(`${w.name} needs you`, rx + 60, ry + 41);
        ctx.font = `400 19px ${MONO}`;
        ctx.fillStyle = C.ink2;
        ctx.fillText(clip(ctx, w.prompt.split("\n")[0] ?? "", rw - 32), rx + 16, ry + 76);
        ry += h + 12;
      }
    } else {
      ctx.font = `500 20px ${SANS}`;
      ctx.fillStyle = C.dim;
      ctx.fillText("Aboard", rx, ry);
      ry += 22;
      for (const a of c.aboard.slice(0, 7)) {
        drawFace(ctx, a.face, rx, ry, 30);
        ctx.font = `500 23px ${SANS}`;
        ctx.fillStyle = C.ink;
        ctx.fillText(clip(ctx, a.name, rw * 0.5), rx + 44, ry + 23);
        ctx.textAlign = "right";
        ctx.font = `600 20px ${SANS}`;
        ctx.fillStyle = TONE[a.activity];
        ctx.fillText(ACTIVITY_LABEL[a.activity], rx + rw, ry + 23);
        ctx.textAlign = "left";
        ry += 42;
      }
    }
  }
}

/** Point a laptop prop's glass at a painter's texture (the kit's laptop draws its own otherwise). */
export function takeOverLaptop(lid: THREE.Object3D, theirs: THREE.Texture, ours: THREE.Texture): boolean {
  let done = false;
  lid.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
    if (m && m.map === theirs) { m.map = ours; m.needsUpdate = true; done = true; }
  });
  return done;
}
