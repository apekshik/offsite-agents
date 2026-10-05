// Adapted from Ready Player One (github.com/apekshik/ready-player-one).
//
// How the picture is made, for everything in the world:
//   N8AO      renders the scene and darkens where surfaces meet (ambient occlusion), so things
//             sit on the deck instead of floating. Skipped on "low": a plain render pass instead.
//   bloom     picks out only what's brighter than white (the sun on the water, glowing screens)
//   output    tone mapping and sRGB, once, for the whole frame
//   SMAA      edge anti-aliasing
// Rendered in half float, so light can go past white before it's tone mapped.

/// <reference path="./n8ao.d.ts" />
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import { N8AOPass } from "n8ao";
import type { Quality } from "./renderer.ts";

export interface PipelineOptions {
  quality?: Quality;
}

export interface Pipeline {
  /** Draws one frame. Redraws the sun's shadow maps when they are due (see below). */
  render(dt?: number): void;
  /** Sizes the canvas, every pass and the camera's aspect, in CSS pixels. */
  setSize(width: number, height: number): void;
  /** The next frame redraws shadows whatever happens (after a teleport, say). */
  cut(): void;
  setPasses(passes: { occlusion?: boolean; glow?: boolean; smooth?: boolean }): void;
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  ao: N8AOPass | null;
  dispose(): void;
}

export function createPipeline(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, { quality = "high" }: PipelineOptions = {}): Pipeline {
  // The targets keep their depth, for the passes that need to know how far away things are.
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(1, 1) });
  const composer = new EffectComposer(renderer, target);

  let ao: N8AOPass | null = null;
  if (quality === "high") {
    ao = new N8AOPass(scene, camera, 1, 1);
    ao.setQualityMode("Medium");
    Object.assign(ao.configuration, {
      aoRadius: 1.6, distanceFalloff: 1.2, intensity: 2.2, halfRes: true, gammaCorrection: false,
      color: new THREE.Color("#141a24"), // cool, not black: shade under a sunny sky
    });
    // Left to itself, N8AO walks the whole scene several times a frame and draws it twice more
    // so no shade shows through glass. Not worth it for a few panes.
    ao.autoDetectTransparency = false;
    ao.configuration.transparencyAware = false;
    composer.addPass(ao);
  }
  const plain = new RenderPass(scene, camera);
  plain.enabled = !ao;
  composer.addPass(plain);
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.45, 0.55, 2.0);
  // The glow is soft anyway: its blur chain starts at a quarter of the screen's resolution
  // rather than half, which costs a fraction as much.
  const bloomSize = bloom.setSize.bind(bloom);
  bloom.setSize = (w: number, h: number) => bloomSize(w / 2, h / 2);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const smaa = new SMAAPass();
  composer.addPass(smaa);

  // The sun's two shadow cascades redraw most of the world: about half the frame's draw calls.
  // Redraw them every other frame; at 60 fps a shadow trailing a moving thing by one frame
  // doesn't show. After a cut (a teleport, a jump of the camera) redraw at once, or the maps
  // would be fitted to where the camera was.
  const lastPos = new THREE.Vector3(), lastDir = new THREE.Vector3(), dir = new THREE.Vector3(), pos = new THREE.Vector3();
  let frame = 0, forced = true;
  function shadowsDue(): boolean {
    camera.getWorldDirection(dir);
    pos.setFromMatrixPosition(camera.matrixWorld);
    const cut = pos.distanceTo(lastPos) > 5 || dir.dot(lastDir) < 0.94; // 5 m or ~20° in one frame
    lastPos.copy(pos);
    lastDir.copy(dir);
    const due = forced || cut || (frame++ & 1) === 0;
    forced = false;
    return due;
  }

  return {
    composer, bloom, ao,
    render(dt) {
      if (renderer.shadowMap.enabled) renderer.shadowMap.needsUpdate = shadowsDue();
      composer.render(dt);
    },
    setSize(w, h) {
      renderer.setSize(w, h, false);
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(w, h);
      if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
        const cam = camera as THREE.PerspectiveCamera;
        cam.aspect = w / Math.max(1, h);
        cam.updateProjectionMatrix();
      }
      forced = true;
    },
    cut() { forced = true; },
    setPasses({ occlusion, glow, smooth }) {
      if (occlusion !== undefined && ao) { ao.enabled = occlusion; plain.enabled = !occlusion; }
      if (glow !== undefined) bloom.enabled = glow;
      if (smooth !== undefined) smaa.enabled = smooth;
    },
    dispose() {
      composer.dispose();
      ao?.dispose();
      bloom.dispose();
      smaa.dispose();
      target.dispose();
    },
  };
}
