import * as THREE from "three";
import { AUDIO_FILES, type AudioFile } from "./files.ts";
import { EMITTERS, LAYERS, ONE_SHOTS, UI_SOUNDS, filesOf, type EmitterSound, type Layer, type OneShotSound, type UiSound } from "./sounds.ts";
import { ambienceMix, nightFromHour, wildlifeChance } from "./mix.ts";
import { Picker, type Deterministic } from "./pick.ts";
import { loadPrefs, savePrefs, type AudioPrefs } from "./prefs.ts";
import type { FlightPhase } from "./cues.ts";

// Offsite's sound, on three.js's AudioListener and PositionalAudio. One instance (`audio`, from
// index.ts) is shared by the game and the interface; see README.md for how the engine wires it.
//
// Nothing is created before the first user gesture (the browser's autoplay rule): until then calls
// are remembered (emitters, ambience) or dropped (one-shots). Files load lazily after that, beds
// first, so nothing here ever holds up the first frame.

/** A place: a world position, or an object to follow (a helicopter, a crew member). */
export type Where = THREE.Object3D | { x: number; y: number; z: number };

export interface Emitter {
  setPosition(where: Where): void;
  /** 0..1 on top of the sound's own mix level, eased over `fade` seconds. */
  setVolume(volume: number, fade?: number): void;
  /** Fades out over `fade` seconds and releases it. */
  stop(fade?: number): void;
  readonly stopped: boolean;
}

export interface PlayOptions {
  /** 0..1 on top of the sound's own mix level. */
  volume?: number;
  /** Seconds from now. */
  delay?: number;
  /** Start this many seconds into the file (joining something already under way). */
  offset?: number;
}

export interface AudioOptions {
  /** Where the files are served (apps/web/public/audio). */
  base?: string;
  /** Seeded variations keyed on the film's clock; null for the game's randomness. */
  deterministic?: Deterministic | null;
  /** Gulls and dolphins on their own, around the listener (default on). */
  wildlife?: boolean;
  /** The sea's surface in world y, for dolphins (the yacht's water is at 0). */
  seaLevel?: number;
}

export interface AudioSnapshot {
  /** The context exists and is running (after the first gesture). */
  started: boolean;
  volume: number;
  muted: boolean;
}

interface EmitterState {
  sound: EmitterSound;
  where: Where;
  volume: number;
  node: THREE.PositionalAudio | null;
  stopped: boolean;
}

const isObject = (w: Where): w is THREE.Object3D => (w as THREE.Object3D).isObject3D === true;
const LAYER_IDS = Object.keys(LAYERS) as Layer[];
/** A one-shot whose file took longer than this to arrive is skipped: it would land out of sync. */
const LATE_S = 0.4;

function editable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
}

function idle(fn: () => void) {
  const w = globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(fn, { timeout: 2000 });
  else setTimeout(fn, 200);
}

export class AudioManager {
  private base: string;
  private picker: Picker;
  private wildlife: boolean;
  private seaLevel: number;
  private prefs: AudioPrefs;
  private snap: AudioSnapshot;
  private readonly subs = new Set<() => void>();

  private listener: THREE.AudioListener | null = null;
  private camera: THREE.Object3D | null = null;
  private scene: THREE.Object3D | null = null;
  /** Holds sounds placed at fixed world positions. */
  private readonly root = new THREE.Group();
  private ext: "ogg" | "m4a" = "ogg";
  private readonly buffers = new Map<AudioFile, Promise<AudioBuffer | null>>();

  private readonly emitters = new Set<EmitterState>();
  private readonly layers = new Map<Layer, THREE.Audio>();
  private readonly playing = new Map<string, number>();
  private readonly helis = new Map<THREE.Object3D, { phase: FlightPhase; loop: Emitter | null }>();
  private mix = { night: 0, busy: 0 };
  private disarm: (() => void) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastSlot = -1;
  private readonly tmp = new THREE.Vector3();
  private readonly ear = new THREE.Vector3();

  constructor(o: AudioOptions = {}) {
    this.base = o.base ?? "/audio/";
    this.picker = new Picker(o.deterministic ?? null);
    this.wildlife = o.wildlife ?? true;
    this.seaLevel = o.seaLevel ?? 0;
    this.prefs = loadPrefs();
    this.snap = { started: false, ...this.prefs };
    this.root.name = "audio";
  }

  // ---------- setup ----------

  /** Hang the listener on the camera and the placed sounds in the scene. Safe to call again. */
  attach(camera: THREE.Object3D, scene: THREE.Object3D): void {
    if (this.camera !== camera) {
      if (this.listener) { this.listener.removeFromParent(); camera.add(this.listener); }
      this.camera = camera;
    }
    if (this.scene !== scene) { this.root.removeFromParent(); scene.add(this.root); this.scene = scene; }
    this.arm();
  }

  detach(): void {
    this.listener?.removeFromParent();
    this.root.removeFromParent();
    this.camera = null;
    this.scene = null;
  }

  /** Waits for the first click, tap or key press anywhere, then starts. attach() and every play call arm it. */
  arm(): void {
    if (this.listener || this.disarm || typeof window === "undefined") return;
    const events = ["pointerdown", "keydown", "touchend"] as const;
    const go = () => { off(); void this.start(); };
    const off = () => { for (const e of events) window.removeEventListener(e, go, true); this.disarm = null; };
    for (const e of events) window.addEventListener(e, go, true);
    this.disarm = off;
  }

  /**
   * Creates the audio context and starts everything asked for so far. Call it from inside a user
   * gesture (arm() does), or the browser keeps it suspended.
   */
  start(): Promise<void> {
    if (this.listener) return this.listener.context.state === "running" ? Promise.resolve() : this.listener.context.resume();
    if (typeof window === "undefined") return Promise.resolve();
    this.disarm?.();
    const listener = new THREE.AudioListener();
    this.listener = listener;
    this.camera?.add(listener);
    listener.setMasterVolume(this.level());
    // Resume synchronously inside the gesture (Safari needs that), before anything awaits.
    const resumed = listener.context.resume();
    const probe = document.createElement("audio");
    this.ext = probe.canPlayType('audio/ogg; codecs="opus"') ? "ogg" : "m4a";

    document.addEventListener("visibilitychange", this.onVisibility);
    for (const id of LAYER_IDS) this.startLayer(id);
    for (const e of this.emitters) this.materialize(e);
    this.timer = setInterval(() => this.tick(), 250);
    // The rest, while the browser has nothing better to do.
    idle(() => {
      for (const def of [...Object.values(UI_SOUNDS), ...Object.values(ONE_SHOTS)]) for (const f of filesOf(def)) void this.load(f);
    });
    this.update({ started: true });
    return resumed.then(() => undefined, () => undefined);
  }

  /** Seeded variations for the film rig (null: back to random). */
  setDeterministic(d: Deterministic | null): void {
    this.picker = new Picker(d);
    this.lastSlot = -1;
  }

  /** Gulls and dolphins on their own. The film rig may turn them off and cue them with play(). */
  setWildlife(on: boolean): void { this.wildlife = on; }

  dispose(): void {
    this.disarm?.();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const e of this.emitters) this.release(e, 0);
    this.emitters.clear();
    for (const l of this.layers.values()) { if (l.isPlaying) l.stop(); l.disconnect(); l.gain.disconnect(); }
    this.layers.clear();
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", this.onVisibility);
    this.detach();
    this.listener = null;
    this.update({ started: false });
  }

  // ---------- volume ----------

  get volume(): number { return this.prefs.volume; }
  set volume(v: number) { this.setPrefs({ volume: Math.min(1, Math.max(0, v)) }); }
  get muted(): boolean { return this.prefs.muted; }
  set muted(m: boolean) { this.setPrefs({ muted: m }); }
  toggleMute(): void { this.muted = !this.muted; }

  /** M mutes and unmutes, except while typing in a field. Returns the unbind. */
  bindMuteKey(target: Window = window): () => void {
    const on = (e: KeyboardEvent) => {
      if (e.code !== "KeyM" || e.repeat || e.metaKey || e.ctrlKey || e.altKey || editable(e.target)) return;
      this.toggleMute();
    };
    target.addEventListener("keydown", on);
    return () => target.removeEventListener("keydown", on);
  }

  /** For React's useSyncExternalStore: started, volume, muted. */
  readonly subscribe = (fn: () => void): (() => void) => { this.subs.add(fn); return () => { this.subs.delete(fn); }; };
  readonly getSnapshot = (): AudioSnapshot => this.snap;

  private setPrefs(p: Partial<AudioPrefs>) {
    this.prefs = { ...this.prefs, ...p };
    savePrefs(this.prefs);
    this.listener?.setMasterVolume(this.level());
    this.update(p);
  }

  private level() { return this.prefs.muted ? 0 : this.prefs.volume; }

  private update(p: Partial<AudioSnapshot>) {
    this.snap = { ...this.snap, ...p };
    for (const fn of this.subs) fn();
  }

  private onVisibility = () => {
    const ctx = this.listener?.context;
    if (!ctx) return;
    if (document.hidden) void ctx.suspend();
    else void ctx.resume();
  };

  // ---------- ambience ----------

  /**
   * The beds: pass the sky's night (0 day .. 1 night) or the hour (0..24), and how busy the ship is
   * (0..1, mix.ts busyLevel). Changes ease over a few seconds.
   */
  setAmbience(a: { hour?: number; night?: number; busy?: number }): void {
    const night = a.night ?? (a.hour !== undefined ? nightFromHour(a.hour) : this.mix.night);
    this.mix = { night, busy: a.busy ?? this.mix.busy };
    this.applyMix(3);
  }

  private startLayer(id: Layer) {
    const listener = this.listener!;
    const def = LAYERS[id];
    const bed = new THREE.Audio(listener);
    bed.gain.gain.value = 0;
    this.layers.set(id, bed);
    void this.load(def.file).then((buf) => {
      if (!buf || this.layers.get(id) !== bed) return;
      this.loop(bed, buf, def.file, id);
      bed.play();
      this.applyMix(1.5);
    });
  }

  private applyMix(seconds: number) {
    if (!this.listener) return;
    const levels = ambienceMix(this.mix.night, this.mix.busy);
    const t = this.listener.context.currentTime;
    for (const [id, bed] of this.layers) bed.gain.gain.setTargetAtTime(levels[id] * LAYERS[id].volume, t, seconds / 3);
  }

  // ---------- emitters ----------

  /** A loop at a place (bar music at the bar, the server room's hum) or following something. */
  emitter(sound: EmitterSound, where: Where, o: { volume?: number } = {}): Emitter {
    const e: EmitterState = { sound, where, volume: o.volume ?? 1, node: null, stopped: false };
    this.emitters.add(e);
    this.arm();
    this.materialize(e);
    return {
      setPosition: (w) => { e.where = w; this.place(e); },
      setVolume: (v, fade = 0.5) => {
        e.volume = Math.max(0, v);
        if (e.node?.isPlaying) e.node.gain.gain.setTargetAtTime(EMITTERS[sound].volume * e.volume, e.node.context.currentTime, Math.max(0.01, fade / 3));
      },
      stop: (fade = 0.5) => { if (!e.stopped) this.release(e, fade); },
      get stopped() { return e.stopped; },
    };
  }

  private materialize(e: EmitterState) {
    if (!this.listener || e.node || e.stopped) return;
    const def = EMITTERS[e.sound];
    const node = new THREE.PositionalAudio(this.listener);
    this.configure(node, def);
    node.gain.gain.value = 0;
    e.node = node;
    this.place(e);
    const file = def.files[this.picker.variation(e.sound, def.files.length)]!;
    void this.load(file).then((buf) => {
      if (!buf || e.stopped || e.node !== node) return;
      this.loop(node, buf, file, e.sound);
      node.play();
      node.gain.gain.setTargetAtTime(def.volume * e.volume, node.context.currentTime, 0.3);
    });
  }

  private place(e: EmitterState) {
    const node = e.node;
    if (!node) return;
    if (isObject(e.where)) {
      if (node.parent !== e.where) e.where.add(node);
      node.position.set(0, 0, 0);
    } else {
      if (node.parent !== this.root) this.root.add(node);
      node.position.set(e.where.x, e.where.y, e.where.z);
    }
  }

  private release(e: EmitterState, fade: number) {
    e.stopped = true;
    this.emitters.delete(e);
    const node = e.node;
    e.node = null;
    if (!node) return;
    const end = () => {
      if (node.isPlaying) node.stop();
      if (node.source) node.disconnect();
      node.gain.disconnect();
      node.removeFromParent();
    };
    if (fade > 0 && node.isPlaying) {
      node.gain.gain.setTargetAtTime(0, node.context.currentTime, fade / 4);
      setTimeout(end, fade * 1000 + 50);
    } else end();
  }

  // ---------- one-shots and the interface ----------

  /** A sound that happens once, somewhere (or at your ear, with no place). */
  play(sound: OneShotSound, where?: Where, o: PlayOptions = {}): void {
    this.arm();
    const def = ONE_SHOTS[sound];
    if (!this.listener || (this.playing.get(sound) ?? 0) >= def.voices) return;
    if (where) {
      const p = isObject(where) ? where.getWorldPosition(this.tmp) : this.tmp.set(where.x, where.y, where.z);
      if (this.camera && p.distanceTo(this.camera.getWorldPosition(this.ear)) > def.max) return;
    }
    const node: THREE.Audio<AudioNode> = where ? new THREE.PositionalAudio(this.listener) : new THREE.Audio(this.listener);
    if (node instanceof THREE.PositionalAudio) this.configure(node, def);
    this.fire(sound, def, node, o, where);
  }

  /** The phone and the interface: buzz, fold clicks, the send tick, the landed chime. */
  ui(sound: UiSound, o: PlayOptions = {}): void {
    this.arm();
    const def = UI_SOUNDS[sound];
    if (!this.listener || (this.playing.get(sound) ?? 0) >= def.voices) return;
    this.fire(sound, def, new THREE.Audio(this.listener), o, undefined);
  }

  private fire(key: string, def: { files: readonly AudioFile[]; volume: number; detune?: number }, node: THREE.Audio<AudioNode>, o: PlayOptions, where: Where | undefined) {
    const ctx = node.context;
    const asked = ctx.currentTime;
    const file = def.files[this.picker.variation(key, def.files.length)]!;
    node.setDetune(this.picker.detune(key, def.detune ?? 0)); // applied when it starts
    this.playing.set(key, (this.playing.get(key) ?? 0) + 1);
    const done = () => {
      this.playing.set(key, Math.max(0, (this.playing.get(key) ?? 1) - 1));
      if (node.source) node.disconnect();
      node.gain.disconnect();
      node.removeFromParent();
    };
    void this.load(file).then((buf) => {
      const late = ctx.currentTime - asked;
      if (!buf || late > LATE_S + (o.delay ?? 0) || !this.listener) { done(); return; }
      if (where) {
        if (isObject(where)) where.add(node);
        else { this.root.add(node); node.position.set(where.x, where.y, where.z); }
      }
      node.setBuffer(buf);
      node.offset = Math.min(Math.max(0, o.offset ?? 0), Math.max(0, buf.duration - 0.05));
      node.gain.gain.value = def.volume * (o.volume ?? 1);
      node.play(Math.max(0, (o.delay ?? 0) - late));
      node.source?.addEventListener("ended", done, { once: true });
    });
  }

  // ---------- the helicopter ----------

  /**
   * Call every frame (or whenever it changes) for each helicopter in the air or on the pad, with
   * its object and its flight's phase (cues.ts flightPhase). Approach and take-off play their
   * sounds, following it; on the pad its rotors idle; joining mid-flight, the rotor loop plays.
   */
  helicopter(obj: THREE.Object3D, phase: FlightPhase, msIntoPhase = 0): void {
    const prev = this.helis.get(obj);
    if ((prev?.phase ?? "away") === phase) return;
    prev?.loop?.stop(phase === "away" ? 1.5 : 0.8);
    if (phase === "away") { this.helis.delete(obj); return; }
    const st: { phase: FlightPhase; loop: Emitter | null } = { phase, loop: null };
    this.helis.set(obj, st);
    const into = msIntoPhase / 1000;
    if (phase === "ground") st.loop = this.emitter("heli-idle", obj);
    else {
      const sound = phase === "approach" ? "heli-approach" : "heli-takeoff";
      if (this.listener && into < AUDIO_FILES[sound].seconds - 1) this.play(sound, obj, { offset: into });
      else st.loop = this.emitter("heli-rotor", obj);
    }
  }

  // ---------- internals ----------

  private configure(node: THREE.PositionalAudio, def: { ref: number; rolloff: number; max: number; cheap?: boolean }) {
    node.setDistanceModel("inverse");
    node.setRefDistance(def.ref);
    node.setRolloffFactor(def.rolloff);
    node.setMaxDistance(def.max);
    if (def.cheap) node.panner.panningModel = "equalpower";
  }

  /** Loop over exactly the length the build wrote (AAC pads its tail), from a varied start. */
  private loop(node: THREE.Audio<AudioNode>, buf: AudioBuffer, file: AudioFile, key: string) {
    const len = Math.min(buf.duration, AUDIO_FILES[file].seconds);
    node.setBuffer(buf);
    node.setLoop(true);
    node.setLoopStart(0);
    node.setLoopEnd(len);
    node.offset = this.picker.slot(`${key}:start`, 0) * len * 0.9;
  }

  private load(file: AudioFile): Promise<AudioBuffer | null> {
    let p = this.buffers.get(file);
    if (!p) { p = this.fetchDecode(file); this.buffers.set(file, p); }
    return p;
  }

  private async fetchDecode(file: AudioFile): Promise<AudioBuffer | null> {
    const ctx = this.listener?.context;
    if (!ctx) return null;
    for (const ext of this.ext === "ogg" ? ["ogg", "m4a"] : ["m4a"]) {
      try {
        const r = await fetch(`${this.base}${file}.${ext}`);
        if (!r.ok) continue;
        return await ctx.decodeAudioData(await r.arrayBuffer());
      } catch { /* the other format, or nothing: a missing sound never breaks the game */ }
    }
    return null;
  }

  /** Four times a second: gulls and dolphins, keyed on half-second slots of the (film's) clock. */
  private tick() {
    if (!this.wildlife || !this.listener || !this.camera || this.prefs.muted) return;
    const slot = Math.floor(this.picker.now() * 2);
    if (slot === this.lastSlot) return;
    this.lastSlot = slot;
    const chance = wildlifeChance(this.mix.night);
    const ear = this.camera.getWorldPosition(this.ear);
    const around = (key: string, r0: number, r1: number) => {
      const a = this.picker.slot(`${key}:a`, slot) * Math.PI * 2, r = r0 + (r1 - r0) * this.picker.slot(`${key}:r`, slot);
      return { x: ear.x + Math.cos(a) * r, z: ear.z + Math.sin(a) * r };
    };
    if (this.picker.slot("gull", slot) < chance.gull) {
      const p = around("gull", 10, 35);
      this.play("gull", { x: p.x, y: ear.y + 4 + 10 * this.picker.slot("gull:y", slot), z: p.z });
    }
    if (this.picker.slot("dolphin", slot) < chance.dolphin) {
      const p = around("dolphin", 25, 50);
      this.play("dolphin-splash", { x: p.x, y: this.seaLevel, z: p.z });
    }
  }
}
