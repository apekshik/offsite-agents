// The cast: every preset doing every act, with props, nameplates and bubbles, and
// Computah, the main orchestrator, cycling its moods. A dev page; it brings its own renderer, lights and deck.
//
//   /dev/cast.html                 everything
//   /dev/cast.html?act=hammock     one act, close up (&preset=otis to pick who)
//   /dev/cast.html?lineup=1        every preset standing in a row
//   /dev/cast.html?bot=think       Computah, close up, in one mood
//   &camera=close|wide|side|x,y,z  where the camera starts
//   &gesture=laugh                 everyone plays a gesture over their act, again and again

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { ACTIVITY_LABEL } from "@offsite/contracts";
import {
  ACTS, BOT_MOODS, CAPTAIN_PRESET, CREW_PRESETS, ComputerBot, CrewFigure, FIT, furniture, isAct, isGesture, makeTextSprite, randomCrewAvatar,
  type ActId, type AvatarPreset, type BotMood, type Tone,
} from "../../../packages/kit/src/avatar/index.ts";

const params = new URLSearchParams(location.search);
const canvas = document.getElementById("c") as HTMLCanvasElement;
const hud = document.getElementById("hud")!;

// ---------- a plain stage ----------

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.background = skyTexture();
scene.fog = new THREE.Fog("#cfe6f3", 40, 120);
const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 300);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight("#d7ecff", "#b98c60", 1.25));
const sun = new THREE.DirectionalLight("#fff0da", 2.7);
sun.position.set(10, 16, 12);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.camera.left = -24; sun.shadow.camera.right = 24; sun.shadow.camera.top = 24; sun.shadow.camera.bottom = -24;
sun.shadow.camera.far = 60;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);

const deck = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ map: plankTexture(), roughness: 0.75 }));
deck.rotation.x = -Math.PI / 2;
deck.receiveShadow = true;
scene.add(deck);

function skyTexture() {
  const c = document.createElement("canvas");
  c.width = 4; c.height = 256;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, "#5fa8dc"); g.addColorStop(0.6, "#bfe0f2"); g.addColorStop(1, "#f6e7cf");
  ctx.fillStyle = g; ctx.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function plankTexture() {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 512;
  const ctx = c.getContext("2d")!;
  for (let i = 0; i < 16; i++) {
    const l = 52 + ((i * 37) % 9);
    ctx.fillStyle = `hsl(28, 46%, ${l}%)`;
    ctx.fillRect(0, i * 32, 512, 32);
    ctx.fillStyle = "rgba(40, 24, 10, 0.55)";
    ctx.fillRect(0, i * 32, 512, 2);
    ctx.fillRect(((i * 173) % 512), i * 32, 2, 32);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(20, 20);
  t.anisotropy = 8;
  return t;
}

// ---------- the cast ----------

const byId = (id: string) => [CAPTAIN_PRESET, ...CREW_PRESETS].find((p) => p.id === id) ?? CREW_PRESETS[0]!;

interface Station {
  act: ActId;
  who: string;
  line: keyof typeof ACTIVITY_LABEL | string;
  tone?: Tone;
  say?: string;
  set?: (g: THREE.Group) => number | null; // builds the furniture, returns the seat height (or null)
  walk?: boolean;
  backpack?: boolean;
  zzz?: boolean;
  view?: "side" | "front" | "high";
}

const STATIONS: Station[] = [
  { act: "type", who: "wren", line: "editing", say: "Splitting the settings page", set: (g) => (g.add(furniture.desk()), FIT.desk.seat) },
  { act: "laptop", who: "otis", line: "reading", set: (g) => (g.add(furniture.deckChair()), FIT.deckChair.seat) },
  { act: "lounge-laptop", who: "juniper", line: "running", say: "Tests are green", set: (g) => { g.add(furniture.lounger()); const u = furniture.umbrella(); u.position.set(-0.9, 0, -0.4); g.add(u); return FIT.lounger.seat; }, view: "side" },
  { act: "sunbathe", who: "ines", line: "idle", set: (g) => (g.add(furniture.lounger()), FIT.lounger.seat), view: "side" },
  { act: "hammock", who: "kofi", line: "reading", set: (g) => (g.add(furniture.hammock()), FIT.hammock.seat), view: "side" },
  { act: "fish", who: "marlo", line: "idle", set: (g) => { const r = furniture.rail(2); r.position.z = 0.75; g.add(r); return null; } },
  { act: "fish-sit", who: "bodhi", line: "idle", set: (g) => { platform(g); return 0; }, view: "side" },
  { act: "carry", who: "sable", line: "landed", tone: "ok", say: "Dark mode, delivered", walk: true },
  { act: "slump", who: "teo", line: "failed", tone: "danger", say: "The build broke again", set: (g) => (g.add(furniture.chair()), FIT.chair.seat) },
  { act: "phone", who: "captain", line: "Captain", walk: true },
  { act: "think", who: "nova", line: "thinking" },
  { act: "celebrate", who: "coral", line: "landed", tone: "ok", say: "Landed!" },
  { act: "wave", who: "lumi", line: "arriving", backpack: true, say: "Hi! I'm new" },
  { act: "rail", who: "pike", line: "idle", set: (g) => { const r = furniture.rail(2); r.position.z = 0.5; g.add(r); return null; } },
  { act: "swim", who: "ines", line: "idle", set: (g) => { g.add(furniture.poolWater(3, 3)); g.position.y = 1.5; return null; } },
  { act: "stool", who: "juniper", line: "idle", set: (g) => { g.add(furniture.barStool()); bar(g); return FIT.stool.seat; } },
  { act: "drink", who: "otis", line: "idle" },
  { act: "bartend", who: "pike", line: "idle", set: (g) => { bar(g, 0.3); return null; } },
  { act: "talk", who: "kofi", line: "asking", tone: "warn", say: "Can I delete the old migrations?" },
  { act: "listen", who: "wren", line: "idle" },
  { act: "chat", who: "teo", line: "idle" },
  { act: "point", who: "marlo", line: "delegating" },
  // Off duty, with company.
  { act: "nap", who: "ines", line: "idle", set: (g) => (g.add(furniture.lounger()), FIT.lounger.seat), view: "side", zzz: true },
  { act: "nap-hammock", who: "kofi", line: "idle", set: (g) => (g.add(furniture.hammock()), FIT.hammock.seat), view: "side", zzz: true },
  { act: "hammock-rest", who: "otis", line: "idle", set: (g) => (g.add(furniture.hammock()), FIT.hammock.seat), view: "side" },
  { act: "nap-chair", who: "teo", line: "idle", set: (g) => (g.add(furniture.deckChair()), FIT.deckChair.seat), zzz: true },
  { act: "sit-drink", who: "sable", line: "idle", set: (g) => (g.add(furniture.deckChair()), FIT.deckChair.seat) },
  { act: "dance", who: "coral", line: "idle" },
  { act: "cards", who: "wren", line: "idle", set: (g) => { g.add(furniture.deckChair()); table(g); return FIT.deckChair.seat; } },
  { act: "selfie", who: "lumi", line: "idle" },
  { act: "stretch", who: "nova", line: "idle" },
  { act: "huddle", who: "pike", line: "delegating", set: (g) => { const d = furniture.desk(); d.position.set(0.55, 0, 0); g.add(d); return null; } },
  { act: "tuck", who: "bodhi", line: "idle", set: (g) => { g.position.y = 0.9; return null; } },
  { act: "climb", who: "juniper", line: "idle" },
  { act: "jog", who: "marlo", line: "idle" },
  { act: "sauna", who: "otis", line: "idle", set: (g) => (g.add(furniture.chair()), FIT.chair.seat) },
  { act: "tinker", who: "kofi", line: "idle" },
  { act: "leanBack", who: "wren", line: "idle" },
];

// A low table in front of a seat, for cards.
function table(g: THREE.Group) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.45, 0.55), new THREE.MeshStandardMaterial({ color: "#a8743f", roughness: 0.6 }));
  m.position.set(0, 0.225, 0.75);
  m.castShadow = m.receiveShadow = true;
  g.add(m);
}

function platform(g: THREE.Group) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.5, 1.4), new THREE.MeshStandardMaterial({ color: "#b7804f", roughness: 0.7 }));
  m.position.set(0, -0.25, -0.55);
  m.castShadow = m.receiveShadow = true;
  g.add(m);
  g.position.y = 0.5;
}
// A bar counter, its near face `front` metres in front of the slot.
function bar(g: THREE.Group, front = 0.38) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.08, 0.5), new THREE.MeshStandardMaterial({ color: "#a8743f", roughness: 0.6 }));
  m.position.set(0, 0.54, front + 0.25);
  m.castShadow = m.receiveShadow = true;
  g.add(m);
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.05, 0.6), new THREE.MeshStandardMaterial({ color: "#f2efe8", roughness: 0.3 }));
  top.position.set(0, 1.1, m.position.z);
  top.castShadow = true;
  g.add(top);
}

interface Live { fig: CrewFigure; st: Station; seat: number | null; group: THREE.Group; walkT: number; base: THREE.Vector3 }
const live: Live[] = [];
let focus: THREE.Vector3 | null = null;
let focusView: Station["view"] = "front";

function addFigure(p: AvatarPreset, at: THREE.Vector3, st: Station, i: number) {
  const g = new THREE.Group();
  g.position.copy(at);
  scene.add(g);
  const seat = st.set ? st.set(g) : null;
  const label = st.line in ACTIVITY_LABEL ? ACTIVITY_LABEL[st.line as keyof typeof ACTIVITY_LABEL] : st.line;
  const fig = new CrewFigure({ spec: p.spec, look: p.look, name: p.name, line: label, tone: st.tone ?? (st.line === "asking" ? "warn" : "accent"), seed: i * 7 + 3 });
  fig.setAct(st.act);
  if (st.backpack) fig.setBackpack(true);
  if (st.zzz) fig.setSleeping(true);
  if (st.line === "asking") fig.setAsking(true);
  if (st.act === "type") fig.write(["// settings.tsx", "export function Settings() {", "  const [dark, setDark] = useState(false);", "  return <Toggle on={dark} />;", "}"], "settings.tsx");
  g.add(fig.object);
  live.push({ fig, st, seat, group: g, walkT: i, base: g.position.clone() });
  return fig;
}

const only = params.get("act");
const lineup = params.get("lineup");
const botOnly = params.get("bot");
let bot: ComputerBot | null = null;
let botLabel: THREE.Sprite | null = null;

if (lineup) {
  const all = [CAPTAIN_PRESET, ...CREW_PRESETS];
  const extra = Number(params.get("random") ?? 0);
  for (let i = 0; i < extra; i++) { const r = randomCrewAvatar(i + 1); all.push({ id: `r${i}`, name: `Random ${i + 1}`, blurb: "", spec: r.spec, look: r.look }); }
  all.forEach((p, i) => {
    const x = (i - (all.length - 1) / 2) * 1.05;
    const fig = addFigure(p, new THREE.Vector3(x, 0, 0), { act: "listen", who: p.id, line: p.blurb ? "idle" : "idle" }, i);
    fig.setAct(null);
  });
  focus = new THREE.Vector3(0, 1.0, 0);
} else if (botOnly) {
  focus = new THREE.Vector3(0, 1.4, 0);
} else {
  const list = only && isAct(only) ? STATIONS.filter((s) => s.act === only) : STATIONS;
  if (only && !list.length) {
    if (isAct(only)) list.push({ act: only, who: params.get("preset") ?? "otis", line: "idle" });
  }
  const cols = 6;
  list.forEach((st, i) => {
    const who = params.get("preset") ?? st.who;
    const x = list.length === 1 ? 0 : ((i % cols) - (cols - 1) / 2) * 4.2;
    const z = list.length === 1 ? 0 : -Math.floor(i / cols) * 5.2;
    addFigure(byId(who), new THREE.Vector3(x, 0, z), st, i);
    if (st.say) setTimeout(() => live[i]?.fig.say(st.say!), 600 + i * 150);
  });
  if (list.length === 1) {
    focus = live[0]!.group.position.clone().add(new THREE.Vector3(0, list[0]!.act === "swim" ? 0.3 : 0.8, 0.2));
    focusView = list[0]!.view ?? "front";
  }
}

// Computah, cycling its moods.
if (!lineup && (!only || botOnly)) {
  const holder = new THREE.Group();
  holder.position.set(botOnly ? 0 : 0, 0, botOnly ? 0 : 4.2);
  scene.add(holder);
  bot = new ComputerBot(holder, { scale: 0.55 });
  bot.anchor.set(0, 1.5, 0);
  botLabel = makeTextSprite("idle", { font: 28 });
  botLabel.position.set(0, 2.25, 0);
  holder.add(botLabel);
}

// ---------- camera ----------

function placeCamera() {
  const cam = params.get("camera");
  if (cam && /^-?[\d.]+,-?[\d.]+,-?[\d.]+$/.test(cam)) {
    const [x, y, z] = cam.split(",").map(Number) as [number, number, number];
    camera.position.set(x, y, z);
    controls.target.copy(focus ?? new THREE.Vector3(0, 0.8, -5));
  } else if (focus) {
    const v = cam === "side" ? "side" : cam === "front" ? "front" : focusView;
    const far = cam === "wide" ? 1.8 : 1;
    if (lineup) camera.position.set(0, 1.5, 9.5);
    else if (botOnly) camera.position.set(0.6, 1.6, 2.6);
    else if (v === "side") camera.position.copy(focus).add(new THREE.Vector3(2.5 * far, 0.8 * far, 1.4 * far));
    else camera.position.copy(focus).add(new THREE.Vector3(1.1 * far, 0.65 * far, 2.5 * far));
    controls.target.copy(focus);
  } else {
    camera.position.set(0, cam === "close" ? 6 : 12, cam === "close" ? 9 : 15.5);
    controls.target.set(0, 0.4, -5.5);
  }
  controls.update();
}
placeCamera();

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);
resize();

// ---------- loop ----------

const timer = new THREE.Timer();
const fr = (x: number) => x - Math.floor(x);
let botMood = 0, botNext = 0;
hud.textContent = only ? `act: ${only}` : lineup ? "presets" : botOnly ? "Computah" : `${live.length} acts · drag to orbit`;

function frame(now?: number) {
  requestAnimationFrame(frame);
  timer.update(now);
  const dt = Math.min(0.05, timer.getDelta());
  const t = timer.getElapsed();
  for (const L of live) {
    let speed = 0;
    if (L.st.walk && !params.has("still")) {
      // Back and forth along x, turning at the ends.
      L.walkT += dt;
      const span = 1.4, period = 5.6, ph = (L.walkT % period) / period;
      const x = ph < 0.5 ? -span + 4 * span * ph : 3 * span - 4 * span * ph;
      L.group.position.x = L.base.x + x;
      L.fig.object.rotation.y = ph < 0.5 ? Math.PI / 2 : -Math.PI / 2;
      speed = (2 * span * 2) / period;
    }
    const gesture = params.get("gesture");
    if (gesture && isGesture(gesture) && !L.fig.rig.gestureId && fr(t * 0.25) < 0.1) L.fig.gesture(gesture);
    L.fig.update(dt, t, { speed, seat: L.seat, camera });
  }
  if (bot) {
    if (botOnly && (BOT_MOODS as string[]).includes(botOnly)) {
      if (bot.mood !== botOnly) {
        bot.setMood(botOnly as BotMood);
        botLabel?.removeFromParent();
        botLabel = makeTextSprite(botOnly, { font: 28 });
        botLabel.position.set(0, 2.25, 0);
        bot.root.parent!.add(botLabel);
      }
    }
    else if (t > botNext) {
      botNext = t + 3.4;
      const mood = BOT_MOODS[botMood++ % BOT_MOODS.length]!;
      bot.setMood(mood);
      if (mood === "think") bot.thought();
      botLabel?.removeFromParent();
      botLabel = makeTextSprite(mood, { font: 28 });
      botLabel.position.set(0, 2.25, 0);
      bot.root.parent!.add(botLabel);
    }
    bot.update(dt, camera.position);
  }
  controls.update();
  renderer.render(scene, camera);
}
frame();

Object.assign(window, { dev: { scene, camera, controls, live, bot, ACTS } });
