// The render kit: what every world draws with. Renderer and post-processing, the sky and its day,
// daylight and reflections, materials, an open sea with a ship's wake, spray, pool water and
// static batching.

export { createRenderer } from "./renderer.ts";
export type { Quality, RendererOptions } from "./renderer.ts";
export { createPipeline } from "./pipeline.ts";
export type { Pipeline, PipelineOptions } from "./pipeline.ts";
export { createSky, hourAt, formatHour, DAY_MINUTES } from "./sky.ts";
export type { Sky, SkyOptions, SkyState, SkyPalette } from "./sky.ts";
export { createDaylight, createEnvProbe } from "./light.ts";
export type { Daylight, DaylightOptions, EnvProbe } from "./light.ts";
export {
  setMaterialBase, SURFACES, wear, surfaceMaterial, patch,
  teak, hullPaint, paint, darkGlass, glass, chrome, canvas, poolTile, screenMaterial, nightLight,
} from "./materials.ts";
export type { SurfaceId, WearOptions } from "./materials.ts";
export { createOcean, SKY_GLSL } from "./ocean.ts";
export type { Ocean, OceanOptions, HullShape } from "./ocean.ts";
export { createSpray } from "./spray.ts";
export type { Spray } from "./spray.ts";
export { poolWaterMaterial } from "./pool.ts";
export type { PoolWaterOptions } from "./pool.ts";
export { batchStatic, mergeInto } from "./batch.ts";
export { LIGHT, waterNoise, FOAM_GLSL } from "./shared.ts";
