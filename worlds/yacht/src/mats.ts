// The yacht's palette, after the concept art: gloss white paint, a dark navy boot stripe, long
// dark window bands, warm teak decks, glass balustrades and chrome, white canvas.

import * as THREE from "three";
import {
  canvas, chrome, darkGlass, glass, hullPaint, nightLight, paint, patch, poolTile, poolWaterMaterial, surfaceMaterial, teak, wear, LIGHT,
} from "@offsite/kit";
import { D3 } from "./dims.ts";

// Dark shapes painted on the hull's sides: long window bands with slanted ends, rows of portholes,
// the anchor's pocket. (z0, y0, z1, y1), the slant of their ends (dz per metre up), corner radius.
const BANDS: [number, number, number, number, number, number][] = [
  [-50.5, 6.7, -39.4, 8.6, 0.9, 0.25], // forward, under the foredeck
  [-10.5, 2.3, 35.5, 3.9, -1.2, 0.3], // the long band aft
  [42.5, 2.8, 50.5, 3.6, -0.8, 0.2],
];
const POCKET = new THREE.Vector4(-59.6, 2.6, -57.4, 4.6); // the anchor's pocket: dark, but not a window
const PORTS: [number, number, number, number][] = [
  // first z, y, spacing, count
  [-35.5, 3.4, 2.45, 9],
  [-46.5, 3.6, 2.2, 3],
  [-62.2, 8.3, 2.6, 3],
];

function hullMaterial(): THREE.MeshPhysicalMaterial {
  const m = hullPaint("#f4f5f2");
  const bands = BANDS.map(([z0, y0, z1, y1]) => new THREE.Vector4(z0, y0, z1, y1));
  const bandX = BANDS.map(([, , , , s, r]) => new THREE.Vector2(s, r));
  const ports = PORTS.map(([z, y, s, n]) => new THREE.Vector4(z, y, s, n));
  return patch(m, "yacht-hull", (sh) => {
    Object.assign(sh.uniforms, { uBands: { value: bands }, uBandX: { value: bandX }, uPorts: { value: ports }, uPocket: { value: POCKET }, uNight: LIGHT.uNight });
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vHP; varying vec3 vHN;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvHP = (modelMatrix * vec4(transformed, 1.0)).xyz; vHN = mat3(modelMatrix) * objectNormal;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>
        varying vec3 vHP; varying vec3 vHN;
        uniform vec4 uBands[${BANDS.length}];
        uniform vec2 uBandX[${BANDS.length}];
        uniform vec4 uPorts[${PORTS.length}];
        uniform vec4 uPocket;
        uniform float uNight;
        float hullGlass = 0.0, hullBoot = 0.0;
        float sdBox(vec2 p, vec2 h, float r) { vec2 q = abs(p) - h + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }`)
      .replace("#include <color_fragment>", `#include <color_fragment>
        {
          vec2 p = vec2(vHP.z, vHP.y);
          float side = smoothstep(0.25, 0.5, abs(normalize(vHN).x));
          float d = 1e3;
          for (int i = 0; i < ${BANDS.length}; i++) {
            vec4 b = uBands[i];
            vec2 q = vec2(p.x - uBandX[i].x * (p.y - b.y), p.y);
            d = min(d, sdBox(q - 0.5 * (b.xy + b.zw), 0.5 * (b.zw - b.xy), uBandX[i].y));
          }
          for (int i = 0; i < ${PORTS.length}; i++) {
            vec4 r = uPorts[i];
            float k = clamp(floor((p.x - r.x) / r.z + 0.5), 0.0, r.w - 1.0);
            d = min(d, sdBox(p - vec2(r.x + k * r.z, r.y), vec2(0.3, 0.2), 0.1));
          }
          float aa = fwidth(d) + 1e-4;
          hullGlass = (1.0 - smoothstep(-aa, aa, d)) * side;
          hullBoot = 1.0 - smoothstep(0.72 - 0.02, 0.72 + 0.02, vHP.y);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.055, 0.1, 0.2), hullBoot);
          float dp = sdBox(vec2(p.x - 0.4 * (p.y - uPocket.y), p.y) - 0.5 * (uPocket.xy + uPocket.zw), 0.5 * (uPocket.zw - uPocket.xy), 0.15);
          float pocket = (1.0 - smoothstep(-aa, aa, dp)) * side;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.012, 0.02, 0.03), max(hullGlass, pocket));
        }`)
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.05, hullGlass);")
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
        {
          // At night the cabins behind the windows are lit, each a little differently.
          float k = fract(sin(floor(vHP.z / 3.1) * 12.9898 + floor(vHP.y * 0.8) * 4.1) * 43758.5453);
          totalEmissiveRadiance += vec3(1.0, 0.74, 0.45) * hullGlass * uNight * (0.12 + 0.3 * k);
        }`);
  }) as THREE.MeshPhysicalMaterial;
}

/** Ceilings: their faint bounce light becomes the warm wash of the deck lights after dark. */
function nightWash(m: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  return patch(m, "nightwash", (sh) => {
    sh.uniforms.uNight = LIGHT.uNight;
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uNight;")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance *= 1.0 + 2.6 * uNight;");
  }) as THREE.MeshStandardMaterial;
}

export function makeMaterials() {
  const floor = new THREE.MeshStandardMaterial({ color: "#c79f74", roughness: 0.55 });
  wear(floor, "wood", { albedo: 0.7, normal: 0.5, tile: 2.6 });
  const pad = new THREE.MeshStandardMaterial({ color: "#3b4048", roughness: 0.85 });
  wear(pad, "rubber", { albedo: 0.25, normal: 0.6, tile: 1.2 });
  const leaf = new THREE.MeshStandardMaterial({ color: "#3d7a34", roughness: 0.65, side: THREE.DoubleSide });
  const sail = canvas("#f7f6f1", { side: THREE.DoubleSide });
  return {
    hull: hullMaterial(),
    white: paint("#f3f3ef", 0.3),
    // Ceilings and the undersides of decks, glowing faintly with light bounced up off the teak.
    under: nightWash(new THREE.MeshStandardMaterial({ color: "#efece6", roughness: 0.7, emissive: "#f1e2cf", emissiveIntensity: 0.16 })),
    navy: paint("#1b2b4b", 0.35),
    teak: teak(),
    floor: nightWash(floor),
    darkGlass: darkGlass({ pane: 2.6, lit: 0.6 }),
    rail: glass({ color: "#a9d0da", opacity: 0.14 }), // glass balustrades
    officeGlass: glass({ color: "#5d8296", opacity: 0.2 }),
    frame: paint("#2a3038", 0.4),
    bridgeGlass: glass({ color: "#13232e", opacity: 0.55 }),
    chrome: chrome(),
    steel: chrome("#c9ced3", 0.3),
    pad,
    cushion: canvas("#f7f4ec"),
    accent: canvas("#2c5a8c"), // pillows, towels, bunting
    seat: canvas("#3a404c"), // office chairs
    wood: surfaceMaterial("wood", "#a8723f"),
    deskTop: surfaceMaterial("wood", "#dcc19a"),
    dark: new THREE.MeshStandardMaterial({ color: "#16191e", roughness: 0.4, metalness: 0.2 }),
    leaf,
    pot: paint("#efeee8", 0.55),
    soil: new THREE.MeshStandardMaterial({ color: "#3b2c20", roughness: 1 }),
    tile: poolTile({ waterY: D3 - 0.12 }),
    poolWater: poolWaterMaterial(),
    tubWater: poolWaterMaterial({ bubbles: 0.55, color: "#4fd2de" }),
    sail,
    lamp: nightLight("#ffd29a", 4),
    glowBlue: new THREE.MeshStandardMaterial({ color: "#0d2233", emissive: "#3fb6ff", emissiveIntensity: 2.2, roughness: 0.3 }),
    panel: new THREE.MeshStandardMaterial({ color: "#ffffff", emissive: "#fff2df", emissiveIntensity: 1.3, roughness: 0.5 }),
    bottle: new THREE.MeshStandardMaterial({ color: "#5f8f6a", roughness: 0.15, metalness: 0.1 }),
  };
}

export type Mats = ReturnType<typeof makeMaterials>;
export type MatKey = keyof Mats;

/** Which piles cast shadows: glass, water and lights don't. */
export function castsShadow(k: MatKey): boolean {
  return !["rail", "officeGlass", "bridgeGlass", "poolWater", "tubWater", "lamp", "panel"].includes(k);
}
