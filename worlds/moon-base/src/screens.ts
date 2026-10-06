// What screens show until the app paints them, and what the base's own screens show: lines of
// code in syntax colours, no words anywhere (the art's rule: abstract code only). Desk monitors,
// the console and the work hall's board are meshes named `screen:<id>`, each with its own
// material, so the app can set its map; the rig's and the hall's side screens are the base's own
// (`code:<id>`) and scroll slowly.

import * as THREE from "three";
import { screenMaterial } from "@offsite/kit";

function rng(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
}

const COLORS = ["#7cc4ff", "#c792ea", "#9be28f", "#f2c46d", "#d6e2f0", "#ff9a5c"];

/** Draws `rows` lines of code-like dashes into g, starting at line `from`. */
function codeLines(g: CanvasRenderingContext2D, w: number, h: number, seed: number, from = 0) {
  g.fillStyle = "#0b1622";
  g.fillRect(0, 0, w, h);
  g.fillStyle = "#11233a";
  g.fillRect(0, 0, w * 0.18, h);
  g.fillStyle = "#e8742a";
  g.fillRect(0, 0, w, h * 0.05);
  const line = h / 18;
  for (let i = 0; i < 17; i++) {
    const r = rng(seed * 131 + ((i + from) % 997) + 7);
    g.fillStyle = "#244766";
    g.fillRect(w * 0.03, h * 0.08 + i * line, w * 0.04 + r() * w * 0.08, line * 0.4);
    let x = w * 0.22 + Math.floor(r() * 4) * w * 0.035;
    for (let k = 0; k < 4 && x < w * 0.95; k++) {
      const seg = w * (0.035 + r() * 0.14);
      g.fillStyle = COLORS[Math.floor(r() * COLORS.length)]!;
      g.fillRect(x, h * 0.08 + i * line, seg, line * 0.42);
      x += seg + w * 0.016;
    }
  }
}

function canvasTexture(w: number, h: number): { tex: THREE.CanvasTexture; g: CanvasRenderingContext2D } {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { tex, g: c.getContext("2d")! };
}

let still: THREE.CanvasTexture | null = null;
/** One still frame of code, shared by every screen the app hasn't painted yet. */
export function codeTexture(): THREE.CanvasTexture {
  if (still) return still;
  const { tex, g } = canvasTexture(512, 300);
  codeLines(g, 512, 300, 11);
  return (still = tex);
}

/** A screen of code that scrolls a line every so often (the base's own screens). */
export function scrollingCode(seed: number): { texture: THREE.CanvasTexture; update(t: number): void; dispose(): void } {
  const { tex, g } = canvasTexture(384, 224);
  let at = -1;
  return {
    texture: tex,
    update(t) {
      const line = Math.floor(t / 1.7 + seed);
      if (line === at) return;
      at = line;
      codeLines(g, 384, 224, seed, line);
      tex.needsUpdate = true;
    },
    dispose() { tex.dispose(); },
  };
}

/** A screen mesh: a plane facing +z in its own frame, `w` by `h`, named for whoever paints it. */
export function screenMesh(name: string, w: number, h: number, map: THREE.Texture, brightness = 1.25): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), screenMaterial(new THREE.Color(brightness, brightness, brightness), map));
  mesh.name = name;
  return mesh;
}

export function disposeStill() { still?.dispose(); still = null; }
