// New crew arrive by lander. Each arrival is a touchdown time on the server's clock; from it alone
// (and ARRIVAL's timings, via the kit's planFlights) every client works out the same flight: down
// out of the black from the north-east, where Earth is, slowing to a hover high over the pad,
// then straight down on its engines in a spreading ring of dust, touching down at the exact
// moment. Its ramp drops, the new crew member walks down it toward the hub; it waits, lifts off
// and is gone toward Earth. Touchdowns close together share one lander (it waits on the pad).
//
// For a film: call world.setArrivals([T]) with T the touchdown you want; LANDER.approachS
// seconds before T it appears high in the north-east, hovers over the pad at LANDER.hoverS, and
// settles at T. MoonWorld.lander(now) says where it is, for a camera to follow.

import * as THREE from "three";
import { ARRIVAL } from "@offsite/contracts";
import { LIGHT, inFlightWindow, planFlights, type Flight } from "@offsite/kit";
import type { Mats, MatKey } from "./mats.ts";
import { Pile } from "./kit.ts";
import { disc, ring, soft } from "./furniture.ts";

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------- the model: a white capsule with orange pods on four legs, front (its hatch) to +z ----------

export const LANDER = {
  /** The hatch's sill and where the ramp reaches the ground. */
  hatchY: 2.35, rampFoot: 6.2, rampW: 1.5,
  approachS: ARRIVAL.approachMs / 1000,
  /** Seconds into the approach it stops over the pad and starts straight down. */
  hoverS: 9.0,
  hoverY: 34,
};

/** The body, legs and engines, in its own frame (feet on y = 0). */
export function landerBody(p: Pile<MatKey>) {
  // The lower stage: an eight-sided skirt, white, orange panels on its faces.
  const skirt = new THREE.CylinderGeometry(2.55, 2.8, 2.0, 8, 1).translate(0, 2.25, 0).rotateY(Math.PI / 8);
  skirt.deleteAttribute("uv");
  p.add("white", skirt);
  for (let i = 0; i < 8; i++) {
    if (i === 0) continue; // the hatch side
    const a = (i / 8) * Math.PI * 2;
    p.obox(i % 2 ? "orange" : "white", Math.sin(a) * 2.62, 2.25, Math.cos(a) * 2.62, 1.4, 1.5, 0.08, a);
  }
  // The capsule above: tapering, a rounded crown, dark windows in a band.
  const prof: THREE.Vector2[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const r = t < 0.7 ? 2.4 - t * 0.9 : 1.77 * Math.sqrt(Math.max(0, 1 - ((t - 0.7) / 0.3) ** 2)) * (1 - 0.2 * (t - 0.7));
    prof.push(new THREE.Vector2(Math.max(0.001, r), 3.25 + t * 4.4));
  }
  const capsule = new THREE.LatheGeometry(prof, 24);
  capsule.deleteAttribute("uv");
  p.add("white", capsule);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    p.obox("dark", Math.sin(a) * 1.92, 5.7, Math.cos(a) * 1.92, 0.75, 0.8, 0.06, a, 0.18);
  }
  p.obox("dark", 0, 4.6, 2.1, 0.9, 0.55, 0.06, 0, 0.12);
  // Orange thruster pods on the flanks, with their nozzles.
  for (const sx of [-1, 1]) {
    soft(p, "orange", sx * 2.75, 3.6, 0, 0.9, 2.6, 1.2, 0, 0, 0.14);
    soft(p, "white", sx * 2.85, 4.95, 0, 0.7, 0.3, 1.0, 0, 0, 0.08);
    for (const dz of [-0.35, 0.35]) disc(p, "dark", V(sx * 3.22, 3.2, dz), "x", 0.17, 0.1, 10);
  }
  // The hatch: a dark doorway in a white frame on the front, a lamp over it.
  p.box("dark", -0.7, LANDER.hatchY, 2.5, 0.7, LANDER.hatchY + 2.0, 2.66);
  p.box("white", -0.85, LANDER.hatchY + 2.0, 2.5, 0.85, LANDER.hatchY + 2.2, 2.75);
  for (const sx of [-1, 1]) p.box("white", sx * 0.78 - 0.08, LANDER.hatchY, 2.5, sx * 0.78 + 0.08, LANDER.hatchY + 2.0, 2.75);
  p.box("amber", -0.6, LANDER.hatchY + 2.06, 2.75, 0.6, LANDER.hatchY + 2.14, 2.78);
  // Four legs splayed out to round feet, struts back to the skirt.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const top = V(Math.sin(a) * 2.2, 2.6, Math.cos(a) * 2.2), foot = V(Math.sin(a) * 4.3, 0.18, Math.cos(a) * 4.3);
    p.rod("steel", top, foot, 0.13, 8, false);
    p.rod("steel", V(Math.sin(a) * 2.5, 1.35, Math.cos(a) * 2.5), V(foot.x * 0.82, 0.9, foot.z * 0.82), 0.07, 6);
    p.cyl("orange", foot.x, 0, foot.z, 0.55, 0.18, 14, 0.42);
    p.box("orange", top.x * 1.05 - 0.2, 2.45, top.z * 1.05 - 0.2, top.x * 1.05 + 0.2, 2.85, top.z * 1.05 + 0.2);
  }
  // The engines underneath.
  for (const [x, z] of [[0, 0], [0.9, 0.9], [-0.9, 0.9], [0.9, -0.9], [-0.9, -0.9]] as const) {
    const bell = new THREE.CylinderGeometry(0.22, 0.42, 0.7, 12, 1, true).translate(x, 0.95, z);
    bell.deleteAttribute("uv");
    p.add("dark", bell);
  }
  p.cyl("dark", 0, 1.25, 0, 1.6, 0.1, 16);
  // An antenna and a beacon on the crown.
  p.rod("steel", V(0.4, 7.4, 0), V(0.4, 8.6, 0), 0.03, 4);
  p.cyl("red", 0.4, 8.6, 0, 0.08, 0.12, 8);
  ring(p, "orange", V(0, 3.25, 0), "y", 2.42, 0.06, 24);
}

/** The ramp, hinged at the hatch's sill (its origin), reaching forward (+z) and down to the ground when lowered. */
export function landerRamp(p: Pile<MatKey>) {
  const len = Math.hypot(LANDER.rampFoot - 2.62, LANDER.hatchY);
  const w = LANDER.rampW;
  p.box("white", -w / 2, -0.06, 0, w / 2, 0.02, len);
  for (let k = 1; k < 9; k++) p.box("dark", -w / 2 + 0.06, 0.02, (k / 9) * len - 0.03, w / 2 - 0.06, 0.04, (k / 9) * len + 0.03);
  for (const sx of [-1, 1]) {
    p.box("orange", sx * (w / 2) - 0.05, -0.06, 0, sx * (w / 2) + 0.05, 0.12, len);
    for (let k = 0; k <= 2; k++) p.rod("steel", V(sx * (w / 2), 0.1, (k / 2) * len), V(sx * (w / 2), 0.95, (k / 2) * len), 0.025, 5);
    p.rod("steel", V(sx * (w / 2), 0.95, 0), V(sx * (w / 2), 0.95, len), 0.03, 5);
    p.box("amber", sx * (w / 2) - 0.02, 0.12, 0.2, sx * (w / 2) + 0.02, 0.15, len - 0.2);
  }
}
/** The ramp's angle down from level when it is lowered. */
export const RAMP_DOWN = Math.atan2(LANDER.hatchY, LANDER.rampFoot - 2.62);

/** A parked lander, merged into a pile at (x, y, z), its hatch facing yaw. */
export function parkLander(dst: Pile<MatKey>, x: number, y: number, z: number, yaw: number) {
  const p = new Pile<MatKey>();
  landerBody(p);
  const rampP = new Pile<MatKey>();
  landerRamp(rampP);
  const at = new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), yaw), V(1, 1, 1));
  for (const [k, list] of p.parts) for (const it of list) dst.add(k, it.geometry, at.clone().multiply(it.matrix ?? new THREE.Matrix4()));
  const hinge = at.clone().multiply(new THREE.Matrix4().compose(V(0, LANDER.hatchY, 2.62), new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), RAMP_DOWN), V(1, 1, 1)));
  for (const [k, list] of rampP.parts) for (const it of list) dst.add(k, it.geometry, hinge.clone().multiply(it.matrix ?? new THREE.Matrix4()));
}

// ---------- the flights ----------

class Path {
  private pts: THREE.Vector3[];
  private len: number[] = [0];
  constructor(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, n = 80) {
    this.pts = new THREE.CubicBezierCurve3(a, b, c, d).getPoints(n);
    for (let i = 1; i < this.pts.length; i++) this.len.push(this.len[i - 1]! + this.pts[i]!.distanceTo(this.pts[i - 1]!));
  }
  get length() { return this.len[this.len.length - 1]!; }
  at(d: number, out: THREE.Vector3): THREE.Vector3 {
    const dd = Math.min(this.length, Math.max(0, d));
    let i = 1;
    while (i < this.len.length - 1 && this.len[i]! < dd) i++;
    const l0 = this.len[i - 1]!, l1 = this.len[i]!, t = l1 > l0 ? (dd - l0) / (l1 - l0) : 0;
    return out.copy(this.pts[i - 1]!).lerp(this.pts[i]!, t);
  }
}

/** Where a flight is: in the pad's frame (metres from its centre, y up from it). Out of the north-east, down onto the pad. */
export interface LanderPaths { inbound: Path; outbound: Path }
function paths(toEarth: THREE.Vector3): LanderPaths {
  const far = toEarth.clone().setY(0).normalize();
  const hover = V(0, LANDER.hoverY, 0);
  const inbound = new Path(far.clone().multiplyScalar(420).setY(330), far.clone().multiplyScalar(200).setY(150), far.clone().multiplyScalar(40).setY(LANDER.hoverY + 16), hover);
  const outbound = new Path(V(0, 30, 0), V(0, 90, 0), far.clone().multiplyScalar(160).setY(220), far.clone().multiplyScalar(520).setY(520));
  return { inbound, outbound };
}

export type LanderPhase = "approach" | "descent" | "ground" | "depart";

export interface LanderView {
  position: THREE.Vector3;
  phase: LanderPhase;
  touchdown: number;
  object: THREE.Object3D;
}

/** Where a flight's lander is at `now` (pad frame), how hard its engines burn (0..1), how far its ramp is down (0..1). */
function pose(P: LanderPaths, f: Flight, now: number, out: THREE.Vector3): { visible: boolean; burn: number; ramp: number; tilt: number; phase: LanderPhase } {
  const t0 = f.land - ARRIVAL.approachMs;
  if (!inFlightWindow(f, now)) return { visible: false, burn: 0, ramp: 0, tilt: 0, phase: "approach" };
  if (now < f.land) {
    const tau = (now - t0) / 1000;
    if (tau < LANDER.hoverS) {
      const s = tau / LANDER.hoverS;
      // Fast at first, braking hard into the hover.
      const d = P.inbound.length * (1 - Math.pow(1 - s, 2.4));
      P.inbound.at(d, out);
      return { visible: true, burn: 0.35 + 0.65 * smooth(0.55, 1, s), ramp: 0, tilt: (1 - s) * 0.25, phase: "approach" };
    }
    // Straight down onto the pad, slowing all the way, touching down exactly at f.land.
    const u = (tau - LANDER.hoverS) / (LANDER.approachS - LANDER.hoverS);
    out.set(0, LANDER.hoverY * Math.pow(1 - u, 1.7), 0);
    return { visible: true, burn: 1, ramp: 0, tilt: 0, phase: "descent" };
  }
  if (now <= f.leave) {
    out.set(0, 0, 0);
    const since = (now - f.land) / 1000, left = (f.leave - now) / 1000;
    const ramp = smooth(0.3, 1.5, since) * smooth(0.2, 1.4, left);
    return { visible: true, burn: Math.max(0, 1 - since * 1.5) * 0.6 + smooth(1.0, 0, left) * 0.6, ramp, tilt: 0, phase: "ground" };
  }
  const tau = (now - f.leave) / 1000, total = ARRIVAL.departMs / 1000;
  if (tau < 3) {
    out.set(0, 30 * Math.pow(tau / 3, 2), 0);
    return { visible: true, burn: 1, ramp: 0, tilt: 0, phase: "depart" };
  }
  const s = (tau - 3) / (total - 3);
  P.outbound.at(P.outbound.length * Math.pow(s, 1.6), out);
  return { visible: true, burn: 1 - 0.4 * s, ramp: 0, tilt: s * 0.3, phase: "depart" };
}

/** The dust kicked up on the pad: a ring of soft puffs racing outward, thicker the lower the lander. */
function dustRing(): THREE.Mesh {
  const N = 220;
  const geo = new THREE.InstancedBufferGeometry();
  const quad = new THREE.PlaneGeometry(1, 1);
  geo.index = quad.index;
  geo.setAttribute("position", quad.getAttribute("position"));
  const seeds = new Float32Array(N * 4);
  let sd = 77;
  const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < N * 4; i++) seeds[i] = rnd();
  geo.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 4));
  geo.instanceCount = N;
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uTime: LIGHT.uTime, uAmt: { value: 0 }, uTint: LIGHT.uTint, uNight: LIGHT.uNight },
    vertexShader: /* glsl */ `
      attribute vec4 aSeed;
      uniform float uTime, uAmt;
      varying float vA; varying vec2 vUv;
      void main() {
        float life = 1.6 + aSeed.y * 1.4;
        float t = fract(uTime / life + aSeed.x);
        float a = aSeed.z * 6.2832;
        float r = 1.5 + t * (14.0 + 10.0 * aSeed.w);
        vec3 p = vec3(cos(a) * r, 0.25 + t * (1.2 + 2.2 * aSeed.y) * (1.0 - 0.4 * t), sin(a) * r);
        float size = (0.8 + 2.6 * t) * (0.7 + 0.6 * aSeed.w);
        vA = uAmt * smoothstep(0.0, 0.12, t) * (1.0 - t) * (1.0 - t) * 0.42;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        mv.xy += position.xy * size;
        gl_Position = projectionMatrix * mv;
        vUv = position.xy + 0.5;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTint; uniform float uNight;
      varying float vA; varying vec2 vUv;
      void main() {
        float r = length(vUv - 0.5) * 2.0;
        float a = smoothstep(1.0, 0.1, r) * vA;
        if (a < 0.003) discard;
        vec3 col = vec3(0.62, 0.6, 0.57) * (0.35 + 0.65 * min(uTint, vec3(1.4)));
        gl_FragColor = vec4(col, a);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "lander-dust";
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  return mesh;
}

/** The engines' glow: a short additive cone under the lander, and a light on the pad. */
function flame(): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uOn: { value: 0 }, uTime: LIGHT.uTime },
    vertexShader: "varying float vL; void main(){ vL = -position.y / 3.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: "uniform float uOn, uTime; varying float vL; void main(){ float f = uOn * (1.0 - vL) * (0.8 + 0.2 * sin(uTime * 60.0 + vL * 20.0)); gl_FragColor = vec4(vec3(1.0, 0.75, 0.45) * f * 1.6, 1.0); }",
  });
  const m = new THREE.Mesh(new THREE.ConeGeometry(1.1, 3.0, 16, 1, true).rotateX(Math.PI).translate(0, -0.9, 0), mat);
  m.name = "lander-flame";
  m.renderOrder = 6;
  m.frustumCulled = false;
  return m;
}

export interface Landers {
  root: THREE.Group;
  setArrivals(touchdowns: number[]): void;
  update(dt: number, now: number): void;
  view(now: number): LanderView | null;
  flying(now: number): { object: THREE.Object3D; land: number; leave: number }[];
  dispose(): void;
}

/** Landers flying to the pad at `pad`, landing with their hatch facing `yaw`; Earth (where they come from) along `toEarth`. */
export function createLanders(mats: Mats, pad: THREE.Vector3, yaw: number, toEarth: THREE.Vector3): Landers {
  const root = new THREE.Group();
  root.name = "landers";
  const P = paths(toEarth);
  const bodyPile = new Pile<MatKey>();
  landerBody(bodyPile);
  const rampPile = new Pile<MatKey>();
  landerRamp(rampPile);
  const shadow = (k: MatKey) => ({ cast: k !== "amber" && k !== "red", receive: true });
  const template = new THREE.Group();
  const body = bodyPile.build(mats, shadow);
  body.name = "lander-body";
  const ramp = new THREE.Group();
  ramp.name = "lander-ramp";
  ramp.position.set(0, LANDER.hatchY, 2.62);
  ramp.add(rampPile.build(mats, shadow));
  template.add(body, ramp);
  const dust = dustRing();
  dust.position.copy(pad);
  dust.visible = false;
  root.add(dust);
  const dustMat = dust.material as THREE.ShaderMaterial;
  const padLight = new THREE.PointLight("#ffb46b", 0, 40, 1.6);
  padLight.position.copy(pad).setY(pad.y + 3);
  root.add(padLight);
  const fleet: THREE.Group[] = [];
  let flights: Flight[] = [];
  let lingering = 0;
  const _p = new THREE.Vector3();

  const lander = (i: number) => {
    while (fleet.length <= i) {
      const g = template.clone();
      const f = flame();
      f.position.set(0, 0.6, 0);
      g.add(f);
      g.rotation.order = "YXZ";
      g.visible = false;
      root.add(g);
      fleet.push(g);
    }
    return fleet[i]!;
  };
  const live = (now: number) => flights.filter((f) => inFlightWindow(f, now));

  return {
    root,
    setArrivals(touchdowns) { flights = planFlights(touchdowns); },
    view(now) {
      const f = live(now)[0];
      if (!f) return null;
      const p = pose(P, f, now, _p);
      return { position: pad.clone().add(_p), phase: p.phase, touchdown: f.land, object: fleet[0] ?? template };
    },
    flying(now) {
      return live(now).map((f, i) => ({ object: lander(i), land: f.land, leave: f.leave }));
    },
    update(dt, now) {
      const list = live(now);
      let kick = 0;
      for (let i = 0; i < Math.max(list.length, fleet.length); i++) {
        const f = list[i];
        if (!f) { if (fleet[i]) fleet[i]!.visible = false; continue; }
        const g = lander(i);
        const p = pose(P, f, now, _p);
        g.visible = p.visible;
        if (!p.visible) continue;
        g.position.copy(pad).add(_p);
        g.rotation.y = yaw;
        g.rotation.x = p.tilt;
        const rampObj = g.getObjectByName("lander-ramp")!;
        rampObj.rotation.x = RAMP_DOWN * p.ramp - 1.25 * (1 - p.ramp);
        const fl = g.getObjectByName("lander-flame") as THREE.Mesh;
        (fl.material as THREE.ShaderMaterial).uniforms.uOn!.value = p.burn;
        fl.visible = p.burn > 0.01;
        // Dust: the lower and harder it burns, the more.
        kick = Math.max(kick, p.burn * (1 - smooth(4, 32, _p.y)) * (p.phase === "ground" ? 0.6 : 1));
      }
      lingering = Math.max(kick, lingering - dt * 0.35);
      dust.visible = lingering > 0.01;
      dustMat.uniforms.uAmt!.value = lingering;
      padLight.intensity = kick * 40 * (0.4 + 0.6 * LIGHT.uNight.value);
    },
    dispose() {
      template.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry.dispose();
      });
      dust.geometry.dispose();
      dustMat.dispose();
    },
  };
}
