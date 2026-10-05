// Adapted from Ready Player One (github.com/apekshik/ready-player-one).
//
// Daylight: the sun (the moon by night) casting two cascades of soft shadow fitted to the view,
// a hemisphere light so shade never goes dead, fog that fades into the sky's own horizon, and
// reflections from an environment probe. All of it follows the sky (sky.ts) every frame.

import * as THREE from "three";
import { SunLight } from "three/addons/lights/SunLight.js";
import type { Quality } from "./renderer.ts";
import type { SkyState } from "./sky.ts";
import { LIGHT } from "./shared.ts";

export interface DaylightOptions {
  quality?: Quality;
  /** How far the sun's shadows reach from the camera at least (metres). */
  shadowReach?: number;
  fogNear?: number;
  fogFar?: number;
}

export interface Daylight {
  sun: SunLight;
  hemi: THREE.HemisphereLight;
  fog: THREE.Fog;
  /** Lights, fog, environment strength and every shared water uniform, to match the sky. */
  apply(state: SkyState, scene: THREE.Scene): void;
  /**
   * Shadows reach far enough to cover something of `radius` at `center` from where the camera
   * is: close in, the cascades stay tight and sharp; from far out, the whole ship still casts.
   */
  fit(camera: THREE.Camera, center: THREE.Vector3, radius: number): void;
  dispose(): void;
}

export function createDaylight({ quality = "high", shadowReach = 160, fogNear = 260, fogFar = 2600 }: DaylightOptions = {}): Daylight {
  const fog = new THREE.Fog("#d6e7f3", fogNear, fogFar);
  const hemi = new THREE.HemisphereLight("#d9ecff", "#4a5868", 1.0);
  const sun = new SunLight("#fff3dc", 3.1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(quality === "high" ? 2048 : 1024, quality === "high" ? 2048 : 1024);
  sun.shadow.camera.far = shadowReach;
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.04;
  sun.shadow.radius = quality === "high" ? 2.5 : 1.5;
  const _c = new THREE.Color(), at = new THREE.Vector3();
  LIGHT.uFogNear.value = fogNear;
  LIGHT.uFogFar.value = fogFar;

  return {
    sun, hemi, fog,
    apply(st, scene) {
      const p = st.p;
      // Fog fades into the sky's own horizon, so the sea's far edge meets the sky without a band.
      fog.color.copy(p.fog).lerp(p.horizon, 0.55);
      hemi.color.copy(p.hemiSky);
      hemi.groundColor.copy(p.hemiGround);
      // The environment probe (the sky and sea themselves) gives most of the soft light; the
      // hemisphere only keeps shade from going dead where the probe's light can't be told apart.
      hemi.intensity = p.hemiI * 0.3;
      sun.color.copy(st.lightColor);
      sun.intensity = st.lightIntensity;
      sun.position.copy(st.lightDir); // the cascades fit themselves to the view; it only needs a direction
      scene.environmentIntensity = Math.min(1, p.env * 1.5);
      LIGHT.uSkyTop.value.copy(p.top);
      LIGHT.uSkyHorizon.value.copy(p.horizon);
      LIGHT.uSkyGlow.value.copy(p.glow);
      LIGHT.uSkyGlowAmt.value = p.glowAmt;
      LIGHT.uSkyBelow.value.copy(p.fog);
      LIGHT.uSun.value.copy(st.specColor);
      LIGHT.uSunDir.value.copy(st.specDir);
      LIGHT.uFog.value.copy(fog.color);
      LIGHT.uFogNear.value = fog.near;
      LIGHT.uFogFar.value = fog.far;
      LIGHT.uNight.value = st.night;
      // Unlit shaders (water, spray) are tinted by how much light there is.
      LIGHT.uTint.value.copy(p.hemiSky).multiplyScalar(p.hemiI * 0.45)
        .add(_c.copy(st.lightColor).multiplyScalar(st.lightIntensity * 0.18));
    },
    fit(camera, center, radius) {
      at.setFromMatrixPosition(camera.matrixWorld);
      sun.shadow.camera.far = Math.min(900, Math.max(shadowReach, at.distanceTo(center) + radius));
    },
    dispose() { sun.dispose(); hemi.dispose(); },
  };
}

/**
 * Reflections and soft bounce light from the world around: a cube map of `envScene` (the sky and
 * the sea, not the ship) captured one face per frame every few seconds, then prefiltered for
 * PBR, so there's never a hitch.
 */
export interface EnvProbe {
  scene: THREE.Scene;
  texture: THREE.Texture | null;
  /** time: seconds. Captures from `at`. Pass force after a big jump in the hour. */
  update(time: number, at: THREE.Vector3, force?: boolean): void;
  dispose(): void;
}

export function createEnvProbe(renderer: THREE.WebGLRenderer, { size = 128, every = 3 } = {}): EnvProbe {
  const scene = new THREE.Scene();
  const target = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: false });
  const camera = new THREE.CubeCamera(0.5, 3000, target);
  const pmrem = new THREE.PMREMGenerator(renderer);
  let face = -1, at = -Infinity, out: THREE.WebGLRenderTarget | null = null;
  const probe: EnvProbe = {
    scene,
    texture: null,
    update(time, pos, force = false) {
      if (face < 0) {
        if (!force && time - at < every && out) return;
        at = time;
        camera.position.set(pos.x, Math.max(2, pos.y), pos.z);
        camera.updateMatrixWorld(true);
        face = 0;
      }
      // The first capture happens all at once, so there's never a frame without one.
      const faces = out && !force ? 1 : 6;
      const shadows = renderer.shadowMap.autoUpdate, needs = renderer.shadowMap.needsUpdate;
      renderer.shadowMap.autoUpdate = false;
      renderer.shadowMap.needsUpdate = false;
      const prev = renderer.getRenderTarget();
      for (let n = 0; n < faces && face < 6; n++, face++) {
        renderer.setRenderTarget(target, face);
        renderer.render(scene, camera.children[face] as THREE.Camera);
      }
      renderer.setRenderTarget(prev);
      renderer.shadowMap.autoUpdate = shadows;
      renderer.shadowMap.needsUpdate = needs;
      if (face < 6) return;
      face = -1;
      out = pmrem.fromCubemap(target.texture, out);
      probe.texture = out.texture;
    },
    dispose() { target.dispose(); out?.dispose(); pmrem.dispose(); },
  };
  return probe;
}
