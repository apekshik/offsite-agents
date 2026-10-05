// New crew arrive by helicopter. Each arrival is a touchdown time on the server's clock; from it
// alone (and ARRIVAL's timings) every client works out the same flight: in from far out over the
// sea, slowing to a hover beside the pad, sliding across and settling at the exact moment, rotors
// turning while people step out, then up and away. A reload mid-flight shows the same place.
//
// Touchdowns close together share one helicopter (it waits on the pad for the next); flights
// further apart fly separate helicopters, so one can be leaving while the next comes in.
//
// For a film: call world.setArrivals([T]) with T the touchdown you want (ms on the clock the world
// is updated with). The helicopter appears FLIGHT.approachS seconds before T about 400 m off the
// port quarter (out of the sunset), runs up the port side of the yacht at 25-35 m, swings in to a
// hover off the helipad, slides across and touches down at exactly T; it waits FLIGHT.groundS on
// the pad, rotors turning, then lifts and leaves to starboard over FLIGHT.departS. flightPlan(T)
// gives the times of each phase; YachtWorld.helicopter(now) where it is, for a camera to follow.

import * as THREE from "three";
import { ARRIVAL } from "@offsite/contracts";
import { LIGHT, type Ocean } from "@offsite/kit";
import { D2, PAD, deckHalfBeam } from "./dims.ts";

const TAU = Math.PI * 2;
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const smoother = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * t * (t * (t * 6 - 15) + 10); };

// ---------- the model: a sleek twin-engine helicopter, nose to +z, skids on y = 0 ----------

function lathe(profile: [number, number][], seg = 24): THREE.BufferGeometry {
  // profile: [z, r] from nose to tail; revolved about the z axis.
  const pts = profile.map(([z, r]) => new THREE.Vector2(r, z));
  const g = new THREE.LatheGeometry(pts, seg).rotateX(Math.PI / 2);
  g.deleteAttribute("uv");
  return g;
}

export function helicopterModel(): THREE.Group {
  const white = new THREE.MeshPhysicalMaterial({ color: "#f5f6f4", roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.08 });
  const navy = new THREE.MeshStandardMaterial({ color: "#1b2b4b", roughness: 0.35 });
  const glass = new THREE.MeshPhysicalMaterial({ color: "#0b1219", roughness: 0.05, metalness: 0.2, clearcoat: 1 });
  const metal = new THREE.MeshStandardMaterial({ color: "#3a3f46", roughness: 0.45, metalness: 0.6 });
  const g = new THREE.Group();
  g.name = "helicopter";
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    return m;
  };
  // Fuselage: a rounded cabin tapering into the tail boom.
  const body = lathe([[3.3, 0.0], [3.15, 0.45], [2.8, 0.78], [2.2, 0.98], [1.2, 1.06], [0.0, 1.06], [-1.0, 0.98], [-1.9, 0.7], [-2.6, 0.42], [-3.0, 0.32]]);
  add(body, white, 0, 1.55, 0, 0.92, 1.08, 1);
  add(lathe([[-2.9, 0.33], [-6.2, 0.17], [-6.25, 0.0]], 12), white, 0, 1.78, 0);
  // Windscreen and cabin windows.
  add(new THREE.SphereGeometry(1, 24, 16, 0, TAU, 0, Math.PI / 2.1), glass, 0, 1.72, 2.05, 0.86, 0.72, 1.12).rotation.x = 0.55;
  for (const sx of [-1, 1]) {
    add(new THREE.BoxGeometry(0.05, 0.62, 1.7), glass, sx * 0.93, 1.85, 0.25);
    add(new THREE.BoxGeometry(0.05, 0.12, 4.2), navy, sx * 0.95, 1.18, 0.0);
  }
  // Engine housing and rotor mast.
  add(new THREE.CapsuleGeometry(0.5, 1.6, 6, 12).rotateX(Math.PI / 2), white, 0, 2.55, -0.35, 1.05, 0.8, 1);
  add(new THREE.CylinderGeometry(0.12, 0.16, 0.6, 10), metal, 0, 3.05, 0.1);
  // The ducted tail rotor, its fin and the stabiliser.
  const duct = new THREE.TorusGeometry(0.62, 0.17, 10, 28).rotateY(Math.PI / 2);
  add(duct, white, 0, 2.05, -6.45);
  add(new THREE.CylinderGeometry(0.5, 0.5, 0.1, 20).rotateZ(Math.PI / 2), metal, 0, 2.05, -6.45);
  add(new THREE.BoxGeometry(0.12, 1.5, 0.9), white, 0, 3.05, -6.75).rotation.x = -0.35;
  add(new THREE.BoxGeometry(2.1, 0.07, 0.55), white, 0, 1.85, -5.4);
  // Skids.
  for (const sx of [-1, 1]) {
    const skid = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.8, 8).rotateX(Math.PI / 2), metal);
    skid.position.set(sx * 1.08, 0.06, 0.3);
    g.add(skid);
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.5, 8), metal);
    tip.position.set(sx * 1.08, 0.2, 2.3);
    tip.rotation.x = 0.9;
    g.add(tip);
    for (const z of [-0.8, 1.3]) {
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 6), metal);
      strut.position.set(sx * 0.9, 0.5, z);
      strut.rotation.z = sx * 0.35;
      g.add(strut);
    }
  }
  // Main rotor: five blades on a hub, and a faint disc for when they blur.
  const rotor = new THREE.Group();
  rotor.name = "rotor";
  rotor.position.set(0, 3.38, 0.1);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.22, 12), metal);
  rotor.add(hub);
  for (let i = 0; i < 5; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(5.9, 0.05, 0.34).translate(3.05, 0, 0), metal);
    blade.rotation.y = (i / 5) * TAU;
    blade.castShadow = true;
    rotor.add(blade);
  }
  // The blur: a disc that shows the blades' sweep as soft streaks trailing each blade, faint
  // over the rest of the disc; once the rotor is up to speed it stands in for the blades.
  const blurMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uAngle: { value: 0 }, uAmt: { value: 1 }, uTint: LIGHT.uTint },
    vertexShader: "varying vec2 vP; void main(){ vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: /* glsl */ `
      uniform float uAngle, uAmt; uniform vec3 uTint; varying vec2 vP;
      void main() {
        float r = length(vP) / 6.0;
        if (r > 1.0 || r < 0.05) discard;
        float a = atan(vP.y, vP.x) + uAngle;
        float k = fract(a / 1.2566); // five blades
        float streak = exp(-k * 9.0) + exp(-(1.0 - k) * 40.0) * 0.6;
        float alpha = (0.07 + 0.32 * streak) * smoothstep(1.0, 0.93, r) * smoothstep(0.05, 0.2, r) * uAmt;
        alpha += smoothstep(0.985, 0.995, r) * smoothstep(1.0, 0.995, r) * 0.25 * uAmt; // the tips' track
        gl_FragColor = vec4(vec3(0.16, 0.17, 0.19) * (0.6 + 0.6 * uTint), alpha);
      }`,
  });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(6.0, 64).rotateX(-Math.PI / 2), blurMat);
  disc.name = "blur";
  disc.position.y = 0.03;
  disc.renderOrder = 6;
  rotor.add(disc);
  g.add(rotor);
  const tail = new THREE.Group();
  tail.name = "tailRotor";
  tail.position.set(0, 2.05, -6.45);
  for (let i = 0; i < 8; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.55, 0.08).translate(0, 0.27, 0), metal);
    b.rotation.x = (i / 8) * TAU;
    tail.add(b);
  }
  g.add(tail);
  // Navigation lights.
  const red = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.3, 0.2) });
  const green = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 4, 0.6) });
  const beacon = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 0.4, 0.3) });
  add(new THREE.SphereGeometry(0.07, 8, 6), red, -1.06, 1.85, -5.4);
  add(new THREE.SphereGeometry(0.07, 8, 6), green, 1.06, 1.85, -5.4);
  const top = add(new THREE.SphereGeometry(0.09, 8, 6), beacon, 0, 3.75, -6.95);
  top.name = "beacon";
  const strobe = add(new THREE.SphereGeometry(0.08, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 6, 6) }), 0, 1.2, -1.6);
  strobe.name = "strobe";
  // Landing lights under the nose, and their beams reaching down ahead (after dark).
  const lamp = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1) });
  for (const sx of [-0.35, 0.35]) add(new THREE.CircleGeometry(0.11, 12).rotateX(Math.PI / 2 + 0.5), lamp, sx, 0.62, 2.55).name = "landing-lamp";
  const beamMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uOn: { value: 0 } },
    vertexShader: "varying float vL; varying vec3 vN, vV; void main(){ vL = -position.y / 22.0; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalMatrix * normal; vV = -mv.xyz; gl_Position = projectionMatrix * mv; }",
    fragmentShader: "uniform float uOn; varying float vL; varying vec3 vN, vV; void main(){ float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.5); float a = uOn * (1.0 - vL) * (1.0 - vL) * edge * 0.16; gl_FragColor = vec4(vec3(1.0, 0.95, 0.85) * a, 1.0); }",
  });
  const beam = new THREE.Mesh(new THREE.ConeGeometry(4.2, 22, 24, 1, true).translate(0, -11, 0), beamMat);
  beam.name = "landing-beam";
  beam.position.set(0, 0.55, 2.6);
  beam.rotation.x = -0.62;
  beam.renderOrder = 7;
  beam.frustumCulled = false;
  g.add(beam);
  return g;
}

// ---------- the flights ----------

interface Flight { land: number; leave: number }

/** Groups touchdowns into flights: one that lands while a helicopter still waits shares it. */
export function planFlights(touchdowns: number[]): Flight[] {
  const ts = [...new Set(touchdowns.filter((t) => Number.isFinite(t)))].sort((a, b) => a - b);
  const out: Flight[] = [];
  for (const t of ts) {
    const last = out[out.length - 1];
    // Close enough that the last one would still be climbing off the pad: it waits instead.
    if (last && t <= last.leave + 6000) last.leave = Math.max(last.leave, t + ARRIVAL.groundMs);
    else out.push({ land: t, leave: t + ARRIVAL.groundMs });
  }
  return out;
}

// Paths in the pad's frame (metres from the pad's centre, y up from the deck).
class Path {
  private pts: THREE.Vector3[] = [];
  private len: number[] = [0];
  constructor(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, n = 80) {
    const curve = new THREE.CubicBezierCurve3(a, b, c, d);
    this.pts = curve.getPoints(n);
    for (let i = 1; i < this.pts.length; i++) this.len.push(this.len[i - 1]! + this.pts[i]!.distanceTo(this.pts[i - 1]!));
  }
  get length() { return this.len[this.len.length - 1]!; }
  /** The point `d` metres along. */
  at(d: number, out: THREE.Vector3): THREE.Vector3 {
    const L = this.length, dd = Math.min(L, Math.max(0, d));
    let i = 1;
    while (i < this.len.length - 1 && this.len[i]! < dd) i++;
    const l0 = this.len[i - 1]!, l1 = this.len[i]!, t = l1 > l0 ? (dd - l0) / (l1 - l0) : 0;
    return out.copy(this.pts[i - 1]!).lerp(this.pts[i]!, t);
  }
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const APPROACH_A = 10.6; // seconds of the approach spent coming in; the rest is the slide and settle
// In from the port quarter, out of the sunset; up the port side well clear of the rail, 25-35 m
// up, so a camera alongside sees it pass the whole ship; a turn in to hover off the pad's port side.
const HOVER = V(-21, 9, -5);
const IN = new Path(V(-175, 72, 335), V(-78, 44, 175), V(-62, 22, 8), HOVER);
const LIFT = 2.6;
const OUT = new Path(V(2, 10, 0), V(55, 17, 5), V(230, 62, 75), V(540, 140, 250));
const LANDED_YAW = Math.PI / 2; // nose to starboard, the way it slid in: a cabin door faces aft, toward the office

/**
 * The choreography's timings, in seconds: the approach (APPROACH_A of it flying in, the rest the
 * slide across and the settle), the wait on the pad, the departure.
 */
export const FLIGHT = {
  approachS: ARRIVAL.approachMs / 1000,
  inS: APPROACH_A,
  groundS: ARRIVAL.groundMs / 1000,
  departS: ARRIVAL.departMs / 1000,
  /** Metres it flies on the way in, from where it appears to the hover. */
  inLength: IN.length,
};

/** When each part of a single arrival happens, for a touchdown at `touchdown` (ms). */
export function flightPlan(touchdown: number) {
  const appear = touchdown - ARRIVAL.approachMs;
  return {
    appear,
    hover: appear + APPROACH_A * 1000,
    touchdown,
    liftoff: touchdown + ARRIVAL.groundMs,
    gone: touchdown + ARRIVAL.groundMs + ARRIVAL.departMs,
  };
}

/** Where a helicopter is, in the world (the ship's frame), for a camera to follow. */
export interface HelicopterView {
  position: THREE.Vector3;
  /** Heading: the way the nose points (0 is +z). */
  yaw: number;
  phase: "approach" | "settle" | "ground" | "depart";
  /** The touchdown time (ms) of the flight. */
  touchdown: number;
  object: THREE.Object3D;
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _v = new THREE.Vector3();

/** Where a flight's helicopter is `t` ms after its window opens: position (pad frame) and heading. */
function pose(f: Flight, now: number, out: THREE.Vector3): { yaw: number; visible: boolean } {
  const approachMs = ARRIVAL.approachMs, t0 = f.land - approachMs;
  if (now < t0 || now > f.leave + ARRIVAL.departMs) return { yaw: 0, visible: false };
  if (now < f.land) {
    const tau = (now - t0) / 1000, total = approachMs / 1000;
    if (tau < APPROACH_A) {
      const s = tau / APPROACH_A;
      const d = IN.length * (1 - Math.pow(1 - s, 1.6));
      IN.at(d, out);
      IN.at(Math.max(0, d - 2), _a);
      IN.at(Math.min(IN.length, d + 2), _b);
      return { yaw: Math.atan2(_b.x - _a.x, _b.z - _a.z), visible: true };
    }
    // Slide across to the pad and settle, touching down exactly at f.land.
    const k = smoother(APPROACH_A, total - 0.7, tau), h = smooth(APPROACH_A + 0.6, total, tau);
    out.set(HOVER.x * (1 - k), HOVER.y * (1 - h), 0);
    IN.at(IN.length - 2, _a);
    const inYaw = Math.atan2(HOVER.x - _a.x, HOVER.z - _a.z);
    return { yaw: inYaw + (LANDED_YAW - inYaw) * smooth(APPROACH_A, APPROACH_A + 2.2, tau), visible: true };
  }
  if (now <= f.leave) {
    out.set(0, 0, 0);
    return { yaw: LANDED_YAW, visible: true };
  }
  const tau = (now - f.leave) / 1000, total = ARRIVAL.departMs / 1000;
  if (tau < LIFT) {
    out.set(-2 * smooth(0, LIFT, tau), 10 * smooth(0, LIFT, tau), 0);
    return { yaw: LANDED_YAW, visible: true };
  }
  const s = (tau - LIFT) / (total - LIFT);
  const d = OUT.length * Math.pow(s, 1.8);
  OUT.at(d, out);
  OUT.at(Math.max(0, d - 2), _a);
  OUT.at(Math.min(OUT.length, d + 2), _b);
  const yaw = Math.atan2(_b.x - _a.x, _b.z - _a.z);
  return { yaw: LANDED_YAW + (yaw - LANDED_YAW) * smooth(0, 0.25, s), visible: true };
}

export interface Helicopters {
  root: THREE.Group;
  setArrivals(touchdowns: number[]): void;
  update(dt: number, now: number): void;
  view(now: number): HelicopterView | null;
  dispose(): void;
}

function phaseOf(f: Flight, now: number): HelicopterView["phase"] {
  if (now < f.land - ARRIVAL.approachMs + APPROACH_A * 1000) return "approach";
  if (now < f.land) return "settle";
  if (now <= f.leave) return "ground";
  return "depart";
}

/** The downwash on the deck: rings of disturbed air and spray over the pad. */
function deckWash(): THREE.Mesh {
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    uniforms: { uTime: LIGHT.uTime, uAmt: { value: 0 }, uTint: LIGHT.uTint },
    vertexShader: "varying vec2 vP; void main(){ vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: /* glsl */ `
      uniform float uTime, uAmt; uniform vec3 uTint; varying vec2 vP;
      void main() {
        float r = length(vP);
        float rings = sin(r * 2.2 - uTime * 12.0) * 0.5 + 0.5;
        float swirl = sin(atan(vP.y, vP.x) * 9.0 + r * 1.5 - uTime * 6.0) * 0.5 + 0.5;
        float a = uAmt * smoothstep(11.0, 3.0, r) * smoothstep(1.0, 3.0, r) * (0.14 * rings + 0.1 * swirl * rings);
        gl_FragColor = vec4(vec3(0.9, 0.92, 0.95) * (uTint + 0.15), a);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(24, 24).rotateX(-Math.PI / 2), m);
  mesh.name = "downwash-deck";
  mesh.renderOrder = 2;
  return mesh;
}

export function createHelicopters(ocean?: Ocean): Helicopters {
  const root = new THREE.Group();
  root.name = "helicopters";
  const template = helicopterModel();
  const wash = deckWash();
  wash.visible = false;
  root.add(wash);
  const washMat = wash.material as THREE.ShaderMaterial;
  // Where the landing lights fall on the deck, after dark.
  const spotMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    uniforms: { uOn: { value: 0 } },
    vertexShader: "varying vec2 vP; void main(){ vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: "uniform float uOn; varying vec2 vP; void main(){ float r = length(vP) / 4.5; float a = uOn * exp(-r * r * 3.0) * smoothstep(1.0, 0.7, r); gl_FragColor = vec4(vec3(1.0, 0.96, 0.88) * a * 0.9, 1.0); }",
  });
  const spot = new THREE.Mesh(new THREE.PlaneGeometry(9, 9).rotateX(-Math.PI / 2), spotMat);
  spot.name = "landing-spot";
  spot.visible = false;
  root.add(spot);
  let spotOn = 0;
  const fleet: THREE.Group[] = [];
  let flights: Flight[] = [];
  const pad = V(PAD.x, D2, PAD.z);
  const p0 = new THREE.Vector3(), p1 = new THREE.Vector3(), p2 = new THREE.Vector3(), fwd = new THREE.Vector3();

  const heli = (i: number) => {
    while (fleet.length <= i) {
      const h = template.clone();
      // Their own blur and beam, which change with each one's flight.
      for (const name of ["blur", "landing-beam"]) {
        const m = h.getObjectByName(name) as THREE.Mesh;
        m.material = (m.material as THREE.ShaderMaterial).clone();
      }
      h.rotation.order = "YXZ";
      h.visible = false;
      root.add(h);
      fleet.push(h);
    }
    return fleet[i]!;
  };

  return {
    root,
    setArrivals(touchdowns) {
      flights = planFlights(touchdowns);
    },
    view(now) {
      const f = flights.find((x) => now >= x.land - ARRIVAL.approachMs && now <= x.leave + ARRIVAL.departMs);
      if (!f) return null;
      const p = pose(f, now, _v);
      return { position: pad.clone().add(_v), yaw: p.yaw, phase: phaseOf(f, now), touchdown: f.land, object: fleet[0] ?? template };
    },
    update(_dt, now) {
      const live = flights.filter((f) => now >= f.land - ARRIVAL.approachMs && now <= f.leave + ARRIVAL.departMs);
      let washAmt = 0, washX = 0, washZ = 0, overDeck = false;
      for (let i = 0; i < Math.max(live.length, fleet.length); i++) {
        const f = live[i];
        if (!f) { if (fleet[i]) fleet[i]!.visible = false; continue; }
        const h = heli(i);
        const p = pose(f, now, p1);
        h.visible = p.visible;
        if (!p.visible) continue;
        // Lean into the motion: nose down to speed up, up to slow down, bank into turns.
        pose(f, now - 250, p0);
        pose(f, now + 250, p2);
        const vel = _a.subVectors(p2, p0).divideScalar(0.5);
        const acc = _b.copy(p2).add(p0).addScaledVector(p1, -2).divideScalar(0.0625);
        fwd.set(Math.sin(p.yaw), 0, Math.cos(p.yaw));
        const af = acc.x * fwd.x + acc.z * fwd.z, ar = -acc.x * fwd.z + acc.z * fwd.x; // along the nose, and to its right
        const vf = vel.x * fwd.x + vel.z * fwd.z;
        const grounded = p1.y < 0.05;
        h.position.copy(pad).add(p1);
        h.rotation.y = p.yaw;
        h.rotation.x = grounded ? 0 : THREE.MathUtils.clamp(af * 0.045 + vf * 0.0025, -0.32, 0.32);
        h.rotation.z = grounded ? 0 : THREE.MathUtils.clamp(ar * 0.03, -0.4, 0.4);
        const rotor = h.getObjectByName("rotor")!, tail = h.getObjectByName("tailRotor")!;
        rotor.rotation.y = ((now / 1000) * 31) % TAU;
        tail.rotation.x = ((now / 1000) * 90) % TAU;
        const beacon = h.getObjectByName("beacon");
        if (beacon) beacon.visible = Math.floor(now / 600) % 2 === 0;
        const strobe = h.getObjectByName("strobe");
        if (strobe) { const f = (now % 1300) / 1300; strobe.visible = f < 0.04 || (f > 0.1 && f < 0.14); }
        // The blades blur into the disc once they're up to speed (they always are while it's here).
        const blur = (h.getObjectByName("blur") as THREE.Mesh).material as THREE.ShaderMaterial;
        blur.uniforms.uAngle!.value = rotor.rotation.y;
        rotor.children.forEach((c) => { if (c.name !== "blur") c.visible = c === rotor.children[0]; });
        // Landing lights: on after dark from the hover until it's down, and on the way up.
        const phase = phaseOf(f, now);
        const beam = (h.getObjectByName("landing-beam") as THREE.Mesh).material as THREE.ShaderMaterial;
        const lit = LIGHT.uNight.value * (phase === "ground" ? 0 : phase === "depart" ? 1 - smooth(0, 6000, now - f.leave) : 1);
        beam.uniforms.uOn!.value = lit;
        h.getObjectByName("landing-beam")!.visible = lit > 0.01;
        // The downwash: on the water when it's low over the sea, on the deck when it's over the pad.
        const wx = h.position.x, wz = h.position.z;
        const overShip = Math.abs(wx) < deckHalfBeam(wz) + 1 && wz > -72 && wz < 70;
        const alt = overShip ? h.position.y - D2 : h.position.y;
        const amt = (1 - smooth(6, 30, alt)) * (phase === "ground" ? 0.55 : 1);
        if (amt > washAmt) { washAmt = amt; washX = wx; washZ = wz; overDeck = overShip; }
        // The beam's spot: ahead of the nose by the height and the beam's tilt, if that's on deck.
        if (lit > spotOn) {
          const reach = Math.tan(0.62 + h.rotation.x) * Math.max(0, h.position.y - D2);
          const sx = wx + Math.sin(h.rotation.y) * (reach + 2.6), sz = wz + Math.cos(h.rotation.y) * (reach + 2.6);
          const onDeck = Math.abs(sx) < deckHalfBeam(sz) && sz > -66 && sz < -40;
          if (onDeck) {
            spotOn = lit * (1 - smooth(14, 30, h.position.y - D2));
            spot.position.set(sx, D2 + 0.04, sz);
          }
        }
      }
      spot.visible = spotOn > 0.01;
      spotMat.uniforms.uOn!.value = spotOn;
      spotOn = 0;
      // One wash at a time: the strongest.
      ocean?.setDownwash(washX, washZ, overDeck ? 0 : washAmt, 15);
      wash.visible = overDeck && washAmt > 0.01;
      if (wash.visible) {
        wash.position.set(washX, D2 + 0.05, washZ);
        washMat.uniforms.uAmt!.value = washAmt;
      }
    },
    dispose() {
      template.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
      });
    },
  };
}
