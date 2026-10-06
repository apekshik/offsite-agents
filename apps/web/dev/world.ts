// The world viewer: a world on its own, without the app. Orbit round it, scrub the time of day,
// show its slots and walking graph, fly a helicopter in, and check the graph against the
// colliders. For working on worlds and for screenshots (scripts/shot.mjs).
//
//   /dev/world.html?view=hero&hour=18.5&quality=high&slots=1&nav=1&ui=0&fly=1
//   /dev/world.html?walk&at=<nav node or slot id>&yaw=<deg>&view=first|third   walk the decks
//   &crew=<tag|kind|all>   seat crew at the slots with that tag or kind, for checking scale
//   &t=21.5 (or &hour=)    hold the sky at an hour: about 19.0 is sunset, 21.5 night
//   &busy=0.8              how busy the ship is (0 off duty .. 1 the whole crew working), eased in
//   &swell=0               hold the ship still on the swell (default 1)
//   &world=moon-base       the moon base instead of the yacht (its own views: aerial, hub, hall…)

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import type { SlotKind, WorldLayout } from "@offsite/contracts";
import {
  CAPTAIN_PRESET, CREW_PRESETS, Captain, Collision, CrewFigure, Input, SELF_LAYER, Walker, actFor, buildAvatar, createPipeline, createRenderer, formatHour, type Quality,
} from "@offsite/kit";
import { buildYacht } from "@offsite/world-yacht";
import { buildMoonBase } from "@offsite/world-moon-base";

const params = new URLSearchParams(location.search);
const quality: Quality = params.get("quality") === "low" ? "low" : "high";
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
if (params.get("ui") === "0") document.body.classList.add("clean");

const canvas = $("c") as HTMLCanvasElement;
const renderer = createRenderer(canvas, { quality, pixelRatio: params.has("dpr") ? Number(params.get("dpr")) : undefined });
renderer.info.autoReset = false;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 5000);
const pipeline = createPipeline(renderer, scene, camera, { quality });
const labels = new CSS2DRenderer();
labels.domElement.style.cssText = "position:fixed;inset:0;pointer-events:none";
document.body.appendChild(labels.domElement);

// ---------- camera presets ----------
type View = { pos: [number, number, number]; at: [number, number, number]; fov?: number };
const VIEWS: Record<string, View> = {
  hero: { pos: [-92, 38, -118], at: [0, 9, -8] },
  bow3q: { pos: [-62, 44, -92], at: [4, 6, -2], fov: 45 },
  aerial: { pos: [-118, 112, 52], at: [0, 6, 2] },
  profile: { pos: [-190, 14, 0], at: [0, 11, 0], fov: 38 },
  bow: { pos: [-46, 24, -112], at: [0, 10, -48] },
  helipad: { pos: [12, 15.5, -71], at: [0, 11.5, -45] },
  office: { pos: [0.6, 11.9, -21.2], at: [0, 11.4, 6], fov: 62 },
  officeglass: { pos: [-17, 13.6, -9], at: [0, 11.8, -4] },
  bridge: { pos: [1.5, 19.65, -22.0], at: [0, 19.0, -30], fov: 62 },
  canopy: { pos: [13, 25, 24], at: [0, 19, -4] },
  sundeck: { pos: [-15, 23.5, 60], at: [0, 14.5, 33] },
  bar: { pos: [9, 17.6, 52], at: [-1, 15.2, 40] },
  promenade: { pos: [10.3, 7.3, 32], at: [10.1, 6.9, -8], fov: 60 },
  stern: { pos: [16, 7.5, 95], at: [0, 4.5, 60] },
  // Below decks.
  beachclub: { pos: [7.4, 2.7, 61.2], at: [3.5, 1.9, 50], fov: 70 },
  beachdoors: { pos: [6.5, 3.2, 74], at: [0, 2.6, 58], fov: 55 },
  garage: { pos: [-3.9, 2.9, 60.8], at: [-8.5, 1.6, 50.5], fov: 70 },
  mess: { pos: [8.6, 2.8, 18.6], at: [-2, 1.6, 6], fov: 70 },
  galley: { pos: [-1.6, 2.6, 17.5], at: [-7, 1.7, 8], fov: 70 },
  gym: { pos: [3.0, 2.8, 33.2], at: [9, 1.6, 23], fov: 70 },
  cinema: { pos: [-2.6, 3.2, 33.5], at: [-6.7, 2.3, 20.5], fov: 70 },
  spa: { pos: [2.6, 2.8, 45.4], at: [9.5, 1.6, 36.5], fov: 70 },
  engine: { pos: [-2.4, 3.4, 45.4], at: [-7.5, 1.6, 36.5], fov: 70 },
  server: { pos: [0, 2.6, 0.8], at: [0, 2.2, -15], fov: 65 },
  core: { pos: [5.2, 2.2, -10.6], at: [0, 2.6, -15], fov: 65 },
  serverstair: { pos: [10.7, 2.4, -2.5], at: [8.4, 2.4, -20], fov: 65 },
  // Night and sunset heroes.
  sunsetport: { pos: [-150, 26, 70], at: [0, 9, 0], fov: 40 },
  nightquarter: { pos: [-70, 22, 140], at: [0, 9, 20], fov: 45 },
  helideck: { pos: [-26, 22, -86], at: [0, 10.5, -50], fov: 50 },
  stringlights: { pos: [-6, 17.6, 50], at: [0, 15.8, 22], fov: 65 },
  sternon: { pos: [0, 14, 140], at: [0, 9, 40], fov: 40 },
  wake: { pos: [70, 70, 240], at: [0, 0, 90] },
};
// The moon base's views, after the concept art's cameras (docs/art/moon-base/refs).
const MOON_VIEWS: Record<string, View> = {
  aerial: { pos: [0, 50, 125], at: [0, 0, -110], fov: 42 },
  masterplan: { pos: [4, 96, 150], at: [0, 4, -28], fov: 50 },
  night: { pos: [0, 50, 125], at: [0, 0, -110], fov: 42 },
  hub: { pos: [2.5, 2.3, 14.5], at: [-3, 5, -20], fov: 62 },
  console: { pos: [0.4, 2.5, 3.6], at: [0, 2.2, -10], fov: 60 },
  hall: { pos: [-5.3, 4.2, -87.6], at: [-25.1, 4.6, -70.1], fov: 66 },
  hallfloor: { pos: [-14.9, 7.8, -70.2], at: [-17.4, 2.8, -81.9], fov: 70 },
  greenhouse: { pos: [-17.2, 19.7, -90.8], at: [-2.4, 19.4, -92.6], fov: 64 },
  garage: { pos: [36, 2.6, 30], at: [50, 2.4, 24], fov: 60 },
  pad: { pos: [8, 2.2, -14], at: [11.5, 6, -36], fov: 56 },
  rig: { pos: [-40, 7, 42], at: [-18, -2, 18], fov: 58 },
  sports: { pos: [45.3, 19.9, -78.7], at: [60.2, 20.3, -77.4], fov: 70 },
  lookout: { pos: [-90.6, 25.9, -58.7], at: [-80.0, 29.1, -75.7], fov: 66 },
  quarters: { pos: [-43.6, 7.8, -58.9], at: [-53.5, 6.4, -59.1], fov: 70 },
  crater: { pos: [-60, 40, 90], at: [0, 8, -10], fov: 50 },
};
const which = params.get("world") === "moon-base" ? "moon-base" : "yacht";
if (which === "moon-base") { for (const k of Object.keys(VIEWS)) delete VIEWS[k]; Object.assign(VIEWS, MOON_VIEWS); VIEWS.hero = MOON_VIEWS.aerial!; }
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.maxDistance = 1500;
function setView(name: string) {
  const v = VIEWS[name] ?? VIEWS.hero!;
  camera.position.set(...v.pos);
  controls.target.set(...v.at);
  camera.fov = v.fov ?? 50;
  camera.updateProjectionMatrix();
  controls.update();
  pipeline.cut();
}
const viewSel = $("view") as HTMLSelectElement;
for (const name of Object.keys(VIEWS)) viewSel.add(new Option(name, name));
viewSel.value = params.get("view") ?? "hero";
viewSel.onchange = () => setView(viewSel.value);
if (params.has("cam")) {
  // ?cam=x,y,z,tx,ty,tz[,fov]: any camera, for checking a spot.
  const [x, y, z, tx, ty, tz, fov] = params.get("cam")!.split(",").map(Number);
  VIEWS.custom = { pos: [x!, y!, z!], at: [tx!, ty!, tz!], fov: fov || 50 };
  viewSel.add(new Option("custom", "custom"));
  viewSel.value = "custom";
}
setView(viewSel.value);

// ---------- the world ----------
const t0 = performance.now();
const ctx = { renderer, scene, camera, quality, assets: "/" };
const busyOpt = params.has("busy") ? { busy: Number(params.get("busy")) } : {};
const world = which === "moon-base" ? await buildMoonBase(ctx, busyOpt) : await buildYacht(ctx, busyOpt);
scene.add(world.root);
const buildMs = performance.now() - t0;
(window as unknown as Record<string, unknown>).__world = { world, scene, camera, renderer, pipeline, THREE };

// ---------- walking: the captain, at eye height, with the kit's own controls and collision ----------
const walking = params.has("walk");
let captain: Captain | null = null;
const navAt = new Map(world.layout.nav.nodes.map((n) => [n.id, n.pos]));
const spot = (id: string): [number, number, number] | null =>
  navAt.get(id) ?? world.layout.slots.find((s) => s.id === id)?.pos ?? null;
if (walking) {
  controls.enabled = false;
  const collision = new Collision().add(...world.colliders).build();
  const input = new Input({ element: canvas });
  const start = spot(params.get("at") ?? "") ?? world.layout.slots.find((s) => s.kind === "captain-spawn")!.pos;
  captain = new Captain({
    camera, collision, input,
    avatar: buildAvatar(CAPTAIN_PRESET.spec, CAPTAIN_PRESET.look),
    spawn: { pos: start, facing: ((Number(params.get("yaw") ?? 180)) * Math.PI) / 180 },
    view: params.get("view") === "first" ? "first" : "third",
    ...(world.captain ? { move: world.captain } : {}),
  });
  if (params.has("pitch")) captain.cameraRig.pitch = Number(params.get("pitch"));
  world.daylight.sun.shadow.camera.layers.enable(SELF_LAYER);
  camera.fov = 70;
  camera.updateProjectionMatrix();
  scene.add(captain.object);
  captain.setInteractables(world.interactables);
}

// ---------- crew at their slots, for scale ----------
const _tagAt = new THREE.Vector3();
function tagNear(fig: CrewFigure) {
  const plate = (fig as unknown as { plate?: { sprite: THREE.Object3D } }).plate;
  if (plate) plate.sprite.visible = fig.object.getWorldPosition(_tagAt).distanceTo(camera.position) < 9;
}
const crewFigs: { fig: CrewFigure; walker: Walker }[] = [];
if (params.has("crew")) {
  const want = params.get("crew") || "all";
  const slots = world.layout.slots.filter((s) => want === "all" || s.kind === want || s.tags?.includes(want));
  slots.forEach((slot, i) => {
    const p = CREW_PRESETS[i % CREW_PRESETS.length]!;
    const fig = new CrewFigure({ spec: p.spec, look: p.look, name: p.name, line: slot.kind, seed: i * 7 + 3 });
    fig.water = 0;
    scene.add(fig.object);
    const walker = new Walker(fig.object);
    walker.place(slot);
    const working = i % 3 !== 2;
    fig.setAct(actFor(working ? "editing" : "idle", slot.kind));
    // Name tags only within a few metres here: the viewer doesn't hide them behind walls as the game does.
    crewFigs.push({ fig, walker });
  });
}

const hour = $("hour") as HTMLInputElement, hourText = $("hourText"), clock = $("clock") as HTMLInputElement;
const startHour = params.has("t") ? Number(params.get("t")) : params.has("hour") ? Number(params.get("hour")) : which === "moon-base" ? (viewSel.value === "night" ? 21.5 : 10.2) : 18.4;
if (params.has("busy")) world.setBusy(Number(params.get("busy")));
if (params.has("swell") && "setSwell" in world) world.setSwell(Number(params.get("swell")));
hour.value = String(startHour);
clock.checked = params.get("clock") === "1";
const applyHour = () => world.setHour(clock.checked ? null : Number(hour.value));
hour.oninput = () => { clock.checked = false; applyHour(); };
clock.onchange = applyHour;
applyHour();

const arrivals: number[] = [];
$("fly").onclick = () => {
  arrivals.push(Date.now() + 14_000);
  world.setArrivals(arrivals);
};
if (params.has("fly")) {
  // ?fly=<seconds into the flight>: a helicopter that set out that long ago (approach is 14 s).
  arrivals.push(Date.now() + 14_000 - Number(params.get("fly") || 0) * 1000);
  world.setArrivals(arrivals);
}

// ---------- slots, walking graph, colliders ----------
const KIND_COLOR: Record<SlotKind, string> = {
  desk: "#4fd1ff", lounger: "#ffd166", hammock: "#f4a261", "deck-chair": "#e9c46a", "bar-stool": "#e76f51",
  pool: "#2ec4b6", "hot-tub": "#00b4d8", rail: "#c0c0c0", fishing: "#90be6d", helm: "#ff4d6d", computer: "#c77dff",
  dropoff: "#ff9f1c", helipad: "#ffffff", "crew-spawn": "#80ffdb", "captain-spawn": "#ff006e",
  gym: "#06d6a0", cinema: "#8338ec", sauna: "#fb8500", workshop: "#adb5bd", core: "#00f5ff",
};
function slotMarkers(layout: WorldLayout): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.SphereGeometry(0.16, 12, 8);
  for (const s of layout.slots) {
    const mat = new THREE.MeshBasicMaterial({ color: KIND_COLOR[s.kind], depthTest: false, transparent: true, opacity: 0.9 });
    const y = s.pos[1] + (s.seat ?? 0) + 0.05;
    const m = new THREE.Mesh(geo, mat);
    m.position.set(s.pos[0], y, s.pos[2]);
    m.renderOrder = 10;
    g.add(m);
    const dir = new THREE.Vector3(Math.sin(s.facing), 0, Math.cos(s.facing));
    const arrow = new THREE.ArrowHelper(dir, m.position, 0.7, KIND_COLOR[s.kind], 0.2, 0.12);
    arrow.traverse((o) => { const mm = (o as THREE.Mesh).material as THREE.Material | undefined; if (mm) { mm.depthTest = false; mm.transparent = true; } o.renderOrder = 10; });
    g.add(arrow);
    const el = document.createElement("div");
    el.className = "slot-label";
    el.textContent = s.id;
    el.style.borderLeft = `3px solid ${KIND_COLOR[s.kind]}`;
    const label = new CSS2DObject(el);
    label.position.set(s.pos[0], y + 0.35, s.pos[2]);
    g.add(label);
  }
  return g;
}
function navLines(layout: WorldLayout): THREE.Group {
  const g = new THREE.Group();
  const at = new Map(layout.nav.nodes.map((n) => [n.id, n.pos]));
  const pos: number[] = [];
  for (const [a, b] of layout.nav.edges) {
    const p = at.get(a)!, q = at.get(b)!;
    pos.push(p[0], p[1] + 0.12, p[2], q[0], q[1] + 0.12, q[2]);
  }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: "#ff3df5", depthTest: false, transparent: true }));
  lines.renderOrder = 11;
  g.add(lines);
  const pg = new THREE.BufferGeometry();
  pg.setAttribute("position", new THREE.Float32BufferAttribute(layout.nav.nodes.flatMap((n) => [n.pos[0], n.pos[1] + 0.12, n.pos[2]]), 3));
  const pts = new THREE.Points(pg, new THREE.PointsMaterial({ color: "#ffffff", size: 5, sizeAttenuation: false, depthTest: false, transparent: true }));
  pts.renderOrder = 12;
  g.add(pts);
  return g;
}
const slotGroup = slotMarkers(world.layout), navGroup = navLines(world.layout);
const colGroup = new THREE.Group();
for (const c of world.colliders) {
  const m = (c as THREE.Mesh).clone();
  m.material = new THREE.MeshBasicMaterial({ color: "#ff5533", wireframe: true, transparent: true, opacity: 0.35, depthTest: false });
  colGroup.add(m);
}
const toggles: [string, THREE.Object3D][] = [["slots", slotGroup], ["nav", navGroup], ["cols", colGroup]];
for (const [id, group] of toggles) {
  const box = $(id) as HTMLInputElement;
  box.checked = params.get(id) === "1";
  group.visible = box.checked;
  scene.add(group);
  box.onchange = () => {
    group.visible = box.checked;
    if (id === "slots") labels.domElement.style.display = box.checked ? "" : "none";
  };
}
labels.domElement.style.display = slotGroup.visible ? "" : "none";

// ---------- checks: the graph is connected, and every edge is walkable in a straight line ----------
function check(layout: WorldLayout): string {
  const lines: string[] = [];
  const at = new Map(layout.nav.nodes.map((n) => [n.id, n.pos]));
  const adj = new Map<string, string[]>(layout.nav.nodes.map((n) => [n.id, []]));
  for (const [a, b] of layout.nav.edges) { adj.get(a)!.push(b); adj.get(b)!.push(a); }
  const start = layout.slots.find((s) => s.kind === "captain-spawn")?.nav ?? layout.nav.nodes[0]!.id;
  const seen = new Set([start]), queue = [start];
  while (queue.length) for (const n of adj.get(queue.shift()!)!) if (!seen.has(n)) { seen.add(n); queue.push(n); }
  const lost = layout.nav.nodes.filter((n) => !seen.has(n.id)).map((n) => n.id);
  if (lost.length) lines.push(`unreachable nodes: ${lost.join(", ")}`);
  const badSlots = layout.slots.filter((s) => !at.has(s.nav) || !seen.has(s.nav)).map((s) => s.id);
  if (badSlots.length) lines.push(`slots off the graph: ${badSlots.join(", ")}`);
  const far = layout.slots.filter((s) => { const p = at.get(s.nav); return p && Math.hypot(p[0] - s.pos[0], p[2] - s.pos[2]) > 4.5; }).map((s) => s.id);
  if (far.length) lines.push(`slots far from their node: ${far.join(", ")}`);
  // Walk each edge in short steps, following the floor (decks, stair ramps): every step needs a
  // floor under it, no step up taller than 0.45 m, and nothing in the way at knee or head height.
  // Against the colliders' BVH (the kit's Collision): a big world's colliders are too many
  // triangles to raycast one by one.
  const col = new Collision().add(...world.colliders).build();
  const blocked: string[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3();
  const floorAt = (x: number, y: number, z: number) => col.floorBelow(x, y + 1.0, z, 2.4);
  const clear = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => {
    for (const h of [0.5, 1.6]) {
      a.set(x0, y0 + h, z0);
      b.set(x1, y1 + h, z1);
      const len = d.subVectors(b, a).length();
      if (len < 1e-4) continue;
      if (col.raycast(a, d.normalize(), len)) return false;
    }
    return true;
  };
  for (const [p, q] of layout.nav.edges) {
    const P = at.get(p)!, Q = at.get(q)!;
    const n = Math.max(1, Math.ceil(Math.hypot(Q[0] - P[0], Q[2] - P[2]) / 0.4));
    let prev: [number, number, number] | null = null, why = "";
    for (let i = 0; i <= n && !why; i++) {
      const s = i / n, x = P[0] + (Q[0] - P[0]) * s, z = P[2] + (Q[2] - P[2]) * s, y = P[1] + (Q[1] - P[1]) * s;
      const f = floorAt(x, y, z);
      if (f === null) why = `no floor at ${x.toFixed(1)},${z.toFixed(1)}`;
      else if (prev && f - prev[1] > 0.45) why = `step of ${(f - prev[1]).toFixed(2)} m at ${x.toFixed(1)},${z.toFixed(1)}`;
      else if (prev && !clear(prev[0], prev[1], prev[2], x, f, z)) why = `wall at ${x.toFixed(1)},${z.toFixed(1)}`;
      if (f !== null) prev = [x, f, z];
    }
    if (why) blocked.push(`${p} — ${q}: ${why}`);
  }
  if (blocked.length) lines.push(`blocked edges (${blocked.length}):\n  ${blocked.join("\n  ")}`);
  const counts: Record<string, number> = {};
  for (const s of layout.slots) counts[s.kind] = (counts[s.kind] ?? 0) + 1;
  console.info(`[world] slots by kind ${JSON.stringify(counts)}; ${layout.slots.length} slots, ${layout.nav.nodes.length} nodes, ${layout.nav.edges.length} edges`);
  if (lines.length) console.warn(`[world] checks:\n${lines.join("\n")}`);
  return lines.length ? lines.join("\n") : `graph ok: ${layout.nav.nodes.length} nodes, ${layout.nav.edges.length} edges, ${layout.slots.length} slots`;
}
setTimeout(() => { $("check").textContent = check(world.layout); }, 50);

// ---------- the loop ----------
function resize() {
  pipeline.setSize(innerWidth, innerHeight);
  labels.setSize(innerWidth, innerHeight);
}
addEventListener("resize", resize);
resize();

const stats = $("stats");
let frames = 0, acc = 0, cpu = 0, fps = 0, last = performance.now();
const counts = { calls: 0, tris: 0 };
// ?heli=<seconds>: a helicopter that many seconds into its flight (approach 14 s, then 7 s on the
// pad, 9 s away), held there: the world's clock stands still for the shot.
let fixedNow = params.has("now") ? Number(params.get("now")) : null;
if (params.has("heli")) {
  const T0 = 1_700_000_000_000;
  world.setArrivals([T0 + 14_000]);
  fixedNow = T0 + Number(params.get("heli")) * 1000;
}
function frame() {
  const t = performance.now(), dt = Math.min(0.1, (t - last) / 1000);
  last = t;
  if (captain) captain.update(dt, t / 1000);
  else controls.update();
  renderer.info.reset();
  const c0 = performance.now();
  world.update(dt, fixedNow ?? Date.now());
  for (const c of crewFigs) {
    c.fig.update(dt, t / 1000, { speed: 0, seat: c.walker.seat, camera });
    tagNear(c.fig);
  }
  pipeline.render(dt);
  if (slotGroup.visible) labels.render(scene, camera);
  cpu += performance.now() - c0;
  counts.calls = renderer.info.render.calls;
  counts.tris = renderer.info.render.triangles;
  frames++;
  acc += dt;
  if (acc >= 0.5) {
    fps = frames / acc;
    stats.textContent = `${fps.toFixed(0)} fps  ${(cpu / frames).toFixed(1)} ms cpu\n${counts.calls} draws  ${(counts.tris / 1e6).toFixed(2)} M tris\nbuilt in ${buildMs.toFixed(0)} ms  ${quality}`;
    (window as unknown as Record<string, unknown>).__stats = { fps, cpuMs: cpu / frames, calls: counts.calls, tris: counts.tris, buildMs };
    frames = 0; acc = 0; cpu = 0;
  }
  hourText.textContent = formatHour(world.sky.state.hour);
  if (clock.checked) hour.value = String(world.sky.state.hour);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ?bench=1: after things settle, draw 240 frames back to back and wait for the GPU to finish
// them, for a frame time that isn't capped by the display (window.__bench, in ms).
if (params.has("bench")) {
  setTimeout(() => {
    const gl = renderer.getContext(), px = new Uint8Array(4);
    const N = 240;
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const t0 = performance.now();
    for (let i = 0; i < N; i++) {
      world.update(1 / 60, fixedNow ?? Date.now());
      pipeline.render(1 / 60);
    }
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const ms = (performance.now() - t0) / N;
    (window as unknown as Record<string, unknown>).__bench = ms;
    console.info(`[bench] ${ms.toFixed(2)} ms a frame at ${renderer.domElement.width}x${renderer.domElement.height} (${quality})`);
  }, 4000);
}

// The tour (walk mode): contact sheets of what the captain sees standing at a spot, for checking
// every deck at eye height without a person at the keys. From a script:
//   await __walk.sheet("d1-s6", [0, 90, 180, 270], "first")  -> a 2×2 sheet as a data URL
if (walking && captain) {
  const cap = captain;
  const settle = (n: number) => {
    for (let i = 0; i < n; i++) {
      cap.update(1 / 60, performance.now() / 1000);
      world.update(1 / 60, fixedNow ?? Date.now());
      for (const c of crewFigs) { c.fig.update(1 / 60, performance.now() / 1000, { speed: 0, seat: c.walker.seat, camera }); tagNear(c.fig); }
    }
  };
  (window as unknown as Record<string, unknown>).__walk = {
    captain: cap,
    /** Walks from one nav node to another along the graph's edge, as the captain: where they end up. */
    stroll(from: string, to: string, seconds = 20) {
      const a = spot(from), b = spot(to);
      if (!a || !b) return null;
      cap.teleport(a, Math.atan2(b[0] - a[0], b[2] - a[2]));
      const c = cap.controller;
      for (let i = 0; i < seconds * 60; i++) {
        const p = c.position, dx = b[0] - p.x, dz = b[2] - p.z;
        if (Math.hypot(dx, dz) < 0.3) break;
        c.update(1 / 60, { x: 0, z: 1, sprint: false, jump: false }, Math.atan2(dx, dz), false);
      }
      const p = c.position;
      return { at: [p.x, p.y, p.z].map((v) => +v.toFixed(2)), want: b, off: +Math.hypot(b[0] - p.x, b[1] - p.y, b[2] - p.z).toFixed(2) };
    },
    go(id: string, yawDeg: number, view: "first" | "third" = "first", pitch = 0.05) {
      const p = spot(id);
      if (!p) return false;
      const yaw = (yawDeg * Math.PI) / 180;
      cap.view = view;
      cap.teleport(p, yaw);
      cap.cameraRig.yaw = yaw;
      cap.cameraRig.pitch = pitch;
      settle(40);
      pipeline.cut();
      return true;
    },
    sheet(id: string, yaws: number[], view: "first" | "third" = "first", pitch = 0.05): string | null {
      const p = spot(id);
      if (!p) return null;
      const w = renderer.domElement.width, h = renderer.domElement.height;
      const out = document.createElement("canvas");
      out.width = w; out.height = h;
      const g = out.getContext("2d")!;
      yaws.slice(0, 4).forEach((yd, i) => {
        const yaw = (yd * Math.PI) / 180;
        cap.view = view;
        cap.teleport(p, yaw);
        cap.cameraRig.yaw = yaw;
        cap.cameraRig.pitch = pitch;
        settle(45);
        pipeline.cut();
        pipeline.render(1 / 60);
        pipeline.render(1 / 60);
        g.drawImage(renderer.domElement, (i % 2) * (w / 2), Math.floor(i / 2) * (h / 2), w / 2, h / 2);
        g.fillStyle = "rgba(0,0,0,0.55)";
        g.fillRect((i % 2) * (w / 2), Math.floor(i / 2) * (h / 2), 210, 22);
        g.fillStyle = "#fff";
        g.font = "14px monospace";
        g.fillText(`${id} ${yd}° ${view}`, (i % 2) * (w / 2) + 6, Math.floor(i / 2) * (h / 2) + 16);
      });
      return out.toDataURL("image/png");
    },
  };
}
