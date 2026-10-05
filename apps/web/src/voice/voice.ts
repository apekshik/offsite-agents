// Proximity voice: each person's voice runs through a 3D HRTF panner at their head, so it fades with distance (silent
// beyond MAX_DISTANCE) and sounds like it comes from where they stand; through a wall or a deck it's muffled. The mic
// is off until you turn it on (T, or the HUD's mic); the browser asks for it the first time. While anyone is talking,
// the ship's own sound steps back a little (audio.setDuck).
//
// Adapted from Ready Player One (github.com/apekshik/ready-player-one, src/voice.js), MIT, Copyright (c) 2026
// Apekshik Panigrahi: the panner per remote stream, the muted <audio> element Chrome needs before it feeds a WebRTC
// stream to Web Audio, the analyser levels, and unlocking audio inside a gesture. Ported to TypeScript; per-person
// mute, muffling through walls, speaking state and ducking are Offsite's.

import * as THREE from "three";
import { audio } from "../audio/index.ts";

/** Voices are silent beyond this many metres. */
export const MAX_DISTANCE = 25;
/** Full volume within this many metres. */
const REF_DISTANCE = 2;
/** Above this level (0..1) someone is talking. */
const SPEAKING = 0.06;
/** How far the ship's sound ducks while someone talks. */
const DUCK = 0.6;

interface Remote {
  el: HTMLAudioElement;
  src: MediaStreamAudioSourceNode;
  gain: GainNode;
  filter: BiquadFilterNode;
  panner: PannerNode;
  analyser: AnalyserNode;
  level: number;
  heard: boolean;
}

export interface VoiceSnapshot {
  /** The mic has been granted and is in use (it may be muted). */
  enabled: boolean;
  /** Turned off after being on: the track sends silence. */
  muted: boolean;
  /** Sending your voice right now. */
  live: boolean;
  /** Asking the browser for the mic. */
  asking: boolean;
  /** Why the mic isn't on ("blocked", "none"), shown by the HUD. */
  error: string | null;
  /** You are talking (your mic's level is up). */
  talking: boolean;
  /** People (user ids) heard talking now. */
  speaking: string[];
  /** People (user ids) you muted. */
  mutedPeople: string[];
}

type MicListener = (track: MediaStreamTrack | null) => void;

export class Voice {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private mic: MediaStreamTrack | null = null;
  private micAnalyser: AnalyserNode | null = null;
  private micLevel = 0;
  private remotes = new Map<string, Remote>();
  private pending = new Map<string, MediaStream>();
  /** peer id → user id (the deck says who each tab is). */
  private users = new Map<string, string>();
  private muted = new Set<string>();
  private buf = new Uint8Array(256);
  private micListeners = new Set<MicListener>();
  private subs = new Set<() => void>();
  private snap: VoiceSnapshot = { enabled: false, muted: false, live: false, asking: false, error: null, talking: false, speaking: [], mutedPeople: [] };
  private disarm: (() => void) | null = null;
  private v = new THREE.Vector3();

  // ---- the store, for React (useVoice) ----

  readonly subscribe = (fn: () => void) => { this.subs.add(fn); return () => { this.subs.delete(fn); }; };
  readonly getSnapshot = () => this.snap;
  private set(p: Partial<VoiceSnapshot>) {
    const next = { ...this.snap, ...p };
    if (JSON.stringify(next) === JSON.stringify(this.snap)) return;
    this.snap = next;
    for (const fn of this.subs) fn();
  }

  /** The mic track changed (on, or gone): the deck hands it to every peer connection. */
  onMic(fn: MicListener): () => void { this.micListeners.add(fn); fn(this.mic); return () => { this.micListeners.delete(fn); }; }
  get micTrack() { return this.mic; }

  /** Start audio on the first click or key (browsers keep it locked until a gesture), then forget the listeners. */
  arm() {
    if (this.ctx || this.disarm || typeof window === "undefined") return;
    const go = () => { this.unlock(); this.disarm?.(); };
    addEventListener("pointerdown", go, true);
    addEventListener("keydown", go, true);
    this.disarm = () => { removeEventListener("pointerdown", go, true); removeEventListener("keydown", go, true); this.disarm = null; };
  }

  /** Must run inside a user gesture. */
  unlock() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.out = new GainNode(this.ctx, { gain: 1 });
      this.out.connect(this.ctx.destination);
    }
    void this.ctx.resume().catch(() => {});
    for (const [id, stream] of this.pending) this.attach(id, stream);
    this.pending.clear();
  }

  /** T or the mic button: the first time asks the browser for the mic; after that, mute and unmute. */
  async toggle(): Promise<void> {
    this.unlock();
    if (this.snap.asking) return;
    if (!this.mic || this.mic.readyState === "ended") {
      this.set({ asking: true, error: null });
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        this.mic = stream.getAudioTracks()[0] ?? null;
        if (!this.mic) throw Object.assign(new Error("no track"), { name: "NotFoundError" });
        this.mic.onended = () => { this.mic = null; this.micAnalyser = null; this.set({ enabled: false, live: false, muted: false }); for (const fn of this.micListeners) fn(null); };
        const src = this.ctx!.createMediaStreamSource(stream);
        this.micAnalyser = this.ctx!.createAnalyser();
        this.micAnalyser.fftSize = 256;
        src.connect(this.micAnalyser);
        for (const fn of this.micListeners) fn(this.mic);
        this.set({ asking: false, enabled: true, muted: false, live: true });
      } catch (e) {
        const name = (e as { name?: string }).name;
        this.set({ asking: false, error: name === "NotAllowedError" || name === "SecurityError" ? "blocked" : name === "NotFoundError" ? "none" : "failed" });
      }
      return;
    }
    this.setMuted(!this.snap.muted);
  }

  setMuted(muted: boolean) {
    if (this.mic) this.mic.enabled = !muted;
    this.set({ muted, live: !!this.mic && !muted });
  }

  /** Mute (or unmute) one person, for you only. */
  mutePerson(userId: string, on: boolean) {
    if (on) this.muted.add(userId); else this.muted.delete(userId);
    for (const [peer, r] of this.remotes) if (this.users.get(peer) === userId) r.gain.gain.setTargetAtTime(on ? 0 : 1, this.ctx!.currentTime, 0.05);
    this.set({ mutedPeople: [...this.muted] });
  }

  /** Which person a tab's stream belongs to. */
  setPeerUser(peerId: string, userId: string) {
    this.users.set(peerId, userId);
    const r = this.remotes.get(peerId);
    if (r && this.ctx) r.gain.gain.value = this.muted.has(userId) ? 0 : 1;
  }

  addRemote(peerId: string, stream: MediaStream) {
    if (!this.ctx) { this.pending.set(peerId, stream); this.arm(); return; }
    this.attach(peerId, stream);
  }

  private attach(peerId: string, stream: MediaStream) {
    this.removeRemote(peerId);
    const ctx = this.ctx!;
    // Chrome only feeds a remote WebRTC stream into Web Audio if an element is also playing it.
    const el = new Audio();
    el.srcObject = stream;
    el.muted = true;
    void el.play().catch(() => {});
    const src = ctx.createMediaStreamSource(stream);
    const user = this.users.get(peerId);
    const gain = new GainNode(ctx, { gain: user && this.muted.has(user) ? 0 : 1 });
    // Through a wall or a deck: muffled (setOccluded).
    const filter = new BiquadFilterNode(ctx, { type: "lowpass", frequency: 20_000, Q: 0.7 });
    const panner = new PannerNode(ctx, { panningModel: "HRTF", distanceModel: "linear", refDistance: REF_DISTANCE, maxDistance: MAX_DISTANCE, rolloffFactor: 1 });
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    src.connect(analyser);
    src.connect(gain).connect(filter).connect(panner).connect(this.out!);
    this.remotes.set(peerId, { el, src, gain, filter, panner, analyser, level: 0, heard: false });
  }

  removeRemote(peerId: string) {
    const r = this.remotes.get(peerId);
    this.pending.delete(peerId);
    if (!r) return;
    r.src.disconnect();
    r.gain.disconnect();
    r.filter.disconnect();
    r.panner.disconnect();
    r.el.srcObject = null;
    this.remotes.delete(peerId);
  }

  private level(analyser: AnalyserNode): number {
    analyser.getByteTimeDomainData(this.buf);
    let sum = 0;
    for (const x of this.buf) sum += (x - 128) ** 2;
    return Math.min(1, Math.sqrt(sum / this.buf.length) / 30);
  }

  /**
   * Every frame, from the game: where your ears are (the camera), and each tab's head in the world with whether a
   * wall is between you. Positions the voices, measures who is talking, and ducks the ship's sound while anyone is.
   */
  update(ear: THREE.Vector3, forward: THREE.Vector3, up: THREE.Vector3, heads: Map<string, { at: THREE.Vector3; occluded: boolean }>) {
    const ctx = this.ctx;
    if (!ctx) return;
    const L = ctx.listener;
    const t = ctx.currentTime;
    if (L.positionX) {
      L.positionX.setTargetAtTime(ear.x, t, 0.05);
      L.positionY.setTargetAtTime(ear.y, t, 0.05);
      L.positionZ.setTargetAtTime(ear.z, t, 0.05);
      L.forwardX.value = forward.x; L.forwardY.value = forward.y; L.forwardZ.value = forward.z;
      L.upX.value = up.x; L.upY.value = up.y; L.upZ.value = up.z;
    } else {
      L.setPosition(ear.x, ear.y, ear.z);
      L.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
    }
    const speaking: string[] = [];
    for (const [peer, r] of this.remotes) {
      const h = heads.get(peer);
      if (h) {
        r.panner.positionX.setTargetAtTime(h.at.x, t, 0.05);
        r.panner.positionY.setTargetAtTime(h.at.y, t, 0.05);
        r.panner.positionZ.setTargetAtTime(h.at.z, t, 0.05);
        r.filter.frequency.setTargetAtTime(h.occluded ? 900 : 20_000, t, 0.15);
      }
      const user = this.users.get(peer);
      r.heard = !!h && h.at.distanceTo(this.v.copy(ear)) < MAX_DISTANCE && !(user && this.muted.has(user));
      r.level = r.level * 0.6 + this.level(r.analyser) * 0.4;
      // Talking, as far as you're concerned: loud enough, and within earshot (not muted).
      if (r.level > SPEAKING && user && r.heard) speaking.push(user);
    }
    if (this.micAnalyser) this.micLevel = this.snap.live ? this.micLevel * 0.6 + this.level(this.micAnalyser) * 0.4 : 0;
    // Ducking only for voices you can actually hear.
    const audible = [...this.remotes.values()].some((r) => r.heard && r.level > SPEAKING);
    audio.setDuck(audible ? DUCK : 1);
    this.set({ speaking: speaking.sort(), talking: this.micLevel > SPEAKING });
  }

  /** How loud someone is right now (0..1), for the ring over their head; 0 when muted or out of earshot. */
  levelOf(peerId: string): number {
    const r = this.remotes.get(peerId);
    return r && r.heard ? r.level : 0;
  }

  /** How loud a remote voice reaches you right now: the panner's distance gain (linear model) times the mute. For tests. */
  gainAt(peerId: string, ear: THREE.Vector3): number | null {
    const r = this.remotes.get(peerId);
    if (!r) return null;
    const p = new THREE.Vector3(r.panner.positionX.value, r.panner.positionY.value, r.panner.positionZ.value);
    const d = Math.min(Math.max(p.distanceTo(ear), REF_DISTANCE), MAX_DISTANCE);
    return (1 - (d - REF_DISTANCE) / (MAX_DISTANCE - REF_DISTANCE)) * r.gain.gain.value;
  }

  /** Off the deck: every voice goes, the mic is released. */
  reset() {
    for (const id of [...this.remotes.keys()]) this.removeRemote(id);
    this.pending.clear();
    this.users.clear();
    this.mic?.stop();
    this.mic = null;
    this.micAnalyser = null;
    for (const fn of this.micListeners) fn(null);
    audio.setDuck(1);
    this.set({ enabled: false, muted: false, live: false, talking: false, speaking: [] });
  }

  /** T toggles the mic (not while typing in a field). Returns the unbind. */
  bindKey(target: Window = window): () => void {
    const on = (e: KeyboardEvent) => {
      if (e.code !== "KeyT" || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName ?? ""))) return;
      e.preventDefault();
      void this.toggle();
    };
    target.addEventListener("keydown", on);
    return () => target.removeEventListener("keydown", on);
  }
}
