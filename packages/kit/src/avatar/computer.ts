// Adapted from Ready Player One (github.com/apekshik/ready-player-one): the Computah.
//
// Computah in person, the ship's main orchestrator: a little floating robot. Its head is a white ceramic pod with
// a dark glass screen for a face: two glowing eyes and a small mouth, drawn as signed distance
// fields so one expression melts into the next. Round it: ear pods that light up, an antenna
// that blinks with each new thought and wobbles behind the head, a dashed hover ring that spins
// while it thinks, and two floating mitten hands that gesture.
//
// Moods:
//   arrive - drops in from above, brakes with a bounce, says hello
//   idle   - floats about, looking round or at whoever's near (watch)
//   greet  - a hop and a wave when the captain walks up
//   think  - eyes up and aside, loading dots for a mouth, hand on chin; thought() blinks the antenna
//   idea   - it knows what to do: eyes wide, a hop, hands up
//   focus  - narrowed eyes on the work (lookAt), hands conducting, now and then a glance back
//   proud  - happy ^ ^ eyes, a spin and a cheer
//   sad    - X eyes and a glitching screen, then a droop
// Unlike RPO's, it lives aboard: after proud, sad and greet it settles back into its rest mood.

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

export type BotMood = "arrive" | "idle" | "greet" | "think" | "idea" | "focus" | "proud" | "sad";
export const BOT_MOODS: BotMood[] = ["arrive", "idle", "greet", "think", "idea", "focus", "proud", "sad"];

/** Optional sparkle: hook up a particle system, or leave it out. */
export interface BotFx {
  flash?(x: number, y: number, z: number, color: string, size: number, dur: number): void;
  spark?(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: string, life: number, size: number, drag: number, gravity: number): void;
}

const FACE_FRAG = /* glsl */ `
  uniform float uTime, uOpen, uHappy, uLid, uSlant, uWide, uErr, uMouth, uMouthOpen, uDots, uGlitch, uFlash, uBright;
  uniform vec2 uLook, uHalf;
  uniform vec3 uEye, uBg;
  varying vec2 vUv;
  float box(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
  float seg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)); }
  float hash(float n) { return fract(sin(n) * 43758.5453); }
  float eye(vec2 q, float side) {
    float s = 1.0 + 0.32 * uWide;
    vec2 b = vec2(0.062, max(0.006, 0.098 * uOpen)) * s;
    float d = box(q, b, min(b.x, b.y) * 0.95);
    float lid = b.y * (1.0 - 1.05 * uLid) + uSlant * 0.9 * q.x * side;
    d = max(d, q.y - lid);
    vec2 h = q - vec2(0.0, -0.035);
    float arc = max(abs(length(h) - 0.062) - 0.017, -h.y);
    d = mix(d, arc, uHappy);
    float x = min(seg(q, vec2(-0.05, -0.05), vec2(0.05, 0.05)), seg(q, vec2(-0.05, 0.05), vec2(0.05, -0.05))) - 0.016;
    return mix(d, x, uErr);
  }
  void main() {
    vec2 p = (vUv - 0.5) * uHalf * 2.0;
    float edge = box(p, uHalf, 0.11);
    if (edge > 0.0) discard;
    float band = floor(p.y * 26.0 + floor(uTime * 18.0) * 3.0);
    p.x += (hash(band) - 0.5) * 0.09 * uGlitch * step(0.55, hash(band + 7.0));
    vec2 look = uLook * vec2(0.075, 0.05);
    float d = min(eye(p - vec2(-0.165, 0.045) - look, 1.0), eye((p - vec2(0.165, 0.045) - look) * vec2(-1.0, 1.0), 1.0));
    vec2 m = p - vec2(0.0, -0.135) - look * 0.6;
    float w = 0.065 + 0.02 * abs(uMouth);
    float cy = uMouth * 0.035 * ((m.x * m.x) / (w * w) - 0.45);
    float line = max(abs(m.y - cy) - 0.011, abs(m.x) - w);
    float o = (length(m / vec2(0.034, 0.045 * (0.5 + 0.5 * uMouthOpen))) - 1.0) * 0.032;
    float mouth = mix(line, o, uMouthOpen);
    float dots = 1e3;
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float hop = max(0.0, sin(uTime * 6.0 - fi * 0.9)) * 0.022;
      dots = min(dots, length(m - vec2((fi - 1.0) * 0.06, hop)) - 0.016);
    }
    mouth = mix(mouth, dots, uDots);
    d = min(d, mouth);
    float aa = fwidth(d) * 1.2 + 0.002;
    float fill = smoothstep(aa, -aa, d);
    float glow = exp(-max(d, 0.0) * 34.0) * 0.32;
    float scan = 0.94 + 0.06 * sin(vUv.y * 220.0 - uTime * 3.0);
    float rim = smoothstep(-0.07, 0.0, edge);
    float sheen = smoothstep(0.05, 0.0, abs(p.x * 0.55 + p.y - 0.2)) * 0.06 + smoothstep(0.03, 0.0, abs(p.x * 0.55 + p.y - 0.29)) * 0.03;
    vec3 col = uBg * (0.7 + rim * 0.9) + vec3(sheen);
    col += uEye * (fill * scan * uBright + glow * uBright);
    col += uEye * uFlash * 0.08;
    gl_FragColor = vec4(col, 1.0);
  }`;

const HALO_FRAG = /* glsl */ `
  uniform vec3 uCol; uniform float uAmt; varying vec2 vUv;
  float hash(float n) { return fract(sin(n) * 43758.5453); }
  void main() {
    float u = vUv.x * 14.0, id = floor(u);
    float dash = step(0.22 + 0.5 * hash(id), fract(u));
    gl_FragColor = vec4(uCol * (0.25 + dash) * uAmt, 1.0);
  }`;

const UV_VERT = "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }";

type FaceKey = "open" | "happy" | "lid" | "slant" | "wide" | "err" | "mouth" | "mouthOpen" | "dots" | "glitch" | "lookX" | "lookY";
type Face = Partial<Record<FaceKey, number>>;
const FACES: Record<string, Face> = {
  neutral: { mouth: 0.35 },
  hello: { mouth: 0.9, wide: 0.25 },
  think: { lid: 0.08, dots: 1, lookY: 0.9 },
  ponder: { lid: 0.62, slant: -0.2, dots: 1, lookY: 0.6 },
  idea: { wide: 1, mouthOpen: 1 },
  focus: { lid: 0.38, slant: -0.08, mouth: 0.4 },
  glance: { mouth: 0.8, happy: 0.35 },
  proud: { happy: 1, mouth: 1 },
  sad: { lid: 0.3, slant: 0.85, mouth: -0.9, lookY: -0.6 },
  error: { err: 1, mouthOpen: 0.6, glitch: 1 },
  idle: { mouth: 0.5, happy: 0.15 },
};
const FACE_KEYS: FaceKey[] = ["open", "happy", "lid", "slant", "wide", "err", "mouth", "mouthOpen", "dots", "glitch", "lookX", "lookY"];

class Spring {
  v = 0;
  x: number;
  k: number;
  d: number;
  constructor(x = 0, k = 90, d = 11) { this.x = x; this.k = k; this.d = d; }
  step(target: number, dt: number) {
    this.v += ((target - this.x) * this.k - this.v * this.d) * dt;
    this.x += this.v * dt;
    return this.x;
  }
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

interface Hand { g: THREE.Group; side: number; pos: THREE.Vector3; vel: THREE.Vector3; aim: THREE.Vector3 }

export interface ComputerBotOptions {
  /** Its size: 1 is a head about a metre wide. */
  scale?: number;
  /** The mood it settles into after arriving or a greeting. */
  rest?: BotMood;
  /** Already here: skip the drop. */
  settled?: boolean;
  fx?: BotFx;
  /** Its voice: called with a cue ("hello", "idea", "proud", "sad", "blip") and where it is. */
  onSound?: (cue: string, at: THREE.Vector3) => void;
  colors?: { eye?: THREE.ColorRepresentation; glow?: THREE.ColorRepresentation };
}

export class ComputerBot {
  readonly root = new THREE.Group();
  /** Where to hover, in the parent's frame. */
  readonly anchor = new THREE.Vector3();
  /** A point it is working on (parent frame), while focused. */
  lookAt: THREE.Vector3 | null = null;
  /** A world point to look at while idle (null: the camera). */
  watch: THREE.Vector3 | null = null;
  mood: BotMood;
  rest: BotMood;
  private scale: number;
  private fx: BotFx;
  private onSound: ((cue: string, at: THREE.Vector3) => void) | undefined;
  private moodT = 0;
  private t = 0;
  private drop = 0;
  private spin = 0;
  private thinkSide = 1;
  private blinkIn = 1.5;
  // Blinks, glances and sparks come from a seeded stream, so the same clock gives the same bot.
  private rndState = 0x9e3779b9;
  private rnd() {
    let t = (this.rndState = (this.rndState + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  private blink = 0;
  private glanceIn = 5;
  private glance = 0;
  private flash = 0;
  private thoughts = 0;
  private after: BotMood | null = null;
  private failed = false;
  private landed = false;
  private cameraPos = new THREE.Vector3(0, 0, 10);
  private colors: { eye: THREE.Color; glow: THREE.Color; fail: THREE.Color };
  private face = Object.fromEntries(FACE_KEYS.map((k) => [k, k === "open" ? 1 : 0])) as Record<FaceKey, number>;
  private sp = {
    y: new Spring(0, 60, 9), pitch: new Spring(0, 50, 10), roll: new Spring(0, 40, 7), yaw: new Spring(0, 30, 9),
    antX: new Spring(0, 70, 4), antZ: new Spring(0, 70, 4), halo: new Spring(0, 20, 6),
  };
  private rig = new THREE.Group();
  private antenna = new THREE.Group();
  private haloTilt = new THREE.Group();
  private haloSpin: THREE.Mesh;
  private hands: Hand[];
  private glowMat = new THREE.MeshBasicMaterial({ color: "#00e5ff", toneMapped: false });
  private tipMat = new THREE.MeshBasicMaterial({ color: "#00e5ff", toneMapped: false });
  private mats: THREE.Material[];
  private fu: Record<string, THREE.IUniform>;
  private hu: Record<string, THREE.IUniform>;
  private _v = new THREE.Vector3();
  private _w = new THREE.Vector3();
  private _w2 = new THREE.Vector3();
  private _m = new THREE.Matrix4();
  private _q = new THREE.Quaternion();

  constructor(parent: THREE.Object3D, { scale = 0.5, rest = "idle", settled = true, fx = {}, onSound, colors = {} }: ComputerBotOptions = {}) {
    this.scale = scale;
    this.rest = rest;
    this.fx = fx;
    this.onSound = onSound;
    this.mood = settled ? rest : "arrive";
    this.colors = { eye: new THREE.Color(colors.eye ?? "#3ad0ff"), glow: new THREE.Color(colors.glow ?? "#1560ff"), fail: new THREE.Color("#ff3b4e") };
    const root = this.root;
    root.name = "computer";
    root.scale.setScalar(scale);
    parent.add(root);
    root.add(this.rig);

    const ceramic = new THREE.MeshPhysicalMaterial({ color: "#f1f3f7", roughness: 0.3, metalness: 0, clearcoat: 0.9, clearcoatRoughness: 0.18 });
    const graphite = new THREE.MeshStandardMaterial({ color: "#1d222c", roughness: 0.45, metalness: 0.5 });
    this.mats = [ceramic, graphite, this.glowMat, this.tipMat];
    const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, parentObj: THREE.Object3D = this.rig) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      parentObj.add(m);
      return m;
    };

    mesh(new RoundedBoxGeometry(1.0, 0.8, 0.74, 5, 0.24), ceramic);
    mesh(new RoundedBoxGeometry(0.88, 0.66, 0.2, 4, 0.1), graphite).position.z = 0.28;
    this.fu = {
      uTime: { value: 0 }, uOpen: { value: 1 }, uHappy: { value: 0 }, uLid: { value: 0 }, uSlant: { value: 0 }, uWide: { value: 0 },
      uErr: { value: 0 }, uMouth: { value: 0 }, uMouthOpen: { value: 0 }, uDots: { value: 0 }, uGlitch: { value: 0 }, uFlash: { value: 0 },
      uBright: { value: 1 }, uLook: { value: new THREE.Vector2() }, uHalf: { value: new THREE.Vector2(0.4, 0.29) },
      uEye: { value: new THREE.Color() }, uBg: { value: new THREE.Color("#05080f") },
    };
    const screenMat = new THREE.ShaderMaterial({ uniforms: this.fu, vertexShader: UV_VERT, fragmentShader: FACE_FRAG, toneMapped: false });
    const screen = mesh(new THREE.PlaneGeometry(0.8, 0.58), screenMat);
    screen.position.z = 0.385;
    screen.castShadow = false;
    this.mats.push(screenMat);

    for (const side of [-1, 1]) {
      const pod = mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.1, 24), graphite);
      pod.rotation.z = Math.PI / 2;
      pod.position.x = side * 0.52;
      const rim = mesh(new THREE.TorusGeometry(0.115, 0.018, 8, 28), this.glowMat);
      rim.rotation.y = Math.PI / 2;
      rim.position.x = side * 0.575;
    }

    this.antenna.position.set(0.18, 0.39, -0.08);
    this.rig.add(this.antenna);
    mesh(new THREE.CylinderGeometry(0.014, 0.022, 0.3, 8), graphite, this.antenna).position.y = 0.15;
    mesh(new THREE.SphereGeometry(0.05, 14, 10), this.tipMat, this.antenna).position.y = 0.32;

    mesh(new THREE.CylinderGeometry(0.2, 0.26, 0.1, 28), graphite).position.y = -0.42;
    const aperture = mesh(new THREE.CircleGeometry(0.13, 28), this.glowMat);
    aperture.rotation.x = Math.PI / 2;
    aperture.position.y = -0.473;

    this.hu = { uCol: { value: new THREE.Color() }, uAmt: { value: 1 } };
    const haloMat = new THREE.ShaderMaterial({ uniforms: this.hu, vertexShader: UV_VERT, fragmentShader: HALO_FRAG, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.haloSpin = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.016, 6, 120), haloMat);
    this.haloSpin.rotation.x = Math.PI / 2;
    this.haloTilt.add(this.haloSpin);
    root.add(this.haloTilt);
    this.mats.push(haloMat);

    this.hands = [-1, 1].map((side) => {
      const g = new THREE.Group();
      const palm = mesh(new THREE.SphereGeometry(0.1, 16, 12), ceramic, g);
      palm.scale.set(1, 0.78, 1.3);
      mesh(new THREE.SphereGeometry(0.045, 10, 8), ceramic, g).position.set(-side * 0.085, 0.03, 0.03);
      mesh(new THREE.SphereGeometry(0.035, 10, 8), this.tipMat, g).position.z = 0.125;
      root.add(g);
      const rest = new THREE.Vector3(side * 0.74, -0.2, 0.1);
      g.position.copy(rest);
      return { g, side, pos: rest.clone(), vel: new THREE.Vector3(), aim: new THREE.Vector3(0, -1, 1) };
    });

    if (settled) { this.t = 5; this.landed = true; }
    this.place(0);
    if (!settled) this.say("arrive");
  }

  private say(cue: string) { this.onSound?.(cue, this.root.getWorldPosition(this._v)); }

  setMood(mood: BotMood) {
    if (this.mood === mood) return;
    // Don't cut the "aha" short: get to work once it's done.
    if (this.mood === "idea" && mood === "focus" && this.moodT < 1.2) { this.after = "focus"; return; }
    this.mood = mood;
    this.moodT = 0;
    this.spin = 0;
    const p = this.root.getWorldPosition(this._v);
    if (mood === "idea") { this.sp.y.v += 4.5; this.flash = 1; this.fx.flash?.(p.x, p.y + 0.5 * this.scale, p.z, "#ffffff", 1.4 * this.scale, 0.3); this.say("idea"); }
    else if (mood === "proud") { this.sp.y.v += 5; this.flash = 1; this.say("proud"); }
    else if (mood === "sad") {
      this.failed = true;
      this.sp.roll.v += 9;
      this.flash = 1;
      this.say("sad");
      for (let i = 0; i < 24; i++) {
        const a = this.rnd() * Math.PI * 2;
        this.fx.spark?.(p.x, p.y + 0.6 * this.scale, p.z, Math.cos(a) * 2, 1 + this.rnd() * 2, Math.sin(a) * 2, i % 2 ? "#ff3b4e" : "#ffb0a0", 0.5, 0.07, 6, 0.8);
      }
    } else if (mood === "greet") { this.sp.y.v += 3; this.say("hello"); }
    else if (mood === "focus") this.say("start");
    if (mood !== "sad") this.failed = false;
  }

  /** A new line of thought arrived: a nod and a blink of the antenna. */
  thought() {
    this.thoughts++;
    this.thinkSide = -this.thinkSide;
    this.sp.pitch.v -= 2.2;
    this.sp.antX.v += 3;
    this.flash = Math.max(this.flash, 0.6);
    if (this.thoughts % 2) this.say("blip");
  }

  /** cameraPos: the viewer, in world space. night (0..1) dims the glow a little: bloom does more after dark. */
  update(dt: number, cameraPos: THREE.Vector3, night = 0) {
    this.t += dt;
    this.moodT += dt;
    this.cameraPos.copy(cameraPos);
    const mood = this.mood, mt = this.moodT;
    if ((mood === "arrive" || mood === "greet") && mt > 1.9) this.setMood(this.rest);
    if (mood === "idea" && mt > 1.5) { this.setMood(this.after ?? "think"); this.after = null; }
    if (mood === "proud" && mt > 2.8) this.setMood(this.rest);
    if (mood === "sad" && mt > 3.2) this.setMood(this.rest);
    this.drop = this.landed && this.t > 0.75 ? 0 : 6 * Math.pow(Math.max(0, 1 - this.t / 0.75), 2.4);
    if (!this.landed && this.t > 0.62) { this.landed = true; this.say("hello"); }
    this.place(dt);
    this.express(dt, night);
  }

  private place(dt: number) {
    const { root, rig, sp, mood, moodT: mt, t } = this;
    let yOff = Math.sin(t * 1.7) * 0.07 + Math.sin(t * 0.63) * 0.04;
    if (mood === "sad") yOff -= 0.35;
    if (mood === "proud") yOff += Math.abs(Math.sin(mt * 7)) * 0.18 * Math.max(0, 1 - mt / 1.6);
    const y = sp.y.step(yOff, dt);
    root.position.set(this.anchor.x, this.anchor.y + (y + this.drop) * this.scale, this.anchor.z);

    const target = this.facingPoint();
    const parentPos = root.parent ? root.parent.getWorldPosition(this._w) : this._w.set(0, 0, 0);
    this._v.copy(target).sub(parentPos).sub(root.position);
    let yaw = Math.atan2(this._v.x, this._v.z);
    if (mood === "proud") {
      this.spin = Math.min(Math.PI * 2, this.spin + dt * Math.PI * 2 * (mt > 0.25 && mt < 1.3 ? 1.1 : 0));
      if (this.spin < Math.PI * 2) yaw += this.spin;
    }
    sp.yaw.step(sp.yaw.x + wrap(yaw - sp.yaw.x), dt);
    root.rotation.y = sp.yaw.x;

    const flat = Math.hypot(this._v.x, this._v.z) || 1;
    let pitch = 0, roll = Math.sin(t * 0.9) * 0.04;
    if (mood === "think") { pitch = -0.14; roll += Math.sin(t * 0.7) * 0.1 * this.thinkSide; }
    if (mood === "focus") pitch = clamp(Math.atan2(-this._v.y, flat) * 0.6, -0.1, 0.55) + (this.glance > 0 ? -0.1 : 0);
    if (mood === "sad") pitch = 0.4;
    if (mood === "idle") pitch = 0.06 * Math.sin(t * 0.4);
    if (this.t < 0.75) pitch = -0.3;
    rig.rotation.x = sp.pitch.step(pitch, dt);
    rig.rotation.z = sp.roll.step(roll, dt);

    const vy = sp.y.v * 0.06 + (this.t < 0.75 ? -12 : 0) * 0.02;
    this.antenna.rotation.x = sp.antX.step(clamp(-vy, -0.6, 0.6) + sp.pitch.v * 0.04, dt);
    this.antenna.rotation.z = sp.antZ.step(-sp.roll.v * 0.05 + Math.sin(t * 2.3) * 0.05, dt);

    const spin = ({ arrive: 1.5, think: 3.2, idea: 6, focus: 0.9, proud: 7, sad: 0.2, idle: 0.6, greet: 2.5 } as Record<BotMood, number>)[mood];
    this.haloSpin.rotation.z += sp.halo.step(spin, dt) * dt;
    this.haloTilt.rotation.set(0.12 * Math.sin(t * 0.5), 0, (mood === "think" ? 0.2 : 0.08) * Math.cos(t * 0.37));
    this.haloTilt.position.y = -0.56 + (mood === "sad" ? -0.15 : 0) + Math.sin(t * 2.2) * 0.03;
    this.moveHands(dt);
  }

  private facingPoint() {
    const out = this._w2;
    if (this.mood === "focus" && this.lookAt && this.glance <= 0 && this.root.parent) return this.root.parent.localToWorld(out.copy(this.lookAt));
    if (this.mood === "idle" && this.watch) return out.copy(this.watch);
    return out.copy(this.cameraPos);
  }

  private moveHands(dt: number) {
    const { mood, moodT: mt, t } = this;
    const lookLocal = this.lookAt && mood === "focus" && this.root.parent
      ? this.root.worldToLocal(this.root.parent.localToWorld(this._v.copy(this.lookAt)))
      : null;
    for (const h of this.hands) {
      const s = h.side, tgt = this._w.set(s * 0.74, -0.2 + Math.sin(t * 2 + s) * 0.04, 0.1);
      const aim = h.aim.set(s * 0.3, -0.4, 1);
      switch (mood) {
        case "arrive":
          if (mt < 0.8) tgt.set(s * 0.62, 0.42, -0.15);
          else if (s > 0 && mt < 1.9) { tgt.set(0.66, 0.32, 0.25); tgt.x += Math.sin(mt * 16) * 0.1; aim.set(0, 1, 0.3); }
          break;
        case "greet":
          if (s > 0) { tgt.set(0.66, 0.32, 0.25); tgt.x += Math.sin(mt * 16) * 0.1; aim.set(0, 1, 0.3); }
          break;
        case "think":
          if (s > 0) { tgt.set(0.2, -0.47, 0.5); tgt.y += Math.max(0, Math.sin(t * 5)) * 0.03; aim.set(-0.4, 1, 0.2); }
          else tgt.set(-0.62, -0.33, 0.28);
          break;
        case "idea":
          tgt.set(s * 0.68, 0.5, 0.15); aim.set(s * 0.2, 1, 0.2);
          break;
        case "focus":
          tgt.set(s * 0.46, -0.42, 0.42);
          tgt.y += Math.sin(t * 7 + (s > 0 ? 0 : Math.PI)) * 0.035;
          if (lookLocal) aim.copy(lookLocal).sub(tgt);
          else aim.set(0, -1, 0.6);
          break;
        case "proud":
          if (mt < 1.7) { tgt.set(s * 0.7, 0.5 + Math.sin(mt * 14 + s) * 0.06, 0.1); aim.set(s * 0.3, 1, 0); }
          else if (s > 0) { tgt.set(0.66, 0.3, 0.25); tgt.x += Math.sin(mt * 15) * 0.11; aim.set(0, 1, 0.3); }
          break;
        case "sad":
          tgt.set(s * 0.5, -0.7, 0.05); aim.set(0, -1, 0.2);
          break;
        case "idle":
          tgt.y += Math.sin(t * 0.8 + s * 2) * 0.05;
          break;
      }
      h.vel.addScaledVector(this._v.copy(tgt).sub(h.pos), dt * 120).multiplyScalar(Math.max(0, 1 - dt * 13));
      h.pos.addScaledVector(h.vel, dt);
      h.g.position.copy(h.pos);
      this._m.lookAt(this._v.set(0, 0, 0), aim.normalize().negate(), this._w.set(0, 1, 0));
      this._q.setFromRotationMatrix(this._m);
      h.g.quaternion.slerp(this._q, Math.min(1, dt * 10));
    }
  }

  private express(dt: number, night: number) {
    const { mood, moodT: mt, face, fu } = this;
    let preset = FACES["neutral"]!;
    switch (mood) {
      case "arrive": preset = mt > 0.75 ? FACES["hello"]! : FACES["neutral"]!; break;
      case "think": preset = mt > 12 && Math.sin(this.t * 0.5) > 0.3 ? FACES["ponder"]! : FACES["think"]!; break;
      case "idea": preset = FACES["idea"]!; break;
      case "focus": preset = this.glance > 0 ? FACES["glance"]! : FACES["focus"]!; break;
      case "proud": preset = FACES["proud"]!; break;
      case "greet": preset = FACES["hello"]!; break;
      case "sad": preset = mt < 0.9 ? FACES["error"]! : FACES["sad"]!; break;
      case "idle": preset = FACES["idle"]!; break;
    }
    if (mood === "focus") {
      this.glance -= dt;
      this.glanceIn -= dt;
      if (this.glanceIn <= 0) { this.glance = 1.1; this.glanceIn = 6 + this.rnd() * 5; }
    } else this.glance = 0;
    this.blinkIn -= dt;
    if (this.blinkIn <= 0) { this.blink = 0.16; this.blinkIn = 2 + this.rnd() * 3.5; }
    this.blink = Math.max(0, this.blink - dt);
    const blink = this.blink > 0 ? Math.abs(this.blink - 0.08) / 0.08 : 1;

    let lx = 0, ly = 0;
    if (mood === "think") { lx = 0.75 * this.thinkSide; ly = preset.lookY ?? 0; }
    else if (mood === "focus" && this.lookAt && this.glance <= 0 && this.root.parent) {
      this.root.parent.localToWorld(this._v.copy(this.lookAt));
      this.rig.worldToLocal(this._v);
      ly = clamp((this._v.y / Math.max(0.5, this._v.length())) * 1.8, -1, 0.3);
    } else if (mood === "idle") { lx = 0.5 * Math.sin(this.t * 0.31); ly = 0.2 * Math.sin(this.t * 0.23); }
    else ly = preset.lookY ?? 0;

    const k = 1 - Math.exp(-dt * 11);
    for (const key of FACE_KEYS) {
      let want = key === "open" ? preset.open ?? 1 : preset[key] ?? 0;
      if (key === "lookX") want = lx;
      if (key === "lookY") want = ly;
      face[key] += (want - face[key]) * k;
    }
    this.flash = Math.max(0, this.flash - dt * 2.2);
    fu["uTime"]!.value = this.t;
    fu["uOpen"]!.value = face.open * blink;
    fu["uHappy"]!.value = face.happy;
    fu["uLid"]!.value = face.lid;
    fu["uSlant"]!.value = face.slant;
    fu["uWide"]!.value = face.wide;
    fu["uErr"]!.value = face.err;
    fu["uMouth"]!.value = face.mouth;
    fu["uMouthOpen"]!.value = face.mouthOpen;
    fu["uDots"]!.value = face.dots;
    fu["uGlitch"]!.value = face.glitch * (0.6 + 0.4 * Math.sin(this.t * 40));
    fu["uFlash"]!.value = this.flash;
    (fu["uLook"]!.value as THREE.Vector2).set(face.lookX, face.lookY);
    const upset = mood === "sad" ? 1 : 0;
    const eye = (fu["uEye"]!.value as THREE.Color).copy(this.colors.eye).lerp(this.colors.fail, upset);
    eye.multiplyScalar(1.6 - 0.6 * night);
    const glow = this.glowMat.color.copy(this.colors.glow).lerp(this.colors.fail, upset).multiplyScalar(1.4 - 0.5 * night + this.flash * 2);
    (this.hu["uCol"]!.value as THREE.Color).copy(glow).multiplyScalar(0.9);
    this.hu["uAmt"]!.value = mood === "sad" ? 0.3 : 1;
    const beat = mood === "think" ? 0.5 + 0.5 * Math.sin(this.t * 7) : 0.75;
    this.tipMat.color.copy(glow).multiplyScalar(0.6 + beat * 0.6 + this.flash * 1.5);
  }

  dispose() {
    this.root.removeFromParent();
    this.root.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    for (const m of this.mats) m.dispose();
  }
}
