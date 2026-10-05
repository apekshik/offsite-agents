import { useEffect, useRef } from "react";
import { useQuery } from "convex/react";
import type { WorldModule } from "@offsite/kit";
import { yacht } from "@offsite/world-yacht";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Game as Engine } from "./engine.ts";

// The 3D world: renderer, the office's world (the yacht), the captain, the crew. Owned by the
// game stream; the interface never imports from here (see src/bridge.ts).

const WORLDS: Record<string, WorldModule> = { yacht };

export function Game({ officeId }: { officeId: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef<Engine | null>(null);
  const snapshot = useQuery(api.world.snapshot, { officeId: officeId as Id<"offices"> });
  const latest = useRef(snapshot);
  latest.current = snapshot;
  const me = useQuery(api.users.me);
  const world = snapshot?.office.world;
  const ready = me !== undefined && !!world;

  useEffect(() => {
    if (!ready || !canvas.current) return;
    let live = true;
    let started: Engine | null = null;
    const quality = new URLSearchParams(location.search).get("quality") === "low" ? "low" : "high";
    void Engine.start({ canvas: canvas.current, world: WORLDS[world] ?? yacht, quality, captain: me }).then((g) => {
      if (!live) { g.dispose(); return; }
      started = g;
      engine.current = g;
      // The world takes a moment to build; catch up on whatever arrived meanwhile.
      if (latest.current) g.setSnapshot(latest.current);
    });
    return () => { live = false; started?.dispose(); engine.current = null; };
    // The world is built once per ship and captain; everything else streams in through setSnapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, world, me?._id]);

  useEffect(() => {
    if (snapshot && engine.current) engine.current.setSnapshot(snapshot);
  });

  return <canvas ref={canvas} id="game" style={{ position: "fixed", inset: 0, width: "100%", height: "100%", display: "block", outline: "none" }} tabIndex={0} />;
}
