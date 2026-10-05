import type { ConvexReactClient } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { MotionSample, PRESENCE, PersonAct } from "@offsite/contracts";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { voice } from "../voice/index.ts";
import { Peers, type Signal } from "./peers.ts";

// Everyone on the same ship's deck, live. Each tab joins the roster (convex/presence.ts) with a peer id, connects
// peer to peer with everyone else (peers.ts, signaled through convex/signals.ts) and streams its movement 15 times a
// second; voices ride the same connections (src/voice). Where a peer-to-peer link isn't up (yet, or at all: strict
// NATs and no TURN server), positions go through Convex instead, about 5 times a second, and the roster's position
// stands in for the live one. The approach is Ready Player One's (src/main.js: enterWorld, onPlayers, onPeerData).

export type OnDeck = FunctionReturnType<typeof api.presence.here>[number];

/** What this tab's captain is doing, from the game. */
export interface SelfState { pos: [number, number, number]; facing: number; act: PersonAct; speed: number }

/** One position for someone, from a peer-to-peer sample or the roster. */
export interface Sample { p: [number, number, number]; r: number; v: number; a: PersonAct }

/** How each person's movement (and voice) reaches you: directly, still connecting, or through Convex (no voice). */
export type Link = "direct" | "connecting" | "relayed";

export interface DeckOptions {
  client: ConvexReactClient;
  officeId: string;
  /** Your user id: your own row isn't someone else. */
  me: string;
  self: () => SelfState | null;
  onSample: (userId: string, s: Sample, via: "direct" | "relayed") => void;
  /** Everyone else on deck, whenever that changes. */
  onRoster: (others: OnDeck[]) => void;
  /** A reliable event from someone (a wave). */
  onEvent?: (userId: string, msg: { t: string }) => void;
  /** Another tab of yours took over, or you were taken off the ship. */
  onReplaced?: () => void;
  /** false: no peer-to-peer at all (every position through Convex, no voice). For testing the fallback. */
  p2p?: boolean;
  ice?: RTCIceServer[];
}

const LIVE_MS = 1500;
const round2 = (n: number) => Math.round(n * 100) / 100;

// ---- the links, for the interface ("no direct link") ----

let links: Record<string, Link> = {};
const linkSubs = new Set<() => void>();
export const deckLinks = {
  get: () => links,
  subscribe(fn: () => void) { linkSubs.add(fn); return () => { linkSubs.delete(fn); }; },
};
function setLinks(next: Record<string, Link>) {
  if (JSON.stringify(next) === JSON.stringify(links)) return;
  links = next;
  for (const fn of linkSubs) fn();
}

export class Deck {
  readonly peerId = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
  private peers: Peers | null = null;
  private others: OnDeck[] = [];
  private all: OnDeck[] = [];
  private byPeer = new Map<string, string>();
  private lastLive = new Map<string, number>();
  private lastSeq = new Map<string, number>();
  private lastRow = new Map<string, { at: number; pos: number[] }>();
  private handled = new Set<string>();
  private unsubs: (() => void)[] = [];
  private timers: ReturnType<typeof setInterval>[] = [];
  private joined = false;
  private stopped = false;
  private seq = 0;
  private lastSent = "";
  private lastForced = 0;
  private lastBeat = 0;
  private beating = false;
  private lastBeatSig = "";

  private o: DeckOptions;
  constructor(o: DeckOptions) { this.o = o; }

  start() {
    const { client, officeId } = this.o;
    const id = officeId as Id<"offices">;
    if (this.o.p2p !== false && typeof RTCPeerConnection !== "undefined") {
      this.peers = new Peers({
        myId: this.peerId,
        ...(this.o.ice ? { ice: this.o.ice } : {}),
        signal: (to, kind, data) => { void client.mutation(api.signals.send, { from: this.peerId, to, kind, data }).catch(() => {}); },
        onData: (from, msg) => this.onData(from, msg),
        onTrack: (from, stream) => voice.addRemote(from, stream),
        onChange: () => this.refreshLinks(),
      });
      this.unsubs.push(voice.onMic((track) => this.peers?.setMicTrack(track)));
    }
    const roster = client.watchQuery(api.presence.here, { officeId: id });
    const onRoster = () => { try { const r = roster.localQueryResult(); if (r) this.onRoster(r); } catch { /* not aboard (any more): the app notices */ } };
    this.unsubs.push(roster.onUpdate(onRoster));
    onRoster();
    const inbox = client.watchQuery(api.signals.inbox, { peerId: this.peerId });
    const onInbox = () => { try { const r = inbox.localQueryResult(); if (r) this.onSignals(r); } catch { /* signed out */ } };
    this.unsubs.push(inbox.onUpdate(onInbox));

    this.timers.push(setInterval(() => this.tick(), 1000 / PRESENCE.sendHz));
    addEventListener("pagehide", this.stop);
    void this.join();
  }

  private async join() {
    while (!this.stopped && !this.joined) {
      const s = this.o.self();
      if (s) {
        try {
          await this.o.client.mutation(api.presence.join, { officeId: this.o.officeId as Id<"offices">, peerId: this.peerId, pos: s.pos, facing: s.facing, act: s.act });
          this.joined = true;
          this.lastBeat = Date.now();
          return;
        } catch { /* try again shortly */ }
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  /** 15 times a second: movement to every open link; a heartbeat (or, on the fallback, ~5 Hz positions) to Convex. */
  private tick() {
    if (this.stopped || !this.joined) return;
    const s = this.o.self();
    if (!s) return;
    const now = Date.now();
    const p: [number, number, number] = [round2(s.pos[0]), round2(s.pos[1]), round2(s.pos[2])];
    const r = round2(s.facing), v = round2(Math.min(20, Math.max(0, s.speed)));
    if (this.peers && this.peers.connectedCount() > 0) {
      const sig = JSON.stringify([p, r, v, s.act]);
      if (sig !== this.lastSent || now - this.lastForced > 1000) {
        this.peers.broadcast({ t: "s", p, r, v, a: s.act, n: ++this.seq } satisfies MotionSample);
        this.lastSent = sig;
        this.lastForced = now;
      }
    }
    // Anyone we can't reach directly hears our position through Convex.
    const fallback = this.others.some((x) => !this.peers?.isOpen(x.peerId));
    const every = fallback ? PRESENCE.fallbackMs : PRESENCE.beatMs;
    const beatSig = JSON.stringify([p, r, s.act]);
    if (this.beating || now - this.lastBeat < every) return;
    if (beatSig === this.lastBeatSig && now - this.lastBeat < PRESENCE.beatMs) return;
    this.beating = true;
    this.lastBeat = now;
    this.lastBeatSig = beatSig;
    void this.o.client.mutation(api.presence.beat, { officeId: this.o.officeId as Id<"offices">, peerId: this.peerId, pos: p, facing: r, act: s.act })
      .then((res) => { if (res.replaced && !this.stopped) { this.stop(); this.o.onReplaced?.(); } })
      .catch(() => {})
      .finally(() => { this.beating = false; });
  }

  private onRoster(rows: OnDeck[]) {
    this.all = rows;
    const others = rows.filter((x) => x.userId !== this.o.me);
    const now = performance.now();
    const gone = this.others.filter((x) => !others.some((y) => y.peerId === x.peerId));
    for (const g of gone) voice.removeRemote(g.peerId);
    this.others = others;
    this.byPeer = new Map(others.map((x) => [x.peerId, x.userId]));
    for (const x of others) voice.setPeerUser(x.peerId, x.userId);
    this.peers?.sync(others.map((x) => x.peerId));
    this.o.onRoster(others);
    // No live sample lately: the roster's position stands in (the fallback), with a speed from how far it moved.
    for (const x of others) {
      if (now - (this.lastLive.get(x.userId) ?? -1e9) < LIVE_MS) continue;
      const prev = this.lastRow.get(x.userId);
      if (prev && prev.at === x.at) continue;
      const dt = prev ? (x.at - prev.at) / 1000 : 0;
      const dist = prev ? Math.hypot(x.pos[0]! - prev.pos[0]!, x.pos[2]! - prev.pos[2]!) : 0;
      this.lastRow.set(x.userId, { at: x.at, pos: x.pos });
      const act = PersonAct.catch("walk").parse(x.act);
      this.o.onSample(x.userId, { p: [x.pos[0]!, x.pos[1]!, x.pos[2]!], r: x.facing, v: dt > 0 && dt < 3 ? Math.min(8, dist / dt) : 0, a: act }, "relayed");
    }
    this.refreshLinks();
  }

  private onSignals(list: { id: Id<"signals">; from: string; kind: string; data: string }[]) {
    const fresh = list.filter((s) => !this.handled.has(s.id));
    if (!fresh.length) return;
    for (const s of fresh) {
      this.handled.add(s.id);
      void this.peers?.handle(s as Signal);
    }
    void this.o.client.mutation(api.signals.ack, { peerId: this.peerId, ids: fresh.map((s) => s.id) }).catch(() => {});
    if (this.handled.size > 2000) this.handled = new Set([...this.handled].slice(-500));
  }

  private onData(fromPeer: string, msg: unknown) {
    const userId = this.byPeer.get(fromPeer);
    if (!userId || !msg || typeof msg !== "object") return;
    const m = msg as { t?: unknown };
    if (m.t === "s") {
      const parsed = MotionSample.safeParse(msg);
      if (!parsed.success) return;
      const s = parsed.data;
      if (s.n <= (this.lastSeq.get(fromPeer) ?? -1)) return;
      this.lastSeq.set(fromPeer, s.n);
      this.lastLive.set(userId, performance.now());
      this.o.onSample(userId, { p: s.p, r: s.r, v: s.v, a: s.a }, "direct");
    } else if (typeof m.t === "string") {
      this.o.onEvent?.(userId, m as { t: string });
    }
  }

  /**
   * This tab directs the crew for everyone on deck: it came on deck first (ties: the smaller user id). Everyone works it
   * out from the same roster, so they agree.
   */
  isHost(): boolean {
    const first = [...this.all].sort((a, b) => a.joinedAt - b.joinedAt || (a.userId < b.userId ? -1 : 1))[0];
    return !first || first.userId === this.o.me;
  }

  /** Someone else is on deck with a direct link (worth sharing the crew's plan with). */
  get linked(): boolean { return !!this.peers && this.peers.connectedCount() > 0; }

  /** Something everyone should see happen (a wave): over the reliable channel. */
  send(msg: { t: string }) { this.peers?.broadcast(msg, true); }

  private refreshLinks() {
    const next: Record<string, Link> = {};
    for (const x of this.others) {
      next[x.userId] = this.peers?.isOpen(x.peerId) ? "direct" : !this.peers || this.peers.hasFailed(x.peerId) ? "relayed" : "connecting";
    }
    setLinks(next);
  }

  stop = () => {
    if (this.stopped) return;
    this.stopped = true;
    removeEventListener("pagehide", this.stop);
    for (const t of this.timers) clearInterval(t);
    for (const u of this.unsubs) u();
    this.peers?.closeAll();
    this.peers = null;
    voice.reset();
    setLinks({});
    if (this.joined) void this.o.client.mutation(api.presence.leave, { peerId: this.peerId }).catch(() => {});
  };
}
