import { useEffect, useState } from "react";
import { scene } from "../bridge.ts";
import { Game } from "../game/Game.tsx";
import { Overlay } from "../overlay/Overlay.tsx";

// Aboard: the world under the overlay, with a veil while the ship builds. Loaded on its own
// (Gate.tsx imports it lazily), so the front door and the way aboard never wait for three.js.

export function Aboard({ officeId }: { officeId: string }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = setInterval(() => { if (scene.captain()) { setReady(true); clearInterval(t); } }, 250);
    return () => clearInterval(t);
  }, []);
  return (
    <>
      <Game officeId={officeId} />
      <Overlay officeId={officeId} />
      <div className={`boarding ${ready ? "gone" : ""}`}><span className="disp">Boarding</span><span className="dots"><i /><i /><i /></span></div>
    </>
  );
}
