// Adapted from Ready Player One (github.com/apekshik/ready-player-one).
//
// The sky. The day turns (morning, afternoon, golden hour, sunset, blue hour, night, dawn) off a
// shared clock, so everyone aboard sees the same sky. One dome shader draws it all: the gradient
// and sunset glow, sun, moon and stars, billowing cumulus that drift, grow and dissolve, and thin
// cirrus wisps high above them. The clouds take their light from the sun, or the moon at night.

import * as THREE from "three";

export const DAY_MINUTES = 30; // one full day, in real minutes

// Real minutes into the cycle -> hour of the day. Golden hour, sunset and dawn are stretched so
// the good light lasts; the dead of night goes quickly.
const DAY_TRACK: [number, number][] = [[0, 8], [10, 16.5], [17, 19.8], [19.5, 21.3], [25.5, 27.8], [30, 32]];

export function hourAt(ms: number, dayMinutes = DAY_MINUTES): number {
  const m = ((((ms / 60000) % dayMinutes) + dayMinutes) % dayMinutes) * (DAY_MINUTES / dayMinutes);
  for (let i = 1; i < DAY_TRACK.length; i++) {
    const [m1, h1] = DAY_TRACK[i]!;
    if (m > m1) continue;
    const [m0, h0] = DAY_TRACK[i - 1]!;
    return (h0 + ((h1 - h0) * (m - m0)) / (m1 - m0)) % 24;
  }
  return 8;
}

export function formatHour(h: number): string {
  const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

// Where the sun and moon are: a summer day at ~41°N. `turn` spins the whole sky about the
// vertical, so a world can choose where the sun sets (0: over -x, a little toward -z).
const LAT = 0.72, SUN_DECL = 0.36, MOON_DECL = -0.22;
function celestial(out: THREE.Vector3, hourAngle: number, decl: number, turn: number): THREE.Vector3 {
  const e = -Math.cos(decl) * Math.sin(hourAngle);
  const u = Math.sin(LAT) * Math.sin(decl) + Math.cos(LAT) * Math.cos(decl) * Math.cos(hourAngle);
  const s = -(Math.cos(LAT) * Math.sin(decl) - Math.sin(LAT) * Math.cos(decl) * Math.cos(hourAngle));
  return out.set(e * Math.cos(turn) - s * Math.sin(turn), u, e * Math.sin(turn) + s * Math.cos(turn)).normalize();
}

// The look of the sky, keyed by the sun's height (sin of its elevation). `light` is the sun's
// own color and strength; at night the moon takes over.
interface Key {
  e: number;
  top: string; horizon: string; fog: string; glow: string; glowAmt: number;
  light: string; lightI: number; hemiSky: string; hemiGround: string; hemiI: number;
  cloudLit: string; cloudShade: string; stars: number; env: number;
}
const KEYS: Key[] = [
  // Night: a deep blue moonlit sky, not black, so a ship (and its white hull) still reads on film.
  { e: -0.32, top: "#04102c", horizon: "#16284e", fog: "#122142", glow: "#1c2c52", glowAmt: 0.0, light: "#ffffff", lightI: 0, hemiSky: "#6c86c4", hemiGround: "#202a3c", hemiI: 0.8, cloudLit: "#26365c", cloudShade: "#070c18", stars: 1, env: 0.3 },
  { e: -0.16, top: "#0c1c44", horizon: "#2f4276", fog: "#2a3a64", glow: "#3e3e78", glowAmt: 0.35, light: "#ffffff", lightI: 0, hemiSky: "#7488c6", hemiGround: "#262a38", hemiI: 0.74, cloudLit: "#40446e", cloudShade: "#11152c", stars: 0.8, env: 0.3 },
  { e: -0.05, top: "#1e3370", horizon: "#b06c84", fog: "#6e6488", glow: "#ff7a52", glowAmt: 0.7, light: "#ff9a5a", lightI: 0, hemiSky: "#9a94c8", hemiGround: "#3c3a48", hemiI: 0.74, cloudLit: "#e07e82", cloudShade: "#3a3560", stars: 0.15, env: 0.32 },
  { e: 0.03, top: "#3360a6", horizon: "#ff9c55", fog: "#e0a888", glow: "#ff6a1f", glowAmt: 1.0, light: "#ff8c3c", lightI: 1.7, hemiSky: "#c4b6d6", hemiGround: "#5d6070", hemiI: 0.86, cloudLit: "#ffae6a", cloudShade: "#6c5674", stars: 0, env: 0.45 },
  { e: 0.13, top: "#3471c4", horizon: "#f8c487", fog: "#ead2b6", glow: "#ffa860", glowAmt: 0.75, light: "#ffc77e", lightI: 2.7, hemiSky: "#d0def2", hemiGround: "#6f7c8a", hemiI: 1.0, cloudLit: "#fff0da", cloudShade: "#8f90a6", stars: 0, env: 0.6 },
  { e: 0.32, top: "#2f80dc", horizon: "#b6daf6", fog: "#d6e7f3", glow: "#fff3dc", glowAmt: 0.15, light: "#fff3dc", lightI: 3.1, hemiSky: "#d9ecff", hemiGround: "#7b8c99", hemiI: 1.15, cloudLit: "#ffffff", cloudShade: "#a3b3c6", stars: 0, env: 0.7 },
  { e: 0.9, top: "#2a78d6", horizon: "#b2d8f6", fog: "#d4e6f3", glow: "#fff6e6", glowAmt: 0.1, light: "#fff6e6", lightI: 3.2, hemiSky: "#dbeeff", hemiGround: "#7f909c", hemiI: 1.18, cloudLit: "#ffffff", cloudShade: "#a8b8ca", stars: 0, env: 0.72 },
];

/** The sky's palette at one moment: colors and amounts the rest of the world lights itself by. */
export interface SkyPalette {
  top: THREE.Color; horizon: THREE.Color; fog: THREE.Color; glow: THREE.Color; glowAmt: number;
  light: THREE.Color; lightI: number; hemiSky: THREE.Color; hemiGround: THREE.Color; hemiI: number;
  cloudLit: THREE.Color; cloudShade: THREE.Color; stars: number; env: number;
}
const COLOR_KEYS = ["top", "horizon", "fog", "glow", "light", "hemiSky", "hemiGround", "cloudLit", "cloudShade"] as const;
const NUMBER_KEYS = ["glowAmt", "lightI", "hemiI", "stars", "env"] as const;
const PALETTE = KEYS.map((k) => {
  const p = { e: k.e } as SkyPalette & { e: number };
  for (const n of COLOR_KEYS) p[n] = new THREE.Color(k[n]);
  for (const n of NUMBER_KEYS) p[n] = k[n];
  return p;
});

function emptyPalette(): SkyPalette {
  const p = {} as SkyPalette;
  for (const n of COLOR_KEYS) p[n] = new THREE.Color();
  for (const n of NUMBER_KEYS) p[n] = 0;
  return p;
}

function samplePalette(out: SkyPalette, e: number): SkyPalette {
  let i = 1;
  while (i < PALETTE.length - 1 && e > PALETTE[i]!.e) i++;
  const a = PALETTE[i - 1]!, b = PALETTE[i]!;
  let t = THREE.MathUtils.clamp((e - a.e) / (b.e - a.e), 0, 1);
  t = t * t * (3 - 2 * t);
  for (const n of COLOR_KEYS) out[n].copy(a[n]).lerp(b[n], t);
  for (const n of NUMBER_KEYS) out[n] = a[n] + (b[n] - a[n]) * t;
  return out;
}

// 256² noise with the next z-slice in the green channel, offset by (37, 17), so one texture
// fetch gives smooth 3D value noise (after Inigo Quilez).
function noiseTexture(): THREE.DataTexture {
  const N = 256, base = new Uint8Array(N * N), data = new Uint8Array(N * N * 4);
  let seed = 7;
  for (let i = 0; i < base.length; i++) base[i] = ((seed = (seed * 16807) % 2147483647) / 2147483647) * 255;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = (y * N + x) * 4;
    data[i] = base[y * N + x]!;
    data[i + 1] = base[((y - 17) & 255) * N + ((x - 37) & 255)]!;
    data[i + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, N, N);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

const FRAG = /* glsl */ `
  uniform sampler2D uNoise;
  uniform float uTime, uGlowAmt, uStars, uMoonAmt, uSunAmt, uCoverage, uCirrus;
  uniform vec3 uTop, uHorizon, uBelow, uGlow, uSunCol, uSunDir, uMoonDir, uMoonCol;
  uniform vec3 uCloudLit, uCloudShade, uLightDir, uLightCol;
  uniform vec2 uWind;
  uniform mat3 uStarRot;
  varying vec3 vDir;

  float n3(vec3 x) {
    vec3 p = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    vec2 uv = p.xy + vec2(37.0, 17.0) * p.z + f.xy;
    vec2 rg = texture2D(uNoise, (uv + 0.5) / 256.0).yx;
    return mix(rg.x, rg.y, f.z);
  }
  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }

  // Cumulus: drifting, slowly boiling fbm, warped so the edges curl, gathered into separate
  // clouds by a broad mask. Fewer octaves near the horizon, where detail can't show.
  float cumulus(vec2 p, int oct) {
    vec3 q = vec3((p + uWind) * 0.0019, uTime * 0.006);
    float mask = n3(vec3(q.xy * 0.23 + 11.0, uTime * 0.002));
    q.xy += (vec2(n3(q * 0.55), n3(q * 0.55 + vec3(5.2, 1.3, 2.7))) - 0.5) * 1.1;
    float n = 0.0, a = 0.55;
    for (int i = 0; i < 6; i++) {
      if (i >= oct) break;
      n += a * n3(q);
      q = q * 2.07 + vec3(0.0, 0.0, uTime * 0.012);
      a *= 0.48;
    }
    float th = mix(0.66, 0.4, uCoverage) - mask * 0.16;
    return smoothstep(th, th + 0.17, n);
  }

  // Cirrus: long thin strands, stretched along the wind and combed by a warp.
  float cirrus(vec2 p) {
    vec2 q = (p + uWind * 1.8) * 0.00045;
    q = mat2(0.86, -0.5, 0.5, 0.86) * q * vec2(1.0, 3.2);
    vec3 r = vec3(q, uTime * 0.004);
    r.xy += (vec2(n3(r * 0.45), n3(r * 0.45 + 7.7)) - 0.5) * 3.0;
    r.xy += (vec2(n3(r * 1.6 + 3.0), n3(r * 1.6 + 1.1)) - 0.5) * 0.6;
    float n = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) {
      n += a * (1.0 - abs(n3(r) * 2.0 - 1.0));
      r = r * vec3(2.1, 2.4, 1.0) + 1.7;
      a *= 0.5;
    }
    float mask = smoothstep(0.35, 0.8, n3(vec3(p * 0.00018 + uWind * 0.0001, 3.0)));
    return smoothstep(0.6, 0.95, n) * mask;
  }

  float hg(float mu, float g) {
    float g2 = g * g;
    return (1.0 - g2) / (12.566 * pow(1.0 + g2 - 2.0 * g * mu, 1.5));
  }

  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;

    // Base gradient, with the warm glow banked up on the sun's side of the horizon.
    vec3 col = h > 0.0 ? mix(uHorizon, uTop, pow(smoothstep(0.0, 0.62, h), 0.75)) : mix(uHorizon, uBelow, smoothstep(0.0, -0.18, h));
    vec2 sh = normalize(uSunDir.xz + 1e-5);
    float side = dot(normalize(d.xz + 1e-5), sh) * 0.5 + 0.5;
    float band = exp(-abs(h - max(uSunDir.y, -0.02) * 0.6) * 7.0);
    col = mix(col, uGlow, clamp(uGlowAmt * band * pow(side, 3.0) * 0.9, 0.0, 1.0));
    col = mix(col, uGlow, uGlowAmt * 0.12 * exp(-abs(h) * 12.0));

    // Stars, turning with the night, thinning toward the horizon.
    if (uStars > 0.01 && h > 0.0) {
      vec3 sd = uStarRot * d;
      float s = 0.0;
      for (int l = 0; l < 2; l++) {
        float sc = l == 0 ? 210.0 : 95.0;
        vec3 p = sd * sc, c = floor(p), f = fract(p);
        float r = hash13(c + float(l) * 17.0);
        if (r > (l == 0 ? 0.91 : 0.975)) {
          vec3 at = vec3(hash13(c + 1.7), hash13(c + 4.1), hash13(c + 9.3)) * 0.7 + 0.15;
          float tw = 0.65 + 0.35 * sin(uTime * (1.5 + r * 4.0) + r * 80.0);
          s += smoothstep(l == 0 ? 0.15 : 0.12, 0.0, length(f - at)) * (l == 0 ? 2.4 : 4.5) * tw;
        }
      }
      col += vec3(0.85, 0.9, 1.0) * s * uStars * smoothstep(0.0, 0.3, h);
    }

    // Sun and moon.
    float mu = dot(d, uSunDir);
    col += uSunCol * uSunAmt * (smoothstep(0.99955, 0.99975, mu) * 14.0 + pow(max(mu, 0.0), 260.0) * 0.6 + pow(max(mu, 0.0), 14.0) * 0.22);
    float mm = dot(d, uMoonDir);
    if (uMoonAmt > 0.01) {
      vec3 rel = (d - uMoonDir * mm) * 900.0;
      float maria = n3(rel * 0.9 + 40.0) * 0.6 + n3(rel * 2.3 + 9.0) * 0.4;
      float disc = smoothstep(0.99958, 0.99972, mm);
      col = mix(col, uMoonCol * (1.15 - maria * 0.45), disc * uMoonAmt);
      col += uMoonCol * uMoonAmt * (pow(max(mm, 0.0), 900.0) * 0.5 + pow(max(mm, 0.0), 40.0) * 0.12);
    }

    if (h > 0.0) {
      float lmu = dot(d, uLightDir);
      vec2 lstep = uLightDir.xz / max(uLightDir.y, 0.15);
      float near = smoothstep(0.012, 0.12, h);

      // Cirrus first: it's higher, so the cumulus pass over it.
      vec2 pc = cameraPosition.xz + d.xz * (1700.0 - cameraPosition.y) / h;
      float ci = cirrus(pc) * uCirrus * near * smoothstep(0.03, 0.2, h);
      vec3 cc = mix(uCloudLit, uLightCol, 0.25) * (0.95 + hg(lmu, 0.6) * 1.5);
      col = mix(col, mix(cc, uHorizon, 0.25), ci * 0.6);

      // Cumulus layer.
      float camY = min(cameraPosition.y, 500.0);
      vec2 p = cameraPosition.xz + d.xz * (620.0 - camY) / h;
      float dens = cumulus(p, h < 0.1 ? 4 : 6);
      if (dens > 0.002) {
        // Probe toward the light for self-shadowing: thick heads, dark bellies.
        float od = cumulus(p + lstep * 55.0, 3) + cumulus(p + lstep * 150.0, 3) * 0.7;
        float lit = exp(-od * 1.25);
        float powder = 1.0 - exp(-dens * 3.0);
        vec3 c = mix(uCloudShade, uCloudLit, clamp(lit * (0.55 + 0.45 * powder) + 0.12, 0.0, 1.0));
        // Silver lining where thin edges face the light.
        c += uLightCol * (hg(lmu, 0.72) * 2.2 + 0.05) * (1.0 - dens) * lit;
        c *= 1.0 - 0.18 * dens * (1.0 - lit);
        c = mix(c, uHorizon, smoothstep(0.3, 0.0, h) * 0.55);
        col = mix(col, c, smoothstep(0.0, 0.4, dens) * near);
      }
    }

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

/** Everything the rest of the world needs to light itself to match the sky. */
export interface SkyState {
  hour: number;
  sunDir: THREE.Vector3;
  moonDir: THREE.Vector3;
  /** The sun by day, the moon by night; kept a little above the horizon so shadows stay finite. */
  lightDir: THREE.Vector3;
  lightColor: THREE.Color;
  lightIntensity: number;
  /** The glint on water: the sun's color by day, the moon's by night. */
  specColor: THREE.Color;
  specDir: THREE.Vector3;
  /** 0 by day, 1 at night. */
  night: number;
  p: SkyPalette;
}

export interface SkyOptions {
  /** Real minutes in one full day (default 30). */
  dayMinutes?: number;
  /** Turns the sky about the vertical (radians): where the sun rises and sets. */
  turn?: number;
  /** Radius of the dome before it is fitted inside the camera's far plane. */
  radius?: number;
}

export interface Sky {
  dome: THREE.Mesh;
  /** A second dome on the same material, for scenes rendered apart (the environment probe). */
  makeDome(): THREE.Mesh;
  state: SkyState;
  uniforms: Record<string, THREE.IUniform>;
  /** t: local seconds (twinkle, cloud boil); clockMs: the shared wall clock. */
  update(t: number, clockMs: number): SkyState;
  /** Hold the sky at an hour (0..24), or null to hand it back to the clock. */
  setHour(h: number | null): void;
  /** Hold the hour where it is now (true), or let the clock run again (false). */
  freeze(on: boolean): void;
  /** Cloud cover 0..1, or null for the weather to wander. */
  setCover(c: number | null): void;
  dispose(): void;
}

export function createSky({ dayMinutes = DAY_MINUTES, turn = 0, radius = 1200 }: SkyOptions = {}): Sky {
  const u: Record<string, THREE.IUniform> = {
    uNoise: { value: noiseTexture() },
    uTime: { value: 0 },
    uWind: { value: new THREE.Vector2() },
    uCoverage: { value: 0.5 },
    uCirrus: { value: 0.6 },
    uTop: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uBelow: { value: new THREE.Color() },
    uGlow: { value: new THREE.Color() },
    uGlowAmt: { value: 0 },
    uSunCol: { value: new THREE.Color() },
    uSunAmt: { value: 1 },
    uSunDir: { value: new THREE.Vector3() },
    uMoonCol: { value: new THREE.Color("#e8eefc") },
    uMoonDir: { value: new THREE.Vector3() },
    uMoonAmt: { value: 0 },
    uStars: { value: 0 },
    uStarRot: { value: new THREE.Matrix3() },
    uCloudLit: { value: new THREE.Color() },
    uCloudShade: { value: new THREE.Color() },
    uLightDir: { value: new THREE.Vector3() },
    uLightCol: { value: new THREE.Color() },
  };
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: u,
    vertexShader: "varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: FRAG,
  });
  const geo = new THREE.SphereGeometry(radius, 48, 24);
  const makeDome = () => {
    const dome = new THREE.Mesh(geo, mat);
    dome.name = "sky";
    dome.frustumCulled = false;
    dome.renderOrder = -1;
    dome.castShadow = dome.receiveShadow = false;
    // Stay centred on whoever is looking, so the sky is always at infinity, and inside their far plane.
    const at = new THREE.Vector3();
    dome.onBeforeRender = (_r, _s, cam) => {
      const far = (cam as THREE.PerspectiveCamera).far ?? 2600;
      const k = Math.min(1, (far * 0.9) / radius);
      at.setFromMatrixPosition(cam.matrixWorld);
      if (dome.position.equals(at) && dome.scale.x === k) return;
      dome.position.copy(at);
      dome.scale.setScalar(k);
      dome.updateMatrixWorld();
      dome.modelViewMatrix.multiplyMatrices(cam.matrixWorldInverse, dome.matrixWorld);
    };
    return dome;
  };
  const dome = makeDome();

  const state: SkyState = {
    hour: 12,
    sunDir: new THREE.Vector3(),
    moonDir: new THREE.Vector3(),
    lightDir: new THREE.Vector3(),
    lightColor: new THREE.Color(),
    lightIntensity: 0,
    specColor: new THREE.Color(),
    specDir: new THREE.Vector3(),
    night: 0,
    p: emptyPalette(),
  };
  const moonLight = new THREE.Color("#9db4e6"), noonSun = new THREE.Color("#fff3dc"), _c = new THREE.Color();
  const rot = new THREE.Matrix4(), axis = new THREE.Vector3(0.3, 0.75, -0.5).normalize();
  const smooth = THREE.MathUtils.smoothstep;
  let override: number | null = null, cover: number | null = null;

  function update(t: number, clockMs: number): SkyState {
    const hour = override ?? hourAt(clockMs, dayMinutes);
    state.hour = hour;
    const H = ((hour - 12) / 24) * Math.PI * 2;
    celestial(state.sunDir, H, SUN_DECL, turn);
    celestial(state.moonDir, H + Math.PI * 0.94, MOON_DECL, turn);
    const e = state.sunDir.y, p = samplePalette(state.p, e);
    const night = smooth(-e, 0.02, 0.2);
    state.night = night;

    // The light: the sun until it's down, then the moon. Both are near zero around the
    // handover, so the switch doesn't pop.
    const moonUp = smooth(state.moonDir.y, 0.0, 0.2);
    if (e > -0.03) {
      state.lightDir.copy(state.sunDir);
      state.lightColor.copy(p.light);
      state.lightIntensity = p.lightI * smooth(e, -0.03, 0.06);
    } else {
      state.lightDir.copy(state.moonDir);
      state.lightColor.copy(moonLight);
      state.lightIntensity = 1.05 * night * moonUp;
    }
    // Keep shadows from stretching to infinity at the very low sun.
    if (state.lightDir.y < 0.12) state.lightDir.setY(0.12).normalize();
    state.specColor.copy(p.light).multiplyScalar(smooth(e, -0.02, 0.03))
      .add(_c.copy(moonLight).multiplyScalar(0.85 * night * moonUp));
    state.specDir.copy(e > -0.03 ? state.sunDir : state.moonDir);

    // Weather: the cloud cover wanders between clear spells and big skies.
    const sec = (clockMs / 1000) % 86400;
    const cov = 0.2 + 0.12 * Math.sin(sec / 410) + 0.06 * Math.sin(sec / 157 + 1.3);
    u.uTime!.value = t;
    (u.uWind!.value as THREE.Vector2).set(sec * 7.5, sec * 2.6);
    u.uCoverage!.value = cover ?? THREE.MathUtils.clamp(cov, 0.05, 0.9);
    u.uCirrus!.value = 0.3 + 0.25 * Math.sin(sec / 530 + 2.0);
    (u.uTop!.value as THREE.Color).copy(p.top);
    (u.uHorizon!.value as THREE.Color).copy(p.horizon);
    (u.uBelow!.value as THREE.Color).copy(p.fog);
    (u.uGlow!.value as THREE.Color).copy(p.glow);
    u.uGlowAmt!.value = p.glowAmt;
    (u.uSunCol!.value as THREE.Color).copy(p.light).lerp(noonSun, smooth(e, 0.05, 0.3));
    u.uSunAmt!.value = smooth(e, -0.04, 0.0);
    (u.uSunDir!.value as THREE.Vector3).copy(state.sunDir);
    (u.uMoonDir!.value as THREE.Vector3).copy(state.moonDir);
    u.uMoonAmt!.value = 0.25 + 0.75 * night;
    u.uStars!.value = p.stars;
    (u.uStarRot!.value as THREE.Matrix3).setFromMatrix4(rot.makeRotationAxis(axis, -H));
    (u.uCloudLit!.value as THREE.Color).copy(p.cloudLit);
    (u.uCloudShade!.value as THREE.Color).copy(p.cloudShade);
    const ld = u.uLightDir!.value as THREE.Vector3;
    ld.copy(e > -0.03 ? state.sunDir : state.moonDir);
    if (ld.y < 0.02) ld.setY(0.02).normalize();
    (u.uLightCol!.value as THREE.Color).copy(e > -0.03 ? p.light : moonLight)
      .multiplyScalar(e > -0.03 ? 0.6 + 0.4 * smooth(e, -0.03, 0.1) : 0.35 * night);
    return state;
  }

  return {
    dome,
    makeDome,
    state,
    uniforms: u,
    update,
    setHour: (h) => { override = h == null ? null : ((h % 24) + 24) % 24; },
    freeze: (on) => { override = on ? state.hour : null; },
    setCover: (c) => { cover = c; },
    dispose: () => { geo.dispose(); mat.dispose(); (u.uNoise!.value as THREE.Texture).dispose(); },
  };
}
