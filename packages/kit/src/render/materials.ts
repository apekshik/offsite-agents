// Adapted from Ready Player One (github.com/apekshik/ready-player-one).
//
// The material library: tileable PBR surfaces (public/materials/<id>/), worn by everything so the
// world shares one physical language, and a small palette for ships: teak decking, gloss hull
// paint, tinted and clear glass, chrome, canvas, pool tile, screens.
//
// None of our geometry has meaningful uvs, so surfaces are projected from three sides
// (triplanar) instead: in world space for static things, in the object's own space for things
// that move or are instanced, so their texture rides along. The maps add grain, relief and
// roughness variation; the material keeps its own color, so the palette doesn't shift (each map
// is divided by its own average).

import * as THREE from "three";
import { LIGHT, waterNoise } from "./shared.ts";

let BASE = "/materials/";
/** Where the material folders are served from: `${assets}materials/`. Call before making materials. */
export function setMaterialBase(assets: string) {
  BASE = `${assets.replace(/\/?$/, "/")}materials/`;
}

const loader = new THREE.TextureLoader();
interface Entry { tex: THREE.Texture; mean: THREE.Vector3 }
const cache = new Map<string, Entry>();

// What each surface is like, and how big one tile of it is (metres).
export const SURFACES = {
  "painted-metal": { tile: 1.6, rough: 0.38, metal: 0.35, normal: 0.5 },
  "brushed-metal": { tile: 1.2, rough: 0.34, metal: 0.9, normal: 0.7 },
  plastic: { tile: 1.0, rough: 0.5, metal: 0, normal: 0.5 },
  rubber: { tile: 0.8, rough: 0.9, metal: 0, normal: 0.8 },
  wood: { tile: 2.0, rough: 0.6, metal: 0, normal: 0.8 },
  fabric: { tile: 0.6, rough: 0.9, metal: 0, normal: 1.0 },
  marble: { tile: 3.2, rough: 0.25, metal: 0, normal: 0.6 },
  terrazzo: { tile: 1.8, rough: 0.35, metal: 0, normal: 0.4 },
} as const;
export type SurfaceId = keyof typeof SURFACES;

// A map's average (its mean color), so it can modulate without shifting color.
function meanOf(image: CanvasImageSource): number[] {
  const c = document.createElement("canvas");
  c.width = c.height = 16;
  const g = c.getContext("2d")!;
  g.drawImage(image, 0, 0, 16, 16);
  const d = g.getImageData(0, 0, 16, 16).data;
  const m = [0, 0, 0];
  for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) m[k]! += d[i + k]!;
  return m.map((v) => Math.max(1, v / (d.length / 4)) / 255);
}

function tex(id: string, map: string, color: boolean): Entry {
  const key = `${id}/${map}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const mean = new THREE.Vector3(1, 1, 1);
  const t = loader.load(`${BASE}${id}/${map}.webp`, (t) => {
    const m = meanOf(t.image as CanvasImageSource);
    // Albedo averages are in sRGB; the shader compares linear values.
    if (color) mean.set(...(m.map((v) => Math.pow(v, 2.2)) as [number, number, number]));
    else mean.set(m[0]!, m[1]!, m[2]!);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  const entry = { tex: t, mean };
  cache.set(key, entry);
  return entry;
}

type Shader = THREE.WebGLProgramParametersWithUniforms;

/**
 * Adds a shader change to a material on top of whatever it already does. `key` names the change,
 * so materials with different changes never share a compiled program.
 */
export function patch(material: THREE.Material, key: string, fn: (sh: Shader) => void): THREE.Material {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (sh, r) => {
    prev.call(material, sh, r);
    fn(sh);
  };
  const keys: string[] = (material.userData.patches ??= []);
  keys.push(key);
  material.customProgramCacheKey = () => keys.join("|");
  material.needsUpdate = true;
  return material;
}

const VERT_DECL = /* glsl */ `
  varying vec3 vTriP, vTriN, vTriAx, vTriAy, vTriAz;
  uniform vec3 uTriScale;
  uniform float uTriObject;`;
// Where we sample (metres in world or object space), the surface's normal in that same space,
// and that space's axes as seen by the camera (to bring a perturbed normal back into view space).
const VERT_BODY = /* glsl */ `
  {
    vec4 wp = modelMatrix * vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      wp = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
    #endif
    if (uTriObject > 0.5) {
      vTriP = transformed * uTriScale;
      vTriN = objectNormal / max(uTriScale, vec3(1e-4));
      vTriAx = normalize(normalMatrix * vec3(1.0, 0.0, 0.0));
      vTriAy = normalize(normalMatrix * vec3(0.0, 1.0, 0.0));
      vTriAz = normalize(normalMatrix * vec3(0.0, 0.0, 1.0));
    } else {
      vTriP = wp.xyz;
      vTriN = mat3(modelMatrix) * objectNormal;
      vTriAx = mat3(viewMatrix) * vec3(1.0, 0.0, 0.0);
      vTriAy = mat3(viewMatrix) * vec3(0.0, 1.0, 0.0);
      vTriAz = mat3(viewMatrix) * vec3(0.0, 0.0, 1.0);
    }
  }`;

const FRAG_DECL = /* glsl */ `
  varying vec3 vTriP, vTriN, vTriAx, vTriAy, vTriAz;
  uniform sampler2D uTriColor, uTriNormal, uTriRough;
  uniform vec3 uTriColorMean, uTriRoughMean;
  uniform float uTriTile, uTriAlbedo, uTriNormalAmt, uTriRoughAmt;
  vec3 triW() {
    vec3 w = pow(abs(normalize(vTriN)), vec3(4.0));
    return w / max(1e-4, w.x + w.y + w.z);
  }
  vec4 triSample(sampler2D t, vec3 w) {
    vec3 p = vTriP / uTriTile;
    return texture2D(t, p.zy) * w.x + texture2D(t, p.xz) * w.y + texture2D(t, p.xy) * w.z;
  }`;

const FRAG_ALBEDO = /* glsl */ `
  vec3 triWeights = triW();
  {
    vec3 a = triSample(uTriColor, triWeights).rgb / max(uTriColorMean, vec3(0.02));
    diffuseColor.rgb *= mix(vec3(1.0), clamp(a, 0.0, 2.0), uTriAlbedo);
  }`;

const FRAG_ROUGH = /* glsl */ `
  roughnessFactor *= mix(1.0, clamp(triSample(uTriRough, triWeights).g / max(uTriRoughMean.g, 0.02), 0.4, 1.8), uTriRoughAmt);`;

// Whiteout-blended triplanar normals, back into view space.
const FRAG_NORMAL = /* glsl */ `
  {
    vec3 N = normalize(vTriN), p = vTriP / uTriTile;
    vec3 tx = texture2D(uTriNormal, p.zy).xyz * 2.0 - 1.0;
    vec3 ty = texture2D(uTriNormal, p.xz).xyz * 2.0 - 1.0;
    vec3 tz = texture2D(uTriNormal, p.xy).xyz * 2.0 - 1.0;
    tx.xy *= uTriNormalAmt; ty.xy *= uTriNormalAmt; tz.xy *= uTriNormalAmt;
    tx = vec3(tx.xy + N.zy, abs(tx.z) * N.x);
    ty = vec3(ty.xy + N.xz, abs(ty.z) * N.y);
    tz = vec3(tz.xy + N.xy, abs(tz.z) * N.z);
    vec3 nT = normalize(tx.zyx * triWeights.x + ty.xzy * triWeights.y + tz.xyz * triWeights.z);
    vec3 nV = normalize(nT.x * vTriAx + nT.y * vTriAy + nT.z * vTriAz);
    #ifdef DOUBLE_SIDED
      nV *= gl_FrontFacing ? 1.0 : -1.0;
    #endif
    normal = normalize(mix(normal, nV, step(0.0, dot(nV, normal)) * 0.999 + 0.001));
  }`;

export interface WearOptions {
  /** "world" for static things, "object" for things that move or are instanced. */
  space?: "world" | "object";
  albedo?: number;
  normal?: number;
  rough?: number;
  tile?: number;
}

/** Gives a MeshStandardMaterial a surface from the library, on top of whatever it already does. */
export function wear<M extends THREE.MeshStandardMaterial>(material: M, id: SurfaceId, { space = "world", albedo = 0.5, normal = 1, rough = 0.6, tile }: WearOptions = {}): M {
  const s = SURFACES[id];
  const C = tex(id, "basecolor", true), N = tex(id, "normal", false), R = tex(id, "roughness", false);
  const u = {
    uTriColor: { value: C.tex }, uTriNormal: { value: N.tex }, uTriRough: { value: R.tex },
    uTriColorMean: { value: C.mean }, uTriRoughMean: { value: R.mean },
    uTriTile: { value: tile ?? s.tile }, uTriAlbedo: { value: albedo }, uTriNormalAmt: { value: s.normal * normal }, uTriRoughAmt: { value: rough },
    uTriScale: { value: (material.userData.triScale as THREE.Vector3 | undefined) ?? new THREE.Vector3(1, 1, 1) }, uTriObject: { value: space === "object" ? 1 : 0 },
  };
  material.userData.tri = u;
  patch(material, `tri:${space}`, (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", `#include <common>\n${VERT_DECL}`)
      .replace("#include <project_vertex>", `#include <project_vertex>\n${VERT_BODY}`);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>\n${FRAG_DECL}`)
      .replace("#include <map_fragment>", `#include <map_fragment>\n${FRAG_ALBEDO}`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>\n${FRAG_ROUGH}`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>\n${FRAG_NORMAL}`);
  });
  return material;
}

/** A fresh material made of `id`, tinted by its color. size: the part's size in metres (object space). */
export function surfaceMaterial(id: SurfaceId, color: THREE.ColorRepresentation, opts: THREE.MeshStandardMaterialParameters = {}, size: THREE.Vector3 | null = null): THREE.MeshStandardMaterial {
  const s = SURFACES[id];
  const m = new THREE.MeshStandardMaterial({ color, roughness: s.rough, metalness: s.metal, ...opts });
  if (size) m.userData.triScale = size;
  return wear(m, id, { space: "object", albedo: id === "wood" || id === "fabric" ? 0.85 : 0.45 });
}

// ---------- the palette ----------

/**
 * Teak decking: oiled wood in planks that run along z, with black caulking between them and
 * staggered butt joints. The seams fade to their average tone where they'd be thinner than a pixel.
 */
export function teak({ color = "#a87443", plank = 0.13, length = 5.2 } = {}): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.66, metalness: 0 });
  wear(m, "wood", { albedo: 0.9, normal: 0.6, rough: 0.5, tile: 1.4 });
  return patch(m, "teak", (sh) => {
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>
        float tkHash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
        float tkSeam = 0.0;`)
      .replace("#include <map_fragment>", `#include <map_fragment>
        {
          float qx = vTriP.x / ${plank.toFixed(3)};
          float i = floor(qx), fx = fract(qx), dx = fwidth(qx);
          float zz = vTriP.z / ${length.toFixed(2)} + tkHash(vec2(i, 3.1));
          float fz = fract(zz), dz = fwidth(zz);
          float sx = 1.0 - smoothstep(0.035 - dx, 0.035 + dx, min(fx, 1.0 - fx));
          float sz = 1.0 - smoothstep(0.0025 - dz, 0.0025 + dz, min(fz, 1.0 - fz));
          float fade = smoothstep(0.25, 0.6, dx);
          tkSeam = mix(max(sx, sz), 0.07, fade) * smoothstep(0.6, 0.95, vTriN.y / max(length(vTriN), 1e-4));
          float tone = 0.86 + 0.24 * tkHash(vec2(i, floor(zz)));
          diffuseColor.rgb *= mix(tone, 1.0, fade);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.035, 0.03, 0.026), tkSeam * 0.9);
        }`)
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.9, tkSeam);");
  }) as THREE.MeshStandardMaterial;
}

/** A superyacht's hull: deep gloss white under a clear coat that mirrors the sky. */
export function hullPaint(color: THREE.ColorRepresentation = "#f3f4f1"): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({ color, roughness: 0.3, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05 });
}

/** Gloss paint for superstructure, trim and fittings. */
export function paint(color: THREE.ColorRepresentation = "#f2f3f0", roughness = 0.28): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
}

/**
 * Tinted window glass, seen from outside: dark, opaque, a mirror at glancing angles. At night
 * some panes glow warm, as if the cabins behind them are lit (cells of `pane` metres along z).
 */
export function darkGlass({ color = "#0c141b", glow = "#ffc98a", lit = 0.45, pane = 3.2 } = {}): THREE.MeshPhysicalMaterial {
  // The emissive is gated by night (and by which panes are lit) in the shader below.
  const m = new THREE.MeshPhysicalMaterial({ color, roughness: 0.05, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.02, emissive: glow, emissiveIntensity: 1 });
  return patch(m, "darkglass", (sh) => {
    sh.uniforms.uNight = LIGHT.uNight;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vGlassP;")
      .replace("#include <project_vertex>", `#include <project_vertex>
        #ifdef USE_INSTANCING
          vGlassP = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        #else
          vGlassP = (modelMatrix * vec4(transformed, 1.0)).xyz;
        #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vGlassP;\nuniform float uNight;")
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
        {
          vec2 cell = floor(vec2(vGlassP.z / ${pane.toFixed(2)}, vGlassP.y / 3.4) + vec2(vGlassP.x > 0.0 ? 17.0 : 0.0, 0.0));
          float on = step(1.0 - ${lit.toFixed(2)}, fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453));
          // Each lit cabin a little differently: some bright, most a warm glow behind the tint.
          float shade = fract(sin(dot(cell, vec2(39.3468, 11.135))) * 24634.6345);
          totalEmissiveRadiance = emissive * uNight * on * (0.35 + 0.75 * shade * shade);
        }`);
  }) as THREE.MeshPhysicalMaterial;
}

/**
 * Clear glass you can see through: tinted, and its reflection added in full on top rather than
 * faded with the glass's own opacity (premultiplied alpha), so it still reads as glass.
 */
export function glass({ color = "#8fb0bd", opacity = 0.16 } = {}): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({
    color, roughness: 0.03, metalness: 0, transparent: true, opacity, premultipliedAlpha: true,
    depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.2, specularIntensity: 1,
  });
  return patch(m, "glass", (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      "#include <opaque_fragment>",
      `float glassF = pow(1.0 - saturate(abs(dot(geometryNormal, geometryViewDir))), 4.0);
       float glassA = mix(diffuseColor.a, 0.85, glassF);
       // premultiplied_alpha_fragment multiplies by alpha later: divide first, so the
       // reflection lands at full strength and only the tint is faded.
       outgoingLight = totalDiffuse * glassA + totalSpecular + totalEmissiveRadiance;
       gl_FragColor = vec4(outgoingLight / max(glassA, 1e-3), glassA);`,
    );
  }) as THREE.MeshPhysicalMaterial;
}

/** Polished stainless: rails, stanchions, fittings. */
export function chrome(color: THREE.ColorRepresentation = "#eef1f4", roughness = 0.12): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 1 });
}

/** Canvas and upholstery: cushions, umbrellas, awnings. Object space, so it can be instanced. */
export function canvas(color: THREE.ColorRepresentation = "#efe9dc", opts: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0, ...opts });
  return wear(m, "fabric", { space: "object", albedo: 0.35, normal: 0.8, rough: 0.3, tile: 0.5 });
}

/**
 * Glass mosaic for a pool: small square tiles with pale grout, and below `waterY` the sun's
 * caustics dancing over them.
 */
export function poolTile({ color = "#1d8fb0", waterY = 0, tile = 0.06 } = {}): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.18, metalness: 0 });
  const u = { uWaterY: { value: waterY }, uNoise: { value: waterNoise() } };
  return patch(m, "pooltile", (sh) => {
    Object.assign(sh.uniforms, u, { uTime: LIGHT.uTime, uSunTile: LIGHT.uSun, uNight: LIGHT.uNight });
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vTileP; varying vec3 vTileN;")
      .replace("#include <project_vertex>", `#include <project_vertex>
        vTileP = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vTileN = mat3(modelMatrix) * objectNormal;`);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>
        varying vec3 vTileP; varying vec3 vTileN;
        uniform float uWaterY, uTime, uNight; uniform vec3 uSunTile; uniform sampler2D uNoise;
        float tlUnder = 0.0, tlCaustic = 0.0;
        float tlHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }`)
      .replace("#include <map_fragment>", `#include <map_fragment>
        {
          vec3 w = abs(normalize(vTileN));
          vec2 q = (w.y > 0.5 ? vTileP.xz : (w.x > w.z ? vTileP.zy : vTileP.xy)) / ${tile.toFixed(3)};
          vec2 f = abs(fract(q) - 0.5), dq = fwidth(q);
          float grout = 1.0 - smoothstep(0.43 - dq.x, 0.43 + dq.x, max(f.x, f.y));
          grout *= 1.0 - smoothstep(0.2, 0.5, max(dq.x, dq.y));
          diffuseColor.rgb *= 0.85 + 0.3 * tlHash(floor(q));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.85, 0.9, 0.9), grout * 0.7);
          float under = smoothstep(0.02, -0.08, vTileP.y - uWaterY);
          if (under > 0.0) {
            vec2 p = vTileP.xz + 0.3 * vec2(sin(vTileP.z * 1.3 + uTime * 0.8), cos(vTileP.x * 1.1 - uTime * 0.7));
            float a = smoothstep(0.45, 1.0, texture2D(uNoise, p * 0.22 + vec2(uTime * 0.03, uTime * 0.017)).a);
            float b = smoothstep(0.5, 1.0, texture2D(uNoise, p * 0.31 + vec2(0.37 - uTime * 0.021, uTime * 0.034)).a);
            float c = a * 0.35 + b * 0.25 + a * b * 1.4;
            diffuseColor.rgb *= 1.0 + under * c * (0.4 + 0.6 * min(1.0, dot(uSunTile, vec3(0.3))));
            tlUnder = under; tlCaustic = c;
          }
        }`)
      // After dark the pool's own lights come on under the water: the basin glows aqua, the
      // caustics still dancing over it.
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * vec3(0.55, 1.15, 1.25) * tlUnder * uNight * (0.9 + 1.6 * tlCaustic);`);
  }) as THREE.MeshStandardMaterial;
}

/**
 * A screen: unlit, so it reads the same in any light. Each screen gets its own material, so the
 * app can set its `map` (a canvas or video texture) without touching the others.
 */
export function screenMaterial(color: THREE.ColorRepresentation = "#ffffff", map: THREE.Texture | null = null): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, map, toneMapped: false });
}

/** Something that glows at night only (deck lights, lit signs): emissive scaled by LIGHT.uNight. */
export function nightLight(color: THREE.ColorRepresentation = "#ffd9a0", strength = 3, base: THREE.ColorRepresentation = "#e8e4dc"): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: base, roughness: 0.4, emissive: color, emissiveIntensity: strength });
  return patch(m, "nightlight", (sh) => {
    sh.uniforms.uNight = LIGHT.uNight;
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uNight;")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance *= 0.04 + 0.96 * uNight;");
  }) as THREE.MeshStandardMaterial;
}
