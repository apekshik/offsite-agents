// The sky over the crater: black, no air to scatter anything, so the stars are out by day too.
// The sun is a hard white disc low in the east; Earth hangs north-east over the rim, a blue
// marble with drifting clouds and a thin rim of atmosphere. One dome shader draws it all.
//
// The day follows the hour like the yacht's (kit hourAt, a 30-minute day on the shared clock):
// the sun rises in the east-north-east, crosses low through the south and sets in the west; at
// night the sun is down and Earth lights the regolith a cold blue. The state it hands out has the
// same shape as the kit's SkyState, so the kit's daylight (the sun's cascaded shadows, fog and
// the shared uniforms) follows it unchanged.

import * as THREE from "three";
import { hourAt, type SkyPalette, type SkyState } from "@offsite/kit";
import { EARTH } from "./dims.ts";
import { deg } from "./kit.ts";

/** The light the base is usually seen in: a low sun in the east-south-east, long shadows across the crater. */
export const MOON_HOUR = 11.9;

const SUNRISE = 6, SUNSET = 20, PEAK = deg(22);

/** Map direction (unit vector) from an azimuth (clockwise from north, -z) and an elevation. */
export function skyDir(az: number, el: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
}

/** Where the sun is at an hour: azimuth and elevation (radians). */
export function sunAt(hour: number): { az: number; el: number } {
  const h = ((hour % 24) + 24) % 24;
  if (h >= SUNRISE && h <= SUNSET) {
    const f = (h - SUNRISE) / (SUNSET - SUNRISE);
    return { az: deg(80) + f * deg(200), el: PEAK * Math.sin(Math.PI * f) };
  }
  // Night: round under the north, back to where it rises.
  const n = ((h - SUNSET + 24) % 24) / (24 - (SUNSET - SUNRISE));
  return { az: deg(280) + n * deg(160), el: -deg(25) * Math.sin(Math.PI * n) };
}

const FRAG = /* glsl */ `
  uniform vec3 uSunDir, uEarthDir, uEarthLight;
  uniform float uEarthR, uTime, uSunUp;
  varying vec3 vDir;

  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }
  vec3 hash33(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.xxy + p.yxx) * p.zyx);
  }
  float vnoise(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + 11.7; a *= 0.5; }
    return s;
  }

  // Stars: one per cell of a grid on the sky, most of them faint, a few bright, a few tinted.
  vec3 starLayer(vec3 d, float scale, float keep, float gain) {
    vec3 p = d * scale, c = floor(p);
    vec3 h = hash33(c);
    if (h.x > keep) return vec3(0.0);
    vec3 star = c + 0.15 + 0.7 * hash33(c + 7.1);
    float r = length(p - star);
    float w = fwidth(r) * 1.2 + 0.02;
    float b = smoothstep(w, 0.0, r) * pow(h.y, 6.0) * gain;
    vec3 tint = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.85, 0.7), h.z);
    return tint * b;
  }

  void main() {
    vec3 d = normalize(vDir);
    vec3 col = vec3(0.0);
    // (The stars themselves are points: starField below.)
    // A faint band of the galaxy, tilted across the sky.
    vec3 axis = normalize(vec3(0.35, 0.55, 0.76));
    float band = exp(-pow(dot(d, axis) / 0.2, 2.0));
    col += vec3(0.42, 0.45, 0.6) * band * (0.012 + 0.03 * fbm(d * 6.0)) ;

    // The sun: a hard disc, a tight glare, no sky round it.
    float cs = dot(d, uSunDir);
    float disc = smoothstep(0.99996, 0.99999, cs);
    col += vec3(1.0, 0.97, 0.92) * (disc * 60.0 + pow(max(cs, 0.0), 1800.0) * 6.0 + pow(max(cs, 0.0), 90.0) * 0.06) * uSunUp;

    // Earth: a sphere seen from far off, lit nearly full face on, spinning slowly.
    float rho = sin(uEarthR);
    float b = dot(d, uEarthDir);
    float disc2 = b * b - (1.0 - rho * rho);
    float glow = 0.0;
    float off = acos(clamp(b, -1.0, 1.0)) - uEarthR;
    if (disc2 > 0.0) {
      float t = b - sqrt(disc2);
      vec3 n = (d * t - uEarthDir) / rho;
      // Into Earth's own frame: its axis tipped a little, turning about it.
      float s = uTime * 0.004, cs2 = cos(s), sn = sin(s);
      vec3 q = vec3(n.x * cs2 - n.z * sn, n.y, n.x * sn + n.z * cs2);
      float land = smoothstep(0.52, 0.56, fbm(q * 2.1 + vec3(3.1, 0.0, 1.7)));
      float lat = abs(q.y);
      vec3 ocean = mix(vec3(0.03, 0.14, 0.42), vec3(0.06, 0.26, 0.6), fbm(q * 5.0));
      vec3 ground = mix(vec3(0.16, 0.36, 0.12), vec3(0.55, 0.45, 0.28), smoothstep(0.35, 0.75, fbm(q * 6.0 + 5.0)));
      vec3 surf = mix(ocean, ground, land);
      surf = mix(surf, vec3(0.92), smoothstep(0.8, 0.88, lat));
      float cloud = smoothstep(0.5, 0.72, fbm(q * 3.4 + vec3(uTime * 0.002, 0.0, 0.0) + 9.0));
      surf = mix(surf, vec3(1.0), cloud * 0.85);
      float lit = max(dot(n, uEarthLight), 0.0);
      float day = smoothstep(-0.05, 0.25, dot(n, uEarthLight));
      vec3 shade = surf * (0.08 + 1.35 * lit);
      // City lights on the night side.
      shade += vec3(1.0, 0.7, 0.35) * land * (1.0 - day) * step(0.82, hash13(floor(q * 90.0))) * 0.35;
      // The atmosphere's rim, lit where the sun is.
      float rim = pow(1.0 - max(dot(n, -d), 0.0), 3.0);
      shade += vec3(0.35, 0.6, 1.0) * rim * (0.25 + 0.9 * day);
      // Antialias the limb.
      float edge = smoothstep(0.0, fwidth(off) * 1.5, -off);
      col = mix(col, shade, edge);
    }
    // A thin blue glow just outside the limb.
    glow = exp(-max(off, 0.0) / (uEarthR * 0.05)) * step(0.0, off);
    col += vec3(0.3, 0.55, 1.0) * glow * 0.35;

    // Below the horizon: the far side of the plain, in case anything shows through.
    col = mix(col, vec3(0.05, 0.05, 0.055), smoothstep(0.0, -0.04, d.y));
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

/**
 * The stars: a few thousand points on the sky, most faint, a few bright and tinted, thicker along
 * the galaxy's band. Crisp round dots a pixel or two across, the same at any resolution.
 */
function starField(radius: number): THREE.Points {
  const N = 4200;
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), size = new Float32Array(N);
  let s = 1234;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const axis = new THREE.Vector3(0.35, 0.55, 0.76).normalize(), v = new THREE.Vector3(), c = new THREE.Color();
  for (let i = 0; i < N; i++) {
    // Uniform on the sphere, a third of them pulled toward the band.
    v.set(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1);
    if (v.lengthSq() < 1e-4) v.set(0, 1, 0);
    v.normalize();
    if (i % 3 === 0) v.addScaledVector(axis, -v.dot(axis) * 0.85).normalize();
    pos.set([v.x * radius, v.y * radius, v.z * radius], i * 3);
    const b = Math.pow(rnd(), 4);
    c.setHSL(0.58 - 0.5 * rnd() * rnd(), 0.35 * rnd(), 0.55 + 0.45 * b);
    const k = 0.25 + 1.6 * b;
    col.set([c.r * k, c.g * k, c.b * k], i * 3);
    size[i] = 1.1 + 2.2 * b;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
  g.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    uniforms: { uPx: { value: 1 } },
    vertexShader: "attribute vec3 aColor; attribute float aSize; uniform float uPx; varying vec3 vC; void main(){ vC = aColor; gl_PointSize = aSize * uPx; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: "varying vec3 vC; void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.25, r); if (a < 0.01) discard; gl_FragColor = vec4(vC * a, 1.0); }",
  });
  const pts = new THREE.Points(g, m);
  pts.name = "stars";
  pts.frustumCulled = false;
  pts.renderOrder = -1;
  pts.onBeforeRender = (r) => { m.uniforms.uPx!.value = Math.max(1, r.getPixelRatio()); };
  return pts;
}

export interface MoonSky {
  dome: THREE.Mesh;
  /** A second dome on the same material, for the environment probe. */
  makeDome(): THREE.Mesh;
  state: SkyState;
  update(t: number, clockMs: number): SkyState;
  /** Hold the sky at an hour (0..24), or null to follow the shared clock. */
  setHour(h: number | null): void;
  dispose(): void;
}

function palette(): SkyPalette {
  const c = (s: string) => new THREE.Color(s);
  return {
    top: c("#000000"), horizon: c("#05060a"), fog: c("#0a0b0e"), glow: c("#000000"), glowAmt: 0,
    light: c("#fff4e6"), lightI: 3.6, hemiSky: c("#2a3040"), hemiGround: c("#a19e97"), hemiI: 2.6,
    cloudLit: c("#ffffff"), cloudShade: c("#000000"), stars: 1, env: 0.6,
  };
}

export function createMoonSky(radius = 1500): MoonSky {
  const earthDir = skyDir(EARTH.az, EARTH.el);
  const u: Record<string, THREE.IUniform> = {
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uEarthDir: { value: earthDir.clone() },
    uEarthLight: { value: new THREE.Vector3() },
    uEarthR: { value: EARTH.size / 2 },
    uTime: { value: 0 },
    uSunUp: { value: 1 },
  };
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, uniforms: u,
    vertexShader: "varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: FRAG,
  });
  const geo = new THREE.SphereGeometry(radius, 48, 24);
  const makeDome = () => {
    const dome = new THREE.Mesh(geo, mat);
    dome.name = "sky";
    dome.frustumCulled = false;
    dome.renderOrder = -1;
    // Stay centred on whoever is looking, and inside their far plane: the sky is at infinity.
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
  // The stars ride with the dome (one frame behind the camera, which nobody can see at infinity).
  dome.add(starField(radius * 0.97));

  const state: SkyState = {
    hour: MOON_HOUR,
    sunDir: new THREE.Vector3(), moonDir: earthDir.clone(), lightDir: new THREE.Vector3(),
    lightColor: new THREE.Color(), lightIntensity: 0, specColor: new THREE.Color(), specDir: new THREE.Vector3(),
    night: 0, p: palette(),
  };
  const earthlight = new THREE.Color("#9db6ff"), sunlight = new THREE.Color("#fff4e6");
  const day = palette(), dark = { hemiSky: new THREE.Color("#141a2e"), hemiGround: new THREE.Color("#2c3242") };
  let override: number | null = MOON_HOUR;

  function update(t: number, clockMs: number): SkyState {
    const hour = override ?? hourAt(clockMs);
    state.hour = hour;
    const sun = sunAt(hour);
    skyDir(sun.az, sun.el, state.sunDir);
    const night = THREE.MathUtils.smoothstep(-sun.el, -deg(2), deg(5));
    state.night = night;
    const up = THREE.MathUtils.smoothstep(sun.el, -deg(1.5), deg(1));
    // The sun until it's down, then Earth: a cold, dim light from the north-east.
    if (up > 0.02) {
      state.lightDir.copy(state.sunDir);
      state.lightColor.copy(sunlight);
      state.lightIntensity = 3.6 * up;
    } else {
      state.lightDir.copy(earthDir);
      state.lightColor.copy(earthlight);
      state.lightIntensity = 1.1 * night;
    }
    // Keep shadows finite at the lowest sun.
    if (state.lightDir.y < 0.1) state.lightDir.setY(0.1).normalize();
    state.specColor.copy(state.lightColor).multiplyScalar(Math.min(1, state.lightIntensity / 3));
    state.specDir.copy(state.lightDir);
    const p = state.p;
    p.hemiSky.copy(day.hemiSky).lerp(dark.hemiSky, night);
    p.hemiGround.copy(day.hemiGround).lerp(dark.hemiGround, night);
    p.hemiI = 2.6 - 1.5 * night;
    p.env = 0.6 - 0.3 * night;
    p.light.copy(state.lightColor);
    p.lightI = state.lightIntensity;

    u.uTime!.value = t;
    u.uSunUp!.value = up;
    (u.uSunDir!.value as THREE.Vector3).copy(state.sunDir);
    // Earth is lit nearly full face on: the view the art always shows.
    (u.uEarthLight!.value as THREE.Vector3).copy(earthDir).negate().multiplyScalar(0.8).addScaledVector(state.sunDir, 0.45).normalize();
    return state;
  }
  update(0, 0);

  return {
    dome, makeDome, state, update,
    setHour: (h) => { override = h == null ? null : ((h % 24) + 24) % 24; },
    dispose: () => { geo.dispose(); mat.dispose(); },
  };
}
