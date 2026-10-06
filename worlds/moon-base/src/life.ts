// The small things that make the base feel alive, each a draw call or so:
//   halos      path lights, pad lights, beacons blinking on the masts and the tower: glow sprites
//              that read from across the crater, each lit by its own rule (after dark, blinking…)
//   pools      the warm circles path lights throw on the regolith after dark
//   a rover    driving the loop: down the west ramp, across the floor, up the north-east ramp and
//              round the first terrace, its wheels turning, leaning on the slopes
//   ice        blocks of glowing ice riding the conveyor up out of the pit
//   a ball     bouncing round the sports dome in a sixth of a gee, through the hoops now and then
//   dust       motes drifting over the crater, glinting where the sun catches them
// (Halos and pools after the yacht's, worlds/yacht/src/life.ts.)

import * as THREE from "three";
import { LIGHT, patch } from "@offsite/kit";
import { BUSY, type Mats, type MatKey } from "./mats.ts";
import { RAMPS, RAMP, RISER_R, TIER_Y } from "./dims.ts";
import { landingEnd, rampHeight } from "./crater.ts";
import { Pile, polar, deg } from "./kit.ts";
import { ROVER, roverBody, roverWheel } from "./furniture.ts";
import type { Base, Halo } from "./parts.ts";

// ---------- halos ----------

const MODES = { always: 0, night: 1, busy: 2, strobe: 3, blink: 4 } as const;

export function halos(list: Halo[]): THREE.Points {
  const pos: number[] = [], col: number[] = [], size: number[] = [], mode: number[] = [];
  const c = new THREE.Color();
  for (const h of list) {
    pos.push(h.x, h.y, h.z);
    c.set(h.color);
    col.push(c.r, c.g, c.b);
    size.push(h.size);
    mode.push(MODES[h.mode]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aColor", new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute("aSize", new THREE.Float32BufferAttribute(size, 1));
  g.setAttribute("aMode", new THREE.Float32BufferAttribute(mode, 1));
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: LIGHT.uTime, uNight: LIGHT.uNight, uBusy: BUSY, uScale: { value: 900 } },
    vertexShader: /* glsl */ `
      attribute vec3 aColor; attribute float aSize, aMode;
      uniform float uTime, uNight, uBusy, uScale;
      varying vec3 vColor; varying float vOn;
      void main() {
        float on = 1.0;
        if (aMode > 0.5 && aMode < 1.5) on = 0.15 + 0.85 * uNight;
        else if (aMode > 1.5 && aMode < 2.5) on = clamp(max(-0.15 + 1.15 * uBusy, 0.8 * uNight), 0.0, 1.0);
        else if (aMode > 2.5 && aMode < 3.5) { float f = fract(uTime / 1.5); on = (step(f, 0.04) + step(0.12, f) * step(f, 0.16)) * (0.5 + 0.5 * uNight); }
        else if (aMode > 3.5) on = step(0.5, fract(uTime / 1.8 + position.x * 0.13 + position.z * 0.07)) * (0.55 + 0.45 * uNight);
        vOn = on;
        vColor = aColor;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = on < 0.01 ? 0.0 : clamp(aSize * uScale / -mv.z, 2.0, 90.0) * (0.6 + 0.4 * uNight);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor; varying float vOn;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        float core = smoothstep(0.22, 0.0, r), glow = exp(-r * 3.2) * (1.0 - r);
        float a = (core * 3.0 + glow * 0.9) * vOn;
        if (a < 0.002) discard;
        gl_FragColor = vec4(vColor * a, 1.0);
      }`,
  });
  const pts = new THREE.Points(g, m);
  pts.name = "halos";
  pts.frustumCulled = false;
  pts.renderOrder = 5;
  pts.onBeforeRender = (r) => { m.uniforms.uScale!.value = r.getDrawingBufferSize(_v2).y * 0.9; };
  return pts;
}
const _v2 = new THREE.Vector2();

// ---------- pools of light ----------

export function lightPools(spots: { x: number; y: number; z: number; r: number; k?: number }[]): THREE.InstancedMesh {
  const geo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    uniforms: { uNight: LIGHT.uNight },
    vertexShader: "attribute float aK; varying float vK; varying vec2 vUv; void main(){ vK = aK; vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0); }",
    fragmentShader: /* glsl */ `
      uniform float uNight; varying vec2 vUv; varying float vK;
      void main() {
        float r = length(vUv);
        float a = (exp(-r * r * 3.2) * 0.85 + smoothstep(1.0, 0.0, r) * 0.15) * smoothstep(1.0, 0.85, r) * uNight;
        if (a < 0.003) discard;
        gl_FragColor = vec4(vec3(1.0, 0.7, 0.4) * a * 0.42 * vK, 1.0);
      }`,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, spots.length));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  spots.forEach(({ x, y, z, r }, i) => mesh.setMatrixAt(i, m.compose(p.set(x, y + 0.03, z), q, s.set(r, 1, r))));
  geo.setAttribute("aK", new THREE.InstancedBufferAttribute(new Float32Array(spots.map((sp) => sp.k ?? 1)), 1));
  mesh.count = spots.length;
  mesh.name = "light-pools";
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  return mesh;
}

// ---------- the rover's loop ----------

/** The rover's way round: down the west ramp, across the floor, up the north-east one, round T1 to the west ramp again. */
export function roverLoop(): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  const w0 = RAMPS.find((r) => r.id === "w0")!, ne0 = RAMPS.find((r) => r.id === "ne0")!;
  const lane = RISER_R[0]! - RAMP.w / 2;
  const T1 = TIER_Y[1]!, road = RISER_R[0]! + 5.6;
  const wMid = (w0.top + landingEnd(w0)) / 2, nMid = (ne0.top + landingEnd(ne0)) / 2;
  // From the middle of the west ramp's landing, down to its foot.
  for (let i = 0; i <= 24; i++) {
    const a = wMid + ((w0.foot - wMid) * i) / 24;
    const [x, z] = polar(a, lane);
    pts.push(new THREE.Vector3(x, (rampHeight(w0, a) ?? 0) + 0.03, z));
  }
  // Across the north of the floor, well clear of the pad and the hub.
  for (let i = 1; i < 16; i++) {
    const a = w0.foot + deg(4) + ((ne0.foot - deg(4) - (w0.foot + deg(4))) * i) / 16;
    const r = 52 - 6 * Math.sin((i / 16) * Math.PI);
    const [x, z] = polar(a, r);
    pts.push(new THREE.Vector3(x, 0, z));
  }
  // Up the north-east ramp to the middle of its landing.
  for (let i = 0; i <= 24; i++) {
    const a = ne0.foot + ((nMid - ne0.foot) * i) / 24;
    const [x, z] = polar(a, lane);
    pts.push(new THREE.Vector3(x, (rampHeight(ne0, a) ?? T1) + 0.03, z));
  }
  // Straight off it onto the terrace, round it clockwise, and straight onto the west ramp's landing.
  const from = nMid, to = wMid + Math.PI * 2;
  const n = Math.ceil(((to - from) * road) / 4);
  for (let i = 0; i <= n; i++) {
    const a = from + ((to - from) * i) / n;
    const [x, z] = polar(a, road);
    pts.push(new THREE.Vector3(x, T1, z));
  }
  return pts;
}

class Loop {
  private pts: THREE.Vector3[];
  private len: number[] = [0];
  constructor(pts: THREE.Vector3[]) {
    this.pts = [...pts, pts[0]!];
    for (let i = 1; i < this.pts.length; i++) this.len.push(this.len[i - 1]! + this.pts[i]!.distanceTo(this.pts[i - 1]!));
  }
  get length() { return this.len[this.len.length - 1]!; }
  at(d: number, out: THREE.Vector3): THREE.Vector3 {
    const L = this.length, dd = ((d % L) + L) % L;
    let lo = 0, hi = this.len.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (this.len[mid]! < dd) lo = mid; else hi = mid; }
    const l0 = this.len[lo]!, l1 = this.len[hi]!, t = l1 > l0 ? (dd - l0) / (l1 - l0) : 0;
    return out.copy(this.pts[lo]!).lerp(this.pts[hi]!, t);
  }
}

function makeRover(mats: Mats): { root: THREE.Group; wheels: THREE.Object3D[]; dispose(): void } {
  const body = new Pile<MatKey>();
  roverBody(body);
  const root = new THREE.Group();
  root.name = "rover";
  const bodyG = body.build(mats);
  root.add(bodyG);
  const wheelP = new Pile<MatKey>();
  roverWheel(wheelP, 0, 0, 0);
  const wheelG = wheelP.build(mats);
  const wheels: THREE.Object3D[] = [];
  for (const z of ROVER.axles) for (const sx of [-1, 1]) {
    const w = wheelG.clone();
    w.position.set(sx * ROVER.track, ROVER.wheelR, z);
    if (sx < 0) w.scale.x = -1;
    root.add(w);
    wheels.push(w);
  }
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { root, wheels, dispose: () => root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); }) };
}

// ---------- dust ----------

function dustMotes(): THREE.Points {
  const N = 900, R = 60;
  const pos = new Float32Array(N * 3), seed = new Float32Array(N);
  let s = 31;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < N; i++) { pos[i * 3] = (rnd() - 0.5) * 2 * R; pos[i * 3 + 1] = rnd() * 9; pos[i * 3 + 2] = (rnd() - 0.5) * 2 * R; seed[i] = rnd(); }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: LIGHT.uTime, uCam: { value: new THREE.Vector3() }, uSun: LIGHT.uSun, uScale: { value: 900 } },
    vertexShader: /* glsl */ `
      attribute float aSeed; uniform float uTime, uScale; uniform vec3 uCam;
      varying float vA;
      void main() {
        float R = 60.0;
        vec3 p = position + vec3(sin(uTime * 0.05 + aSeed * 40.0) * 3.0, sin(uTime * 0.07 + aSeed * 17.0) * 1.2, uTime * (0.25 + aSeed * 0.3));
        // Wrap round the camera, so there are always motes about.
        p.xz = uCam.xz + mod(p.xz - uCam.xz + R, 2.0 * R) - R;
        p.y += uCam.y - 4.0;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float d = -mv.z;
        vA = smoothstep(55.0, 20.0, d) * smoothstep(0.5, 3.0, d) * (0.35 + 0.65 * fract(aSeed * 7.0));
        gl_PointSize = clamp(0.06 * uScale / d, 1.0, 4.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSun; varying float vA;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        float a = smoothstep(1.0, 0.0, r) * vA * 0.5;
        if (a < 0.003) discard;
        gl_FragColor = vec4((vec3(0.08) + uSun * 0.35) * a, 1.0);
      }`,
  });
  const pts = new THREE.Points(g, m);
  pts.name = "dust";
  pts.frustumCulled = false;
  pts.onBeforeRender = (r, _s, cam) => {
    m.uniforms.uScale!.value = r.getDrawingBufferSize(_v2).y * 0.9;
    (m.uniforms.uCam!.value as THREE.Vector3).setFromMatrixPosition(cam.matrixWorld);
  };
  return pts;
}

// ---------- putting it together ----------

export interface Life {
  objects: THREE.Object3D[];
  update(dt: number, t: number): void;
  dispose(): void;
}

export function buildLife(s: Base, mats: Mats): Life {
  const objects: THREE.Object3D[] = [];
  objects.push(halos(s.halos), lightPools(s.pools), dustMotes());

  // The rover.
  const rover = makeRover(mats);
  const loop = new Loop(roverLoop());
  objects.push(rover.root);
  const p0 = new THREE.Vector3(), p1 = new THREE.Vector3(), p2 = new THREE.Vector3();
  const SPEED = 5.5;

  // Ice riding the conveyor.
  const path = s.marks.get("conveyor") ?? [];
  const belt = path.length > 1 ? new Loop([...path, ...path.slice(1, -1).reverse()]) : null;
  const beltLen = path.reduce((n, p, i) => (i ? n + p.distanceTo(path[i - 1]!) : 0), 0);
  const blockGeo = new THREE.BoxGeometry(0.62, 0.42, 0.55);
  const BLOCKS = 12;
  const ice = new THREE.InstancedMesh(blockGeo, mats.ice, BLOCKS);
  ice.name = "ice-blocks";
  ice.castShadow = true;
  ice.frustumCulled = false;
  if (belt) objects.push(ice);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), e = new THREE.Euler();

  // The ball in the sports dome.
  const hoops = s.marks.get("hoops") ?? [];
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), mats.orange);
  ball.name = "ball";
  ball.castShadow = true;
  if (hoops.length === 2) objects.push(ball);
  const court = hoops.length === 2 ? hoops[0]!.clone().lerp(hoops[1]!, 0.5) : new THREE.Vector3();
  const floorY = court.y - 3.05;
  const toward = hoops.length === 2 ? hoops[1]!.clone().sub(hoops[0]!).setY(0).normalize() : new THREE.Vector3(1, 0, 0);
  const across = new THREE.Vector3(-toward.z, 0, toward.x);
  // Waypoints: spots on the court, and each hoop (dropping through it).
  const G = 1.62;
  const hops: { at: THREE.Vector3; peak: number }[] = [];
  const rnd = (() => { let sd = 9; return () => ((sd = (sd * 16807) % 2147483647) / 2147483647); })();
  for (let i = 0; i < 24; i++) {
    if (i % 4 === 3 && hoops.length === 2) { hops.push({ at: hoops[i % 8 === 3 ? 0 : 1]!.clone().setY(court.y + 0.05), peak: 2.2 }); continue; }
    const at = court.clone().addScaledVector(toward, (rnd() - 0.5) * 16).addScaledVector(across, (rnd() - 0.5) * 6).setY(floorY + 0.13);
    hops.push({ at, peak: 1.2 + rnd() * 2.5 });
  }
  const times: number[] = [0];
  for (let i = 0; i < hops.length; i++) {
    const a = hops[i]!, b = hops[(i + 1) % hops.length]!;
    const top = Math.max(a.at.y, b.at.y) + a.peak;
    times.push(times[i]! + Math.sqrt((2 * (top - a.at.y)) / G) + Math.sqrt((2 * (top - b.at.y)) / G));
  }
  const cycle = times[times.length - 1]!;

  // The base's own code screens.
  const scrolling: { update(t: number): void; dispose(): void }[] = [];

  let dist = 0;
  return {
    objects,
    update(dt, t) {
      // The rover: along its loop, nose along the way, pitched to the slope, wheels turning.
      dist += SPEED * dt;
      loop.at(dist, p0);
      loop.at(dist + 2.0, p1);
      loop.at(dist - 2.0, p2);
      rover.root.position.copy(p0);
      rover.root.rotation.order = "YXZ";
      rover.root.rotation.y = Math.atan2(p1.x - p2.x, p1.z - p2.z);
      rover.root.rotation.x = -Math.atan2(p1.y - p2.y, Math.hypot(p1.x - p2.x, p1.z - p2.z));
      for (const w of rover.wheels) w.rotation.x = (dist / ROVER.wheelR) % (Math.PI * 2);
      // Ice up the belt: a block every couple of metres, riding up, gone at the top.
      if (belt) {
        for (let i = 0; i < BLOCKS; i++) {
          const d = ((t * 0.9 + (i * beltLen) / BLOCKS) % beltLen);
          belt.at(d, p0);
          belt.at(d + 0.3, p1);
          q.setFromEuler(e.set(-Math.atan2(p1.y - p0.y, Math.hypot(p1.x - p0.x, p1.z - p0.z)), Math.atan2(p1.x - p0.x, p1.z - p0.z), 0, "YXZ"));
          ice.setMatrixAt(i, m.compose(p0.setY(p0.y + 0.22), q, one));
        }
        ice.instanceMatrix.needsUpdate = true;
      }
      // The ball: hop to hop on low-gravity arcs.
      if (hoops.length === 2) {
        const tt = t % cycle;
        let i = 0;
        while (i < hops.length - 1 && times[i + 1]! <= tt) i++;
        const a = hops[i]!, b = hops[(i + 1) % hops.length]!;
        const T = times[i + 1]! - times[i]!, u = (tt - times[i]!) / T;
        const top = Math.max(a.at.y, b.at.y) + a.peak;
        const up = Math.sqrt((2 * (top - a.at.y)) / G);
        const time = u * T;
        const y = time < up ? a.at.y + G * up * time - 0.5 * G * time * time : top - 0.5 * G * (time - up) * (time - up);
        ball.position.copy(a.at).lerp(b.at, u).setY(y);
        ball.rotation.x += dt * 3;
      }
      for (const sc of scrolling) sc.update(t);
    },
    dispose() {
      rover.dispose();
      blockGeo.dispose();
      ball.geometry.dispose();
      for (const o of objects) {
        const mm = o as THREE.Mesh;
        if ((mm as unknown as THREE.Points).isPoints || mm.name === "light-pools") { mm.geometry.dispose(); (mm.material as THREE.Material).dispose(); }
      }
    },
  };
  void patch;
}
