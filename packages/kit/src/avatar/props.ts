// Things the crew hold: an open laptop whose screen shows code, the package they carry to the
// bridge, a fishing rod, the foldable phone, a drink. Each is a group with its origin where it
// rests (a laptop's underside, a rod's butt, a glass's base), and grips: where the palms go when
// it is held in two hands. The avatar places a prop and reaches for its grips (avatar.ts).

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { CodeScreen } from "./screen.ts";
import { THEME, drawBrackets } from "./labels.ts";

export type PropKind = "laptop" | "box" | "rod" | "phone" | "drink";

export interface Prop {
  readonly kind: PropKind;
  readonly object: THREE.Group;
  /** Palm targets for two hands, in no particular order (the avatar sorts them left and right). */
  readonly grips: THREE.Object3D[];
  update(dt: number, time: number): void;
  dispose(): void;
}

const std = (color: THREE.ColorRepresentation, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.05, ...extra });

function mesh(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  parent.add(m);
  return m;
}
function grip(parent: THREE.Object3D, x: number, y: number, z: number) {
  const g = new THREE.Object3D();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}
function disposeTree(o: THREE.Object3D) {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    m.geometry?.dispose();
    for (const mat of Array.isArray(m.material) ? m.material : m.material ? [m.material] : []) {
      (mat as THREE.MeshBasicMaterial).map?.dispose();
      mat.dispose();
    }
  });
}
const rand = (seed: number) => () => { seed = (seed * 16807 + 11) % 2147483647; return (seed % 10000) / 10000; };

// ---------- laptop ----------

let keysTex: THREE.CanvasTexture | null = null;
function keyboardTexture() {
  if (keysTex) return keysTex;
  const c = document.createElement("canvas");
  c.width = 256; c.height = 96;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#16181d";
  ctx.fillRect(0, 0, 256, 96);
  ctx.fillStyle = "#2c3038";
  const rows = [14, 14, 13, 12];
  rows.forEach((n, r) => {
    const w = 256 / 14.6;
    for (let i = 0; i < n; i++) ctx.fillRect(4 + i * w + r * 4, 4 + r * 18, w - 3, 15);
  });
  ctx.fillRect(60, 76, 130, 15); // space
  keysTex = new THREE.CanvasTexture(c);
  keysTex.colorSpace = THREE.SRGBColorSpace;
  return keysTex;
}

export const LAPTOP = { width: 0.32, depth: 0.22, thick: 0.016, lid: 0.21 } as const;

/** An open laptop. Origin: the middle of its underside; +z toward the hinge, the screen facing -z. */
export class Laptop implements Prop {
  readonly kind = "laptop" as const;
  readonly object = new THREE.Group();
  readonly grips: THREE.Object3D[];
  readonly screen: CodeScreen;
  readonly lid = new THREE.Group();
  private openAmt = 1;
  private want = 1;

  constructor({ seed = 0, color = "#c4c8cf" }: { seed?: number; color?: THREE.ColorRepresentation } = {}) {
    const { width: W, depth: D, thick: T, lid: Hl } = LAPTOP;
    const shell = std(color, { roughness: 0.38, metalness: 0.65 });
    mesh(this.object, new RoundedBoxGeometry(W, T, D, 2, 0.006), shell, 0, T / 2, 0);
    const keys = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.86, D * 0.44), new THREE.MeshStandardMaterial({ map: keyboardTexture(), roughness: 0.8 }));
    keys.rotation.x = -Math.PI / 2;
    keys.position.set(0, T + 0.0008, D * 0.18);
    this.object.add(keys);
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.06), std("#9da2aa", { roughness: 0.3, metalness: 0.5 }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(0, T + 0.0008, -D * 0.25);
    this.object.add(pad);
    // The lid, hinged at the back edge; open leans back a little past upright.
    this.lid.position.set(0, T, D / 2 - 0.004);
    this.object.add(this.lid);
    mesh(this.lid, new RoundedBoxGeometry(W, Hl, 0.007, 2, 0.003), shell, 0, Hl / 2, 0.0035);
    const bezel = mesh(this.lid, new THREE.PlaneGeometry(W - 0.008, Hl - 0.008), std("#07090c", { roughness: 0.3 }), 0, Hl / 2, -0.0002, 0, Math.PI, 0);
    bezel.castShadow = false;
    this.screen = new CodeScreen({ seed });
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.03, Hl - 0.035), new THREE.MeshBasicMaterial({ map: this.screen.texture, toneMapped: false }));
    glass.position.set(0, Hl / 2 + 0.004, -0.0006);
    glass.rotation.y = Math.PI;
    this.lid.add(glass);
    // Stickers on the back: everyone's laptop is a little different.
    const r = rand(seed * 977 + 13);
    const colors = ["#ff6b3d", "#4fe3ff", "#ffd23f", "#7dff6a", "#ff2bd6", "#b388ff", "#f4f1ff"];
    for (let i = 0; i < 3 + Math.floor(r() * 3); i++) {
      const round = r() > 0.5;
      const s = 0.025 + r() * 0.03;
      const geo = round ? new THREE.CircleGeometry(s / 2, 20) : new THREE.PlaneGeometry(s * (1 + r()), s);
      const st = mesh(this.lid, geo, std(colors[Math.floor(r() * colors.length)]!, { roughness: 0.5 }), (r() - 0.5) * W * 0.75, 0.03 + r() * (Hl - 0.06), 0.0072, 0, 0, (r() - 0.5) * 0.8);
      st.castShadow = false;
    }
    // Palms over the keys.
    this.grips = [grip(this.object, -0.068, T + 0.03, 0.0), grip(this.object, 0.068, T + 0.03, 0.0)];
    this.setLid();
  }

  /** Open or shut the lid (it swings over half a second). */
  setOpen(open: boolean) { this.want = open ? 1 : 0; }
  /** Show these lines on the screen. */
  write(lines: string[], title?: string) { this.screen.write(lines, title); }

  private setLid() { this.lid.rotation.x = THREE.MathUtils.lerp(-Math.PI / 2 + 0.02, 0.32, this.openAmt); }

  update(dt: number) {
    if (this.openAmt !== this.want) {
      this.openAmt = this.want > this.openAmt ? Math.min(1, this.openAmt + dt * 2.2) : Math.max(0, this.openAmt - dt * 2.2);
      this.setLid();
    }
    if (this.openAmt > 0.3) this.screen.update(dt);
  }

  dispose() { this.screen.dispose(); disposeTree(this.object); this.object.removeFromParent(); }
}

// ---------- package ----------

/** The finished work, boxed and taped, carried to the bridge. Origin: its centre. */
export class PackageBox implements Prop {
  readonly kind = "box" as const;
  readonly object = new THREE.Group();
  readonly grips: THREE.Object3D[];
  static readonly size = [0.38, 0.27, 0.3] as const;

  constructor({ color = "#c8955c", label = "" }: { color?: THREE.ColorRepresentation; label?: string } = {}) {
    const [W, H, D] = PackageBox.size;
    mesh(this.object, new RoundedBoxGeometry(W, H, D, 2, 0.012), std(color, { roughness: 0.92 }));
    const tape = std("#e3cfa2", { roughness: 0.4 });
    mesh(this.object, new THREE.BoxGeometry(0.07, H + 0.003, D + 0.003), tape);
    // A shipping label on the front, with a tick: it passed.
    const c = document.createElement("canvas");
    c.width = 128; c.height = 80;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#f4f2ec"; ctx.fillRect(0, 0, 128, 80);
    ctx.fillStyle = "#1c2230";
    for (let i = 0; i < 4; i++) ctx.fillRect(10, 12 + i * 12, 60 - i * 9, 5);
    ctx.strokeStyle = "#1aa86a"; ctx.lineWidth = 9; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(84, 42); ctx.lineTo(97, 56); ctx.lineTo(118, 22); ctx.stroke();
    if (label) { ctx.font = "600 11px sans-serif"; ctx.fillStyle = "#1c2230"; ctx.fillText(label.slice(0, 18), 10, 70); }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const tag = mesh(this.object, new THREE.PlaneGeometry(0.13, 0.08), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }), W * 0.24, -0.02, D / 2 + 0.002);
    tag.castShadow = false;
    // Palms flat on the sides, a little below the middle.
    this.grips = [grip(this.object, -W / 2 - 0.03, -0.03, 0.02), grip(this.object, W / 2 + 0.03, -0.03, 0.02)];
  }

  update() {}
  dispose() { disposeTree(this.object); this.object.removeFromParent(); }
}

// ---------- fishing rod ----------

/**
 * A rod with its line in the water. Origin: the butt; the rod runs up +y and bends a little
 * toward +z (hold it pitched forward and +z points down). Bites come now and then: the tip
 * twitches, then the angler strikes.
 */
export class FishingRod implements Prop {
  readonly kind = "rod" as const;
  readonly object = new THREE.Group();
  readonly grips: THREE.Object3D[];
  /** World height of the water the line goes down to. Null: 3 m below the tip. */
  water: number | null = null;
  private flex = new THREE.Group();
  private tip = new THREE.Object3D();
  private line: THREE.Line;
  private bobber = new THREE.Group();
  private next = 6 + Math.random() * 8;
  private biteT = -1;
  private _a = new THREE.Vector3();
  private _b = new THREE.Vector3();
  private _f = new THREE.Vector3();

  constructor() {
    this.object.add(this.flex);
    const cork = std("#b98a5a", { roughness: 0.95 });
    const blank = std("#20252e", { roughness: 0.35, metalness: 0.3 });
    const metal = std("#c9ced6", { roughness: 0.25, metalness: 0.9 });
    mesh(this.flex, new THREE.CylinderGeometry(0.017, 0.02, 0.38, 12), cork, 0, 0.19, 0);
    mesh(this.flex, new THREE.CylinderGeometry(0.012, 0.012, 0.06, 10), metal, 0, 0.41, 0);
    // The reel hangs under the rod (toward +z), just above the handle.
    const reel = new THREE.Group();
    reel.position.set(0, 0.33, 0.045);
    this.flex.add(reel);
    mesh(reel, new THREE.CylinderGeometry(0.035, 0.035, 0.03, 18), metal, 0, 0, 0, 0, 0, Math.PI / 2);
    mesh(reel, new THREE.BoxGeometry(0.01, 0.04, 0.035), blank, 0, 0, -0.025);
    mesh(reel, new THREE.CylinderGeometry(0.004, 0.004, 0.05, 6), metal, 0.03, 0.0, 0.0, 0, 0, Math.PI / 2);
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.42, 0), new THREE.Vector3(0, 1.0, 0.015), new THREE.Vector3(0, 1.6, 0.06), new THREE.Vector3(0, 2.05, 0.15),
    ]);
    const tube = new THREE.TubeGeometry(curve, 24, 0.007, 6, false);
    // Taper the blank toward the tip.
    const pos = tube.attributes["position"]!;
    const pts = curve.getSpacedPoints(24);
    for (let i = 0; i < pos.count; i++) {
      const ring = Math.floor(i / 7), c = pts[Math.min(ring, 24)]!, k = 1 - 0.75 * (ring / 24);
      pos.setXYZ(i, c.x + (pos.getX(i) - c.x) * k, c.y + (pos.getY(i) - c.y) * k, c.z + (pos.getZ(i) - c.z) * k);
    }
    tube.computeVertexNormals();
    mesh(this.flex, tube, blank);
    for (const t of [0.25, 0.45, 0.65, 0.85]) {
      const p = curve.getPointAt(t);
      mesh(this.flex, new THREE.TorusGeometry(0.009 - t * 0.004, 0.0015, 4, 10), metal, p.x, p.y, p.z + 0.012, Math.PI / 2, 0, 0);
    }
    this.tip.position.copy(curve.getPointAt(1));
    this.flex.add(this.tip);
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(12 * 3), 3));
    this.line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: "#e8eef4", transparent: true, opacity: 0.75 }));
    this.line.frustumCulled = false;
    this.object.add(this.line);
    mesh(this.bobber, new THREE.SphereGeometry(0.03, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), std("#ff4a3d"));
    mesh(this.bobber, new THREE.SphereGeometry(0.03, 12, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), std("#f6f6f2"));
    this.object.add(this.bobber);
    this.grips = [grip(this.flex, 0, 0.3, -0.02), grip(this.flex, 0, 0.06, -0.02)];
  }

  update(dt: number, time: number) {
    // Bites: a few twitches of the tip, then a strike, then the line settles.
    this.next -= dt;
    if (this.next <= 0 && this.biteT < 0) this.biteT = 0;
    let bend = 0.025 * Math.sin(time * 0.9);
    let dip = 0;
    if (this.biteT >= 0) {
      const b = (this.biteT += dt);
      if (b < 1.4) { const tw = Math.max(0, Math.sin(b * 14)) * 0.12; bend += tw; dip = tw * 0.6; }
      else if (b < 1.9) bend -= 0.3 * Math.sin(((b - 1.4) / 0.5) * Math.PI);
      else { this.biteT = -1; this.next = 9 + Math.random() * 14; }
    }
    this.flex.rotation.x = bend;
    // The line: from the tip, out a little and down to the water, sagging slightly.
    this.object.updateWorldMatrix(true, true);
    const a = this.tip.getWorldPosition(this._a);
    const f = this._f.set(0, 0, 1).applyQuaternion(this.object.getWorldQuaternion(new THREE.Quaternion())).setY(0);
    if (f.lengthSq() < 1e-6) f.set(0, 0, 1);
    f.normalize();
    const water = this.water ?? a.y - 3;
    const b = this._b.copy(a).addScaledVector(f, 0.9);
    b.y = water + 0.02 * Math.sin(time * 1.7) - dip;
    const arr = (this.line.geometry.attributes["position"] as THREE.BufferAttribute);
    const p = new THREE.Vector3();
    for (let i = 0; i < 12; i++) {
      const t = i / 11;
      p.lerpVectors(a, b, t);
      p.y -= Math.sin(t * Math.PI) * 0.12; // sag
      this.object.worldToLocal(p);
      arr.setXYZ(i, p.x, p.y, p.z);
    }
    arr.needsUpdate = true;
    this.bobber.position.copy(this.object.worldToLocal(b.clone()));
    this.bobber.quaternion.copy(this.object.getWorldQuaternion(new THREE.Quaternion()).invert());
  }

  dispose() { disposeTree(this.object); this.object.removeFromParent(); }
}

// ---------- the foldable phone ----------

/** Draws a phone screen: the ship's time, and who needs the captain. Swap it with FoldPhone.draw. */
export type PhoneDraw = (ctx: CanvasRenderingContext2D, w: number, h: number, which: "cover" | "inner") => void;

/** One half of the foldable (the cover screen's size): about 0.7 wide to 1 tall, so it opens to ~1.4:1, wider than tall. */
export const PHONE = { w: 0.088, h: 0.126, half: 0.0068 } as const;

function defaultPhoneScreen(ctx: CanvasRenderingContext2D, w: number, h: number, which: "cover" | "inner") {
  ctx.fillStyle = "#05070b";
  ctx.fillRect(0, 0, w, h);
  const grd = ctx.createRadialGradient(w * 0.3, h * 0.15, 0, w * 0.3, h * 0.15, h * 0.9);
  grd.addColorStop(0, "rgba(79, 227, 255, 0.22)");
  grd.addColorStop(1, "rgba(79, 227, 255, 0)");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, w, h);
  const now = new Date();
  const time = `${now.getHours()}:${String(now.getMinutes()).padStart(2, "0")}`;
  ctx.fillStyle = THEME.ink;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (which === "cover") {
    ctx.font = `600 ${w * 0.34}px ${THEME.font}`;
    ctx.fillText(time, w / 2, h * 0.22);
    ctx.font = `500 ${w * 0.09}px ${THEME.font}`;
    ctx.fillStyle = THEME.dim;
    ctx.fillText("OFFSITE", w / 2, h * 0.32);
    ctx.fillStyle = "rgba(4, 7, 11, 0.8)";
    ctx.fillRect(w * 0.1, h * 0.55, w * 0.8, h * 0.16);
    drawBrackets(ctx, w * 0.1, h * 0.55, w * 0.8, h * 0.16, { color: THEME.warn, len: w * 0.08, width: 3 });
    ctx.fillStyle = THEME.warn;
    ctx.font = `600 ${w * 0.1}px ${THEME.font}`;
    ctx.fillText("CREW ASKING", w / 2, h * 0.63);
    return;
  }
  // Inside: the computer's interface, two panes.
  ctx.textAlign = "left";
  ctx.font = `600 ${h * 0.035}px ${THEME.font}`;
  ctx.fillStyle = THEME.dim;
  ctx.fillText("THREADS", w * 0.05, h * 0.06);
  ctx.fillText(time, w * 0.86, h * 0.06);
  for (let i = 0; i < 6; i++) {
    const y = h * (0.12 + i * 0.12);
    ctx.fillStyle = i === 0 ? "rgba(79, 227, 255, 0.14)" : "rgba(238, 243, 247, 0.05)";
    ctx.fillRect(w * 0.04, y, w * 0.4, h * 0.1);
    ctx.fillStyle = i === 0 ? THEME.accent : THEME.faint;
    ctx.fillRect(w * 0.07, y + h * 0.03, w * (0.18 + ((i * 37) % 13) / 100), h * 0.016);
    ctx.fillRect(w * 0.07, y + h * 0.06, w * 0.12, h * 0.012);
  }
  for (let i = 0; i < 5; i++) {
    const mine = i % 2 === 1, bw = w * (0.22 + ((i * 53) % 17) / 100), y = h * (0.14 + i * 0.15);
    ctx.fillStyle = mine ? "rgba(79, 227, 255, 0.25)" : "rgba(238, 243, 247, 0.1)";
    ctx.fillRect(mine ? w * 0.96 - bw : w * 0.5, y, bw, h * 0.1);
  }
  drawBrackets(ctx, w * 0.02, h * 0.02, w * 0.96, h * 0.96, { color: THEME.bracket, len: w * 0.05, width: 3 });
}

/**
 * A foldable phone (think Galaxy Fold). Closed: a tall narrow slab with a cover screen. Open: a
 * near-square screen with a hinge down the middle. Origin: the middle of its back face, screen
 * facing +z, the top toward +y. Opening and closing swings the left half over half a second.
 */
export class FoldPhone implements Prop {
  readonly kind = "phone" as const;
  readonly object = new THREE.Group();
  readonly grips: THREE.Object3D[];
  /** Repaint both screens with this (called when the minute changes, or on refresh()). */
  draw: PhoneDraw = defaultPhoneScreen;
  private body = new THREE.Group();
  private leaf = new THREE.Group(); // the left half, swinging on the hinge
  private inner: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture };
  private cover: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture };
  private openAmt = 0;
  private want = 0;
  private minute = -1;

  constructor({ color = "#2a2e36", open = false }: { color?: THREE.ColorRepresentation; open?: boolean } = {}) {
    const { w, h, half: t } = PHONE;
    const shell = std(color, { roughness: 0.35, metalness: 0.6 });
    const make = (cw: number, ch: number) => {
      const canvas = document.createElement("canvas");
      canvas.width = cw; canvas.height = ch;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      return { canvas, tex };
    };
    this.inner = make(440, 512);
    this.cover = make(192, 440);
    this.object.add(this.body);
    // The right half stays put; the hinge runs up its left edge (x = 0).
    mesh(this.body, new RoundedBoxGeometry(w, h, t, 2, 0.003), shell, w / 2, 0, t / 2);
    const innerMat = (u0: number) => {
      const tex = this.inner.tex.clone();
      tex.repeat.set(0.5, 1);
      tex.offset.set(u0, 0);
      tex.needsUpdate = true;
      return new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    };
    const rightScreen = mesh(this.body, new THREE.PlaneGeometry(w - 0.004, h - 0.006), innerMat(0.5), w / 2 + 0.001, 0, t + 0.0004);
    rightScreen.castShadow = false;
    this.leaf.position.set(0, 0, t);
    this.body.add(this.leaf);
    mesh(this.leaf, new RoundedBoxGeometry(w, h, t, 2, 0.003), shell, -w / 2, 0, -t / 2);
    const leftScreen = mesh(this.leaf, new THREE.PlaneGeometry(w - 0.004, h - 0.006), innerMat(0), -w / 2 - 0.001, 0, 0.0004);
    leftScreen.castShadow = false;
    // The cover screen is on the outside of the left half: it faces you when the phone is shut.
    const coverScreen = mesh(this.leaf, new THREE.PlaneGeometry(w - 0.008, h - 0.012), new THREE.MeshBasicMaterial({ map: this.cover.tex, toneMapped: false }), -w / 2, 0, -t - 0.0004, 0, Math.PI, 0);
    coverScreen.castShadow = false;
    mesh(this.leaf, new THREE.CylinderGeometry(0.003, 0.003, 0.002, 10), std("#05060a"), -w / 2, h / 2 - 0.01, -t - 0.0006, Math.PI / 2, 0, 0); // camera
    this.grips = [grip(this.object, 0, 0, 0), grip(this.object, 0, 0, 0)];
    this.openAmt = this.want = open ? 1 : 0;
    this.refresh();
    this.layout();
  }

  get open() { return this.want === 1; }
  /** Unfold (true) or fold (false). */
  setOpen(open: boolean) { this.want = open ? 1 : 0; }

  /** Repaint the screens now. */
  refresh() {
    const ci = this.inner.canvas.getContext("2d")!, cc = this.cover.canvas.getContext("2d")!;
    this.draw(ci, this.inner.canvas.width, this.inner.canvas.height, "inner");
    this.draw(cc, this.cover.canvas.width, this.cover.canvas.height, "cover");
    this.inner.tex.needsUpdate = true;
    this.cover.tex.needsUpdate = true;
    // The two halves of the inside screen are clones sharing the canvas.
    this.body.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
      if (m?.map && m.map.image === this.inner.canvas) m.map.needsUpdate = true;
    });
  }

  private layout() {
    const { w, h, half: t } = PHONE;
    const e = this.openAmt * this.openAmt * (3 - 2 * this.openAmt);
    // Shut, the left half lies over the front of the right one.
    this.leaf.rotation.y = (1 - e) * Math.PI;
    // Keep it centred in the hands, open or shut.
    this.body.position.set(-w / 2 * (1 - e), 0, -t * (1 - e) * 0.5);
    const half = (w / 2) * (1 + e) + 0.022;
    this.grips[0]!.position.set(-half, -h * 0.18, t * 0.5);
    this.grips[1]!.position.set(half, -h * 0.18, t * 0.5);
  }

  update(dt: number) {
    if (this.openAmt !== this.want) {
      this.openAmt = this.want > this.openAmt ? Math.min(1, this.openAmt + dt * 2.4) : Math.max(0, this.openAmt - dt * 2.4);
      this.layout();
    }
    const m = new Date().getMinutes();
    if (m !== this.minute) { this.minute = m; this.refresh(); }
  }

  dispose() {
    this.inner.tex.dispose();
    this.cover.tex.dispose();
    disposeTree(this.object);
    this.object.removeFromParent();
  }
}

// ---------- drink ----------

/** Something cold with a straw and a paper umbrella. Origin: the base of the glass. */
export class Drink implements Prop {
  readonly kind = "drink" as const;
  readonly object = new THREE.Group();
  readonly grips: THREE.Object3D[] = [];

  constructor({ color = "#ff8a3d", seed = 0 }: { color?: THREE.ColorRepresentation; seed?: number } = {}) {
    const glass = new THREE.MeshStandardMaterial({ color: "#dff4ff", roughness: 0.05, metalness: 0, transparent: true, opacity: 0.32, depthWrite: false });
    const g = mesh(this.object, new THREE.CylinderGeometry(0.036, 0.03, 0.13, 18, 1, true), glass, 0, 0.065, 0);
    g.castShadow = false;
    g.renderOrder = 2;
    mesh(this.object, new THREE.CylinderGeometry(0.03, 0.03, 0.006, 18), glass, 0, 0.003, 0);
    mesh(this.object, new THREE.CylinderGeometry(0.033, 0.029, 0.1, 18), std(color, { roughness: 0.2, transparent: true, opacity: 0.88 }), 0, 0.055, 0);
    mesh(this.object, new THREE.CylinderGeometry(0.0035, 0.0035, 0.17, 6), std(["#ff2bd6", "#4fe3ff", "#ffffff"][seed % 3]!), 0.012, 0.11, 0, 0, 0, -0.2);
    mesh(this.object, new THREE.CylinderGeometry(0.025, 0.025, 0.006, 16), std("#ffe14d", { roughness: 0.5 }), -0.03, 0.125, 0, 0, 0, Math.PI / 2 - 0.3);
    const umb = new THREE.Group();
    umb.position.set(-0.01, 0.13, -0.012);
    umb.rotation.set(-0.35, 0, 0.3);
    this.object.add(umb);
    mesh(umb, new THREE.CylinderGeometry(0.0015, 0.0015, 0.09, 4), std("#f2e6c8"), 0, 0.045, 0);
    mesh(umb, new THREE.ConeGeometry(0.045, 0.022, 10, 1, true), std(["#ff5d8f", "#ffd23f", "#4fe3ff"][(seed + 1) % 3]!, { side: THREE.DoubleSide }), 0, 0.09, 0);
  }

  update() {}
  dispose() { disposeTree(this.object); this.object.removeFromParent(); }
}

export function makeProp(kind: PropKind, seed = 0): Prop {
  switch (kind) {
    case "laptop": return new Laptop({ seed });
    case "box": return new PackageBox();
    case "rod": return new FishingRod();
    case "phone": return new FoldPhone({ open: true });
    case "drink": return new Drink({ seed, color: ["#ff8a3d", "#ff5d8f", "#7ee0c6", "#ffd23f"][seed % 4]! });
  }
}
