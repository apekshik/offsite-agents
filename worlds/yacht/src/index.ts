// The superyacht: Offsite's first world. A ~140 m yacht cruising through an open sea at golden
// hour, with an office for the crew, a bridge for the ship's computer, decks to lounge on and a
// helipad for new arrivals. Built after the concept art in docs/art/yacht.

import * as THREE from "three";
import {
  LIGHT, createDaylight, createEnvProbe, createOcean, createSky, createSpray, setMaterialBase,
  type BuiltWorld, type Daylight, type Ocean, type Sky, type WorldContext, type WorldModule,
} from "@offsite/kit";
import { WATERLINE } from "./dims.ts";
import { Colliders, Pile, Plan, Props } from "./kit.ts";
import { BUSY, castsShadow, makeMaterials, type MatKey } from "./mats.ts";
import type { Ship } from "./parts.ts";
import { buildHull } from "./hull.ts";
import { buildForedeck } from "./foredeck.ts";
import { buildOffice } from "./office.ts";
import { MAST, buildBridge } from "./bridge.ts";
import { buildCanopy } from "./canopy.ts";
import { buildSunDeck } from "./sundeck.ts";
import { buildAft } from "./aft.ts";
import { createHelicopters, type HelicopterView } from "./helicopter.ts";
import { createWildlife, perchesFor } from "./wildlife.ts";
import { buildLowerDeck } from "./lower.ts";
import { createCore } from "./core.ts";
import { WIND, buildLife } from "./life.ts";

export { WATERLINE } from "./dims.ts";
export { planFlights, helicopterModel, flightPlan, FLIGHT } from "./helicopter.ts";
export type { HelicopterView } from "./helicopter.ts";

/** The yacht's own extras on top of a BuiltWorld, for tools and the dev viewer. */
export interface YachtWorld extends BuiltWorld {
  sky: Sky;
  daylight: Daylight;
  ocean: Ocean;
  /** Holds the sky at an hour (0..24), or null to follow the shared clock (a 30-minute day). */
  setHour(h: number | null): void;
  /** Every screen the app can paint, by id ("desk-01".."desk-36", "helm", "wall", "core"). */
  screens: Map<string, THREE.Mesh>;
  setBusy(level: number): void;
  /** How busy the ship is (BuiltWorld.setBusy), eased: what the lights and the wake show now. */
  readonly busy: number;
  /**
   * How much the ship rides the swell: 1 (the default) is a gentle roll and pitch, 0 holds it
   * still (for a locked-off shot). The decks never move under anyone's feet: the sea and the sky
   * move the other way round instead, which looks the same from aboard.
   */
  setSwell(k: number): void;
  /** Where the first helicopter in the air is now, for a camera to follow (null: none flying). */
  helicopter(now: number): HelicopterView | null;
}

// m/s through the water: about 11 knots with everyone off duty, 20 with the whole crew at work.
const SPEED_REST = 5.6, SPEED_BUSY = 10.4;
const speedAt = (busy: number) => SPEED_REST + (SPEED_BUSY - SPEED_REST) * busy;
// Where the sun sets: off the port quarter, so evening light falls on the port side the
// concept art shows, and on the stern.
const SKY_TURN = -1.06;

export interface YachtOptions {
  /** The hour the sky holds at (0..24), or null to follow the shared clock. Default: golden hour. */
  hour?: number | null;
  /** How busy the ship starts out (0..1). */
  busy?: number;
  /** How much it rides the swell (YachtWorld.setSwell). */
  swell?: number;
}

/**
 * The hour asked for in the page's address, if any: ?t=19.2 or ?hour=19.2 (sunset is about 19.0,
 * night 21.5). Lets the app and a film rig set the light without any code.
 */
export function hourFromUrl(): number | null {
  const q = typeof location === "undefined" ? null : new URLSearchParams(location.search);
  const v = q?.get("t") ?? q?.get("hour");
  const h = v == null || v === "" ? NaN : Number(v);
  return Number.isFinite(h) ? h : null;
}

/** Golden hour: low warm sun on the port quarter, long shadows across the decks. */
export const GOLDEN_HOUR = 18.4;

export async function buildYacht(ctx: WorldContext, { hour = GOLDEN_HOUR, busy: busy0 = 0.4, swell: swell0 = 1 }: YachtOptions = {}): Promise<YachtWorld> {
  const { quality, scene, renderer, camera } = ctx;
  setMaterialBase(ctx.assets);
  const root = new THREE.Group();
  root.name = "yacht";

  // The sky, the light and the sea.
  const sky = createSky({ turn: SKY_TURN });
  sky.setHour(hour);
  root.add(sky.dome);
  const daylight = createDaylight({ quality, shadowReach: 150, fogNear: 400, fogFar: 3600 });
  root.add(daylight.sun, daylight.hemi);
  const prevFog = scene.fog, prevEnv = scene.environment, prevEnvI = scene.environmentIntensity;
  scene.fog = daylight.fog;
  let busy = THREE.MathUtils.clamp(busy0, 0, 1), busyTarget = busy;
  BUSY.value = busy;
  const ocean = createOcean({ quality, speed: speedAt(busy), hull: WATERLINE });
  root.add(ocean.mesh);
  ocean.setHullGlow(new THREE.Color("#1aa6d6").multiplyScalar(0.55));
  const spray = createSpray(WATERLINE, { speed: speedAt(busy), quality });
  root.add(spray.mesh);
  const probe = createEnvProbe(renderer, { size: quality === "high" ? 128 : 64, every: 5 });
  probe.scene.add(sky.makeDome(), ocean.makeEnvMesh());

  // The ship.
  const materials = makeMaterials();
  const ship: Ship = {
    pile: new Pile<MatKey>(), col: new Colliders(), plan: new Plan(), props: new Props<MatKey>(), materials, extra: [], tick: [],
    inner: new Pile<MatKey>(), innerProps: new Props<MatKey>(), lights: [], halos: [], drapes: [],
  };
  buildHull(ship.pile);
  buildForedeck(ship);
  buildOffice(ship);
  const interactables = buildBridge(ship);
  buildCanopy(ship);
  buildSunDeck(ship);
  buildAft(ship);
  const { racks } = buildLowerDeck(ship);
  const core = createCore(ship, racks);
  const hull = ship.pile.build(materials, (k) => ({ cast: castsShadow(k), receive: true }));
  hull.name = "ship";
  const props = ship.props.build(materials, (k) => castsShadow(k));
  props.name = "furniture";
  // Below decks: out of the sun, so it casts no shadows.
  const below = ship.inner.build(materials, () => ({ cast: false, receive: true }));
  below.name = "below-decks";
  const belowProps = ship.innerProps.build(materials, () => false);
  belowProps.name = "below-decks-furniture";
  root.add(hull, props, below, belowProps, ...ship.extra);
  const screens = new Map<string, THREE.Mesh>();
  for (const o of ship.extra) if (typeof o.userData.screen === "string") screens.set(o.userData.screen, o as THREE.Mesh);

  const helicopters = createHelicopters(ocean);
  root.add(helicopters.root);

  const layout = ship.plan.finish();
  // Gulls and dolphins; the gulls perch only where nobody sits or stands.
  const wildlife = createWildlife(ocean, perchesFor(props, layout.slots));
  root.add(wildlife.root);
  // For fishing lines and swimmers: where the sea's surface is (it swells about ±0.6 m).
  root.userData.waterY = 0;
  const colliders = [ship.col.mesh()];
  // Lights, glows, steam, the name, drapes and flags (needs the colliders, to find the decks).
  const life = buildLife(ship, colliders, MAST);
  root.add(...life.objects);
  root.updateMatrixWorld(true);

  let t = 0, lastHour = -99, swell = swell0;
  const centre = new THREE.Vector3(0, 10, 0), probeAt = new THREE.Vector3(0, 24, 0);
  // The ship's motion on the swell: a slow roll, a slower pitch, a little heave. Applied to the sea
  // and the sky the other way round (see setSwell).
  const seaFrame = new THREE.Matrix4(), motion = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1);
  const deg = Math.PI / 180;
  function ride(t: number) {
    const roll = (0.55 * Math.sin((t * 2 * Math.PI) / 9.7) + 0.15 * Math.sin((t * 2 * Math.PI) / 5.3 + 1.1)) * deg * swell;
    const pitch = (0.2 * Math.sin((t * 2 * Math.PI) / 12.4 + 0.6) + 0.06 * Math.sin((t * 2 * Math.PI) / 6.1 + 2.0)) * deg * swell;
    const heave = (0.11 * Math.sin((t * 2 * Math.PI) / 7.9 + 0.3) + 0.04 * Math.sin((t * 2 * Math.PI) / 4.4)) * swell;
    motion.compose(_p.set(0, heave, 0), _q.setFromEuler(_e.set(pitch, 0, roll, "YXZ")), _one);
    seaFrame.copy(motion).invert();
    ocean.setFrame(seaFrame);
    _q.invert();
    sky.dome.quaternion.copy(_q);
  }
  const world: YachtWorld = {
    root,
    layout,
    colliders,
    interactables,
    sky,
    daylight,
    ocean,
    screens,
    get busy() { return busy; },
    setHour: (h) => sky.setHour(h),
    setArrivals: (touchdowns) => helicopters.setArrivals(touchdowns),
    setBusy(level) {
      busyTarget = THREE.MathUtils.clamp(Number.isFinite(level) ? level : 0, 0, 1);
    },
    setSwell(k) { swell = Math.max(0, k); },
    helicopter: (now) => helicopters.view(now),
    aircraft: (now) => helicopters.flying(now),
    update(dt, now) {
      t += dt;
      LIGHT.uTime.value = t;
      // Busy eases over a couple of seconds; the ship picks up speed (or slows) with it.
      busy += (busyTarget - busy) * (1 - Math.exp(-dt * 1.6));
      BUSY.value = busy;
      const speed = speedAt(busy);
      ocean.setSpeed(speed);
      spray.setSpeed(speed);
      ocean.advance(dt);
      WIND.value = speed / 7.5;
      ride(t);
      const st = sky.update(t, now);
      daylight.apply(st, scene);
      daylight.fit(camera, centre, 85);
      // Exposure follows the light: open up a little at night so it's dark, not black.
      renderer.toneMappingExposure = 1.0 + 0.45 * st.night;
      const jump = Math.abs(st.hour - lastHour) > 0.25;
      probe.update(t, probeAt, jump);
      if (jump) lastHour = st.hour;
      if (probe.texture) scene.environment = probe.texture;
      helicopters.update(dt, now);
      wildlife.update(now, t);
      core.update(dt, t, busy);
      for (const fn of ship.tick) fn(dt, t, now);
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
      helicopters.dispose();
      wildlife.dispose();
      core.dispose();
      life.dispose();
      ocean.dispose();
      spray.dispose();
      sky.dispose();
      daylight.dispose();
      probe.dispose();
      colliders[0]!.geometry.dispose();
    },
  };
  return world;
}

export const yacht: WorldModule = {
  id: "yacht",
  name: "Superyacht",
  blurb: "A superyacht cruising somewhere warm, at golden hour.",
  build: (ctx) => buildYacht(ctx, { hour: hourFromUrl() ?? GOLDEN_HOUR }),
};
