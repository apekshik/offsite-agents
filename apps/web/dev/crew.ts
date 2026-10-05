// The crew test bed: the real game (engine, director, crew) on the yacht, fed a made-up ship
// instead of Convex, so a big crew can be tried without hiring anyone. For looking at the crew off
// duty, the scramble when work comes in, frame times, and determinism.
//
//   /dev/crew.html?n=16                 sixteen crew, all off duty
//   &busy=6                             six of them already at work
//   &clock                              on the film's virtual clock (src/film/clock.ts): nothing moves
//                                       until window.crew.step(frames) is called
//   &cam=x,y,z,tx,ty,tz[,fov]           a fixed camera (else the captain's)
//   &hud=0                              no overlay
//
// window.crew: delegate(k), finish(k), sync(i), step(n), cam(...), stats(), dump().

const params = new URLSearchParams(location.search);
// The clock goes first, so the engine and three read virtual time.
const film = params.has("clock") ? (await import("../src/film/clock.ts")).clock : null;
if (film) { film.setWall(Date.UTC(2026, 5, 21, 1, 30, 0)); Object.assign(window, { filmClock: film }); }

const THREE = await import("three");
const { CREW_PRESETS, randomCrewAvatar } = await import("@offsite/kit");
const { yacht } = await import("@offsite/world-yacht");
const { Game } = await import("../src/game/engine.ts");
type Snapshot = import("../src/game/engine.ts").Snapshot;
type View = Snapshot["crew"][number];

const N = Math.max(1, Math.min(24, Number(params.get("n") ?? 14)));
const NAMES = ["Juniper", "Otis", "Wren", "Ines", "Kofi", "Marlo", "Bodhi", "Sable", "Teo", "Nova", "Coral", "Lumi", "Pike", "Ada", "Rumi", "Zola", "Felix", "Iris", "Milo", "Saga", "Bea", "Cass", "Dex", "Echo"];
const TASKS = ["Settings toggle", "Theme types", "Dark mode CSS", "Login retry", "Search index", "Rate limiter", "Docs pass", "Cache headers", "Flaky test", "Billing page", "Upload limits", "Audit log"];
const STEPS: [string, string][] = [["edit", "Editing settings.tsx"], ["read", "Reading theme.ts"], ["bash", "pnpm test"], ["search", "grep useTheme"], ["edit", "Writing styles.css"]];
if (params.get("hud") === "0") document.body.classList.add("clean");

const now0 = Date.now();
const crew: View[] = Array.from({ length: N }, (_, i) => {
  const p = CREW_PRESETS[i];
  const look = p ? { spec: p.spec, look: p.look } : randomCrewAvatar(`crew-${i}`);
  return {
    _id: `crew-${i}`, name: NAMES[i % NAMES.length]!, handle: NAMES[i % NAMES.length]!.toLowerCase(), role: "crew",
    arrivesAt: now0 - 3_600_000, live: null, lastEnded: null, lastStep: null, asking: false,
    avatar: look.spec, look: look.look,
  };
});
crew.push({
  _id: "computer", name: "Computer", handle: "computer", role: "computer", arrivesAt: now0 - 3_600_000,
  live: null, lastEnded: null, lastStep: null, asking: false, avatar: null, look: null,
});

const canvas = document.getElementById("c") as HTMLCanvasElement;
const game = await Game.start({ canvas, world: yacht, captain: null, quality: params.get("quality") === "low" ? "low" : "high" });
const snap = (): Snapshot => ({ office: { name: "Sea Legs" }, crew: crew.map((c) => ({ ...c })), questions: [] });
const push = () => game.setSnapshot(snap());

function work(c: View, i: number, at: number) {
  const [kind, summary] = STEPS[i % STEPS.length]!;
  c.live = { runId: `run-${c._id}-${at}`, kind: "task", state: "working", threadTitle: "Dark mode", taskTitle: TASKS[i % TASKS.length]!, step: { kind, summary, since: at } };
}
const busy0 = Number(params.get("busy") ?? 0);
crew.slice(0, busy0).forEach((c, i) => work(c, i, now0 - 60_000));
push();

// ---- the camera ----
let fixed: { pos: InstanceType<typeof THREE.Vector3>; at: InstanceType<typeof THREE.Vector3>; fov: number } | null = null;
function cam(x: number, y: number, z: number, tx: number, ty: number, tz: number, fov = 50) {
  fixed = { pos: new THREE.Vector3(x, y, z), at: new THREE.Vector3(tx, ty, tz), fov };
}
if (params.has("cam")) { const v = params.get("cam")!.split(",").map(Number); cam(v[0]!, v[1]!, v[2]!, v[3]!, v[4]!, v[5]!, v[6] || 50); }
// Staging: put off-duty crew at a spot doing something (the film rig's hook); work overrides it.
type Act = import("../src/game/director.ts").Act;
type Prop = import("../src/game/director.ts").Prop;
const staged = new Map<string, { slotId: string; act: Act; props: Prop[] }>();
game.film = {
  stage: (dirs) => dirs.map((d) => {
    const s = staged.get(d.crewId);
    return s && d.activity === "idle" ? { ...d, target: { kind: "slot" as const, slotId: s.slotId }, act: s.act, props: s.props, group: null, label: `Off duty · ${s.act}` } : d;
  }),
  camera: (c) => {
    if (!fixed) return false;
    c.position.copy(fixed.pos);
    c.lookAt(fixed.at);
    if (c.fov !== fixed.fov) { c.fov = fixed.fov; c.updateProjectionMatrix(); }
    return false;
  },
};

// ---- frame times: the loop's own time, and the gap between frames ----
const g = game as unknown as { loop: (t?: number) => void; renderer: import("three").WebGLRenderer; bodies: Map<string, unknown> };
const cpu: number[] = [], gaps: number[] = [];
let last = 0;
const inner = g.loop;
g.loop = (t?: number) => {
  const a = performance.now();
  inner(t);
  const b = performance.now();
  if (!film) { cpu.push(b - a); if (last) gaps.push(a - last); last = a; if (cpu.length > 600) { cpu.shift(); gaps.shift(); } }
};
const stat = (xs: number[]) => {
  const s = [...xs].sort((p, q) => p - q);
  const q = (k: number) => s[Math.min(s.length - 1, Math.floor(k * s.length))] ?? 0;
  return { n: s.length, mean: +(s.reduce((n, x) => n + x, 0) / Math.max(1, s.length)).toFixed(2), p50: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2) };
};

// ---- the controls ----
const api = {
  game, crew,
  /** Hand work to k off-duty crew (or these indices) now. */
  delegate(k = Math.ceil(N / 2), which?: number[]) {
    const at = Date.now();
    const idx = which ?? crew.map((c, i) => (c.role === "crew" && !c.live ? i : -1)).filter((i) => i >= 0).slice(0, k);
    for (const i of idx) work(crew[i]!, i, at);
    push();
    return idx.map((i) => crew[i]!.name);
  },
  /** k of those at work finish (landed). */
  finish(k = 1) {
    const at = Date.now();
    const done = crew.filter((c) => c.live).slice(0, k);
    for (const c of done) { c.lastEnded = { state: "landed", endedAt: at, taskTitle: c.live!.taskTitle, taskId: `task-${c._id}-${at}` }; c.live = null; }
    push();
    return done.map((c) => c.name);
  },
  /** Crew member i calls sync_with_team. */
  sync(i: number) {
    const c = crew[i]!;
    if (!c.live) work(c, i, Date.now());
    c.live!.step = { kind: "offsite", summary: "Sync with the team", since: Date.now() };
    push();
  },
  /** Crew member i between steps: thinking (and maybe pacing). */
  think(i: number) {
    const c = crew[i]!;
    if (!c.live) work(c, i, Date.now());
    c.live!.step = null;
    push();
  },
  /** With &clock: n frames of 1/60 s. */
  step(n = 1) { for (let i = 0; i < n; i++) film?.step(); },
  cam,
  freeCam() { fixed = null; },
  /** Stage crew i at a slot doing act (off duty only); null lets the director decide again. */
  stage(i: number, slotId: string | null, act: Act = "stand", props: Prop[] = []) {
    if (slotId) staged.set(`crew-${i}`, { slotId, act, props }); else staged.delete(`crew-${i}`);
    push();
  },
  stats() {
    const info = g.renderer.info;
    return { crew: g.bodies.size, cpu: stat(cpu), frame: stat(gaps), calls: info.render.calls, triangles: info.render.triangles };
  },
  resetStats() { cpu.length = 0; gaps.length = 0; last = 0; },
  /** Everyone's state, for comparing runs. */
  dump() {
    const out: Record<string, unknown> = {};
    for (const [id, b] of g.bodies as Map<string, { fig: { object: import("three").Object3D; act: string | null; bubble: { text: string; showing: boolean } }; dir: { act: string; activity: string; target: unknown } | null }>) {
      const p = b.fig.object.position, r = b.fig.object.rotation;
      out[id] = { p: [p.x, p.y, p.z].map((v) => +v.toFixed(4)), yaw: +r.y.toFixed(4), act: b.fig.act, dir: b.dir && [b.dir.activity, b.dir.act, b.dir.target], say: b.fig.bubble.showing ? b.fig.bubble.text : null };
    }
    return out;
  },
};
Object.assign(window, { crew: api });

// The HUD: who's where, once a second.
const hud = document.getElementById("hud")!;
setInterval(() => {
  if (document.body.classList.contains("clean")) return;
  const s = api.stats();
  hud.textContent = `${s.crew} crew · cpu ${s.cpu.mean} ms (p95 ${s.cpu.p95}) · frame ${s.frame.mean} ms · ${s.calls} calls`;
}, 1000);

export {};
