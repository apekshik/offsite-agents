// The small things that make the ship feel alive, and lit after dark, each one draw call or so:
//   halos        navigation lights (red to port, green to starboard, white on the mast and the
//                stern), the strobe on the mast, the helideck's perimeter: glow sprites that read
//                from a long way off, each lit by its own rule (always, at night, when busy…)
//   string lights catenaries of warm bulbs over the sun deck
//   light pools  the warm circles the deck lights throw on the teak at night
//   steam        off the hot tub and the sauna's stove; a puff from the coffee machine now and then
//   the name     OFFSITE on both sides aft, lit at night, and on the transom
//   drapes       white curtains that sway a touch
//   flags        on the mast's yardarm, streaming aft and snapping with the ship's speed

import * as THREE from "three";
import { Collision, LIGHT, canvas, patch } from "@offsite/kit";
import { D1, D2, D3, D4, D5, LD, PLATFORM, STERN_DOOR, TRANSOM, halfBeam } from "./dims.ts";
import { BUSY } from "./mats.ts";
import type { Drape, Halo, Ship } from "./parts.ts";

/** Wind over the decks, from the ship's speed (1 at the usual 7.5 m/s): flags and drapes use it. */
export const WIND = { value: 1 };

// ---------- halos ----------

const MODES = { always: 0, night: 1, pad: 2, strobe: 3, blink: 4 } as const;

export function halos(list: Halo[]): THREE.Points {
  const pos: number[] = [], col: number[] = [], size: number[] = [], mode: number[] = [];
  const c = new THREE.Color();
  for (const h of list) {
    pos.push(h.x, h.y, h.z);
    c.set(h.color);
    col.push(c.r, c.g, c.b);
    size.push(h.size);
    mode.push(MODES[h.mode]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aColor", new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute("aSize", new THREE.Float32BufferAttribute(size, 1));
  g.setAttribute("aMode", new THREE.Float32BufferAttribute(mode, 1));
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: LIGHT.uTime, uNight: LIGHT.uNight, uBusy: BUSY, uScale: { value: 900 } },
    vertexShader: /* glsl */ `
      attribute vec3 aColor; attribute float aSize, aMode;
      uniform float uTime, uNight, uBusy, uScale;
      varying vec3 vColor; varying float vOn;
      void main() {
        float on = 1.0;
        if (aMode > 0.5 && aMode < 1.5) on = uNight;
        else if (aMode > 1.5 && aMode < 2.5) on = clamp(max(-0.15 + 1.15 * uBusy, 0.8 * uNight), 0.0, 1.0);
        else if (aMode > 2.5 && aMode < 3.5) { float f = fract(uTime / 1.5); on = (step(f, 0.04) + step(0.12, f) * step(f, 0.16)) * (0.35 + 0.65 * uNight); }
        else if (aMode > 3.5) on = step(0.5, fract(uTime / 1.6 + position.x * 0.13)) * (0.4 + 0.6 * uNight);
        vOn = on;
        vColor = aColor;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = on < 0.01 ? 0.0 : clamp(aSize * uScale / -mv.z, 2.0, 90.0) * (0.6 + 0.4 * uNight);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor; varying float vOn;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        float core = smoothstep(0.22, 0.0, r), glow = exp(-r * 3.2) * (1.0 - r);
        float a = (core * 3.0 + glow * 0.9) * vOn;
        if (a < 0.002) discard;
        gl_FragColor = vec4(vColor * a, 1.0);
      }`,
  });
  const pts = new THREE.Points(g, m);
  pts.name = "halos";
  pts.frustumCulled = false;
  pts.renderOrder = 5;
  // The glow's size follows the canvas: a point's size is in pixels.
  pts.onBeforeRender = (r) => { m.uniforms.uScale!.value = r.getDrawingBufferSize(_v2).y * 0.9; };
  return pts;
}
const _v2 = new THREE.Vector2();

// ---------- string lights ----------

/** Warm bulbs on wires slung between points: [from, to, sag]. */
export function stringLights(spans: [THREE.Vector3, THREE.Vector3, number][], every = 0.55): { bulbs: THREE.InstancedMesh; wire: THREE.LineSegments; at: THREE.Vector3[] } {
  const at: THREE.Vector3[] = [], wire: number[] = [];
  for (const [a, b, sag] of spans) {
    const n = Math.max(2, Math.round(a.distanceTo(b) / every));
    let prev: THREE.Vector3 | null = null;
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const p = a.clone().lerp(b, u);
      p.y -= sag * 4 * u * (1 - u);
      if (prev) wire.push(prev.x, prev.y, prev.z, p.x, p.y, p.z);
      if (i > 0 && i < n) at.push(p.clone().setY(p.y - 0.07));
      prev = p;
    }
  }
  const mat = new THREE.MeshBasicMaterial({ color: "#ffffff" });
  patch(mat, "bulbs", (sh) => {
    sh.uniforms.uNight = LIGHT.uNight;
    sh.uniforms.uTime = LIGHT.uTime;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying float vK;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvK = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uNight, uTime; varying float vK;")
      .replace("#include <color_fragment>", `#include <color_fragment>
        float tw = 0.85 + 0.15 * sin(uTime * (1.5 + vK * 2.0) + vK * 40.0);
        diffuseColor.rgb = mix(vec3(0.85, 0.82, 0.75), vec3(1.0, 0.72, 0.38) * 4.5 * tw, uNight);`);
  });
  const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.05, 8, 6), mat, at.length);
  const m = new THREE.Matrix4();
  at.forEach((p, i) => bulbs.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z)));
  bulbs.name = "string-lights";
  bulbs.computeBoundingSphere();
  const lg = new THREE.BufferGeometry();
  lg.setAttribute("position", new THREE.Float32BufferAttribute(wire, 3));
  const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: "#2a2a2a" }));
  lines.name = "string-wire";
  return { bulbs, wire: lines, at };
}

// ---------- pools of light on the decks ----------

/** Soft warm circles on the floor under each lamp, after dark. Floors are found with the colliders. */
export function lightPools(lamps: { x: number; y: number; z: number; r: number; k?: number }[], colliders: THREE.Object3D[], floors: number[]): THREE.InstancedMesh {
  const col = new Collision().add(...colliders).build();
  const spots: [number, number, number, number, number][] = [];
  for (const l of lamps) {
    const f = col.floorBelow(l.x, l.y - 0.3, l.z, 8);
    // Only on a deck: never on a table top or a lounger, where a flat disc would float.
    if (f === null || !floors.some((y) => Math.abs(y - f) < 0.06)) continue;
    const h = l.y - f;
    if (h < 1.2) continue;
    spots.push([l.x, f + 0.018, l.z, THREE.MathUtils.clamp(h * 0.55, 1.1, 2.3) * (l.r / 1.6), l.k ?? 1]);
  }
  const geo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    uniforms: { uNight: LIGHT.uNight },
    vertexShader: "attribute float aK; varying float vK; varying vec2 vUv; void main(){ vK = aK; vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0); }",
    fragmentShader: /* glsl */ `
      uniform float uNight; varying vec2 vUv; varying float vK;
      void main() {
        float r = length(vUv);
        float a = (exp(-r * r * 3.2) * 0.85 + smoothstep(1.0, 0.0, r) * 0.15) * smoothstep(1.0, 0.85, r) * uNight;
        if (a < 0.003) discard;
        gl_FragColor = vec4(vec3(1.0, 0.72, 0.42) * a * 0.42 * vK, 1.0);
      }`,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, spots.length));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  spots.forEach(([x, y, z, r], i) => mesh.setMatrixAt(i, m.compose(p.set(x, y, z), q, s.set(r, 1, r))));
  geo.setAttribute("aK", new THREE.InstancedBufferAttribute(new Float32Array(spots.map((sp) => sp[4])), 1));
  mesh.count = spots.length;
  mesh.name = "light-pools";
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  return mesh;
}

// ---------- steam ----------

export interface SteamSource {
  at: THREE.Vector3;
  /** Spread at the source (m). */
  r: number;
  count: number;
  /** Seconds a wisp lives, how far it rises, how big it grows, how dense it is. */
  life: number; rise: number; size: number; alpha: number;
  /** Puffs every this many seconds (0: a steady plume). */
  every?: number;
}

export function steam(sources: SteamSource[]): THREE.Mesh {
  const n = sources.reduce((a, s) => a + s.count, 0);
  const geo = new THREE.InstancedBufferGeometry();
  const quad = new THREE.PlaneGeometry(1, 1);
  geo.index = quad.index;
  geo.setAttribute("position", quad.getAttribute("position"));
  const seeds = new Float32Array(n * 4), src = new Float32Array(n);
  let k = 0, sd = 99;
  const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
  sources.forEach((s, i) => { for (let j = 0; j < s.count; j++, k++) { for (let c = 0; c < 4; c++) seeds[k * 4 + c] = rnd(); src[k] = i; } });
  geo.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 4));
  geo.setAttribute("aSrc", new THREE.InstancedBufferAttribute(src, 1));
  geo.instanceCount = n;
  const N = sources.length;
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, premultipliedAlpha: true,
    uniforms: {
      uTime: LIGHT.uTime, uTint: LIGHT.uTint, uNight: LIGHT.uNight,
      uAt: { value: sources.map((s) => new THREE.Vector4(s.at.x, s.at.y, s.at.z, s.r)) },
      uP: { value: sources.map((s) => new THREE.Vector4(s.life, s.rise, s.size, s.alpha)) },
      uEvery: { value: sources.map((s) => s.every ?? 0) },
    },
    vertexShader: /* glsl */ `
      #define N ${N}
      attribute vec4 aSeed; attribute float aSrc;
      uniform float uTime; uniform vec4 uAt[N], uP[N]; uniform float uEvery[N];
      varying float vA; varying vec2 vUv; varying vec4 vSeed;
      void main() {
        int i = int(aSrc + 0.5);
        vec4 at = uAt[i], P = uP[i];
        float life = P.x * (0.7 + 0.6 * aSeed.y);
        float age = fract(uTime / life + aSeed.x) * life, t = age / life;
        float on = 1.0;
        if (uEvery[i] > 0.0) {
          // A puff: only the wisps let go in the first moments of each beat show.
          float born = uTime - age;
          on = step(fract(born / uEvery[i]), 0.12);
        }
        float a = aSeed.z * 6.2832, rr = sqrt(aSeed.w) * at.w;
        vec3 p = at.xyz + vec3(cos(a) * rr, 0.0, sin(a) * rr);
        p.y += P.y * (t + 0.35 * t * t);
        p.x += sin(uTime * 0.7 + aSeed.x * 20.0) * 0.25 * t + 0.6 * t * t; // drifting aft, curling
        p.z += cos(uTime * 0.6 + aSeed.y * 20.0) * 0.25 * t + 1.6 * t * t;
        float size = P.z * (0.35 + 1.1 * t);
        vA = P.w * on * smoothstep(0.0, 0.15, t) * (1.0 - t) * (1.0 - t);
        vec4 mv = viewMatrix * vec4(p, 1.0);
        mv.xy += position.xy * size;
        gl_Position = projectionMatrix * mv;
        vUv = position.xy + 0.5;
        vSeed = aSeed;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTint; uniform float uNight;
      varying float vA; varying vec2 vUv; varying vec4 vSeed;
      void main() {
        vec2 c = vUv - 0.5;
        float r = length(c) * 2.0;
        float a = smoothstep(1.0, 0.0, r) * vA * (0.75 + 0.25 * sin(vSeed.x * 30.0 + c.x * 6.0));
        if (a < 0.002) discard;
        vec3 col = vec3(0.92, 0.94, 0.96) * (uTint * 1.1 + 0.08 + uNight * 0.12);
        gl_FragColor = vec4(col * a, a);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "steam";
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  return mesh;
}

// ---------- the name ----------

function nameTexture(text: string, w: number, h: number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, w, h);
  g.fillStyle = "#ffffff";
  g.textAlign = "center";
  g.textBaseline = "middle";
  const size = h * 0.78;
  g.font = `600 ${size}px Saira, "Helvetica Neue", Arial, sans-serif`;
  // Spaced out, as names on yachts are.
  const spacing = size * 0.32;
  const widths = [...text].map((ch) => g.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * (text.length - 1);
  const scale = Math.min(1, (w * 0.96) / total);
  g.save();
  g.translate(w / 2, h / 2);
  g.scale(scale, 1);
  let x = -total / 2;
  [...text].forEach((ch, i) => { g.fillText(ch, x + widths[i]! / 2, 0); x += widths[i]! + spacing; });
  g.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Letters on the hull: dark navy by day, glowing white by night. */
function nameMaterial(text: string, aspect: number): THREE.MeshStandardMaterial {
  const tex = nameTexture(text, 1024, Math.round(1024 / aspect));
  const m = new THREE.MeshStandardMaterial({ color: "#16264a", roughness: 0.25, metalness: 0.2, alphaMap: tex, alphaTest: 0.45, emissive: "#fff6e8", emissiveMap: tex, emissiveIntensity: 2.2 });
  return patch(m, "name", (sh) => {
    sh.uniforms.uNight = LIGHT.uNight;
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uNight;")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance *= 0.02 + 0.98 * uNight;");
  }) as THREE.MeshStandardMaterial;
}

export function shipName(): THREE.Group {
  const g = new THREE.Group();
  g.name = "ship-name";
  // Down each side aft, above the beach club's windows.
  const z0 = 51.6, z1 = 59.6, y = 4.42, h = 0.78, len = z1 - z0;
  const sideMat = nameMaterial("OFFSITE", len / h);
  for (const sx of [1, -1]) {
    const a = halfBeam(z0, y), b = halfBeam(z1, y);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(len, h), sideMat);
    m.position.set(sx * ((a + b) / 2 + 0.045), y, (z0 + z1) / 2);
    m.rotation.y = sx * (Math.PI / 2 + Math.atan2(a - b, len));
    g.add(m);
  }
  // On the transom, over the beach club's doorways: the name to port, the home port to starboard.
  const D = STERN_DOOR;
  for (const [sx, text, w] of [[-1, "OFFSITE", 4.8], [1, "LOCALHOST", 5.2]] as const) {
    const hh = 0.5;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, hh), nameMaterial(text, w / hh));
    m.position.set(sx * (D.x0 + D.x1) / 2, D.top + 0.62, TRANSOM + 0.025);
    g.add(m);
  }
  return g;
}

// ---------- drapes ----------

let drapeMat: THREE.MeshStandardMaterial | null = null;
function drapeMaterial(): THREE.MeshStandardMaterial {
  if (drapeMat) return drapeMat;
  const m = canvas("#faf8f2", { side: THREE.DoubleSide });
  return (drapeMat = patch(m, "drape", (sh) => {
    sh.uniforms.uTime = LIGHT.uTime;
    sh.uniforms.uWind = WIND;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime, uWind; attribute float aHang;")
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        {
          // aHang: 0 at the rod, 1 at the hem. The hem swings most, in a slow breeze.
          float k = aHang * aHang;
          float ph = position.x * 0.9 + position.z * 0.7;
          float sw = sin(uTime * 1.1 + ph) * 0.6 + sin(uTime * 2.3 + ph * 1.7) * 0.25;
          transformed += objectNormal * sw * k * 0.09 * (0.5 + 0.5 * uWind);
        }`);
  }) as THREE.MeshStandardMaterial);
}

/** A gathered curtain: pleats down its width, from y1 (the rod) to y0. */
export function drape(d: Drape): THREE.Mesh {
  const NX = 14, NY = 10;
  const pos: number[] = [], hang: number[] = [], index: number[] = [];
  for (let j = 0; j <= NY; j++) for (let i = 0; i <= NX; i++) {
    const u = i / NX, v = j / NY;
    const along = (u - 0.5) * d.w * (1 - 0.25 * v * v);
    const fold = Math.sin(u * Math.PI * 7) * 0.07;
    const y = d.y1 - (d.y1 - d.y0) * v;
    if (d.axis === "x") pos.push(d.x + along, y, d.z + fold);
    else pos.push(d.x + fold, y, d.z + along);
    hang.push(v);
  }
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const a = j * (NX + 1) + i, b = a + 1, c = a + NX + 1, e = c + 1;
    index.push(a, c, b, b, c, e);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aHang", new THREE.Float32BufferAttribute(hang, 1));
  g.setIndex(index);
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, drapeMaterial());
  mesh.name = "drape";
  mesh.castShadow = true;
  return mesh;
}

// ---------- flags ----------

/** A flag on a halyard: its hoist at the origin, flying along +z, fluttering with the wind. */
export function flag(w: number, h: number, draw: (g: CanvasRenderingContext2D, W: number, H: number) => void): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(w, h, 12, 4).rotateY(-Math.PI / 2).translate(0, -h / 2, w / 2);
  const c = document.createElement("canvas");
  c.width = 128; c.height = Math.round((128 * h) / w);
  draw(c.getContext("2d")!, c.width, c.height);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, side: THREE.DoubleSide });
  patch(mat, `flag`, (sh) => {
    sh.uniforms.uTime = LIGHT.uTime;
    sh.uniforms.uWind = WIND;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", `#include <common>\nuniform float uTime, uWind;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        float k = clamp(position.z / ${w.toFixed(2)}, 0.0, 1.0);
        float sp = 0.6 + 0.6 * uWind;
        transformed.x += sin(position.z * ${(5.5 / w).toFixed(2)} - uTime * 9.0 * sp) * 0.1 * ${w.toFixed(2)} * k;
        transformed.y += sin(position.z * ${(3.2 / w).toFixed(2)} - uTime * 6.0 * sp) * 0.03 * ${w.toFixed(2)} * k - 0.06 * ${w.toFixed(2)} * k * k / sp;`);
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.name = "flag";
  return mesh;
}

// ---------- putting it together ----------

export interface Life {
  objects: THREE.Object3D[];
  dispose(): void;
}

/** Where the mast's top is, and its yardarm's ends (bridge.ts). */
export interface Mast { z: number; top: number; yardY: number; yardX: number; yardZ: number }

export function buildLife(s: Ship, colliders: THREE.Object3D[], mast: Mast): Life {
  const { z: mastZ, top: mastTop } = mast;
  const objects: THREE.Object3D[] = [];

  // String lights over the sun deck: along both rails from the canopy deck's edge, and crossing.
  const front = (x: number) => new THREE.Vector3(x, D4 + 1.0, 15.25);
  const pole = (x: number, z: number) => new THREE.Vector3(x, D3 + 3.55, z);
  const poles: [number, number][] = [[-10.75, 24.5], [10.75, 24.5], [-10.75, 34.5], [10.75, 34.5], [-9.4, 44.0], [10.2, 41.5]];
  for (const [x, z] of poles) {
    s.pile.rod("chrome", new THREE.Vector3(x, D3, z), new THREE.Vector3(x, D3 + 3.6, z), 0.035, 8);
    s.pile.cyl("chrome", x, D3 + 3.6, z, 0.06, 0.06, 8);
  }
  const P = (i: number) => pole(poles[i]![0], poles[i]![1]);
  const lights = stringLights([
    [front(-10.6), P(0), 0.45], [front(10.6), P(1), 0.45],
    [P(0), P(2), 0.45], [P(1), P(3), 0.45], [P(2), P(4), 0.4], [P(3), P(5), 0.4],
    [P(0), P(3), 0.75], [P(1), P(2), 0.75],
    [front(-3.5), P(0), 0.6], [front(3.5), P(1), 0.6],
  ]);
  objects.push(lights.bulbs, lights.wire);
  for (const p of lights.at) s.halos.push({ x: p.x, y: p.y, z: p.z, color: "#ffb766", size: 0.32, mode: "night" });
  // Their glow on the deck below, every few bulbs.
  lights.at.forEach((p, i) => { if (i % 5 === 0) s.lights.push({ x: p.x, y: p.y, z: p.z, r: 1.5, k: 0.4 }); });

  // Navigation lights: sidelights on the bridge wings, the masthead light, the stern light, the strobe.
  for (const [sx, color] of [[-1, "#ff2a1e"], [1, "#22ff5a"]] as const) {
    s.pile.box("white", sx * 8.05, D4 + 0.95, -28.0, sx * 8.4, D4 + 1.3, -27.2);
    s.pile.box("navLight", sx * 8.4, D4 + 1.0, -28.0, sx * 8.42, D4 + 1.25, -27.25);
    s.halos.push({ x: sx * 8.47, y: D4 + 1.12, z: -27.6, color, size: 1.1, mode: "night" });
  }
  s.halos.push({ x: 0, y: mastTop + 0.12, z: mastZ, color: "#fff4e0", size: 1.2, mode: "night" });
  s.halos.push({ x: 0, y: mastTop + 0.75, z: mastZ, color: "#ffffff", size: 2.4, mode: "strobe" });
  s.halos.push({ x: 0, y: D3 + 1.15, z: 48.25, color: "#fff4e0", size: 0.9, mode: "night" });
  s.pile.box("navLight", -0.07, D3 + 1.08, 48.12, 0.07, D3 + 1.22, 48.22);
  objects.push(halos(s.halos));

  // Pools of light on the decks under their lamps.
  objects.push(lightPools(s.lights, colliders, [LD, D1, D2, D3, D4, D5, PLATFORM.y]));

  // Steam: off the hot tub, the sauna's stones, and the coffee machine now and then.
  const sources: SteamSource[] = [{ at: new THREE.Vector3(-6.0, D3 + 0.76, 42.6), r: 1.25, count: 150, life: 4.2, rise: 1.6, size: 0.9, alpha: 0.11 }];
  if (s.sauna) sources.push({ at: s.sauna, r: 0.25, count: 50, life: 3.0, rise: 1.3, size: 0.55, alpha: 0.12 });
  if (s.coffee) sources.push({ at: s.coffee, r: 0.04, count: 40, life: 1.6, rise: 0.5, size: 0.16, alpha: 0.35, every: 7 });
  objects.push(steam(sources));

  // The name, lit at night.
  objects.push(shipName());

  // Drapes: at the beach club's doorway, and gathered at the canopy deck's corner posts.
  for (const sx of [-1, 1]) for (const z of [-18.2, 12.2]) s.drapes.push({ x: sx * 9.25, z, y0: D4 + 0.06, y1: D4 + 3.25, w: 0.75, axis: "z" });
  for (const d of s.drapes) objects.push(drape(d));

  // Flags on the yardarm: a burgee to starboard, signal flags to port.
  const burgee = flag(1.0, 0.6, (g, W, H) => {
    g.fillStyle = "#1f3f78"; g.fillRect(0, 0, W, H);
    g.fillStyle = "#4fd1ff"; g.beginPath(); g.moveTo(0, 0); g.lineTo(W, H / 2); g.lineTo(0, H); g.closePath(); g.fill();
    g.fillStyle = "#f4f2ec"; g.font = `700 ${H * 0.45}px sans-serif`; g.fillText("O", W * 0.12, H * 0.66);
  });
  burgee.position.set(mast.yardX, mast.yardY, mast.yardZ);
  objects.push(burgee);
  const signals = ["#e8b52c", "#b8322a", "#f4f2ec"];
  signals.forEach((c, i) => {
    const f = flag(0.62, 0.42, (g, W, H) => { g.fillStyle = c; g.fillRect(0, 0, W, H); g.fillStyle = i === 2 ? "#1f3f78" : "#f4f2ec"; g.fillRect(W * 0.35, 0, W * 0.3, H); });
    f.position.set(-mast.yardX, mast.yardY - i * 0.5, mast.yardZ);
    objects.push(f);
  });

  return {
    objects,
    dispose() {
      for (const o of objects) o.traverse((x) => {
        const m = x as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mm = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mm)) mm.forEach((q) => q.dispose()); else mm?.dispose();
      });
      drapeMat = null;
    },
  };
}

