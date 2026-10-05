// Adapted from Ready Player One (github.com/apekshik/ready-player-one).
//
// World labels in the shell's look, "Bracket": dark glass, corner brackets instead of boxes,
// one cyan accent, Saira. A nameplate (name and what they are doing), a speech bubble that
// fades, the "!" that bobs over someone who needs the captain, the "!" that pops when a phone
// buzzes, and the "Z z z" over someone asleep. Labels drawn before the
// font has loaded redraw themselves once it arrives.

import * as THREE from "three";

export const THEME = {
  accent: "#4fe3ff",
  ink: "#eef3f7",
  dim: "#9aa8b6",
  faint: "rgba(238, 243, 247, 0.14)",
  bracket: "rgba(238, 243, 247, 0.85)",
  glass: "rgba(4, 7, 11, 0.42)",
  glassStrong: "rgba(4, 7, 11, 0.78)",
  scrim: "rgba(4, 7, 11, 0.9)",
  warn: "#ffc861",
  danger: "#ff5d6c",
  ok: "#6dffa8",
  font: '"Saira", "Helvetica Neue", Arial, sans-serif',
} as const;

/** The four corner brackets of a w×h box at (x, y): the shell's frame. */
export function drawBrackets(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, { color = THEME.bracket as string, len = 10, width = 2 } = {}) {
  const l = Math.min(len, w / 2, h / 2);
  ctx.fillStyle = color;
  for (const [cx, cy, sx, sy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]] as const) {
    ctx.fillRect(sx > 0 ? cx : cx - l, sy > 0 ? cy : cy - width, l, width);
    ctx.fillRect(sx > 0 ? cx : cx - width, sy > 0 ? cy : cy - l, width, l);
  }
}

type Ctx = CanvasRenderingContext2D;

function setFont(ctx: Ctx, weight: number, px: number, { stretch = "normal" as CanvasFontStretch, spacing = 0 } = {}) {
  ctx.font = `${weight} ${px}px ${THEME.font}`;
  if ("fontStretch" in ctx) ctx.fontStretch = stretch;
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${spacing}px`;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines = 4) {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = word; }
    else line = test;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = `${lines[maxLines - 1]}…`; }
  return lines;
}

// Fonts arrive after the first draw; anything drawn before then draws again.
const waiting = new Set<() => void>();
let watching = false;
function whenFontsLoad(redraw: () => void) {
  if (typeof document === "undefined" || !document.fonts) return;
  waiting.add(redraw);
  if (watching) return;
  watching = true;
  const flush = () => { for (const fn of waiting) fn(); waiting.clear(); watching = false; };
  Promise.all([document.fonts.load(`600 30px ${THEME.font}`), document.fonts.load(`500 20px ${THEME.font}`)]).then(flush, flush);
}
const fontsReady = () => typeof document !== "undefined" && !!document.fonts && document.fonts.check(`600 30px ${THEME.font}`);

/** A canvas that becomes a sprite's texture, redrawn on demand. */
class CanvasSprite {
  readonly sprite: THREE.Sprite;
  protected canvas = document.createElement("canvas");
  protected ctx = this.canvas.getContext("2d") as Ctx;
  private tex = new THREE.CanvasTexture(this.canvas);
  /** Metres per canvas pixel at 1× scale. */
  protected worldScale: number;
  width = 0;
  height = 0;

  constructor(worldScale: number) {
    this.worldScale = worldScale;
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.generateMipmaps = false;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthTest: false, depthWrite: false }));
    this.sprite.center.set(0.5, 0);
    this.sprite.renderOrder = 10;
  }

  protected resize(w: number, h: number) {
    w = Math.ceil(w); h = Math.ceil(h);
    if (w !== this.canvas.width || h !== this.canvas.height) {
      this.canvas.width = w;
      this.canvas.height = h;
      // A new size needs a new texture: the old one's storage was the old size.
      this.tex.dispose();
      this.tex = new THREE.CanvasTexture(this.canvas);
      this.tex.colorSpace = THREE.SRGBColorSpace;
      this.tex.minFilter = THREE.LinearFilter;
      this.tex.generateMipmaps = false;
      this.sprite.material.map = this.tex;
      this.sprite.material.needsUpdate = true;
    }
    this.width = w;
    this.height = h;
    this.ctx.clearRect(0, 0, w, h);
  }

  protected commit() {
    this.tex.needsUpdate = true;
    this.sprite.scale.set(this.width * this.worldScale, this.height * this.worldScale, 1);
  }

  dispose() {
    this.tex.dispose();
    this.sprite.material.dispose();
    this.sprite.removeFromParent();
  }
}

/**
 * Keeps a label readable: life-size up close, and past `near` metres it grows with distance so it
 * stays the same size on screen (up to `far`).
 */
export function keepReadable(sprite: THREE.Sprite, baseScale: THREE.Vector2, camera: THREE.Camera, near = 8, far = 26) {
  const d = camera.position.distanceTo(sprite.getWorldPosition(_v));
  const k = Math.min(far, Math.max(near, d)) / near;
  sprite.scale.set(baseScale.x * k, baseScale.y * k, 1);
  return d;
}
const _v = new THREE.Vector3();

export type Tone = "accent" | "warn" | "danger" | "ok" | "dim";
const TONE: Record<Tone, string> = { accent: THEME.accent, warn: THEME.warn, danger: THEME.danger, ok: THEME.ok, dim: THEME.dim };

/** Name and a line of what they are doing, over someone's head. */
export class Nameplate extends CanvasSprite {
  name: string;
  line: string;
  tone: Tone;
  private base = new THREE.Vector2();
  private dimmed = false;

  constructor(name: string, line = "", tone: Tone = "accent") {
    super(0.0018);
    this.name = name;
    this.line = line;
    this.tone = tone;
    this.draw();
    if (!fontsReady()) whenFontsLoad(() => this.draw());
  }

  set(name: string, line = this.line, tone: Tone = this.tone) {
    if (name === this.name && line === this.line && tone === this.tone) return;
    this.name = name;
    this.line = line;
    this.tone = tone;
    this.draw();
  }

  /** Faded back: someone far away, or behind what the captain is looking at. */
  dim(on: boolean) {
    if (on === this.dimmed) return;
    this.dimmed = on;
    this.sprite.material.opacity = on ? 0.45 : 1;
  }

  private draw() {
    const ctx = this.ctx, S = 2; // drawn at twice the size it shows, for crisp text
    const padX = 16 * S, padY = 9 * S;
    setFont(ctx, 600, 26 * S);
    const nameW = ctx.measureText(this.name).width;
    const line = this.line.toUpperCase();
    setFont(ctx, 600, 15 * S, { stretch: "condensed", spacing: 2.2 * S });
    const lineW = line ? ctx.measureText(line).width + 16 * S : 0;
    const w = Math.max(nameW, lineW) + padX * 2;
    const h = padY * 2 + 30 * S + (line ? 20 * S : 0);
    this.resize(w, h);
    ctx.fillStyle = THEME.glassStrong;
    ctx.fillRect(0, 0, w, h);
    drawBrackets(ctx, 0, 0, w, h, { color: THEME.bracket, len: 11 * S, width: 2 * S });
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    setFont(ctx, 600, 26 * S);
    ctx.fillStyle = THEME.ink;
    ctx.fillText(this.name, w / 2, padY + 15 * S);
    if (line) {
      const color = TONE[this.tone];
      setFont(ctx, 600, 15 * S, { stretch: "condensed", spacing: 2.2 * S });
      const y = padY + 30 * S + 9 * S;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(w / 2 - lineW / 2 + 4 * S, y, 3.2 * S, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillText(line, w / 2 + 8 * S, y);
    }
    this.commit();
    this.base.set(this.sprite.scale.x, this.sprite.scale.y);
  }

  /** Call each frame with the viewing camera; returns the distance to it. */
  update(camera: THREE.Camera) { return keepReadable(this.sprite, this.base, camera); }
}

/** A short line said out loud, over the nameplate. Fades in, holds, fades out. */
/**
 * How much larger speech bubbles are drawn than life-size. The game leaves it at 1; the film page
 * turns it up for close shots, where a line has to read at a glance on a phone screen.
 */
let bubbleScale = 1;
export function setBubbleScale(k: number) { bubbleScale = k > 0 ? k : 1; }

export class SpeechBubble extends CanvasSprite {
  text = "";
  private base = new THREE.Vector2();
  private age = 0;
  private hold = 0;

  constructor() {
    super(0.0019);
    this.sprite.visible = false;
  }

  /** Show text for ms (by default, long enough to read it). */
  say(text: string, ms = 2600 + text.length * 55) {
    this.text = text.trim().slice(0, 140);
    this.age = 0;
    this.hold = ms / 1000;
    this.draw();
    if (!fontsReady()) whenFontsLoad(() => this.text && this.draw());
    this.sprite.visible = !!this.text;
  }

  clear() { this.hold = 0; this.age = 1e9; }
  get showing() { return this.sprite.visible; }

  private draw() {
    const ctx = this.ctx, S = 2;
    setFont(ctx, 500, 21 * S);
    const lines = wrap(ctx, this.text, 300 * S, 4);
    const padX = 15 * S, padY = 10 * S, lineH = 27 * S, tail = 11 * S;
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + padX * 2;
    const h = lines.length * lineH + padY * 2;
    this.resize(Math.max(w, 60 * S), h + tail);
    const W = this.width;
    ctx.fillStyle = "rgba(4, 7, 11, 0.86)";
    ctx.fillRect(0, 0, W, h);
    // The tail points down at whoever said it.
    ctx.beginPath();
    ctx.moveTo(W / 2 - tail, h);
    ctx.lineTo(W / 2, h + tail);
    ctx.lineTo(W / 2 + tail, h);
    ctx.fill();
    drawBrackets(ctx, 0, 0, W, h, { color: THEME.accent, len: 10 * S, width: 2 * S });
    ctx.fillStyle = THEME.ink;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    setFont(ctx, 500, 21 * S);
    lines.forEach((l, i) => ctx.fillText(l, W / 2, padY + lineH * (i + 0.5)));
    this.commit();
    this.sprite.scale.set(this.sprite.scale.x * bubbleScale, this.sprite.scale.y * bubbleScale, 1);
    this.base.set(this.sprite.scale.x, this.sprite.scale.y);
  }

  update(dt: number, camera?: THREE.Camera) {
    if (!this.sprite.visible) return;
    this.age += dt;
    const fadeIn = Math.min(1, this.age / 0.18), fadeOut = Math.min(1, Math.max(0, (this.hold + 0.4 - this.age) / 0.4));
    const a = Math.min(fadeIn, fadeOut);
    this.sprite.material.opacity = a;
    if (a <= 0 && this.age > this.hold) { this.sprite.visible = false; this.text = ""; return; }
    // A little rise as it appears.
    if (camera) keepReadable(this.sprite, this.base, camera);
    this.sprite.position.y = this.restY + (1 - fadeIn) * -0.08;
  }

  /** Where it sits when shown (set by whoever places it). */
  restY = 0;
}

/** The "!" over someone waiting on the captain: amber, bobbing, pulsing. */
export class AskMarker {
  readonly sprite: THREE.Sprite;
  private tex: THREE.CanvasTexture;
  private base = 0.42;
  restY = 0;

  constructor(color: string = THEME.warn) {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const ctx = c.getContext("2d")!;
    // A diamond with a soft glow, the mark cut out in dark glass.
    ctx.translate(64, 64);
    ctx.shadowColor = color;
    ctx.shadowBlur = 18;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, -46); ctx.lineTo(46, 0); ctx.lineTo(0, 46); ctx.lineTo(-46, 0);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(4, 7, 11, 0.92)";
    ctx.fillRect(-6, -28, 12, 34);
    ctx.fillRect(-6, 14, 12, 12);
    this.tex = new THREE.CanvasTexture(c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthTest: false, depthWrite: false }));
    this.sprite.center.set(0.5, 0);
    this.sprite.renderOrder = 11;
    this.sprite.scale.setScalar(this.base);
    this.sprite.visible = false;
  }

  set visible(on: boolean) { this.sprite.visible = on; }
  get visible() { return this.sprite.visible; }

  update(time: number, camera?: THREE.Camera) {
    if (!this.sprite.visible) return;
    const pulse = 1 + 0.08 * Math.max(0, Math.sin(time * 6));
    let k = 1;
    if (camera) {
      const d = camera.position.distanceTo(this.sprite.getWorldPosition(_v));
      k = Math.min(26, Math.max(8, d)) / 8;
    }
    this.sprite.scale.setScalar(this.base * pulse * k);
    this.sprite.position.y = this.restY + Math.abs(Math.sin(time * 3.2)) * 0.07;
  }

  dispose() {
    this.tex.dispose();
    this.sprite.material.dispose();
    this.sprite.removeFromParent();
  }
}

/** Any label as plain text: signs, debug tags. */
// One glyph drawn once and shared by every marker that uses it.
const glyphs = new Map<string, THREE.CanvasTexture>();
function glyph(key: string, draw: (ctx: Ctx, size: number) => void): THREE.CanvasTexture {
  let tex = glyphs.get(key);
  if (tex) return tex;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  draw(c.getContext("2d") as Ctx, 128);
  tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  glyphs.set(key, tex);
  return tex;
}

/** Scale for a marker that keeps its size on screen past 8 m (up to 26 m). */
function screenScale(sprite: THREE.Object3D, camera?: THREE.Camera) {
  if (!camera) return 1;
  const d = camera.position.distanceTo(sprite.getWorldPosition(_v));
  return Math.min(26, Math.max(8, d)) / 8;
}

/** "Z z z" drifting up and fading over someone asleep. Its time comes from update, so it is the same every run. */
export class SleepMarker {
  readonly object = new THREE.Group();
  private letters: THREE.Sprite[] = [];
  private readonly right = new THREE.Vector3();
  private readonly inv = new THREE.Matrix4();
  restY = 0;
  /** How far to the side of the head they start (half the name tag, when it shows). */
  side = 0;

  constructor() {
    const tex = glyph("z", (ctx, n) => {
      ctx.translate(n / 2, n / 2);
      ctx.font = `800 ${n * 0.8}px ${THEME.font}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = n * 0.09;
      ctx.strokeStyle = "rgba(4, 7, 11, 0.85)";
      ctx.strokeText("Z", 0, n * 0.04);
      ctx.fillStyle = "#e9f4ff";
      ctx.fillText("Z", 0, n * 0.04);
    });
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
      s.renderOrder = 11;
      this.letters.push(s);
      this.object.add(s);
    }
    this.object.visible = false;
  }

  set visible(on: boolean) { this.object.visible = on; }
  get visible() { return this.object.visible; }

  update(time: number, camera?: THREE.Camera) {
    if (!this.object.visible) return;
    const k = screenScale(this.object, camera);
    this.object.position.y = this.restY;
    // They drift up and off to the screen's right, clear of the name tag (`side` metres from the
    // middle at their scale, the tag's half width), whichever way the sleeper lies.
    const right = this.right.set(1, 0, 0);
    if (camera && this.object.parent) {
      right.setFromMatrixColumn(camera.matrixWorld, 0);
      this.inv.copy(this.object.parent.matrixWorld).invert();
      right.transformDirection(this.inv).setY(0);
      if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
      right.normalize();
    }
    const kk = Math.min(k, 2.2);
    this.letters.forEach((s, i) => {
      const u = (time / 2.7 + i / 3) % 1; // each rises over 2.7 s, a third apart
      const fade = Math.min(1, u / 0.15) * (1 - Math.max(0, (u - 0.7) / 0.3));
      s.material.opacity = fade;
      const size = (0.16 + 0.16 * u) * kk;
      s.scale.set(size, size, 1);
      const out = this.side + (0.08 + 0.2 * u + 0.05 * Math.sin(u * 9)) * kk;
      s.position.set(right.x * out, 0.05 + 0.5 * u * kk, right.z * out);
    });
  }

  dispose() {
    for (const s of this.letters) s.material.dispose();
    this.object.removeFromParent();
  }
}

/** A "!" that pops up over someone for a moment: their phone just buzzed. */
export class PopMarker {
  readonly sprite: THREE.Sprite;
  private age = -1;
  restY = 0;

  constructor(color: string = THEME.accent) {
    const tex = glyph(`pop:${color}`, (ctx, n) => {
      ctx.translate(n / 2, n / 2);
      ctx.shadowColor = color;
      ctx.shadowBlur = 16;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(0, 0, n * 0.36, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(4, 7, 11, 0.92)";
      ctx.fillRect(-n * 0.05, -n * 0.24, n * 0.1, n * 0.3);
      ctx.fillRect(-n * 0.05, n * 0.12, n * 0.1, n * 0.1);
    });
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
    this.sprite.center.set(0.5, 0);
    this.sprite.renderOrder = 12;
    this.sprite.visible = false;
  }

  /** Pop up now (it goes again after about a second). */
  pop() { this.age = 0; this.sprite.visible = true; }
  get showing() { return this.sprite.visible; }

  update(dt: number, camera?: THREE.Camera) {
    if (this.age < 0) return;
    this.age += dt;
    const a = this.age;
    if (a > 1.25) { this.age = -1; this.sprite.visible = false; return; }
    // Overshoot in, a wobble, then fade.
    const grow = a < 0.22 ? Math.sin((a / 0.22) * Math.PI * 0.62) * 1.25 : 1 + 0.12 * Math.exp(-(a - 0.22) * 8) * Math.cos((a - 0.22) * 30);
    this.sprite.material.opacity = 1 - Math.max(0, (a - 0.95) / 0.3);
    const s = 0.5 * grow * screenScale(this.sprite, camera);
    this.sprite.scale.set(s, s, 1);
    this.sprite.position.y = this.restY + 0.12 * Math.min(1, a / 0.2);
  }

  dispose() {
    this.sprite.material.dispose();
    this.sprite.removeFromParent();
  }
}

export function makeTextSprite(text: string, { font = 30, weight = 600, color = THEME.ink as string, bg = THEME.glassStrong as string | null, border = THEME.bracket as string, maxWidth = 420, worldScale = 0.0045 } = {}) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false }));
  sprite.center.set(0.5, 0);
  sprite.renderOrder = 10;
  const draw = () => {
    ctx.font = `${weight} ${font}px ${THEME.font}`;
    const lines = wrap(ctx, text, maxWidth, 5);
    const pad = font * 0.5, lineH = font * 1.25;
    canvas.width = Math.ceil(Math.max(...lines.map((l) => ctx.measureText(l).width)) + pad * 2);
    canvas.height = Math.ceil(lines.length * lineH + pad * 1.2);
    ctx.font = `${weight} ${font}px ${THEME.font}`;
    if (bg) {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (border !== "transparent") drawBrackets(ctx, 0, 0, canvas.width, canvas.height, { color: border, len: font * 0.45, width: Math.max(2, font / 13) });
    }
    ctx.fillStyle = color;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    lines.forEach((l, i) => ctx.fillText(l, canvas.width / 2, pad * 0.6 + lineH * (i + 0.5)));
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    sprite.material.map?.dispose();
    sprite.material.map = tex;
    sprite.material.needsUpdate = true;
    sprite.scale.set(canvas.width * worldScale, canvas.height * worldScale, 1);
  };
  draw();
  if (!fontsReady()) whenFontsLoad(() => sprite.parent && draw());
  return sprite;
}

let shadowTex: THREE.CanvasTexture | null = null;
/** A soft blob under someone, for places without real shadows. */
export function makeShadow(size = 1.1) {
  if (!shadowTex) {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const ctx = c.getContext("2d")!;
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(0,0,0,0.35)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    shadowTex = new THREE.CanvasTexture(c);
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 1;
  return m;
}

/** Frees an object's geometries, materials and their textures. */
export function disposeObject(obj: THREE.Object3D) {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) {
      (mat as THREE.MeshStandardMaterial).map?.dispose();
      mat.dispose();
    }
  });
}
