// The landing page's backdrop on its own: for tuning the camera loop and rendering the poster
// (scripts/landing-poster.mjs).
//
//   /dev/landing.html                     plays the loop from the start
//   /dev/landing.html?t=40                holds the camera 40 s into the loop
//   /dev/landing.html?t=0&cam=x,y,z,tx,ty,tz,fov   holds the camera at a pose of its own
//   &shift=0.12  room for the text, as on the page   &crew=0  nobody aboard   &dpr=1  pixel ratio
//   &quality=low                          the low-quality world   &ui=0  hide the stats

import { createLandingScene } from "../src/landing/scene.ts";
import { loopSeconds } from "../src/landing/path.ts";

const q = new URLSearchParams(location.search);
if (q.get("ui") === "0") document.body.classList.add("clean");
const canvas = document.getElementById("c") as HTMLCanvasElement;
const stats = document.getElementById("stats")!;
const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d);

const scene = await createLandingScene(canvas, {
  quality: q.get("quality") === "low" ? "low" : "high",
  maxPixelRatio: num("dpr", 1.25),
  maxPixels: num("pixels", 2_400_000),
  shift: num("shift", 0),
  shiftY: num("shiftY", 0),
  crew: q.get("crew") !== "0",
  start: num("start", 0),
  onSlow: () => { stats.textContent += "\nslow: gave up"; },
});
addEventListener("resize", () => scene.resize(innerWidth, innerHeight));
// &cam=x,y,z,tx,ty,tz,fov: hold the camera there instead.
const cam = q.get("cam")?.split(",").map(Number);
const pose = cam ? { pos: [cam[0]!, cam[1]!, cam[2]!] as [number, number, number], at: [cam[3]!, cam[4]!, cam[5]!] as [number, number, number], fov: cam[6] ?? 40 } : undefined;
if (q.has("t")) scene.still(Number(q.get("t")), pose);
else scene.play();
Object.assign(window, { __landing: { scene, pose, loop: loopSeconds(), ready: true } });
setInterval(() => {
  const s = scene.stats();
  stats.textContent = `${s.fps.toFixed(0)} fps  dpr ${s.pixelRatio.toFixed(2)}\nbuilt ${s.buildMs.toFixed(0)} ms  compiled ${s.compiledMs.toFixed(0)} ms`;
}, 500);
