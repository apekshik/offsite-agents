import * as THREE from "three";
import { CrewFigure, sanitizeAvatar, sanitizeLook, type ActId, type Tone } from "@offsite/kit";
import type { AvatarSpec, Look, PersonAct } from "@offsite/contracts";
import type { Sample } from "../net/index.ts";
import { voice } from "../voice/index.ts";
import { personLook } from "../people/look.ts";

// Everyone else on deck, as the world draws them: each a walking figure in their own look with a name tag, moving
// where their samples say, smoothly. Samples arrive 15 times a second peer to peer, or ~5 a second through Convex when
// no direct link is up; each person is drawn a little in the past (a few sample intervals: less when samples come
// often) and interpolated between the two samples around that moment, carried forward on their last velocity for a
// moment when samples stop. What they are doing shows too: the phone out (the 3D phone in their hands), at the helm,
// and a ring over their head while they talk. Voices are placed at their heads every frame (src/voice).
//
// The remote-player idea (a target per person, settle toward it, teleport when far) is Ready Player One's
// (github.com/apekshik/ready-player-one, src/main.js); the buffered interpolation is Offsite's.

export interface PersonOnDeck {
  userId: string;
  peerId: string;
  name: string;
  avatar: unknown;
  look: unknown;
  owner: boolean;
}


/** Never draw further back than this, nor closer than this, behind the newest sample (ms). */
const MIN_DELAY = 90, MAX_DELAY = 450;
/** Carry someone forward on their velocity for at most this long when samples stop (ms). */
const MAX_EXTRAPOLATE = 250;
/** Further than this from where they're drawn: they jumped (a teleport, a new tab); no gliding across the ship. */
const SNAP_M = 8;
const PLATE_RANGE = 60;

const angleDelta = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

export interface Snap { at: number; p: THREE.Vector3; r: number; v: number; a: PersonAct }

/**
 * Where someone should be drawn at `now` (ms) from their samples (arrival times, oldest first; trimmed in place):
 * interpolated a little in the past (`interval`, the average gap between samples, sets how far), or carried forward
 * on their last stretch for a moment once samples stop. Null before the first sample.
 */
export function drawAt(s: Snap[], interval: number, now: number): { p: THREE.Vector3; r: number; v: number; a: PersonAct } | null {
  if (!s.length) return null;
  const delay = Math.min(MAX_DELAY, Math.max(MIN_DELAY, interval * 1.6 + 30));
  const at = now - delay;
  // Drop samples nobody needs any more (keep the one just before `at`).
  while (s.length > 2 && s[1]!.at <= at) s.shift();
  const a = s[0]!, b = s[1];
  if (at <= a.at) return { p: a.p.clone(), r: a.r, v: a.v, a: a.a };
  if (b && at < b.at) {
    const k = (at - a.at) / (b.at - a.at);
    return { p: a.p.clone().lerp(b.p, k), r: a.r + angleDelta(a.r, b.r) * k, v: a.v + (b.v - a.v) * k, a: k < 0.5 ? a.a : b.a };
  }
  // Past the newest sample: carry on along the last stretch for a moment, then wait there.
  const last = b ?? a, prev = b ? a : null;
  const over = Math.min(MAX_EXTRAPOLATE, at - last.at);
  if (prev && last.v > 0.2 && last.at > prev.at) {
    const vel = last.p.clone().sub(prev.p).divideScalar((last.at - prev.at) / 1000);
    vel.y = 0;
    if (vel.length() < 10) return { p: last.p.clone().addScaledVector(vel, over / 1000), r: last.r, v: over >= MAX_EXTRAPOLATE ? 0 : last.v, a: last.a };
  }
  return { p: last.p.clone(), r: last.r, v: over >= MAX_EXTRAPOLATE ? 0 : last.v, a: last.a };
}

const ACT: Record<PersonAct, ActId | null> = { walk: null, helm: "talk", phone: "phone", "phone-open": "phone" };
const LINE: Record<PersonAct, string> = { walk: "", helm: "At the helm", phone: "On the phone", "phone-open": "On the phone" };

class Person {
  readonly fig: CrewFigure;
  readonly ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  snaps: Snap[] = [];
  /** Average time between samples (ms), for how far back to draw. */
  interval = 200;
  lastArrival = 0;
  speed = 0;
  act: PersonAct = "walk";
  shown = false;
  talking = 0;
  private lookKey = "";

  view: PersonOnDeck;

  constructor(view: PersonOnDeck, scene: THREE.Scene) {
    this.view = view;
    const { avatar, look } = personLook(view);
    this.fig = new CrewFigure({ spec: sanitizeAvatar(avatar) as AvatarSpec, look: look ? (sanitizeLook(look) as Look | null) : null, name: view.name, seed: hashOf(view.userId) % 1000 });
    this.lookKey = JSON.stringify([view.avatar, view.look]);
    this.fig.object.visible = false;
    this.fig.object.name = `person:${view.userId}`;
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.17, 0.24, 40),
      new THREE.MeshBasicMaterial({ color: "#6dffa8", transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.renderOrder = 5;
    this.fig.object.add(this.ring);
    scene.add(this.fig.object);
    this.label();
  }

  /** A new name or look from the roster. */
  refresh(view: PersonOnDeck) {
    const key = JSON.stringify([view.avatar, view.look]);
    if (key !== this.lookKey) {
      this.lookKey = key;
      const { avatar, look } = personLook(view);
      this.fig.setLook(sanitizeAvatar(avatar) as AvatarSpec, look ? (sanitizeLook(look) as Look | null) : null);
      this.fig.setAct(ACT[this.act]);
    }
    this.view = view;
    this.label();
  }

  label() {
    const talking = this.talking > 0.3;
    const line = talking ? "Talking" : LINE[this.act] || (this.view.owner ? "Captain" : "Aboard");
    const tone: Tone = talking ? "ok" : this.view.owner ? "warn" : "accent";
    this.fig.setLabel(this.view.name, line, tone);
  }

  dispose() {
    this.ring.geometry.dispose();
    this.ring.material.dispose();
    this.fig.dispose();
  }
}

function hashOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export interface PeopleOptions {
  scene: THREE.Scene;
  camera: THREE.Camera;
  /** Is something solid between these two points? For name tags and muffling voices through walls. */
  blocked?: (from: THREE.Vector3, to: THREE.Vector3) => boolean;
}

export class People {
  private people = new Map<string, Person>();
  private first = true;
  private occluded = new Map<string, boolean>();
  private occludedAt = 0;
  private heads = new Map<string, { at: THREE.Vector3; occluded: boolean }>();
  private v = new THREE.Vector3();
  private eye = new THREE.Vector3();
  private fwd = new THREE.Vector3();
  private up = new THREE.Vector3();

  private o: PeopleOptions;
  constructor(o: PeopleOptions) { this.o = o; }

  /** Everyone else on deck. Returns who just came aboard (not those already here the first time). */
  setRoster(list: PersonOnDeck[]): string[] {
    const keep = new Set(list.map((p) => p.userId));
    const joined: string[] = [];
    for (const view of list) {
      const p = this.people.get(view.userId);
      if (p) p.refresh(view);
      else {
        this.people.set(view.userId, new Person(view, this.o.scene));
        if (!this.first) joined.push(view.userId);
      }
    }
    for (const [id, p] of this.people) if (!keep.has(id)) { p.dispose(); this.people.delete(id); this.heads.delete(p.view.peerId); }
    this.first = false;
    return joined;
  }

  /** A sample of where someone is, as it arrived. */
  sample(userId: string, s: Sample, now = performance.now()) {
    const p = this.people.get(userId);
    if (!p) return;
    const gap = now - p.lastArrival;
    if (p.lastArrival && gap < 1500) p.interval += (gap - p.interval) * 0.2;
    p.lastArrival = now;
    p.snaps.push({ at: now, p: new THREE.Vector3(...s.p), r: s.r, v: s.v, a: s.a });
    if (p.snaps.length > 30) p.snaps.splice(0, p.snaps.length - 30);
  }

  /** Every frame: where each is drawn, what they're doing, their tag, the ring while they talk, and their voice. */
  update(dt: number, time: number) {
    const now = performance.now();
    const cam = this.o.camera;
    cam.getWorldPosition(this.eye);
    const checkWalls = this.o.blocked && time - this.occludedAt > 0.25;
    if (checkWalls) this.occludedAt = time;
    for (const [id, p] of this.people) {
      const want = this.place(p, now);
      if (!want) continue;
      const obj = p.fig.object;
      if (!p.shown || obj.position.distanceTo(want.p) > SNAP_M) { obj.position.copy(want.p); obj.rotation.y = want.r; p.shown = true; }
      else {
        obj.position.lerp(want.p, 1 - Math.exp(-dt * 20));
        obj.rotation.y += angleDelta(obj.rotation.y, want.r) * (1 - Math.exp(-dt * 16));
      }
      obj.visible = true;
      p.speed += (want.v - p.speed) * (1 - Math.exp(-dt * 10));
      if (want.a !== p.act) { p.act = want.a; p.fig.setAct(ACT[want.a]); p.label(); }
      p.fig.update(dt, time, { speed: p.speed, seat: null, camera: cam });

      // Name tags within range, unless a wall or a deck is in the way.
      const head = obj.localToWorld(p.fig.rig.headTop(this.v).add(new THREE.Vector3(0, 0.1, 0)));
      const dist = head.distanceTo(this.eye);
      if (checkWalls) this.occluded.set(id, dist > 1.5 && this.o.blocked!(this.eye, head));
      const hidden = this.occluded.get(id) ?? false;
      p.fig.inSight = !hidden && dist < PLATE_RANGE;
      p.fig.plate.sprite.visible = p.fig.inSight;

      // Their voice, from their head; the ring while they talk.
      this.heads.set(p.view.peerId, { at: head.clone(), occluded: hidden });
      const level = voice.levelOf(p.view.peerId);
      const was = p.talking > 0.3;
      p.talking = level > 0.06 ? Math.min(1, p.talking + dt * 6) : Math.max(0, p.talking - dt * 2);
      if (was !== p.talking > 0.3) p.label();
      p.ring.position.set(0, p.fig.rig.headTop(this.v).y + 0.08, 0);
      p.ring.material.opacity = Math.min(0.9, p.talking * (0.45 + level * 2));
      p.ring.scale.setScalar(1 + level * 1.2 + Math.sin(time * 9) * 0.04 * p.talking);
      p.ring.visible = p.talking > 0.01 && p.fig.inSight;
    }
    cam.getWorldDirection(this.fwd);
    this.up.set(0, 1, 0).applyQuaternion(cam.getWorldQuaternion(new THREE.Quaternion()));
    voice.update(this.eye, this.fwd, this.up, this.heads);
  }

  private place(p: Person, now: number) { return drawAt(p.snaps, p.interval, now); }

  /** Where someone stands (for walking over to them), or null when they're not on deck. */
  position(userId: string): THREE.Vector3 | null {
    const p = this.people.get(userId);
    return p?.shown && p.fig.object.visible ? p.fig.object.position : null;
  }

  /** Someone's head on screen, like the crew's (scene.locate). */
  locate(userId: string): { x: number; y: number; onScreen: boolean; distance: number } | null {
    const p = this.people.get(userId);
    if (!p?.shown) return null;
    const head = p.fig.object.localToWorld(p.fig.rig.headTop(this.v).add(new THREE.Vector3(0, 0.6, 0)));
    const distance = head.distanceTo(this.o.camera.position);
    const s = head.project(this.o.camera);
    const onScreen = s.z < 1 && Math.abs(s.x) <= 1 && Math.abs(s.y) <= 1;
    if (s.z > 1) { s.x = -s.x; s.y = -s.y; }
    return { x: ((s.x + 1) / 2) * innerWidth, y: ((1 - s.y) / 2) * innerHeight, onScreen, distance };
  }

  /** A wave (an emote over whatever they are doing). */
  wave(userId: string) { this.people.get(userId)?.fig.playEmote("wave"); }

  /** The figures, for picking and for the crew to look at. */
  objects(): { userId: string; object: THREE.Object3D }[] {
    return [...this.people.entries()].filter(([, p]) => p.shown).map(([userId, p]) => ({ userId, object: p.fig.object }));
  }

  get count() { return this.people.size; }

  dispose() {
    for (const p of this.people.values()) p.dispose();
    this.people.clear();
    this.heads.clear();
  }
}
