// The ship's computer, made visible: a column of light in the middle of the server room, in a
// glass tube, rings of light turning round it, racks all round blinking. It is the orchestrator's
// heart, so it shows how busy the ship is: at rest it breathes slowly, dim; with the whole crew at
// work it pulses fast and bright, and the racks' lights race.
//
// The column and the rings are a few meshes with their own shaders; every rack light is one
// instance of one quad (a single draw call), animated on the GPU from a seed and a shared phase.

import * as THREE from "three";
import { LD, LD_CEIL } from "./dims.ts";
import { RACK } from "./furniture.ts";
import { CORE, type RackSpot } from "./lower.ts";
import type { Ship } from "./parts.ts";

export interface Core {
  /** busy: 0..1, already eased. */
  update(dt: number, t: number, busy: number): void;
  dispose(): void;
}

const COLUMN_FRAG = /* glsl */ `
  uniform float uPhase, uLevel, uFlow;
  varying vec2 vUv;
  varying vec3 vN, vV;
  void main() {
    float h = vUv.y, a = vUv.x * 6.2832;
    // Bands of light rising up the column, a finer shimmer through them, bright seams.
    float rise = fract(h * 5.0 - uFlow);
    float band = smoothstep(0.0, 0.08, rise) * smoothstep(0.55, 0.12, rise);
    float fine = 0.5 + 0.5 * sin(h * 80.0 - uFlow * 9.0 + sin(a * 3.0) * 1.5);
    float seam = pow(0.5 + 0.5 * sin(a * 8.0 + h * 4.0 - uFlow * 2.0), 24.0);
    float pulse = 0.72 + 0.28 * sin(uPhase * 6.2832);
    float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
    vec3 cyan = vec3(0.25, 0.85, 1.0), white = vec3(0.85, 0.97, 1.0);
    vec3 col = cyan * (0.35 + 0.9 * band + 0.25 * fine) + white * (seam * 1.2 + rim * 0.8 + band * 0.4 * uLevel);
    col *= uLevel * pulse * 2.4;
    // Brighter in the middle of its height, fading at the caps.
    col *= smoothstep(0.0, 0.12, h) * smoothstep(1.0, 0.85, h) * 0.8 + 0.2;
    gl_FragColor = vec4(col, 1.0);
  }`;

export function createCore(s: Ship, racks: RackSpot[]): Core {
  const group = new THREE.Group();
  group.name = "ship-computer";
  group.position.set(CORE.x, LD, CORE.z);
  const y0 = 0.45, y1 = LD_CEIL - LD - 0.45, H = y1 - y0;

  // The plinth and the cap it hangs from, with lit rings where the column meets them.
  const { inner } = s;
  inner.cyl("dark", CORE.x, LD, CORE.z, 1.55, 0.32, 40);
  inner.cyl("steel", CORE.x, LD + 0.32, CORE.z, 1.3, 0.1, 40);
  inner.cyl("dark", CORE.x, LD_CEIL - 0.42, CORE.z, 1.45, 0.42, 40);
  for (const y of [LD + 0.43, LD_CEIL - 0.44]) {
    const ring = new THREE.TorusGeometry(1.16, 0.04, 8, 48).rotateX(Math.PI / 2).translate(CORE.x, y, CORE.z);
    ring.deleteAttribute("uv");
    inner.add("glowBlue", ring);
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    inner.rod("dark", new THREE.Vector3(CORE.x + Math.cos(a) * 1.25, LD_CEIL - 0.42, CORE.z + Math.sin(a) * 1.25), new THREE.Vector3(CORE.x + Math.cos(a) * 2.2, LD_CEIL, CORE.z + Math.sin(a) * 2.2), 0.05, 6);
  }

  // The column of light.
  const colU = { uPhase: { value: 0 }, uLevel: { value: 0.6 }, uFlow: { value: 0 } };
  const column = new THREE.Mesh(
    new THREE.CylinderGeometry(0.62, 0.62, H, 48, 1, true).translate(0, y0 + H / 2, 0),
    new THREE.ShaderMaterial({
      uniforms: colU,
      vertexShader: "varying vec2 vUv; varying vec3 vN, vV; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalMatrix * normal; vV = -mv.xyz; gl_Position = projectionMatrix * mv; }",
      fragmentShader: COLUMN_FRAG,
      side: THREE.DoubleSide,
    }),
  );
  column.name = "core-column";
  group.add(column);
  // Its glass tube.
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(1.12, 1.12, H, 48, 1, true).translate(0, y0 + H / 2, 0), s.materials.officeGlass);
  tube.renderOrder = 2;
  group.add(tube);
  // Rings of light turning round it, at three heights.
  const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 2.2, 2.8) });
  const rings: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const r = new THREE.Mesh(new THREE.TorusGeometry(0.88 + i * 0.05, 0.018, 6, 64), ringMat);
    r.rotation.x = Math.PI / 2;
    group.add(r);
    rings.push(r);
  }
  // Its light on the room: the one real light down here.
  const light = new THREE.PointLight("#5fd8ff", 4, 15, 1.6);
  light.position.set(0, y0 + H * 0.5, 0);
  group.add(light);
  s.extra.push(group);

  // ---------- the racks' lights ----------
  const PER = 9 * 4;
  const n = racks.length * PER;
  const geo = new THREE.PlaneGeometry(0.028, 0.016);
  const seeds = new Float32Array(n * 2);
  const leds = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: "#ffffff" }), n);
  leds.name = "rack-leds";
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  let k = 0, seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const r of racks) {
    q.setFromAxisAngle(up, r.yaw);
    for (let sv = 0; sv < 9; sv++) for (let j = 0; j < 4; j++) {
      // In the rack's frame: the front at +z, lights down the left of each server.
      p.set(-0.22 + j * 0.045, 0.26 + sv * 0.215, RACK.d / 2 + 0.008).applyQuaternion(q).add(new THREE.Vector3(r.x, LD, r.z));
      m.compose(p, q, one);
      leds.setMatrixAt(k, m);
      const u = rnd();
      seeds[k * 2] = rnd();
      seeds[k * 2 + 1] = j === 0 ? 3 : u < 0.62 ? 0 : u < 0.9 ? 1 : 2; // power (white), then activity: green, blue, amber
      k++;
    }
  }
  geo.setAttribute("aLed", new THREE.InstancedBufferAttribute(seeds, 2));
  const ledU = { uLedT: { value: 0 }, uLevel: { value: 0.5 } };
  leds.material.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, ledU);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec2 aLed; varying vec2 vLed; varying vec3 vLedP;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvLed = aLed; vLedP = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uLedT, uLevel; varying vec2 vLed; varying vec3 vLedP;")
      .replace("#include <color_fragment>", `#include <color_fragment>
        {
          float s = vLed.x, kind = vLed.y;
          vec3 c = kind < 0.5 ? vec3(0.25, 1.0, 0.35) : kind < 1.5 ? vec3(0.2, 0.75, 1.0) : kind < 2.5 ? vec3(1.0, 0.65, 0.15) : vec3(0.85, 0.95, 1.0);
          // Each light flickers at its own rate; a chase of light runs down each row, faster with work.
          float blink = step(0.45 - 0.25 * uLevel, fract(s * 13.7 + uLedT * (0.6 + 2.2 * s)));
          float chase = smoothstep(0.82, 1.0, fract(vLedP.z * 0.11 + vLedP.y * 0.22 + s * 0.08 - uLedT * 0.35));
          float on = kind > 2.5 ? 0.8 : blink * (0.35 + 0.65 * uLevel) + chase * (0.4 + 1.6 * uLevel);
          diffuseColor.rgb = c * (0.08 + on * 3.2);
        }`);
  };
  leds.material.customProgramCacheKey = () => "rack-leds";
  leds.frustumCulled = false;
  s.extra.push(leds);

  // ---------- the engine room's gauge needles ----------
  const gauges = s.gauges ?? [];
  const needles = new THREE.InstancedMesh(new THREE.BoxGeometry(0.012, 0.19, 0.006).translate(0, 0.08, 0), new THREE.MeshStandardMaterial({ color: "#c0281e", roughness: 0.4 }), Math.max(1, gauges.length));
  needles.name = "gauge-needles";
  needles.count = gauges.length;
  s.extra.push(needles);
  const nq = new THREE.Quaternion(), fwd = new THREE.Vector3(0, 0, 1);

  let phase = 0, flow = 0, ledT = 0, spin = 0;
  return {
    update(dt, t, busy) {
      // Faster and brighter with work: about one beat in 3 s at rest, two a second flat out.
      phase += dt * (0.33 + 1.7 * busy);
      flow += dt * (0.25 + 1.4 * busy);
      ledT += dt * (0.5 + 4.5 * busy);
      spin += dt * (0.4 + 2.2 * busy);
      colU.uPhase.value = phase;
      colU.uFlow.value = flow;
      colU.uLevel.value = 0.45 + 0.75 * busy;
      ledU.uLedT.value = ledT;
      ledU.uLevel.value = busy;
      const beat = 0.75 + 0.25 * Math.sin(phase * Math.PI * 2);
      light.intensity = (2.5 + 9 * busy) * beat;
      rings.forEach((r, i) => {
        r.position.y = y0 + H * (0.2 + 0.3 * i) + Math.sin(spin * 0.7 + i * 2.1) * H * 0.12;
        r.rotation.x = Math.PI / 2 + Math.sin(spin + i) * 0.18;
        r.rotation.z = spin * (i % 2 ? -1 : 1);
      });
      ringMat.color.setRGB(0.6, 2.2, 2.8).multiplyScalar((0.5 + 0.9 * busy) * beat);
      gauges.forEach((g, i) => {
        const a = -0.9 + 1.2 * (0.3 + 0.5 * busy) + Math.sin(t * (1.3 + i * 0.4) + i) * 0.06 + Math.sin(t * 9 + i * 3) * 0.015;
        m.compose(g, nq.setFromAxisAngle(fwd, -a * (i % 2 ? 1 : 0.8)), one);
        needles.setMatrixAt(i, m);
      });
      needles.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      column.geometry.dispose();
      (column.material as THREE.Material).dispose();
      tube.geometry.dispose();
      ringMat.dispose();
      for (const r of rings) r.geometry.dispose();
      geo.dispose();
      leds.material.dispose();
      needles.geometry.dispose();
      (needles.material as THREE.Material).dispose();
      light.dispose();
    },
  };
}
