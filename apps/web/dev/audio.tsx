import { createRoot } from "react-dom/client";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { audio, flightPhase, nightFromHour, useAudio, type Emitter, type EmitterSound, type OneShotSound, type UiSound } from "../src/audio/index.ts";
import { AUDIO_FILES } from "../src/audio/files.ts";
import { EMITTERS, ONE_SHOTS, UI_SOUNDS } from "../src/audio/sounds.ts";

// Audition every sound and loop: /dev/audio.html. You stand at the centre of the map facing up
// (north is -z); click the map to choose where sounds play, then play them. Uses the same
// AudioManager the game does, so what you hear here is the game's mix.

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
camera.position.set(0, 1.6, 0);
audio.attach(camera, scene);
const unbindM = audio.bindMuteKey();
import.meta.hot?.dispose(() => { unbindM(); audio.dispose(); });

// No renderer here: keep the listener and the sounds' positions current ourselves.
const tick = () => { camera.updateMatrixWorld(); scene.updateMatrixWorld(); requestAnimationFrame(tick); };
requestAnimationFrame(tick);

const SCALE = 4; // px per metre
const SIZE = 320;

// A pretend helicopter for the flight cue: in from the north-east, down beside you, off to the west.
const heli = new THREE.Object3D();
scene.add(heli);
function heliPosition(phase: string, ms: number, out: THREE.Vector3) {
  if (phase === "approach") { const k = Math.min(1, ms / 14_000), e = 1 - Math.pow(1 - k, 1.6); return out.set(300 - 280 * e, 80 - 75 * e, -300 + 290 * e); }
  if (phase === "ground") return out.set(20, 0, -10);
  const k = Math.min(1, ms / 9_000); return out.set(20 - 400 * k * k, 10 + 120 * k, -10 + 100 * k);
}

function App() {
  const snap = useAudio();
  const [spot, setSpot] = useState({ x: 6, z: -6 });
  const [hour, setHour] = useState(14);
  const [busy, setBusy] = useState(0);
  const [wildlife, setWildlife] = useState(true);
  const [seeded, setSeeded] = useState(false);
  const [loops, setLoops] = useState<Partial<Record<EmitterSound, Emitter>>>({});
  const [flight, setFlight] = useState<{ land: number; leave: number } | null>(null);
  const [heliAt, setHeliAt] = useState<{ x: number; z: number } | null>(null);
  const loopsRef = useRef(loops);
  loopsRef.current = loops;

  useEffect(() => { audio.setAmbience({ night: nightFromHour(hour), busy }); }, [hour, busy]);
  useEffect(() => { audio.setWildlife(wildlife); }, [wildlife]);
  useEffect(() => { audio.setDeterministic(seeded ? { seed: 42, clock: () => performance.now() / 1000 } : null); }, [seeded]);
  useEffect(() => () => { for (const e of Object.values(loopsRef.current)) e?.stop(0); }, []);

  // Fly the pretend helicopter and tell the manager its phase, as the engine will.
  useEffect(() => {
    if (!flight) return;
    let raf = 0;
    const step = () => {
      const { phase, ms } = flightPhase(flight, Date.now());
      audio.helicopter(heli, phase, ms);
      if (phase === "away") { setFlight(null); setHeliAt(null); return; }
      heliPosition(phase, ms, heli.position);
      setHeliAt({ x: heli.position.x, z: heli.position.z });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [flight]);

  const where = { x: spot.x, y: 1.2, z: spot.z };
  const toggleLoop = (s: EmitterSound) => {
    const cur = loops[s];
    if (cur) { cur.stop(0.6); setLoops({ ...loops, [s]: undefined }); }
    else setLoops({ ...loops, [s]: audio.emitter(s, where) });
  };

  const px = (m: number) => SIZE / 2 + m * SCALE;
  return (
    <main>
      <section>
        <h1>OFFSITE · AUDIO</h1>
        <p className="muted">{snap.started ? "Sound is on." : "Click anywhere to start sound (the browser's rule)."} M mutes.</p>
        <label>volume <input type="range" min={0} max={1} step={0.01} value={snap.volume} onChange={(e) => { audio.volume = Number(e.target.value); }} /> {Math.round(snap.volume * 100)}</label>
        <label><input type="checkbox" checked={snap.muted} onChange={(e) => { audio.muted = e.target.checked; }} /> muted</label>

        <h2>Ambience</h2>
        <label>hour <input type="range" min={0} max={24} step={0.25} value={hour} onChange={(e) => setHour(Number(e.target.value))} /> {hour.toFixed(2)}</label>
        <label>busy <input type="range" min={0} max={1} step={0.01} value={busy} onChange={(e) => setBusy(Number(e.target.value))} /> {busy.toFixed(2)}</label>
        <label><input type="checkbox" checked={wildlife} onChange={(e) => setWildlife(e.target.checked)} /> gulls and dolphins on their own</label>
        <label><input type="checkbox" checked={seeded} onChange={(e) => setSeeded(e.target.checked)} /> deterministic (seed 42, keyed on the clock)</label>

        <h2>Where (click the map)</h2>
        <svg width={SIZE} height={SIZE} onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setSpot({ x: (e.clientX - r.left - SIZE / 2) / SCALE, z: (e.clientY - r.top - SIZE / 2) / SCALE });
        }}>
          {[10, 20, 30].map((m) => <circle key={m} cx={SIZE / 2} cy={SIZE / 2} r={m * SCALE} fill="none" stroke="#1f3a55" />)}
          <polygon points={`${SIZE / 2},${SIZE / 2 - 8} ${SIZE / 2 - 5},${SIZE / 2 + 5} ${SIZE / 2 + 5},${SIZE / 2 + 5}`} fill="#8fd3ff" />
          <circle cx={px(spot.x)} cy={px(spot.z)} r={5} fill="#ffc861" />
          {heliAt && <circle cx={Math.min(SIZE - 4, Math.max(4, px(heliAt.x)))} cy={Math.min(SIZE - 4, Math.max(4, px(heliAt.z)))} r={6} fill="#ff7a7a" />}
        </svg>
        <p className="muted">{spot.x.toFixed(1)} m east, {(-spot.z).toFixed(1)} m ahead. Rings every 10 m.</p>
      </section>

      <section>
        <h2>One-shots, at the marker</h2>
        {(Object.keys(ONE_SHOTS) as OneShotSound[]).map((s) => <button key={s} onClick={() => audio.play(s, where)}>{s}</button>)}

        <h2>The phone (no position)</h2>
        {(Object.keys(UI_SOUNDS) as UiSound[]).map((s) => <button key={s} onClick={() => audio.ui(s)}>{s}</button>)}

        <h2>Loops, placed at the marker</h2>
        {(Object.keys(EMITTERS) as EmitterSound[]).map((s) => <button key={s} className={loops[s] ? "on" : ""} onClick={() => toggleLoop(s)}>{s}</button>)}

        <h2>Helicopter</h2>
        <button disabled={!!flight} onClick={() => { const land = Date.now() + 14_000; setFlight({ land, leave: land + 7_000 }); }}>fly one in (30 s)</button>
        <span className="muted">{flight ? flightPhase(flight, Date.now()).phase : ""}</span>

        <h2>Every file, raw</h2>
        <div className="files">
          {Object.entries(AUDIO_FILES).map(([name, f]) => (
            <div key={name}>
              <span>{name} <span className="muted">{f.seconds.toFixed(1)} s{f.loop ? " · loop" : ""}</span></span>
              <audio controls preload="none" loop={f.loop}>
                <source src={`/audio/${name}.ogg`} type='audio/ogg; codecs="opus"' />
                <source src={`/audio/${name}.m4a`} type="audio/mp4" />
              </audio>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
