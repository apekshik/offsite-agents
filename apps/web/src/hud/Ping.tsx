import { useEffect, useRef } from "react";
import { scene, ui, useUi } from "../bridge.ts";
import { Face } from "../ui/index.tsx";
import { useShip } from "../overlay/ship.tsx";

// The ping marker: after "Find", a marker over the crew member's head, projected every frame; when
// they are off screen (or behind you) it sits on the screen's edge with an arrow pointing the way.
// The game draws the beam and the route; this says who and how far.

const EDGE = 56;

export function PingMarker() {
  const ping = useUi((s) => s.ping);
  const { byId } = useShip();
  const box = useRef<HTMLDivElement>(null);
  const arrow = useRef<HTMLDivElement>(null);
  const dist = useRef<HTMLSpanElement>(null);
  const who = ping ? byId.get(ping.crewId) : undefined;

  useEffect(() => {
    if (!ping) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const el = box.current, ar = arrow.current;
      if (!el || !ar) return;
      const at = scene.locate(ping.crewId);
      if (!at) { el.style.opacity = "0"; return; }
      el.style.opacity = "1";
      if (dist.current) dist.current.textContent = `${Math.round(at.distance)} m`;
      const W = innerWidth, H = innerHeight;
      if (at.onScreen) {
        el.classList.remove("edge");
        el.style.transform = `translate(${at.x}px, ${at.y}px)`;
        return;
      }
      // Off screen: from the centre toward them, stopped at the edge.
      const cx = W / 2, cy = H / 2;
      let dx = at.x - cx, dy = at.y - cy;
      if (Math.abs(dx) < 1e-3 && Math.abs(dy) < 1e-3) dy = 1;
      const k = Math.min((W / 2 - EDGE) / Math.abs(dx || 1e-6), (H / 2 - EDGE) / Math.abs(dy || 1e-6));
      const x = cx + dx * k, y = cy + dy * k;
      el.classList.add("edge");
      el.style.transform = `translate(${x}px, ${y}px)`;
      ar.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [ping]);

  if (!ping) return null;
  return (
    <div className="ping" ref={box}>
      <div className="ping-arrow" ref={arrow}><i /></div>
      <div className="ping-tag">
        <Face avatar={who?.avatar} look={who?.look} size={20} />
        <span className="ping-name">{who?.name ?? "Crew"}</span>
        <span className="ping-dist" ref={dist} />
        <button className="ping-x" onClick={() => ui.set({ ping: null })} aria-label="Stop finding">×</button>
      </div>
      <div className="ping-pin" />
    </div>
  );
}
