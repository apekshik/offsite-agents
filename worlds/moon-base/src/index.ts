// The moon base, "Terraced Crater": Offsite's second world. A base built into a crater's
// terraced walls under a black sky, Earth hanging over the rim: rows of half-buried printed habs,
// a work hall dug into the north-west terrace, a glass hub dome on the floor where the captain's
// console is, a greenhouse and a sports dome up top, a lookout on the rim, a rover garage, an ice
// rig in a pit, and a pad where new crew land. Built after the concept art in
// docs/art/moon-base/refs (the masterplan is the layout's source of truth).

import * as THREE from "three";
import {
  LIGHT, createDaylight, createEnvProbe, setMaterialBase,
  type BuiltWorld, type Daylight, type WorldContext, type WorldModule,
} from "@offsite/kit";
import { EARTH, PAD } from "./dims.ts";
import { BUSY, castsShadow, makeMaterials } from "./mats.ts";
import { buildLayout } from "./layout.ts";
import { MOON_HOUR, createMoonSky, skyDir, type MoonSky } from "./sky.ts";
import { codeTexture, disposeStill, screenMesh, scrollingCode } from "./screens.ts";
import { createLanders, type LanderView } from "./lander.ts";
import { PAD_YAW } from "./floor.ts";
import { buildLife } from "./life.ts";

export { MOON_HOUR, sunAt } from "./sky.ts";
export { LANDER } from "./lander.ts";
export type { LanderView } from "./lander.ts";
export { buildLayout } from "./layout.ts";

/** The moon base's own extras on top of a BuiltWorld, for tools and the dev viewer. */
export interface MoonWorld extends BuiltWorld {
  sky: MoonSky;
  daylight: Daylight;
  /** Holds the sky at an hour (0..24), or null to follow the shared clock (a 30-minute day). */
  setHour(h: number | null): void;
  /** Every screen the app can paint, by id ("desk-01".."desk-24", "helm", "wall"). */
  screens: Map<string, THREE.Mesh>;
  setBusy(level: number): void;
  /** How busy the base is (BuiltWorld.setBusy), eased: what the lights show now. */
  readonly busy: number;
  /** Where the first lander in the air is now, for a camera to follow (null: none flying). */
  lander(now: number): LanderView | null;
}

export interface MoonOptions {
  /** The hour the sky holds at (0..24), or null to follow the shared clock. Default: a low morning sun. */
  hour?: number | null;
  /** How busy the base starts out (0..1). */
  busy?: number;
}

/**
 * The hour asked for in the page's address, if any: ?t=21.5 or ?hour=21.5 (the sun is down from
 * about 20.5 to 5.5). Lets the app and a film rig set the light without any code.
 */
export function hourFromUrl(): number | null {
  const q = typeof location === "undefined" ? null : new URLSearchParams(location.search);
  const v = q?.get("t") ?? q?.get("hour");
  const h = v == null || v === "" ? NaN : Number(v);
  return Number.isFinite(h) ? h : null;
}

/** Low gravity: a sixth of a gee would float you off the terraces, so a little more than that, for feel. */
export const MOON_GRAVITY = { gravity: 8.5, jump: 6.0 };

export async function buildMoonBase(ctx: WorldContext, { hour = MOON_HOUR, busy: busy0 = 0.4 }: MoonOptions = {}): Promise<MoonWorld> {
  const { quality, scene, renderer, camera } = ctx;
  setMaterialBase(ctx.assets);
  const root = new THREE.Group();
  root.name = "moon-base";

  // The sky and the light: a black sky, a hard low sun, Earth's glow after dark.
  const sky = createMoonSky();
  sky.setHour(hour);
  root.add(sky.dome);
  const daylight = createDaylight({ quality, shadowReach: 190, fogNear: 1600, fogFar: 7000 });
  root.add(daylight.sun, daylight.hemi);
  const prevFog = scene.fog, prevEnv = scene.environment, prevEnvI = scene.environmentIntensity;
  scene.fog = daylight.fog;
  const probe = createEnvProbe(renderer, { size: quality === "high" ? 128 : 64, every: 5 });
  // What the base reflects: the black sky above, the sunlit regolith all round below.
  const groundMat = new THREE.MeshBasicMaterial({ color: "#5c5955", side: THREE.DoubleSide });
  const ground = new THREE.Mesh(new THREE.CircleGeometry(3000, 32).rotateX(-Math.PI / 2).translate(0, 18, 0), groundMat);
  // ...and the crater's sunlit walls round the horizon, the light that reaches into its shadows.
  const walls = new THREE.Mesh(new THREE.CylinderGeometry(300, 300, 40, 32, 1, true).translate(0, 36, 0), groundMat);
  probe.scene.add(sky.makeDome(), ground, walls);
  let busy = THREE.MathUtils.clamp(busy0, 0, 1), busyTarget = busy;
  BUSY.value = busy;

  // The base.
  const built = buildLayout();
  const s = built.base;
  const materials = makeMaterials();
  const outside = s.pile.build(materials, (k) => ({ cast: castsShadow(k), receive: true }));
  outside.name = "base";
  const props = s.props.build(materials, (k) => castsShadow(k));
  props.name = "pieces";
  // Inside, out of the sun: casting no shadows.
  const inside = s.inner.build(materials, () => ({ cast: false, receive: true }));
  inside.name = "inside";
  const insideProps = s.innerProps.build(materials, () => false);
  insideProps.name = "inside-pieces";
  root.add(outside, props, inside, insideProps);

  // Screens: the app paints the desks, the console and the hall's board; the base scrolls its own.
  const screens = new Map<string, THREE.Mesh>();
  const scrolling: ReturnType<typeof scrollingCode>[] = [];
  s.screens.forEach((sp, i) => {
    const own = sp.kind === "code" ? scrollingCode(i * 7 + 3) : null;
    const mesh = screenMesh(own ? `code:${sp.id}` : `screen:${sp.id}`, sp.w, sp.h, own?.texture ?? codeTexture(), sp.brightness ?? 1.25);
    mesh.position.copy(sp.pos);
    mesh.quaternion.copy(sp.quat);
    if (own) scrolling.push(own);
    else { mesh.userData.screen = sp.id; screens.set(sp.id, mesh); }
    root.add(mesh);
  });

  // Real lights in the rooms after dark (the greenhouse's and the ice's, always).
  const rooms = s.rooms.map((o) => {
    const light = new THREE.PointLight(o.color ?? "#ffd6a6", 0, o.distance, 1.5);
    light.position.set(o.x, o.y, o.z);
    light.name = "room-light";
    root.add(light);
    return { light, o };
  });

  // Arrivals: landers out of the north-east, down onto the pad.
  const landers = createLanders(materials, new THREE.Vector3(PAD.x, 0.14, PAD.z), PAD_YAW, skyDir(EARTH.az, EARTH.el));
  root.add(landers.root);

  const life = buildLife(s, materials);
  root.add(...life.objects);
  root.updateMatrixWorld(true);
  const colliders = [built.colliders];

  let t = 0, lastHour = -99;
  const centre = new THREE.Vector3(0, 8, 0), probeAt = new THREE.Vector3(0, 24, 0);
  const regolith = new THREE.Color("#8a8680");
  const world: MoonWorld = {
    root,
    layout: built.layout,
    colliders,
    interactables: built.interactables,
    sky,
    daylight,
    screens,
    captain: MOON_GRAVITY,
    soundscape: { sea: false, wildlife: false, aircraft: "none" },
    get busy() { return busy; },
    setHour: (h) => sky.setHour(h),
    setArrivals: (touchdowns) => landers.setArrivals(touchdowns),
    setBusy(level) { busyTarget = THREE.MathUtils.clamp(Number.isFinite(level) ? level : 0, 0, 1); },
    lander: (now) => landers.view(now),
    aircraft: (now) => landers.flying(now),
    update(dt, now) {
      t += dt;
      LIGHT.uTime.value = t;
      busy += (busyTarget - busy) * (1 - Math.exp(-dt * 1.6));
      BUSY.value = busy;
      const st = sky.update(t, now);
      daylight.apply(st, scene);
      daylight.fit(camera, centre, 140);
      // No air: the shade stays dark, the sun hard. Open up a little at night so it's dark, not black.
      renderer.toneMappingExposure = 1.0 + 0.55 * st.night;
      // The ground the probe sees: lit regolith by day, Earth-lit at night.
      groundMat.color.copy(regolith).multiplyScalar(0.12 + 0.34 * Math.max(0, st.lightDir.y) * st.lightIntensity).lerp(new THREE.Color("#1c2233"), st.night * 0.6);
      const jump = Math.abs(st.hour - lastHour) > 0.25;
      probe.update(t, probeAt, jump);
      if (jump) lastHour = st.hour;
      if (probe.texture) scene.environment = probe.texture;
      landers.update(dt, now);
      life.update(dt, t);
      for (const { light, o } of rooms) light.intensity = o.intensity * (o.always ? 1 : LIGHT.uNight.value) * (1 - (o.busy ?? 0) + (o.busy ?? 0) * busy);
      for (const sc of scrolling) sc.update(t);
    },
    dispose() {
      scene.fog = prevFog;
      scene.environment = prevEnv;
      scene.environmentIntensity = prevEnvI;
      root.removeFromParent();
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry?.dispose();
      });
      for (const m of Object.values(materials)) m.dispose();
      for (const sc of scrolling) sc.dispose();
      disposeStill();
      landers.dispose();
      life.dispose();
      sky.dispose();
      daylight.dispose();
      probe.dispose();
      ground.geometry.dispose();
      walls.geometry.dispose();
      groundMat.dispose();
      built.collision.dispose();
      colliders[0]!.geometry.dispose();
    },
  };
  return world;
}

export const moonBase: WorldModule = {
  id: "moon-base",
  name: "Moon Base",
  blurb: "A base terraced into a crater on the Moon, Earth over the rim.",
  build: (ctx) => buildMoonBase(ctx, { hour: hourFromUrl() ?? MOON_HOUR }),
};
