// An open sea to the horizon, around a ship that stays at the origin while the water scrolls past
// it. Adapted in spirit from Ready Player One's water (github.com/apekshik/ready-player-one),
// which is tied to its island's surf; this one is self-contained.
//
// One surface follows the camera: a polar grid, fine near the camera and coarse toward the
// horizon, cut into wedges that skip themselves when out of view. The vertex shader moves it with
// Gerstner swell (in the sea's own frame, so the waves travel past the ship) and the ship's own
// waves (in the ship's frame, where a wake stands still): the bow wave, the Kelvin arms, the wash
// behind the transom. The fragment shader draws the water body, the sky's reflection (and the
// hull's, faked from its outline), the sun's glitter, foam, and fades into the sky at the horizon.

import * as THREE from "three";
import type { Quality } from "./renderer.ts";
import { FOAM_GLSL, LIGHT, waterNoise } from "./shared.ts";

/** The ship as the sea sees it: its outline at the waterline. The bow points to -z. */
export interface HullShape {
  /** z where the stem meets the water. */
  bow: number;
  /** z where the hull ends aft (include a swim platform: water shouldn't come up through it). */
  stern: number;
  /** Half the hull's width at the waterline at z (bow <= z <= stern). */
  halfBeam(z: number): number;
  /** Height of the hull's top edge above the water at z, so the water can reflect it. */
  top(z: number): number;
}

export interface OceanOptions {
  quality?: Quality;
  /** The ship's speed through the water (m/s). The sea scrolls past at this speed; 0 is at anchor. */
  speed?: number;
  hull?: HullShape;
  /** Metres from the camera to the edge of the sea. */
  reach?: number;
  /** The hull's paint, for its reflection. */
  hullColor?: THREE.ColorRepresentation;
}

export interface Ocean {
  /** Add to the scene. */
  mesh: THREE.Group;
  material: THREE.ShaderMaterial;
  /** A plain stand-in for the sea, for environment probes (sky reflections on the hull). */
  makeEnvMesh(): THREE.Mesh;
  speed: number;
  /** Swell height (m) at a point in the ship's frame at time t (seconds), for floating things. */
  heightAt(x: number, z: number, t: number): number;
  dispose(): void;
}

// Swell: [direction (radians, from +x toward +z, in the sea's frame), amplitude (m), wavelength (m)].
// A slight sea: long, low swell from the port bow, wind waves over it.
const SWELL: [number, number, number][] = [
  [0.75, 0.42, 118],
  [0.35, 0.26, 66],
  [1.15, 0.16, 37],
  [0.55, 0.09, 21],
  [1.45, 0.05, 12.5],
  [0.15, 0.03, 7.4],
];
const CHOP = 0.85; // how far crests lean (Gerstner's horizontal motion), 0..1
const HN = 64; // samples of the hull's outline

export const SKY_GLSL = /* glsl */ `
  uniform vec3 uSkyTop, uSkyHorizon, uSkyGlow, uSkyBelow, uSunDir;
  uniform float uSkyGlowAmt;
  // The sky dome's own gradient and sunset glow (sky.ts), without clouds: what water reflects.
  vec3 skyAt(vec3 d) {
    float h = d.y;
    vec3 col = h > 0.0 ? mix(uSkyHorizon, uSkyTop, pow(smoothstep(0.0, 0.62, h), 0.75)) : mix(uSkyHorizon, uSkyBelow, smoothstep(0.0, -0.18, h));
    vec2 sh = normalize(uSunDir.xz + 1e-5);
    float side = dot(normalize(d.xz + 1e-5), sh) * 0.5 + 0.5;
    float band = exp(-abs(h - max(uSunDir.y, -0.02) * 0.6) * 7.0);
    col = mix(col, uSkyGlow, clamp(uSkyGlowAmt * band * pow(side, 3.0) * 0.9, 0.0, 1.0));
    col = mix(col, uSkyGlow, uSkyGlowAmt * 0.12 * exp(-abs(h) * 12.0));
    return col;
  }`;

const COMMON = /* glsl */ `
  #define HN ${HN}
  uniform float uTime, uSpeed;
  uniform vec4 uWaves[6];
  uniform vec2 uHull[HN];
  uniform vec3 uHullZ; // bow, stern, how much the ship's speed makes waves (0..1.5)

  vec2 hullAt(float z) {
    float u = (z - uHullZ.x) / (uHullZ.y - uHullZ.x) * float(HN - 1);
    if (u <= 0.0 || u >= float(HN - 1)) return vec2(0.0);
    int i = int(floor(u));
    return mix(uHull[i], uHull[i + 1], fract(u));
  }
  // Roughly how far outside the hull's waterline a point is (negative inside).
  float hullDist(vec2 p) {
    if (p.y < uHullZ.x) return length(vec2(p.x, p.y - uHullZ.x));
    if (p.y > uHullZ.y) return length(vec2(max(abs(p.x) - uHull[HN - 1].x, 0.0), p.y - uHullZ.y));
    return abs(p.x) - hullAt(p.y).x;
  }
`;

const VERT = /* glsl */ `
  ${COMMON}
  uniform sampler2D uNoise;
  varying vec3 vWorld, vN;
  varying float vCrest;
  varying vec4 vWake; // hull distance, metres aft of the bow, metres aft of the stern, churn

  // The ship's own waves, standing still in the ship's frame.
  float wakeH(vec2 p, float dh) {
    float a = p.y - uHullZ.x, l = abs(p.x), s = p.y - uHullZ.y;
    float h = 0.0;
    float out_ = max(dh, 0.0);
    // The bow wave: water piled against the stem, falling away along the sides, then a trough.
    h += 0.85 * exp(-out_ / 2.2) * exp(-max(a, 0.0) / 14.0);
    h -= 0.2 * exp(-out_ / 5.0) * smoothstep(14.0, 40.0, a) * (1.0 - smoothstep(80.0, 125.0, a));
    // The Kelvin arms: a V of short crests spreading from the bow at 19.5 degrees.
    float xa = 0.354 * a + 2.5, w = 3.5 + 0.05 * a;
    float arm = exp(-pow((l - xa) / w, 2.0));
    h += 0.3 * arm * exp(-a / 420.0) * smoothstep(3.0, 26.0, a) * sin(6.2832 / 15.0 * (a * 0.82 - l * 0.57));
    // Transverse waves inside the V, behind the stern.
    h += 0.12 * cos(6.2832 * a / 38.0) * smoothstep(xa, xa - 12.0, l) * smoothstep(0.0, 30.0, s) * exp(-max(s, 0.0) / 260.0);
    // The mound right behind the transom.
    float sw = 4.0 + 0.1 * max(s, 0.0);
    h += 0.3 * exp(-pow(p.x / sw, 2.0)) * smoothstep(-2.0, 2.0, s) * exp(-max(s, 0.0) / 16.0);
    return h * uHullZ.z;
  }

  void main() {
    vec4 w0 = modelMatrix * vec4(position, 1.0);
    vec2 p = w0.xz;
    vec2 e = p - vec2(0.0, uSpeed * uTime); // the sea's frame: the ship moves to -z through it
    float dist = length(p - cameraPosition.xz);
    float dh = hullDist(p);
    // Close in the hull's own lee: and the water mustn't come up through the decks.
    float att = 0.45 + 0.55 * smoothstep(-2.0, 14.0, dh);

    vec3 g = vec3(p.x, 0.0, p.y), T = vec3(1.0, 0.0, 0.0), B = vec3(0.0, 0.0, 1.0);
    float crest = 0.0;
    for (int i = 0; i < 6; i++) {
      vec4 wv = uWaves[i];
      vec2 d = wv.xy;
      float L = wv.w, k = 6.28318 / L, c = sqrt(9.8 / k);
      // Waves shorter than the grid can carry here would only shimmer: fade them out with distance.
      float fade = 1.0 - smoothstep(L * 10.0, L * 26.0, dist);
      float A = wv.z * fade * att;
      if (A <= 0.0) continue;
      float f = k * (dot(d, e) - c * uTime), sf = sin(f), cf = cos(f);
      float q = ${CHOP.toFixed(2)};
      g.x += q * A * d.x * cf; g.z += q * A * d.y * cf; g.y += A * sf;
      float ka = k * A;
      T += vec3(-q * d.x * d.x * ka * sf, d.x * ka * cf, -q * d.x * d.y * ka * sf);
      B += vec3(-q * d.x * d.y * ka * sf, d.y * ka * cf, -q * d.y * d.y * ka * sf);
      crest += sf * wv.z * fade;
    }

    float a = p.y - uHullZ.x, s = p.y - uHullZ.y, churn = 0.0;
    if (uHullZ.z > 0.0 && a > -8.0 && abs(p.x) < 0.45 * a + 40.0 && s < 1200.0) {
      float ep = 0.6;
      float h0 = wakeH(p, dh);
      float hx = wakeH(p + vec2(ep, 0.0), hullDist(p + vec2(ep, 0.0)));
      float hz = wakeH(p + vec2(0.0, ep), hullDist(p + vec2(0.0, ep)));
      // Churned water behind the transom: lumpy, and rolling aft with the sea.
      float sw = 4.5 + 0.11 * max(s, 0.0);
      churn = exp(-pow(p.x / sw, 2.0)) * smoothstep(-1.0, 3.0, s) * exp(-max(s, 0.0) / 120.0);
      float lump = (texture2D(uNoise, e * 0.045 + vec2(0.0, -uTime * 0.02)).b - 0.5) * 0.5 * churn * uHullZ.z;
      g.y += h0 * att + lump;
      T.y += (hx - h0) / ep * att;
      B.y += (hz - h0) / ep * att;
      crest += h0 * 1.4;
    }
    vN = normalize(cross(B, T));
    vCrest = crest;
    vWorld = g;
    vWake = vec4(dh, a, s, churn);
    gl_Position = projectionMatrix * viewMatrix * vec4(g, 1.0);
  }`;

const FRAG = /* glsl */ `
  ${COMMON}
  ${SKY_GLSL}
  ${FOAM_GLSL}
  uniform vec3 uSun, uTint, uFog, uDeep, uScatter, uAerated, uHullColor;
  uniform float uFogNear, uFogFar;
  varying vec3 vWorld, vN;
  varying float vCrest;
  varying vec4 vWake;

  void main() {
    vec3 toCam = cameraPosition - vWorld;
    float dist = length(toCam);
    vec3 V = toCam / dist;
    vec2 p = vWorld.xz;
    vec2 e = p - vec2(0.0, uSpeed * uTime);
    float dh = vWake.x, a = vWake.y, s = vWake.z;
    vec3 L = normalize(uSunDir);

    // Ripples: drifting octaves of slope, fading with distance so they don't shimmer.
    float rf = 1.0 / (1.0 + dist * 0.0045);
    vec4 n1 = tn(e * 0.031 + uTime * vec2(0.011, 0.007));
    vec2 slope = (n1.rg - 0.5) * 1.5 + (tn(e * 0.083 - uTime * vec2(0.013, -0.019)).rg - 0.5) * 0.9;
    // Far out, broad patches of rougher and smoother water break up the swell's even rows.
    slope += (tn(e * 0.0047 + vec2(0.31, uTime * 0.002)).rg - 0.5) * 2.2 * smoothstep(80.0, 600.0, dist);
    if (dist < 90.0) slope += (tn(e * 0.27 + uTime * vec2(-0.05, 0.04)).rg - 0.5) * 0.7 * (1.0 - dist / 90.0);
    slope *= rf;
    vec3 n = normalize(vN + vec3(slope.x, 0.0, slope.y));
    float NV = max(dot(n, V), 0.0);
    float fres = 0.02 + 0.98 * pow(1.0 - NV, 5.0);

    // What the surface reflects: the sky, or the hull where the reflected ray runs into it.
    vec3 R = reflect(-V, n);
    R.y = abs(R.y);
    vec3 refl = skyAt(R);
    if (uHullZ.z >= 0.0 && dh > 0.0 && dh < 60.0) {
      float side = sign(p.x), toward = -R.x * side;
      if (toward > 0.02) {
        float run = dh / toward;
        float zHit = p.y + R.z * run;
        vec2 hull = hullAt(zHit);
        float yHit = vWorld.y + R.y * run;
        if (hull.x > 0.0 && yHit < hull.y && yHit > -0.6) {
          vec3 hn = normalize(vec3(side, 0.0, 0.0));
          vec3 lit = uHullColor * (uTint * 1.1 + uSun * max(dot(hn, L), 0.0) * 0.6);
          if (yHit < 0.45) lit = vec3(0.025, 0.03, 0.04) * (uTint + 0.3); // the dark boot-top stripe
          float edge = smoothstep(hull.y, hull.y - 0.4, yHit);
          refl = mix(refl, lit, edge * smoothstep(34.0, 6.0, dh) * 0.85);
        }
      }
    }

    // Sunlight on the swell: a tight glint up close, widening to a glitter path far away.
    vec3 H = normalize(V + L);
    float shin = mix(2600.0, 320.0, smoothstep(20.0, 1600.0, dist));
    float NH = max(dot(n, H), 0.0);
    float fs = 0.02 + 0.98 * pow(1.0 - max(dot(H, V), 0.0), 5.0);
    vec3 spec = uSun * fs * pow(NH, shin) * min(shin * 0.012, 14.0) * step(0.0, L.y + 0.05);

    // The water itself: deep blue, lighter where light comes through a crest toward you, and
    // turquoise where the wake has stirred bubbles into it.
    float back = pow(max(dot(-V.xz, normalize(L.xz + 1e-5)), 0.0), 2.0) * smoothstep(-0.1, 0.4, L.y + 0.2);
    float crest = clamp(vCrest * 1.6, 0.0, 1.0);
    vec3 body = uDeep + uScatter * crest * (0.25 + 0.75 * back);
    float bowK = exp(-max(a, 0.0) / 22.0);
    float hullFoam = exp(-max(dh, 0.0) / (1.0 + 2.2 * bowK)) * (0.3 + 0.7 * bowK) * step(-0.5, dh);
    float xb = hullAt(min(p.y, uHullZ.x + 30.0)).x + 0.38 * max(a, 0.0);
    float moustache = exp(-pow((abs(p.x) - xb) / (1.0 + 0.09 * a), 2.0)) * exp(-max(a, 0.0) / 24.0) * step(-2.0, a);
    float xa = 0.354 * a + 2.5;
    float arms = exp(-pow((abs(p.x) - xa) / (1.0 + 0.012 * a), 2.0)) * 0.4 * exp(-a / 170.0) * smoothstep(8.0, 40.0, a);
    float churn = vWake.w;
    float aeration = clamp(churn * 0.9 + hullFoam * 0.5 + moustache * 0.6 + arms * 0.3, 0.0, 1.0) * uHullZ.z;
    body = mix(body, uAerated, aeration * 0.7);
    body *= uTint;

    vec3 col = body * (1.0 - fres) + refl * fres + spec;

    // Foam: whitecaps here and there, and the ship's: along the hull, the bow wave peeling off,
    // the white water behind the transom, faint streaks along the Kelvin arms.
    float caps = 0.0; // a slight sea: no whitecaps
    float wake = max(max(hullFoam * 0.9, moustache * 0.95), max(churn * (0.42 + 0.33 * exp(-max(s, 0.0) / 30.0)), arms)) * uHullZ.z;
    float amount = clamp(max(caps, wake), 0.0, 1.0);
    vec2 fp = e + vec2(0.0, -uTime * 0.6 * churn); // the white water tumbles a little faster than the sea
    float foam = foamMask(fp, amount, 1.0 - smoothstep(30.0, 70.0, dist));
    foam = mix(foam, amount * 0.6, smoothstep(150.0, 600.0, dist)); // far away, just its average
    vec3 foamCol = vec3(0.92, 0.95, 0.96) * (uTint * 1.15 + uSun * max(dot(n, L), 0.0) * 0.35);
    col = mix(col, foamCol, foam);

    // Into the sky: the far sea takes the dome's own color in that direction, so there's no seam.
    float fogF = smoothstep(uFogNear, uFogFar, dist);
    col = mix(col, mix(uFog, skyAt(-V), 0.65), fogF);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

// The grid: rings evenly spaced near the centre, then each a fixed fraction wider than the last
// out to the edge, so a cell looks about the same size on screen everywhere. Wedges share one
// vertex buffer; the core near the camera is always drawn.
const SECTORS = 16;
const CORE = 45;
function oceanPieces(segs: number, reach: number): THREE.BufferGeometry[] {
  const step = (2 * Math.PI) / segs;
  const inner = 14; // evenly spaced rings out to here
  const radii: number[] = [];
  const dr = inner * step;
  for (let r = 0; r < inner; r += dr) radii.push(r);
  for (let r = inner; r < reach * (1 + step); r *= 1 + step) radii.push(Math.min(r, reach));
  const rings = radii.length;
  const pos = new Float32Array(rings * segs * 3);
  for (let j = 0; j < rings; j++) for (let i = 0; i < segs; i++) {
    const k = (j * segs + i) * 3, r = radii[j]!, a = i * step;
    pos[k] = Math.cos(a) * r;
    pos[k + 2] = Math.sin(a) * r;
  }
  const lists: number[][] = Array.from({ length: SECTORS + 1 }, () => []);
  for (let j = 0; j + 1 < rings; j++) for (let i = 0; i < segs; i++) {
    const i1 = (i + 1) % segs;
    const a = j * segs + i, b = j * segs + i1, c = (j + 1) * segs + i, d = (j + 1) * segs + i1;
    const r = radii[j]!, ang = (i + 0.5) * step;
    const sector = r < CORE ? SECTORS : Math.floor((ang / (2 * Math.PI)) * SECTORS) % SECTORS;
    lists[sector]!.push(a, b, c, b, d, c);
  }
  const position = new THREE.BufferAttribute(pos, 3);
  return lists.map((idx, k) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", position);
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), reach);
    geo.userData.mid = k < SECTORS ? ((k + 0.5) / SECTORS) * 2 * Math.PI : null;
    return geo;
  });
}

export function createOcean({ quality = "high", speed = 7.5, hull, reach = 4000, hullColor = "#f3f4f1" }: OceanOptions = {}): Ocean {
  const waves = SWELL.map(([dir, amp, len]) => new THREE.Vector4(Math.cos(dir), Math.sin(dir), amp, len));
  const hullSamples = Array.from({ length: HN }, () => new THREE.Vector2());
  const hullZ = new THREE.Vector3(1e5, 1e5 + 1, -1); // no hull: nothing to wake or reflect
  if (hull) {
    for (let i = 0; i < HN; i++) {
      const z = hull.bow + ((hull.stern - hull.bow) * i) / (HN - 1);
      hullSamples[i]!.set(Math.max(0, hull.halfBeam(z)), hull.top(z));
    }
    hullZ.set(hull.bow, hull.stern, THREE.MathUtils.clamp(speed / 7.5, 0, 1.5));
  }
  const material = new THREE.ShaderMaterial({
    fog: false,
    uniforms: {
      uTime: LIGHT.uTime,
      uSkyTop: LIGHT.uSkyTop, uSkyHorizon: LIGHT.uSkyHorizon, uSkyGlow: LIGHT.uSkyGlow, uSkyGlowAmt: LIGHT.uSkyGlowAmt, uSkyBelow: LIGHT.uSkyBelow,
      uSun: LIGHT.uSun, uSunDir: LIGHT.uSunDir, uFog: LIGHT.uFog, uFogNear: LIGHT.uFogNear, uFogFar: LIGHT.uFogFar, uTint: LIGHT.uTint,
      uNoise: { value: waterNoise() },
      uSpeed: { value: speed },
      uWaves: { value: waves },
      uHull: { value: hullSamples },
      uHullZ: { value: hullZ },
      uDeep: { value: new THREE.Color("#07465e") },
      uScatter: { value: new THREE.Color("#139aa3") },
      uAerated: { value: new THREE.Color("#3cc3cc") },
      uHullColor: { value: new THREE.Color(hullColor) },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
  });

  // One group, a mesh per wedge. Each follows the camera and skips itself when out of view.
  const mesh = new THREE.Group();
  mesh.name = "ocean";
  const fwd = new THREE.Vector3(), at = new THREE.Vector3();
  const pieces = oceanPieces(quality === "high" ? 384 : 256, reach);
  for (const geo of pieces) {
    const piece = new THREE.Mesh(geo, material);
    piece.frustumCulled = false;
    piece.receiveShadow = false;
    piece.castShadow = false;
    piece.onBeforeRender = (_r, _s, camera) => {
      at.setFromMatrixPosition(camera.matrixWorld);
      piece.position.set(at.x, 0, at.z);
      piece.updateMatrixWorld();
      const mid = geo.userData.mid as number | null;
      if (mid === null) return;
      const cam = camera as THREE.PerspectiveCamera;
      camera.getWorldDirection(fwd);
      const h = Math.hypot(fwd.x, fwd.z);
      // Half the horizontal view angle, widened when looking down (the corners of the view reach
      // further round), plus a margin for the wedge's own width.
      const half = Math.atan((Math.tan(THREE.MathUtils.degToRad((cam.fov ?? 60) / 2)) * (cam.aspect ?? 1.6)) / Math.max(h, 0.25)) + 0.3 + Math.PI / SECTORS;
      let d = Math.atan2(fwd.z, fwd.x) - mid;
      d = Math.abs(Math.atan2(Math.sin(d), Math.cos(d)));
      geo.drawRange.count = h < 0.2 || d < half ? Infinity : 0;
    };
    mesh.add(piece);
  }

  const k = (len: number) => (2 * Math.PI) / len;
  return {
    mesh,
    material,
    speed,
    makeEnvMesh() {
      const m = new THREE.ShaderMaterial({
        fog: false,
        uniforms: {
          uSkyTop: LIGHT.uSkyTop, uSkyHorizon: LIGHT.uSkyHorizon, uSkyGlow: LIGHT.uSkyGlow, uSkyGlowAmt: LIGHT.uSkyGlowAmt, uSkyBelow: LIGHT.uSkyBelow,
          uSunDir: LIGHT.uSunDir, uTint: LIGHT.uTint, uDeep: material.uniforms.uDeep!,
        },
        vertexShader: "varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }",
        fragmentShader: `${SKY_GLSL}
          uniform vec3 uTint, uDeep; varying vec3 vW;
          void main() {
            vec3 V = normalize(cameraPosition - vW);
            float f = 0.02 + 0.98 * pow(1.0 - max(V.y, 0.0), 5.0);
            vec3 col = mix(uDeep * uTint, skyAt(reflect(-V, vec3(0.0, 1.0, 0.0))), f);
            col = mix(col, skyAt(-V), smoothstep(400.0, 2500.0, length(cameraPosition - vW)));
            gl_FragColor = vec4(col, 1.0);
          }`,
      });
      const disc = new THREE.Mesh(new THREE.CircleGeometry(2800, 48).rotateX(-Math.PI / 2), m);
      disc.frustumCulled = false;
      return disc;
    },
    heightAt(x, z, t) {
      const ez = z - speed * t;
      let y = 0;
      for (const w of waves) {
        const kk = k(w.w), c = Math.sqrt(9.8 / kk);
        y += w.z * Math.sin(kk * (w.x * x + w.y * ez - c * t));
      }
      return y;
    },
    dispose() {
      for (const g of pieces) g.dispose();
      material.dispose();
    },
  };
}
