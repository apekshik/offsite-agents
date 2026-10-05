// Adapted from Ready Player One (github.com/apekshik/ready-player-one).
//
// The renderer, set up the way every world expects: ACES tone mapping (done once, in the
// pipeline's output pass), soft PCF shadows that the pipeline says when to redraw, and no MSAA
// (SMAA smooths edges after the fact, which is cheaper with post-processing).

import * as THREE from "three";

export type Quality = "low" | "high";

export interface RendererOptions {
  quality?: Quality;
  /** Device pixels per CSS pixel. Default: the screen's, capped (1.5 high, 1 low). */
  pixelRatio?: number;
}

let guarded = false;
// A zero-length vertex normal (a sliver triangle) normalizes to NaN, and bloom smears one NaN
// pixel into a black block across the screen. Point those vertices up instead, and if
// interpolation still cancels a normal to nothing, face the camera.
function guardNormals() {
  if (guarded) return;
  guarded = true;
  THREE.ShaderChunk.beginnormal_vertex = THREE.ShaderChunk.beginnormal_vertex.replace(
    "vec3 objectNormal = vec3( normal );",
    "vec3 objectNormal = dot( normal, normal ) > 1e-12 ? vec3( normal ) : vec3( 0.0, 1.0, 0.0 );",
  );
  THREE.ShaderChunk.normal_fragment_begin = THREE.ShaderChunk.normal_fragment_begin.replace(
    "vec3 normal = normalize( vNormal );",
    "vec3 normal = dot( vNormal, vNormal ) > 1e-12 ? normalize( vNormal ) : vec3( 0.0, 0.0, 1.0 );",
  );
}

export function createRenderer(canvas: HTMLCanvasElement, { quality = "high", pixelRatio }: RendererOptions = {}): THREE.WebGLRenderer {
  guardNormals();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, stencil: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(pixelRatio ?? Math.min(window.devicePixelRatio || 1, quality === "high" ? 1.5 : 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // soft: the sun sets its own blur radius
  renderer.shadowMap.autoUpdate = false; // the pipeline says when the sun's maps are redrawn
  renderer.shadowMap.needsUpdate = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  return renderer;
}
