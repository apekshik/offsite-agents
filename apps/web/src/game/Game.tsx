import { useEffect, useRef } from "react";
import { useConvex, useQuery } from "convex/react";
import type { WorldModule } from "@offsite/kit";
import { yacht } from "@offsite/world-yacht";
import { moonBase } from "@offsite/world-moon-base";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Deck } from "../net/index.ts";
import { voice } from "../voice/index.ts";
import { personLook } from "../people/look.ts";
import { Game as Engine } from "./engine.ts";

// The 3D world: renderer, the office's world (the yacht, the moon base…), the captain, the crew, and everyone else on deck (the deck:
// src/net, peer to peer with a fallback through Convex). Owned by the game stream; the interface never imports from
// here (see src/bridge.ts).

const WORLDS: Record<string, WorldModule> = { yacht, "moon-base": moonBase };

/** ?p2p=off (dev only): no peer-to-peer at all, every position through Convex. For trying the fallback. */
const P2P = !(import.meta.env.DEV && new URLSearchParams(location.search).get("p2p") === "off");

export function Game({ officeId }: { officeId: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef<Engine | null>(null);
  const client = useConvex();
  const snapshot = useQuery(api.world.snapshot, { officeId: officeId as Id<"offices"> });
  const latest = useRef(snapshot);
  latest.current = snapshot;
  // The helm's screen lists the threads.
  const threads = useQuery(api.threads.list, { officeId: officeId as Id<"offices"> });
  const latestThreads = useRef(threads);
  latestThreads.current = threads;
  // Finished tasks: packages on the drop-off and what each desk offers.
  const deliveries = useQuery(api.diffs.deliveries, { officeId: officeId as Id<"offices"> });
  const latestDeliveries = useRef(deliveries);
  latestDeliveries.current = deliveries;
  const me = useQuery(api.users.me);
  // Yours here: a friend aboard someone else's ship wears their own look (or a crew look), never the captain's uniform.
  const office = useQuery(api.offices.get, { officeId: officeId as Id<"offices"> });
  const world = snapshot?.office.world;
  // A ship read without a role (the film's and the demo's scripted backends) is the captain's own, alone on deck.
  const owner = office ? office.role !== "member" : undefined;
  const shared = !!office?.role;
  const ready = me !== undefined && !!world && owner !== undefined;

  useEffect(() => {
    if (!ready || !canvas.current) return;
    let live = true;
    let started: Engine | null = null;
    let deck: Deck | null = null;
    let share: ReturnType<typeof setInterval> | null = null;
    const quality = new URLSearchParams(location.search).get("quality") === "low" ? "low" : "high";
    const captain = me ? personLook({ userId: me._id, avatar: me.avatar, look: me.look, owner: !!owner }) : null;
    void Engine.start({ canvas: canvas.current, world: WORLDS[world] ?? yacht, quality, captain, guest: !owner, ...(me ? { userId: me._id } : {}) }).then((g) => {
      if (!live) { g.dispose(); return; }
      started = g;
      engine.current = g;
      // The world takes a moment to build; catch up on whatever arrived meanwhile.
      if (latest.current) g.setSnapshot(latest.current);
      if (latestThreads.current) g.setThreads(latestThreads.current);
      if (latestDeliveries.current) g.setDeliveries(latestDeliveries.current);
      // A friend coming aboard for the first time this visit: the crew nearby wave hello.
      if (!owner && me) g.greet(null, me.name);
      // For poking at the world from the console (and the visual checks' scripts).
      if (import.meta.env.DEV) Object.assign(window, { offsiteGame: g });
      if (!me || !shared) return;
      // On deck with everyone else aboard: their figures, their movement, their voices.
      deck = new Deck({
        client, officeId, me: me._id, p2p: P2P,
        self: () => g.self(),
        onSample: (userId, s) => g.people.sample(userId, s),
        onRoster: (others) => g.setPeople(others),
        onEvent: (userId, msg) => {
          if (msg.t === "wave") g.people.wave(userId);
          // The host's plan for the crew: follow it, so everyone sees the same crew in the same places.
          else if (msg.t === "dir" && deck && !deck.isHost()) g.follow(msg);
        },
        onReplaced: () => console.info("Another tab of yours is on deck now; this one has stepped off."),
      });
      deck.start();
      // Host: share the crew's plan with everyone else on deck, once a second.
      share = setInterval(() => {
        if (!deck?.linked) return;
        if (!deck.isHost()) return;
        g.lead();
        const plan = g.sharedPlan();
        if (plan) deck.send({ t: "dir", ...plan });
      }, 1000);
      if (import.meta.env.DEV) Object.assign(window, { offsiteDeck: deck });
      voice.arm();
    });
    const unbindMic = shared ? voice.bindKey() : () => {};
    return () => { live = false; unbindMic(); if (share) clearInterval(share); deck?.stop(); started?.dispose(); engine.current = null; };
    // The world is built once per ship and captain; everything else streams in through setSnapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, world, me?._id, owner, shared]);

  useEffect(() => {
    if (snapshot && engine.current) engine.current.setSnapshot(snapshot);
  });
  useEffect(() => {
    if (threads && engine.current) engine.current.setThreads(threads);
  }, [threads]);
  useEffect(() => {
    if (deliveries && engine.current) engine.current.setDeliveries(deliveries);
  }, [deliveries]);

  return <canvas ref={canvas} id="game" style={{ position: "fixed", inset: 0, width: "100%", height: "100%", display: "block", outline: "none" }} tabIndex={0} />;
}
