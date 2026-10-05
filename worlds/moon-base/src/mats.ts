// The base's palette, after the concept art: grey regolith printed in thick horizontal layers,
// white structures, orange equipment and accents, warm amber window light against the cold
// grey, blue ice in the pit, green leaves under pink grow lights. Glass only for the hub dome,
// the greenhouse, the sports dome and the lookout.

import * as THREE from "three";
import { LIGHT, glass, nightLight, paint, patch, wear } from "@offsite/kit";

/**
 * How busy the base is, 0 (everyone off duty) to 1 (the whole crew at work), eased. The work
 * hall's lights and the status strips read it.
 */
export const BUSY = { value: 0.4 };

// Cheap value noise for the regolith, in world metres.
const NOISE = /* glsl */ `
  float rgH(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
  float rgN(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(rgH(i), rgH(i + vec3(1, 0, 0)), f.x), mix(rgH(i + vec3(0, 1, 0)), rgH(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(rgH(i + vec3(0, 0, 1)), rgH(i + vec3(1, 0, 1)), f.x), mix(rgH(i + vec3(0, 1, 1)), rgH(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }`;

/**
 * Regolith. Flat ground is mottled and pebbled; anything upright is 3D-printed: thick horizontal
 * beads `layer` metres high with dark grooves between, the way the printed habs and terrace walls
 * are drawn. All of it in world space, so instanced shells line up with the walls behind them.
 */
function regolith(color: string, { layer = 0.32, bands = 1, rough = 0.96, mottle = 1, warm = 0 } = {}): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0 });
  if (warm > 0) { m.emissive.set("#ffd2a0"); m.emissiveIntensity = warm; }
  return patch(m, `regolith:${layer}:${bands}:${mottle}`, (sh) => {
    sh.uniforms.uNight = LIGHT.uNight;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vRgP; varying vec3 vRgN;")
      .replace("#include <project_vertex>", `#include <project_vertex>
        #ifdef USE_INSTANCING
          vRgP = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
          vRgN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
        #else
          vRgP = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vRgN = normalize(mat3(modelMatrix) * objectNormal);
        #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>
        varying vec3 vRgP; varying vec3 vRgN;
        ${NOISE}
        float rgUp = 0.0, rgRidge = 1.0, rgNear = 1.0;
        float rgHeight(vec3 p) {
          float layer = fract(p.y / ${layer.toFixed(3)});
          float bead = smoothstep(0.0, 0.3, layer) * smoothstep(1.0, 0.7, layer);
          // The beads fade out where they'd be finer than a few pixels, so far walls don't shimmer.
          return (1.0 - rgUp) * ${bands.toFixed(2)} * bead * 0.05 * rgNear + rgN(p * 1.7) * 0.03 + rgN(p * 7.3) * 0.008 * rgNear;
        }`)
      .replace("#include <color_fragment>", `#include <color_fragment>
        {
          vec3 n = normalize(vRgN);
          rgUp = smoothstep(0.45, 0.8, abs(n.y));
          float layer = fract(vRgP.y / ${layer.toFixed(3)});
          float dl = fwidth(vRgP.y / ${layer.toFixed(3)});
          float groove = 1.0 - smoothstep(0.0, 0.12 + dl, min(layer, 1.0 - layer));
          rgNear = 1.0 - smoothstep(0.08, 0.25, dl);
          groove *= 1.0 - smoothstep(0.12, 0.35, dl);
          rgRidge = 1.0 - groove * (1.0 - rgUp) * ${bands.toFixed(2)};
          float big = rgN(vRgP * 0.045), mid = rgN(vRgP * 0.37), fine = rgN(vRgP * 3.1);
          float tone = 0.84 + 0.22 * big + ${(0.18 * mottle).toFixed(3)} * (mid - 0.5) + 0.1 * (fine - 0.5);
          // Pebbles and small dark pits on the flat.
          float peb = step(0.9, rgN(vRgP * 5.3 + 2.1)) * rgUp;
          diffuseColor.rgb *= tone * (1.0 - 0.18 * peb) * mix(1.0, 0.62, groove * (1.0 - rgUp) * ${bands.toFixed(2)});
        }`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
        {
          // A bump from rgHeight (three's perturbNormalArb, on a procedural height).
          float h = rgHeight(vRgP);
          vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition);
          float dhx = dFdx(h), dhy = dFdy(h);
          vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
          float det = dot(sx, r1);
          vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
          normal = normalize(abs(det) * normal - grad);
        }`)
      .replace("#include <aomap_fragment>", "#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= rgRidge;");
  }) as THREE.MeshStandardMaterial;
}

/** Emissive that comes up after dark: by day `day` of it, at night all of it. */
function nightBoost(m: THREE.MeshStandardMaterial, key: string, day: number): THREE.MeshStandardMaterial {
  return patch(m, `boost:${key}`, (sh) => {
    sh.uniforms.uNight = LIGHT.uNight;
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uNight;")
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>\ntotalEmissiveRadiance *= ${day.toFixed(3)} + ${(1 - day).toFixed(3)} * uNight;`);
  }) as THREE.MeshStandardMaterial;
}

/** Emissive scaled by how busy the base is: dim at rest, full when everyone is working. */
function busyGlow(m: THREE.MeshStandardMaterial, key: string, rest: number, full: number, night = 0): THREE.MeshStandardMaterial {
  return patch(m, `busy:${key}`, (sh) => {
    sh.uniforms.uBusy = BUSY;
    sh.uniforms.uNight = LIGHT.uNight;
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uBusy, uNight;")
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
        totalEmissiveRadiance *= max(${rest.toFixed(3)} + ${(full - rest).toFixed(3)} * uBusy, ${night.toFixed(3)} * uNight);`);
  }) as THREE.MeshStandardMaterial;
}

/**
 * Glass that glows from inside after dark: the domes lit up in the night overview. The glow is
 * for whoever looks at it from outside (its front faces); from inside, it stays clear glass.
 */
function litGlass(color: string, opacity: number, glow: string, amount: number, day = 0.12): THREE.MeshPhysicalMaterial {
  const m = glass({ color, opacity });
  // Big curved panes catch the sun: a softer glint than a yacht's windows, so it doesn't blind.
  m.specularIntensity = 0.22;
  m.roughness = 0.22;
  m.emissive.set(glow);
  m.emissiveIntensity = amount;
  return patch(m, `litglass:${glow}:${day}`, (sh) => {
    sh.uniforms.uNight = LIGHT.uNight;
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uNight;")
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>\ntotalEmissiveRadiance *= (${day.toFixed(3)} + ${(1 - day).toFixed(3)} * uNight) * (gl_FrontFacing ? 1.0 : 0.12);`);
  }) as THREE.MeshPhysicalMaterial;
}

/** Solar panels: deep blue cells in a silver grid, in the panel's own frame (they're instanced). */
function solar(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: "#1d3170", roughness: 0.3, metalness: 0.25, envMapIntensity: 0.8 });
  return patch(m, "solar", (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vSoP;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvSoP = position;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vSoP;")
      .replace("#include <color_fragment>", `#include <color_fragment>
        {
          vec2 q = vec2(vSoP.x / 0.42, vSoP.z / 0.42);
          vec2 f = abs(fract(q) - 0.5), dq = fwidth(q);
          float line = 1.0 - smoothstep(0.44 - dq.x, 0.44 + dq.x, max(f.x, f.y));
          line *= 1.0 - smoothstep(0.3, 0.6, max(dq.x, dq.y));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.66, 0.72), line * 0.8);
        }`);
  }) as THREE.MeshStandardMaterial;
}

/** The pit's floor: dark wet rock with veins of blue ice glowing through it. */
function iceFloor(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: "#2b3036", roughness: 0.45, metalness: 0.05, emissive: "#2a8cff", emissiveIntensity: 1.2 });
  return patch(m, "icefloor", (sh) => {
    sh.uniforms.uNight = LIGHT.uNight;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vIfP;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvIfP = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>\nuniform float uNight; varying vec3 vIfP;\n${NOISE}`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
        {
          float n = rgN(vIfP * 0.35) * 0.6 + rgN(vIfP * 1.3) * 0.4;
          float vein = smoothstep(0.485, 0.5, n) * (1.0 - smoothstep(0.5, 0.515, n));
          float pool = smoothstep(0.66, 0.8, n);
          totalEmissiveRadiance *= (vein * 0.35 + pool * 0.7) * (0.45 + 0.55 * uNight);
        }`);
  }) as THREE.MeshStandardMaterial;
}

export function makeMaterials() {
  // Floor plates inside: light grey, worn, with a warm wash from the rooms' own light.
  const floor = new THREE.MeshStandardMaterial({ color: "#b4b7bb", roughness: 0.5, metalness: 0.1, emissive: "#ffe2c0", emissiveIntensity: 0.1 });
  wear(floor, "painted-metal", { albedo: 0.6, normal: 0.9, tile: 1.1 });
  const white = paint("#eceae4", 0.42);
  wear(white, "painted-metal", { albedo: 0.25, normal: 0.35, tile: 2.0 });
  const orange = paint("#e8742a", 0.42);
  wear(orange, "painted-metal", { albedo: 0.3, normal: 0.4, tile: 1.5 });
  const crate = paint("#e9772b", 0.5);
  wear(crate, "plastic", { space: "object", albedo: 0.3, normal: 0.5 });
  const seat = new THREE.MeshStandardMaterial({ color: "#f07a2e", roughness: 0.75 });
  wear(seat, "fabric", { space: "object", albedo: 0.25, normal: 0.7, tile: 0.4 });
  const cushion = new THREE.MeshStandardMaterial({ color: "#8d9196", roughness: 0.8 });
  wear(cushion, "fabric", { space: "object", albedo: 0.25, normal: 0.7, tile: 0.4 });
  const leaf = new THREE.MeshStandardMaterial({ color: "#5aa83c", roughness: 0.6, side: THREE.DoubleSide, emissive: "#3c6f22", emissiveIntensity: 0.25 });
  // The terrain is one skin, with nothing under it: it has to cast its shadows from either side
  // (the terraces over the work hall keep the sun out of it).
  const skin = <M extends THREE.Material>(m: M) => { m.shadowSide = THREE.DoubleSide; return m; };
  return {
    ground: skin(regolith("#9b9a96")),
    // The printed walls of the habs and buildings, a touch lighter than the ground.
    printed: skin(regolith("#aaa8a2", { layer: 0.3 })),
    // Inside: the same printed walls, warmed by the rooms' own lights.
    inWall: regolith("#bdbcb8", { layer: 0.28, warm: 0.1 }),
    rock: skin(regolith("#7d7a75", { bands: 0, mottle: 1.6 })),
    white,
    whiteIn: new THREE.MeshStandardMaterial({ color: "#efece6", roughness: 0.6, emissive: "#fff1de", emissiveIntensity: 0.2 }),
    orange,
    crate,
    seat,
    cushion,
    dark: new THREE.MeshStandardMaterial({ color: "#23262b", roughness: 0.45, metalness: 0.3 }),
    steel: new THREE.MeshStandardMaterial({ color: "#a3a8ae", roughness: 0.38, metalness: 0.8 }),
    floor,
    // Pads, roads and the court: smooth sintered regolith.
    pad: skin(regolith("#6f6c69", { bands: 0, mottle: 0.4, rough: 0.85 })),
    hubGlass: litGlass("#a9c6d8", 0.12, "#ffcf8f", 0.18),
    greenGlass: litGlass("#c4dccf", 0.12, "#d8f59a", 0.6, 0.03),
    sportsGlass: litGlass("#b7cce0", 0.14, "#bfe2ff", 0.22),
    lookGlass: litGlass("#a9c6d8", 0.12, "#ffcf8f", 0.15),
    // Small round viewports: warm light behind thick glass, brighter after dark.
    viewport: nightBoost(new THREE.MeshStandardMaterial({ color: "#2a1d10", roughness: 0.15, metalness: 0.2, emissive: "#ffad55", emissiveIntensity: 2.0 }), "viewport", 0.75),
    // Light strips and lamps: amber, a little lit by day, bright after dark.
    amber: nightBoost(new THREE.MeshStandardMaterial({ color: "#ffd9a8", roughness: 0.4, emissive: "#ffae52", emissiveIntensity: 3.2 }), "amber", 0.6),
    lamp: nightLight("#ffc27a", 5),
    // The work hall's ceiling lights, up as the crew gets to work.
    panel: busyGlow(new THREE.MeshStandardMaterial({ color: "#ffffff", emissive: "#ffe6c4", emissiveIntensity: 1.6, roughness: 0.5 }), "panel", 0.65, 1.4),
    // Status strips round the work hall: dark at rest, cyan as the crew get going.
    status: busyGlow(new THREE.MeshStandardMaterial({ color: "#0e2430", emissive: "#28e0ff", emissiveIntensity: 5, roughness: 0.3 }), "status", 0.0, 1.0),
    glowBlue: new THREE.MeshStandardMaterial({ color: "#0d2233", emissive: "#3fb6ff", emissiveIntensity: 2.2, roughness: 0.3 }),
    ice: nightBoost(new THREE.MeshStandardMaterial({ color: "#a8e6ff", roughness: 0.12, metalness: 0.05, emissive: "#3aa8ff", emissiveIntensity: 1.6 }), "ice", 0.55),
    iceFloor: iceFloor(),
    grow: new THREE.MeshStandardMaterial({ color: "#ffd6f6", emissive: "#ff5fd8", emissiveIntensity: 3.0, roughness: 0.4 }),
    leaf,
    soil: new THREE.MeshStandardMaterial({ color: "#3b2c20", roughness: 1 }),
    tank: new THREE.MeshStandardMaterial({ color: "#7cc79a", roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.8, emissive: "#2f8a52", emissiveIntensity: 0.4 }),
    solar: solar(),
    court: new THREE.MeshStandardMaterial({ color: "#3f7fd0", roughness: 0.7, metalness: 0.0, emissive: "#2a5fae", emissiveIntensity: 0.35 }),
    courtLine: nightBoost(new THREE.MeshStandardMaterial({ color: "#ffd9b0", emissive: "#ff9a3c", emissiveIntensity: 2.4, roughness: 0.4 }), "courtline", 0.7),
    // Red beacons on the masts, ring lights round the pads.
    red: nightBoost(new THREE.MeshStandardMaterial({ color: "#5a0d0a", emissive: "#ff2a1a", emissiveIntensity: 4, roughness: 0.4 }), "red", 0.6),
    padRing: nightBoost(new THREE.MeshStandardMaterial({ color: "#5a3c14", emissive: "#ffb347", emissiveIntensity: 3, roughness: 0.4 }), "padring", 0.35),
    rubber: new THREE.MeshStandardMaterial({ color: "#26282b", roughness: 0.9 }),
  };
}

export type Mats = ReturnType<typeof makeMaterials>;
export type MatKey = keyof Mats;

/** Which piles cast shadows: glass and lights don't. */
export function castsShadow(k: MatKey): boolean {
  return !["hubGlass", "greenGlass", "sportsGlass", "lookGlass", "viewport", "amber", "lamp", "panel", "status", "grow", "courtLine", "red", "padRing", "glowBlue"].includes(k);
}
