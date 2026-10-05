// A small WebRTC mesh between everyone on the same ship's deck. Every pair shares one peer connection with
//  - an unreliable data channel for movement (15 Hz; a stale sample is useless),
//  - a reliable, ordered one for events that must arrive (a wave),
//  - an audio transceiver for proximity voice (silent until the mic is on).
// Signaling goes through Convex (convex/signals.ts). The peer with the smaller id makes the offer.
//
// Adapted from Ready Player One (github.com/apekshik/ready-player-one, src/peers.js), MIT, Copyright (c) 2026
// Apekshik Panigrahi. Ported to TypeScript; ICE servers can be given (a TURN service), otherwise public STUN only.

export type SignalKind = "offer" | "answer" | "ice" | "bye";
export interface Signal { from: string; kind: string; data: string }

/** Public STUN only: two browsers behind strict NATs can't connect without a TURN server (see PeersOptions.ice). */
export const DEFAULT_ICE: RTCIceServer[] = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"] }];
const RETRY_MS = 4000;
const CONNECT_TIMEOUT_MS = 15000;

interface Peer {
  id: string;
  pc: RTCPeerConnection;
  dc: RTCDataChannel | null;
  rc: RTCDataChannel | null;
  audio: RTCRtpTransceiver | null;
  initiator: boolean;
  pendingIce: RTCIceCandidateInit[];
  timer: ReturnType<typeof setTimeout> | null;
  /** Gave up connecting at least once (the deck says so: "no direct link"). */
  failed: boolean;
}

export interface PeersOptions {
  myId: string;
  signal: (to: string, kind: SignalKind, data: string) => void;
  onData: (from: string, msg: unknown) => void;
  onTrack?: (from: string, stream: MediaStream) => void;
  onChange?: () => void;
  ice?: RTCIceServer[];
}

export class Peers {
  private peers = new Map<string, Peer>();
  private micTrack: MediaStreamTrack | null = null;
  private wanted = new Set<string>();
  private closed = false;
  /** Peers that failed to connect at least once and aren't connected now. */
  private everFailed = new Set<string>();

  private o: PeersOptions;
  constructor(o: PeersOptions) { this.o = o; }

  /** Keep one connection per remote peer id in `ids`. */
  sync(ids: string[]) {
    if (this.closed) return;
    this.wanted = new Set(ids);
    for (const id of ids) if (!this.peers.has(id) && this.o.myId < id) this.create(id, true);
    for (const id of [...this.peers.keys()]) if (!this.wanted.has(id)) this.close(id);
    for (const id of [...this.everFailed]) if (!this.wanted.has(id)) this.everFailed.delete(id);
  }

  isOpen(id: string): boolean { return this.peers.get(id)?.dc?.readyState === "open"; }
  /** Tried and couldn't connect (and still isn't): strict NATs on both sides, no TURN server. */
  hasFailed(id: string): boolean { return this.everFailed.has(id) && !this.isOpen(id); }
  connectedCount(): number { let n = 0; for (const p of this.peers.values()) if (p.dc?.readyState === "open") n++; return n; }

  /** reliable: on the events channel, so it arrives, in order (falls back to the movement channel). */
  broadcast(msg: unknown, reliable = false) {
    const data = JSON.stringify(msg);
    for (const p of this.peers.values()) {
      if (reliable && p.rc?.readyState === "open") p.rc.send(data);
      else if (p.dc?.readyState === "open" && p.dc.bufferedAmount < 64_000) p.dc.send(data);
    }
  }

  setMicTrack(track: MediaStreamTrack | null) {
    this.micTrack = track;
    for (const p of this.peers.values()) p.audio?.sender.replaceTrack(track).catch(() => {});
  }

  async handle({ from, kind, data }: Signal) {
    if (this.closed) return;
    let p = this.peers.get(from);
    try {
      if (kind === "offer") {
        if (p) this.close(from, false);
        p = this.create(from, false);
        await p.pc.setRemoteDescription(JSON.parse(data) as RTCSessionDescriptionInit);
        p.audio = p.pc.getTransceivers().find((t) => t.receiver.track.kind === "audio") ?? p.pc.addTransceiver("audio");
        p.audio.direction = "sendrecv";
        if (this.micTrack) await p.audio.sender.replaceTrack(this.micTrack);
        await p.pc.setLocalDescription(await p.pc.createAnswer());
        this.o.signal(from, "answer", JSON.stringify(p.pc.localDescription));
        await this.flushIce(p);
      } else if (kind === "answer" && p?.initiator && p.pc.signalingState === "have-local-offer") {
        await p.pc.setRemoteDescription(JSON.parse(data) as RTCSessionDescriptionInit);
        await this.flushIce(p);
      } else if (kind === "ice" && p) {
        const cand = JSON.parse(data) as RTCIceCandidateInit;
        if (p.pc.remoteDescription) await p.pc.addIceCandidate(cand);
        else p.pendingIce.push(cand);
      } else if (kind === "bye" && p) {
        this.close(from, false);
      }
    } catch (err) {
      console.warn("webrtc signal failed", kind, err);
    }
  }

  private async flushIce(p: Peer) {
    for (const c of p.pendingIce.splice(0)) await p.pc.addIceCandidate(c).catch(() => {});
  }

  private create(id: string, initiator: boolean): Peer {
    const pc = new RTCPeerConnection({ iceServers: this.o.ice ?? DEFAULT_ICE });
    const p: Peer = { id, pc, dc: null, rc: null, audio: null, initiator, pendingIce: [], timer: null, failed: false };
    this.peers.set(id, p);
    pc.onicecandidate = (e) => { if (e.candidate) this.o.signal(id, "ice", JSON.stringify(e.candidate)); };
    pc.ontrack = (e) => this.o.onTrack?.(id, e.streams[0] ?? new MediaStream([e.track]));
    pc.ondatachannel = (e) => this.wire(p, e.channel);
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") this.everFailed.delete(id);
      if (pc.connectionState === "failed") this.retry(id);
      this.o.onChange?.();
    };
    p.timer = setTimeout(() => { if (pc.connectionState !== "connected") this.retry(id); }, CONNECT_TIMEOUT_MS);
    if (initiator) {
      this.wire(p, pc.createDataChannel("state", { ordered: false, maxRetransmits: 0 }));
      this.wire(p, pc.createDataChannel("events", { ordered: true }));
      p.audio = pc.addTransceiver("audio", { direction: "sendrecv" });
      if (this.micTrack) void p.audio.sender.replaceTrack(this.micTrack);
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .then(() => this.o.signal(id, "offer", JSON.stringify(pc.localDescription)))
        .catch((err) => console.warn("offer failed", err));
    }
    return p;
  }

  private wire(p: Peer, dc: RTCDataChannel) {
    if (dc.label === "events") p.rc = dc;
    else p.dc = dc;
    dc.onopen = () => this.o.onChange?.();
    dc.onclose = () => this.o.onChange?.();
    dc.onmessage = (e) => {
      let msg: unknown;
      try { msg = JSON.parse(String(e.data)); } catch { return; }
      this.o.onData(p.id, msg);
    };
  }

  private retry(id: string) {
    this.everFailed.add(id);
    this.close(id);
    // Only the initiator offers again; the other side waits for a fresh offer.
    setTimeout(() => { if (!this.closed && this.wanted.has(id) && !this.peers.has(id) && this.o.myId < id) this.create(id, true); }, RETRY_MS);
    this.o.onChange?.();
  }

  private close(id: string, notify = true) {
    const p = this.peers.get(id);
    if (!p) return;
    if (p.timer) clearTimeout(p.timer);
    p.pc.close();
    this.peers.delete(id);
    if (notify && this.wanted.has(id)) this.o.signal(id, "bye", "");
    this.o.onChange?.();
  }

  closeAll() {
    this.closed = true;
    for (const id of [...this.peers.keys()]) this.close(id, false);
  }
}
