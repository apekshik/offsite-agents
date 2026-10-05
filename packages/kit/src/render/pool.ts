// Still water in a basin (a pool, a hot tub): clear enough to see the tiles through, with the
// sky's reflection on top at full strength, slow ripples, and (for a hot tub) bubbles. Lit from
// within at night.

import * as THREE from "three";
import { SKY_GLSL } from "./ocean.ts";
import { FOAM_GLSL, LIGHT, waterNoise } from "./shared.ts";

export interface PoolWaterOptions {
  color?: THREE.ColorRepresentation;
  /** 0..1: how much the water boils (a hot tub's jets). */
  bubbles?: number;
  /** How see-through the water is straight down (0 clear .. 1 opaque). */
  body?: number;
}

export function poolWaterMaterial({ color = "#38c6d8", bubbles = 0, body = 0.42 }: PoolWaterOptions = {}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTime: LIGHT.uTime, uNight: LIGHT.uNight, uTint: LIGHT.uTint, uSun: LIGHT.uSun,
      uSkyTop: LIGHT.uSkyTop, uSkyHorizon: LIGHT.uSkyHorizon, uSkyGlow: LIGHT.uSkyGlow, uSkyGlowAmt: LIGHT.uSkyGlowAmt, uSkyBelow: LIGHT.uSkyBelow, uSunDir: LIGHT.uSunDir,
      uNoise: { value: waterNoise() },
      uColor: { value: new THREE.Color(color) },
      uBubbles: { value: bubbles },
      uBody: { value: body },
    },
    vertexShader: "varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }",
    fragmentShader: /* glsl */ `
      ${SKY_GLSL}
      ${FOAM_GLSL}
      uniform float uTime, uNight, uBubbles, uBody;
      uniform vec3 uTint, uSun, uColor;
      varying vec3 vW;
      void main() {
        vec3 toCam = cameraPosition - vW;
        float dist = length(toCam);
        vec3 V = toCam / dist;
        vec2 e = vW.xz;
        float boil = 1.0 + uBubbles * 3.0;
        vec2 slope = (tn(e * 0.21 + uTime * vec2(0.02, 0.013) * boil).rg - 0.5) * 0.7
                   + (tn(e * 0.55 - uTime * vec2(0.031, -0.024) * boil).rg - 0.5) * 0.4 * boil;
        vec3 n = normalize(vec3(slope.x, 1.0, slope.y));
        float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
        vec3 R = reflect(-V, n);
        R.y = abs(R.y);
        vec3 refl = skyAt(R);
        vec3 L = normalize(uSunDir), H = normalize(V + L);
        vec3 spec = uSun * pow(max(dot(n, H), 0.0), 900.0) * 30.0 * fres;
        // The pool's own light comes up at night.
        vec3 water = uColor * (uTint * 0.9 + uNight * 0.55);
        float a = mix(uBody, 1.0, fres);
        vec3 col = water * uBody * (1.0 - fres) + refl * fres + spec;
        if (uBubbles > 0.0) {
          float f = foamMask(e * 3.0 + vec2(0.0, uTime * 0.3), uBubbles * (0.6 + 0.4 * sin(uTime * 3.0 + e.x * 4.0)), 1.0);
          col = mix(col, vec3(0.95) * (uTint * 1.1 + uNight * 0.3), f * 0.8);
          a = mix(a, 1.0, f * 0.8);
        }
        gl_FragColor = vec4(col, a);
      }`,
  });
}
