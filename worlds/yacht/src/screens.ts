// What screens show until the app paints them: a dark editor with lines of code for the desks,
// the ship's computer's console for the helm, a status board for the office's wall. Each screen
// is its own mesh named `screen:<id>` with its own material, so the app can set `material.map`.

import * as THREE from "three";
import { screenMaterial } from "@offsite/kit";

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function rng(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
}

let desk: THREE.CanvasTexture | null = null;
/** A code editor, dark blue, with a sidebar and syntax-coloured lines. */
export function deskScreenTexture(): THREE.CanvasTexture {
  if (desk) return desk;
  return (desk = canvasTexture(512, 300, (g) => {
    const r = rng(11);
    g.fillStyle = "#0d1b2e";
    g.fillRect(0, 0, 512, 300);
    g.fillStyle = "#132842";
    g.fillRect(0, 0, 110, 300);
    g.fillStyle = "#1e4f86";
    g.fillRect(0, 0, 512, 18);
    for (let i = 0; i < 14; i++) {
      g.fillStyle = i === 3 ? "#2f7fd6" : "#3b5b80";
      g.fillRect(12, 30 + i * 18, 40 + r() * 50, 7);
    }
    const colors = ["#7cc4ff", "#c792ea", "#9be28f", "#f2c46d", "#d6e2f0"];
    for (let i = 0; i < 15; i++) {
      let x = 128 + Math.floor(r() * 4) * 18;
      for (let k = 0; k < 4 && x < 490; k++) {
        const w = 18 + r() * 70;
        g.fillStyle = colors[Math.floor(r() * colors.length)]!;
        g.fillRect(x, 30 + i * 17, w, 7);
        x += w + 8;
      }
    }
    g.fillStyle = "#1a3a5e";
    g.fillRect(110, 272, 402, 28);
    g.fillStyle = "#4fd1ff";
    g.fillRect(122, 282, 120, 7);
  }));
}

/** The ship's computer at the helm: a conversation, a plan, the crew. */
export function helmScreenTexture(): THREE.CanvasTexture {
  return canvasTexture(1024, 440, (g) => {
    g.fillStyle = "#08121f";
    g.fillRect(0, 0, 1024, 440);
    g.fillStyle = "#0f2238";
    g.fillRect(0, 0, 260, 440);
    g.fillStyle = "#4fd1ff";
    g.font = "600 30px Saira, system-ui, sans-serif";
    g.fillText("SHIP'S COMPUTER", 290, 52);
    g.fillStyle = "#7d97b5";
    g.font = "20px Saira, system-ui, sans-serif";
    g.fillText("Walk up and press E", 290, 84);
    const r = rng(5);
    for (let i = 0; i < 9; i++) {
      g.fillStyle = i === 1 ? "#1f5fa3" : "#16314f";
      g.fillRect(18, 28 + i * 44, 224, 34);
      g.fillStyle = "#9cc8ef";
      g.fillRect(30, 40 + i * 44, 80 + r() * 100, 9);
    }
    for (let i = 0; i < 6; i++) {
      const mine = i % 2 === 1;
      g.fillStyle = mine ? "#1d6fd1" : "#1a2b40";
      const w = 300 + r() * 280;
      g.fillRect(mine ? 990 - w : 290, 118 + i * 50, w, 36);
    }
    g.fillStyle = "#132a44";
    g.fillRect(290, 400, 700, 30);
  });
}

/** The office's wall board: the crew and what they're on. */
export function wallScreenTexture(): THREE.CanvasTexture {
  return canvasTexture(1024, 400, (g) => {
    g.fillStyle = "#07111d";
    g.fillRect(0, 0, 1024, 400);
    g.fillStyle = "#4fd1ff";
    g.font = "700 46px Saira, system-ui, sans-serif";
    g.fillText("OFFSITE", 40, 70);
    g.fillStyle = "#6f8cab";
    g.font = "24px Saira, system-ui, sans-serif";
    g.fillText("all hands on deck", 250, 68);
    const r = rng(9);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) {
      const x = 40 + j * 245, y = 110 + i * 92;
      g.fillStyle = "#10233a";
      g.fillRect(x, y, 225, 76);
      g.fillStyle = ["#4fd1ff", "#9be28f", "#f2c46d"][Math.floor(r() * 3)]!;
      g.beginPath();
      g.arc(x + 32, y + 38, 18, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#a9c2dc";
      g.fillRect(x + 62, y + 24, 90 + r() * 60, 10);
      g.fillStyle = "#4a6886";
      g.fillRect(x + 62, y + 46, 60 + r() * 80, 8);
    }
  });
}

/** A screen mesh: a plane facing +z in its own frame, `w` by `h`, named for the app to find. */
export function screen(id: string, w: number, h: number, map: THREE.Texture, brightness = 1.25): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), screenMaterial(new THREE.Color(brightness, brightness, brightness), map));
  mesh.name = `screen:${id}`;
  mesh.userData.screen = id;
  return mesh;
}
