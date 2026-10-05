// n8ao ships no types: just the parts the pipeline uses.
declare module "n8ao" {
  import type { Camera, Color, Scene, WebGLRenderTarget } from "three";
  import { Pass } from "three/addons/postprocessing/Pass.js";
  export class N8AOPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    configuration: {
      aoRadius: number;
      distanceFalloff: number;
      intensity: number;
      halfRes: boolean;
      gammaCorrection: boolean;
      color: Color;
      screenSpaceRadius: boolean;
      transparencyAware: boolean;
      aoSamples: number;
      denoiseSamples: number;
      denoiseRadius: number;
      depthAwareUpsampling: boolean;
      accumulate: boolean;
      [key: string]: unknown;
    };
    autoDetectTransparency: boolean;
    beautyRenderTarget: WebGLRenderTarget;
    setQualityMode(mode: "Performance" | "Low" | "Medium" | "High" | "Ultra"): void;
    setSize(width: number, height: number): void;
    dispose(): void;
  }
}
