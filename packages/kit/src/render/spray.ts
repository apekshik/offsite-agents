// Spray off a moving hull: sheets thrown up and out where the bow cuts the water, and the white
// water boiling up behind the transom. No CPU work at all: every droplet works out on the GPU,
// from its own seed and the clock, where it is in its short life, so it costs one draw call.

import * as THREE from "three";
import type { Quality } from "./renderer.ts";
import type { HullShape } from "./ocean.ts";
import { LIGHT, waterNoise } from "./shared.ts";

const HN = 32;

export interface Spray {
  mesh: THREE.Mesh;
  dispose(): void;
}

export function createSpray(hull: HullShape, { speed = 7.5, quality = "high" }: { speed?: number; quality?: Quality } = {}): Spray {
  const bowCount = quality === "high" ? 520 : 240, sternCount = quality === "high" ? 260 : 120;
  const n = bowCount + sternCount;
  const geo = new THREE.InstancedBufferGeometry();
  const quad = new THREE.PlaneGeometry(1, 1);
  geo.index = quad.index;
  geo.setAttribute("position", quad.getAttribute("position"));
  const seeds = new Float32Array(n * 4), kinds = new Float32Array(n);
  let s = 12345;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 4; k++) seeds[i * 4 + k] = r();
    kinds[i] = i < bowCount ? 0 : 1;
  }
  geo.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 4));
  geo.setAttribute("aKind", new THREE.InstancedBufferAttribute(kinds, 1));
  geo.instanceCount = n;

  // The bow's outline at the waterline, for where the sheets leave the hull.
  const bowSpan = 22;
  const bowBeam = Array.from({ length: HN }, (_, i) => hull.halfBeam(hull.bow + (bowSpan * i) / (HN - 1)));
  const material = new THREE.ShaderMaterial({
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTime: LIGHT.uTime, uTint: LIGHT.uTint, uSun: LIGHT.uSun, uSunDir: LIGHT.uSunDir,
      uFog: LIGHT.uFog, uFogNear: LIGHT.uFogNear, uFogFar: LIGHT.uFogFar,
      uNoise: { value: waterNoise() },
      uSpeed: { value: speed },
      uBow: { value: bowBeam },
      uEnds: { value: new THREE.Vector3(hull.bow, hull.stern, bowSpan) },
      uSternBeam: { value: hull.halfBeam(hull.stern - 0.5) },
    },
    vertexShader: /* glsl */ `
      #define HN ${HN}
      attribute vec4 aSeed;
      attribute float aKind;
      uniform float uTime, uSpeed, uBow[HN], uSternBeam;
      uniform vec3 uEnds;
      varying float vAlpha, vFog;
      varying vec2 vUv;
      varying vec4 vSeed;
      float bowAt(float a) {
        float u = clamp(a / uEnds.z, 0.0, 1.0) * float(HN - 1);
        int i = int(min(floor(u), float(HN - 2)));
        return mix(uBow[i], uBow[i + 1], u - float(i));
      }
      void main() {
        float k = clamp(uSpeed / 7.5, 0.0, 1.5);
        vec3 p; float size;
        if (aKind < 0.5) {
          // A sheet of spray off the bow: up and out, left behind as the ship runs on.
          float life = 1.1 + aSeed.y * 0.9;
          float age = fract(uTime / life + aSeed.x) * life, t = age / life;
          float side = aSeed.z < 0.5 ? -1.0 : 1.0;
          float a = 0.5 + pow(aSeed.w, 1.6) * 16.0;
          float burst = exp(-a / 7.0);
          vec3 v0 = vec3(side * (1.8 + aSeed.y * 3.6), (2.0 + fract(aSeed.w * 7.31) * 5.5) * burst + 0.8, uSpeed * 0.55);
          p = vec3(side * (bowAt(a) + 0.25), 0.2, uEnds.x + a) + v0 * age;
          p.y -= 4.9 * age * age;
          size = (0.5 + 2.6 * t) * (0.65 + 0.6 * burst);
          vAlpha = 0.9 * (1.0 - t) * (1.0 - t) * smoothstep(0.0, 0.06, t) * (0.3 + 0.7 * burst) * smoothstep(-0.4, 0.2, p.y) * k;
        } else {
          // White water boiling up behind the transom, rolling aft and settling.
          float life = 2.0 + aSeed.y * 1.6;
          float age = fract(uTime / life + aSeed.x) * life, t = age / life;
          float s = pow(aSeed.w, 1.4) * 22.0;
          float w = uSternBeam * 0.75 + s * 0.2;
          p = vec3((aSeed.z - 0.5) * 2.0 * w, 0.15, uEnds.y + 0.5 + s);
          p += vec3((aSeed.y - 0.5) * 1.2 * age, 1.3 * age - 0.9 * age * age, uSpeed * 0.85 * age);
          size = 1.1 + 2.6 * t;
          vAlpha = 0.42 * (1.0 - t) * smoothstep(0.0, 0.12, t) * exp(-s / 16.0) * k;
        }
        vec4 mv = viewMatrix * vec4(p, 1.0);
        mv.xy += position.xy * size;
        gl_Position = projectionMatrix * mv;
        vUv = position.xy + 0.5;
        vSeed = aSeed;
        vFog = -mv.z;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uNoise;
      uniform vec3 uTint, uSun, uSunDir, uFog;
      uniform float uFogNear, uFogFar;
      varying float vAlpha, vFog;
      varying vec2 vUv;
      varying vec4 vSeed;
      void main() {
        vec2 c = vUv - 0.5;
        float r = length(c) * 2.0;
        float a = smoothstep(1.0, 0.15, r) * vAlpha;
        a *= 0.45 + 0.75 * texture2D(uNoise, vUv * 0.35 + vSeed.xy).b;
        if (a < 0.003) discard;
        vec3 col = vec3(0.95, 0.97, 0.98) * (uTint * 1.25 + uSun * 0.35);
        col = mix(col, uFog, smoothstep(uFogNear, uFogFar, vFog));
        gl_FragColor = vec4(col * a, a);
      }`,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = "spray";
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  return { mesh, dispose() { geo.dispose(); quad.dispose(); material.dispose(); } };
}
