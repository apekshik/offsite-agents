// Uniforms every water, glow and spray shader shares, so one call a frame (Daylight.apply)
// lights them all to match the sky. Objects, not copies: a material that lists these sees
// every change.

import * as THREE from "three";

export const LIGHT = {
  uTime: { value: 0 }, // seconds, the world's own clock (waves, ripples, caustics)
  uNight: { value: 0 }, // 0 by day, 1 at night: deck lights and lit windows come up
  uSkyTop: { value: new THREE.Color("#2f80dc") },
  uSkyHorizon: { value: new THREE.Color("#b6daf6") },
  uSkyGlow: { value: new THREE.Color("#fff3dc") },
  uSkyGlowAmt: { value: 0 },
  uSkyBelow: { value: new THREE.Color("#d6e7f3") }, // the dome under the horizon
  uSun: { value: new THREE.Color("#fff3dc") }, // the glint's color and strength
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uFog: { value: new THREE.Color("#d6e7f3") },
  uFogNear: { value: 300 },
  uFogFar: { value: 2600 },
  uTint: { value: new THREE.Color(1, 1, 1) }, // how much light there is, for unlit shaders
};

// One small tileable texture, baked once, that the water shaders sample instead of computing
// noise per pixel:
//   R, G  ripple slope (gradient of smooth noise), 0.5 = flat
//   B     foam bubbles: distance to the nearest bubble centre relative to its radius, so
//         `value > grow` means "still foam" for any bubble size
//   A     caustics: a web of bright lines (cell walls of a warped Voronoi)
// Adapted from Ready Player One (github.com/apekshik/ready-player-one), waternoise.js.

const SIZE = 256;

function rng(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
}

type Pt = [number, number, number];
function cellPoints(n: number, seed: number, jitter = 0.8): Pt[] {
  const r = rng(seed), pts: Pt[] = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) pts.push([(i + 0.5 + (r() - 0.5) * jitter) / n, (j + 0.5 + (r() - 0.5) * jitter) / n, r()]);
  return pts;
}

// Nearest and second-nearest point distances at (u, v) on the torus (in cell units).
function nearest2(pts: Pt[], n: number, u: number, v: number): [number, number, number] {
  const ci = Math.floor(u * n), cj = Math.floor(v * n);
  let d1 = 9, d2 = 9, w1 = 0;
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    const i = (ci + di + n) % n, j = (cj + dj + n) % n, p = pts[j * n + i]!;
    let dx = p[0] - u, dy = p[1] - v;
    dx -= Math.round(dx); dy -= Math.round(dy);
    const d = Math.hypot(dx, dy) * n;
    if (d < d1) { d2 = d1; d1 = d; w1 = p[2]; } else if (d < d2) d2 = d;
  }
  return [d1, d2, w1];
}

// Smooth periodic value noise and its gradient.
function valueNoise(n: number, seed: number) {
  const r = rng(seed), g = Array.from({ length: n * n }, r);
  const at = (i: number, j: number) => g[(((j % n) + n) % n) * n + (((i % n) + n) % n)]!;
  return (u: number, v: number): [number, number] => {
    const x = u * n, y = v * n, i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), dsx = 6 * fx * (1 - fx), dsy = 6 * fy * (1 - fy);
    const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1);
    return [dsx * (b - a + (a - b - c + d) * sy), dsy * (c - a + (a - b - c + d) * sx)];
  };
}

function buildNoiseData(): Uint8Array {
  const data = new Uint8Array(SIZE * SIZE * 4);
  const ripple = valueNoise(16, 11), ripple2 = valueNoise(32, 23);
  const bubbles = cellPoints(14, 5), caustA = cellPoints(9, 17), warp = valueNoise(6, 31), warp2 = valueNoise(6, 37);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const u = (x + 0.5) / SIZE, v = (y + 0.5) / SIZE, k = (y * SIZE + x) * 4;
    const [g1x, g1y] = ripple(u, v), [g2x, g2y] = ripple2(u, v);
    data[k] = Math.round(255 * Math.min(1, Math.max(0, 0.5 + (g1x + g2x * 0.5) * 0.12)));
    data[k + 1] = Math.round(255 * Math.min(1, Math.max(0, 0.5 + (g1y + g2y * 0.5) * 0.12)));
    // Bubble radius varies per cell (0.18..0.5 of a cell); store distance / radius.
    const [b1, , bw] = nearest2(bubbles, 14, u, v);
    data[k + 2] = Math.round(255 * Math.min(1, b1 / (0.18 + 0.32 * bw) / 2.5));
    // Caustics: walls of a Voronoi on gently warped coordinates.
    const [wx] = warp(u, v), [wy] = warp2(u, v);
    const [c1, c2] = nearest2(caustA, 9, (u + wx * 0.012 + 1) % 1, (v + wy * 0.012 + 1) % 1);
    data[k + 3] = Math.round(255 * Math.max(0, 1 - (c2 - c1) / 0.16));
  }
  return data;
}

let noise: THREE.DataTexture | null = null;
export function waterNoise(): THREE.DataTexture {
  if (noise) return noise;
  const tex = (noise = new THREE.DataTexture(buildNoiseData(), SIZE, SIZE, THREE.RGBAFormat));
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

// GLSL shared by the water shaders: foam as a sheet full of round holes. As the foam thins
// (amount falls) bubbles "grow" past each point and only a lacy web is left.
export const FOAM_GLSL = /* glsl */ `
  uniform sampler2D uNoise;
  vec4 tn(vec2 uv) { return texture2D(uNoise, uv); }
  float holes(vec2 uv, float grow) { return smoothstep(grow - 0.14, grow + 0.06, tn(uv).b * 2.5); }
  float foamMask(vec2 p, float amount, float near) {
    if (amount < 0.02) return 0.0;
    p += (tn(p * 0.038).rg - 0.5) * 3.6; // warp the bubbles so they don't tile
    float grow = 1.75 - amount * 1.55;
    float f = holes(p * 0.114, grow);
    if (near > 0.0) f *= mix(1.0, holes(p * 0.31 + 0.37, grow * 0.9), near); // fine bubbles up close
    f *= smoothstep(0.05, 0.3, amount + 0.45 * (tn(p * 0.02 + 0.5).b - 0.5));
    return f * smoothstep(0.02, 0.2, amount);
  }`;
