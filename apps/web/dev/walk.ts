// A test deck for walking: the captain in first and third person with collision, stairs to an
// upper deck, desks, loungers and a hammock as slots on a small nav graph, three crew walking
// between them, one who comes over with a question, and the helm to use with E. A dev page; it
// brings its own renderer, lights and deck.
//
//   /dev/walk.html?view=first        start in first person
//   &phone=1                         phone out
//   &at=x,z&yaw=deg&pitch=rad        where the captain starts and looks
//   &ask=1                           the crew member with a question comes straight over

import * as THREE from "three";
import { ACTIVITY_LABEL, type NavGraph, type Slot, type SlotKind } from "@offsite/contracts";
import type { Interactable } from "../../../packages/kit/src/world.ts";
import {
  CAPTAIN_PRESET, CREW_PRESETS, CrewFigure, FIT, actFor, buildAvatar, furniture, type ActId,
} from "../../../packages/kit/src/avatar/index.ts";
import { Walker } from "../../../packages/kit/src/nav/index.ts";
import { Captain, Collision, Input, SELF_LAYER, pick } from "../../../packages/kit/src/captain/index.ts";

const params = new URLSearchParams(location.search);
const canvas = document.getElementById("c") as HTMLCanvasElement;
const $ = (id: string) => document.getElementById(id)!;

// ---------- renderer, sky, sun ----------

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color("#a9d4ee");
scene.fog = new THREE.Fog("#cfe6f3", 45, 160);
const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 400);
scene.add(camera);
scene.add(new THREE.HemisphereLight("#d7ecff", "#b98c60", 1.2));
const sun = new THREE.DirectionalLight("#fff0da", 2.6);
sun.position.set(14, 22, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20, far: 70 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
sun.shadow.camera.layers.enable(SELF_LAYER); // the captain keeps a shadow in first person
scene.add(sun, sun.target);
const sea = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ color: "#2c7fb3", roughness: 0.25, metalness: 0.1 }));
sea.rotation.x = -Math.PI / 2;
sea.position.y = -3;
scene.add(sea);

// ---------- the deck ----------

const deck = new THREE.Group();
scene.add(deck);
const teak = new THREE.MeshStandardMaterial({ map: planks(), roughness: 0.75 });
const white = new THREE.MeshStandardMaterial({ color: "#f3f4f1", roughness: 0.5 });
const chrome = new THREE.MeshStandardMaterial({ color: "#d6dbe2", roughness: 0.22, metalness: 0.9 });
const glass = new THREE.MeshStandardMaterial({ color: "#bfe6f2", roughness: 0.05, transparent: true, opacity: 0.2, depthWrite: false });

function block(mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, parent: THREE.Object3D = deck) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  parent.add(m);
  return m;
}
function planks() {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 512;
  const ctx = c.getContext("2d")!;
  for (let i = 0; i < 16; i++) {
    ctx.fillStyle = `hsl(28, 46%, ${52 + ((i * 37) % 9)}%)`;
    ctx.fillRect(0, i * 32, 512, 32);
    ctx.fillStyle = "rgba(40, 24, 10, 0.55)";
    ctx.fillRect(0, i * 32, 512, 2);
    ctx.fillRect((i * 173) % 512, i * 32, 2, 32);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(6, 6);
  t.anisotropy = 8;
  return t;
}
// A rail run from a to b (on the floor at height y): posts, a top rail, glass. Solid for walking.
function railRun(ax: number, az: number, bx: number, bz: number, y = 0) {
  const len = Math.hypot(bx - ax, bz - az), g = new THREE.Group();
  g.position.set((ax + bx) / 2, y, (az + bz) / 2);
  g.rotation.y = Math.atan2(bx - ax, bz - az) - Math.PI / 2;
  deck.add(g);
  block(chrome, len, 0.05, 0.05, 0, FIT.rail.height, 0, g);
  block(glass, len, FIT.rail.height - 0.1, 0.02, 0, (FIT.rail.height - 0.1) / 2, 0, g).castShadow = false;
  for (let i = 0; i <= Math.ceil(len / 1.5); i++) block(chrome, 0.05, FIT.rail.height, 0.05, -len / 2 + Math.min(len, i * 1.5), FIT.rail.height / 2, 0, g);
}

// Main deck: 24 × 30, its top at y = 0.
block(teak, 24, 0.4, 30, 0, -0.2, 0);
block(white, 24.4, 2.6, 30.4, 0, -1.7, 0).receiveShadow = false;
// Upper deck at the stern: 1.8 high, z from -15 to -5.2.
const UP = 1.8;
block(white, 24, UP - 0.1, 9.8, 0, (UP - 0.1) / 2, -10.1);
block(teak, 24, 0.1, 9.8, 0, UP - 0.05, -10.1);
// Stairs up its front, on the starboard side: 10 steps of 0.18.
for (let i = 0; i < 10; i++) block(teak, 2.4, 0.18 * (i + 1), 0.42, 9, (0.18 * (i + 1)) / 2, -1.2 - i * 0.42);
// Rails: round the main deck, along the upper deck's edge (open at the stairs), up the stairs.
railRun(-12, 15, 12, 15); railRun(-12, -5.2, -12, 15); railRun(12, -5.2, 12, 15);
railRun(-12, -15, 12, -15, UP); railRun(-12, -15, -12, -5.2, UP); railRun(12, -15, 12, -5.2, UP);
railRun(-12, -5.2, 7.8, -5.2, UP); railRun(10.2, -5.2, 12, -5.2, UP);
railRun(7.75, -1.0, 7.75, -5.2, 0);
// The helm console: the thing to use with E.
const helm = block(new THREE.MeshStandardMaterial({ color: "#22262e", roughness: 0.4, metalness: 0.4 }), 1.4, 1.0, 0.6, 5, 0.5, -3);
const helmScreen = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.5), new THREE.MeshBasicMaterial({ color: "#3ad0ff", toneMapped: false }));
helmScreen.position.set(5, 1.05, -2.72);
helmScreen.rotation.x = -0.5;
deck.add(helmScreen);
void helm;

// Furniture at the slots (FIT's reference pieces).
function put(obj: THREE.Object3D, s: Slot) { obj.position.set(...s.pos); obj.rotation.y = s.facing; deck.add(obj); }

const SLOTS: Slot[] = [
  { id: "desk-1", kind: "desk", pos: [-8, 0, 5], facing: 0, seat: FIT.desk.seat, nav: "office" },
  { id: "desk-2", kind: "desk", pos: [-5.5, 0, 5], facing: 0, seat: FIT.desk.seat, nav: "office" },
  { id: "desk-3", kind: "desk", pos: [-3, 0, 5], facing: 0, seat: FIT.desk.seat, nav: "office" },
  { id: "chair-1", kind: "deck-chair", pos: [2.5, 0, 4], facing: -Math.PI / 2, seat: FIT.deckChair.seat, nav: "mid" },
  { id: "hammock-1", kind: "hammock", pos: [-10.6, 0, -1.5], facing: Math.PI, seat: FIT.hammock.seat, nav: "port" },
  { id: "rail-1", kind: "rail", pos: [3, 0, 14.5], facing: 0, nav: "bow" },
  { id: "fish-1", kind: "fishing", pos: [8, 0, 14.3], facing: 0, nav: "bow-s" },
  { id: "lounger-1", kind: "lounger", pos: [-7, UP, -11], facing: 0, seat: FIT.lounger.seat, nav: "up-port" },
  { id: "lounger-2", kind: "lounger", pos: [-4, UP, -11], facing: 0, seat: FIT.lounger.seat, nav: "up-port" },
  { id: "lounger-3", kind: "lounger", pos: [2, UP, -11], facing: 0, seat: FIT.lounger.seat, nav: "up-mid" },
  { id: "drop", kind: "dropoff", pos: [6.6, 0, -2.4], facing: Math.PI / 2, nav: "helm" },
];
for (const s of SLOTS) {
  if (s.kind === "desk") put(furniture.desk(), s);
  if (s.kind === "deck-chair") put(furniture.deckChair(), s);
  if (s.kind === "hammock") put(furniture.hammock(), s);
  if (s.kind === "lounger") { put(furniture.lounger(), s); const u = furniture.umbrella(); u.position.set(s.pos[0] + 1.2, UP, s.pos[2] - 0.5); deck.add(u); }
}

const NAV: NavGraph = {
  nodes: [
    { id: "spawn", pos: [0, 0, 10] }, { id: "bow", pos: [3, 0, 12.5] }, { id: "bow-s", pos: [8, 0, 12.5] },
    { id: "office", pos: [-5.5, 0, 2.6] }, { id: "mid", pos: [0, 0, 3] }, { id: "port", pos: [-9, 0, -1.5] },
    { id: "helm", pos: [6.5, 0, -0.8] }, { id: "stairs-low", pos: [9, 0, -0.4] }, { id: "stairs-high", pos: [9, UP, -5.9] },
    { id: "up-mid", pos: [2, UP, -7.5] }, { id: "up-port", pos: [-5.5, UP, -7.5] },
  ],
  edges: [
    ["spawn", "bow"], ["bow", "bow-s"], ["spawn", "mid"], ["mid", "office"], ["office", "port"], ["mid", "port"], ["mid", "helm"],
    ["helm", "stairs-low"], ["stairs-low", "stairs-high"], ["stairs-high", "up-mid"], ["up-mid", "up-port"], ["bow-s", "helm"], ["spawn", "office"],
  ],
};

// Nav graph, drawn faintly.
{
  const pts: number[] = [];
  const at = new Map(NAV.nodes.map((n) => [n.id, n.pos]));
  for (const [a, b] of NAV.edges) pts.push(...at.get(a)!, ...at.get(b)!);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pts.map((v, i) => (i % 3 === 1 ? v + 0.03 : v)), 3));
  scene.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: "#4fe3ff", transparent: true, opacity: params.has("nav") ? 0.9 : 0.25 })));
}

const collision = new Collision().add(deck).build();

// ---------- the captain ----------

const helmPanel = $("helm");
const helmOpen = () => helmPanel.style.display === "flex";
const input = new Input({ element: canvas, suspended: helmOpen });
const at = (params.get("at") ?? "0,10").split(",").map(Number);
const captain = new Captain({
  camera, collision, input,
  avatar: buildAvatar(CAPTAIN_PRESET.spec, CAPTAIN_PRESET.look),
  spawn: { pos: [at[0] ?? 0, 0, at[1] ?? 10], facing: params.has("yaw") ? (Number(params.get("yaw")) * Math.PI) / 180 : Math.PI },
  view: params.get("view") === "first" ? "first" : "third",
});
if (params.has("pitch")) captain.cameraRig.pitch = Number(params.get("pitch"));
scene.add(captain.object);
const interactables: Interactable[] = [{ id: "helm", label: "Use the helm", at: new THREE.Vector3(5, 1.1, -2.7), radius: 2.4 }];
captain.setInteractables(interactables);
captain.onPrompt = (it) => {
  $("prompt").style.display = it ? "block" : "none";
  $("prompt").querySelector("span")!.textContent = it?.label ?? "";
};
captain.onUse = (it) => {
  if (it.id !== "helm") return;
  helmPanel.style.display = "flex";
  (helmPanel.querySelector("input") as HTMLInputElement).focus();
};
if (params.get("phone")) captain.setPhoneOut(true);
addEventListener("keydown", (e) => {
  // The interface's keys, stood in for here: F for the phone, Escape closes the helm.
  if (e.code === "Escape" && helmOpen()) { helmPanel.style.display = "none"; (document.activeElement as HTMLElement | null)?.blur(); }
  if (e.code === "KeyF" && !helmOpen()) captain.setPhoneOut(!captain.phoneOut);
});

// ---------- the crew ----------

interface Mate { fig: CrewFigure; walker: Walker; slot: Slot | null; until: number; asking: boolean; name: string; line: string }
const taken = new Set<string>();
const crew: Mate[] = [];
const people = [CREW_PRESETS[0]!, CREW_PRESETS[1]!, CREW_PRESETS[2]!, CREW_PRESETS[3]!];
people.forEach((p, i) => {
  const fig = new CrewFigure({ spec: p.spec, look: p.look, name: p.name, line: "Off duty", seed: i * 13 + 5 });
  fig.water = sea.position.y;
  scene.add(fig.object);
  const walker = new Walker(fig.object, { floor: (x, y, z) => collision.floorBelow(x, y, z, 1.2) });
  const start = NAV.nodes.find((n) => n.id === ["office", "helm", "up-mid", "bow-s"][i])!;
  fig.object.position.set(...start.pos);
  crew.push({ fig, walker, slot: null, until: 0, asking: false, name: p.name, line: "Off duty" });
});
const asker = crew[3]!;

function label(m: Mate, line: string, tone: "accent" | "warn" | "ok" = "accent") { m.line = line; m.fig.setLabel(m.name, line, tone); }

// Off to somewhere free; what they do there depends on the spot.
function wander(m: Mate, now: number) {
  if (m.slot) taken.delete(m.slot.id);
  const free = SLOTS.filter((s) => !taken.has(s.id) && s.kind !== "dropoff");
  const s = free[Math.floor(Math.random() * free.length)]!;
  taken.add(s.id);
  m.slot = s;
  m.fig.setAct(null);
  const working = Math.random() < 0.6;
  label(m, "Walking");
  m.walker.goTo(NAV, s, () => {
    const act: ActId | null = actFor(working ? "editing" : "idle", s.kind as SlotKind);
    m.fig.setAct(act);
    label(m, working ? ACTIVITY_LABEL.editing : ACTIVITY_LABEL.idle);
    m.until = performance.now() / 1000 + 8 + Math.random() * 8;
  });
  m.until = now + 1e9;
}

// The one with a question walks over to the captain, "!" overhead, and asks.
function ask(m: Mate) {
  if (m.slot) taken.delete(m.slot.id);
  m.slot = null;
  m.asking = true;
  m.fig.setAct(null);
  m.fig.setAsking(true);
  label(m, ACTIVITY_LABEL.asking, "warn");
  m.walker.follow(captain.object, {
    graph: NAV, distance: 1.5, onReach: () => {
      m.fig.setAct("talk");
      m.fig.say("Can I run the migration on staging?");
    },
  });
  m.until = performance.now() / 1000 + 22;
}

// ---------- clicking crew ----------

captain.onClick = (ndc) => {
  const hit = pick(ndc, camera, crew.map((c) => c.fig.object));
  const m = crew.find((c) => c.fig.object === hit);
  $("status").dataset["clicked"] = m ? m.name : "";
  if (m) m.fig.say(`Hi, Captain. I'm ${m.line.toLowerCase()}.`);
};

// ---------- loop ----------

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);
resize();

const timer = new THREE.Timer();
let askAt = params.get("ask") ? 1 : 14;
function frame(now?: number) {
  requestAnimationFrame(frame);
  timer.update(now);
  const dt = Math.min(0.05, timer.getDelta());
  const t = timer.getElapsed();
  captain.update(dt, t);
  for (const m of crew) {
    if (m === asker && !m.asking && t > askAt) ask(m);
    if (t > m.until || (!m.slot && !m.asking && m.walker.state === "idle")) {
      if (m.asking) { m.asking = false; m.fig.setAsking(false); m.fig.lookAt(null); askAt = t + 30; }
      wander(m, t);
    }
    m.walker.update(dt);
    if (m.asking) m.fig.lookAt(captain.object.position.clone().setY(captain.object.position.y + 1.5));
    m.fig.update(dt, t, { speed: m.walker.speed, seat: m.walker.seat, camera });
  }
  $("cross").style.display = captain.view === "first" ? "block" : "none";
  const clicked = $("status").dataset["clicked"];
  $("status").textContent = `${captain.view} person${input.locked ? " · mouse locked (Esc frees it)" : captain.view === "first" ? " · click to look" : " · drag to look"}${captain.phoneOut ? " · phone out" : ""}${clicked ? ` · clicked ${clicked}` : ""}`;
  renderer.render(scene, camera);
}
frame();

Object.assign(window, { dev: { captain, crew, collision, camera, scene, NAV, SLOTS } });
