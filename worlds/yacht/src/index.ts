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
import { castsShadow, makeMaterials, type MatKey } from "./mats.ts";
import type { Ship } from "./parts.ts";
import { buildHull } from "./hull.ts";
import { buildForedeck } from "./foredeck.ts";
import { buildOffice } from "./office.ts";
import { buildBridge } from "./bridge.ts";
import { buildCanopy } from "./canopy.ts";
import { buildSunDeck } from "./sundeck.ts";
import { buildAft } from "./aft.ts";
import { createHelicopters } from "./helicopter.ts";

export { WATERLINE } from "./dims.ts";
export { planFlights, helicopterModel } from "./helicopter.ts";

/** The yacht's own extras on top of a BuiltWorld, for tools and the dev viewer. */
export interface YachtWorld extends BuiltWorld {
  sky: Sky;
  daylight: Daylight;
  ocean: Ocean;
  /** Holds the sky at an hour (0..24), or null to follow the shared clock (a 30-minute day). */
  setHour(h: number | null): void;
  /** Every screen the app can paint, by id ("desk-01".."desk-36", "helm", "wall"). */
  screens: Map<string, THREE.Mesh>;
}

const SPEED = 7.5; // m/s through the water, about 15 knots
// Where the sun sets: off the port quarter, so evening light falls on the port side the
// concept art shows, and on the stern.
const SKY_TURN = -1.06;

export interface YachtOptions {
  /** The hour the sky holds at (0..24), or null to follow the shared clock. Default: golden hour. */
  hour?: number | null;
}

/** Golden hour: low warm sun on the port quarter, long shadows across the decks. */
export const GOLDEN_HOUR = 18.4;

export async function buildYacht(ctx: WorldContext, { hour = GOLDEN_HOUR }: YachtOptions = {}): Promise<YachtWorld> {
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
  const ocean = createOcean({ quality, speed: SPEED, hull: WATERLINE });
  root.add(ocean.mesh);
  const spray = createSpray(WATERLINE, { speed: SPEED, quality });
  root.add(spray.mesh);
  const probe = createEnvProbe(renderer, { size: quality === "high" ? 128 : 64, every: 5 });
  probe.scene.add(sky.makeDome(), ocean.makeEnvMesh());

  // The ship.
  const materials = makeMaterials();
  const ship: Ship = { pile: new Pile<MatKey>(), col: new Colliders(), plan: new Plan(), props: new Props<MatKey>(), materials, extra: [], tick: [] };
  buildHull(ship.pile);
  buildForedeck(ship);
  buildOffice(ship);
  const interactables = buildBridge(ship);
  buildCanopy(ship);
  buildSunDeck(ship);
  buildAft(ship);
  const hull = ship.pile.build(materials, (k) => ({ cast: castsShadow(k), receive: true }));
  hull.name = "ship";
  const props = ship.props.build(materials, (k) => castsShadow(k));
  props.name = "furniture";
  root.add(hull, props, ...ship.extra);
  const screens = new Map<string, THREE.Mesh>();
  for (const o of ship.extra) if (typeof o.userData.screen === "string") screens.set(o.userData.screen, o as THREE.Mesh);

  const helicopters = createHelicopters();
  root.add(helicopters.root);

  const layout = ship.plan.finish();
  // For fishing lines and swimmers: where the sea's surface is (it swells about ±0.6 m).
  root.userData.waterY = 0;
  const colliders = [ship.col.mesh()];
  root.updateMatrixWorld(true);

  let t = 0, lastHour = -99;
  const centre = new THREE.Vector3(0, 10, 0), probeAt = new THREE.Vector3(0, 24, 0);
  const world: YachtWorld = {
    root,
    layout,
    colliders,
    interactables,
    sky,
    daylight,
    ocean,
    screens,
    setHour: (h) => sky.setHour(h),
    setArrivals: (touchdowns) => helicopters.setArrivals(touchdowns),
    update(dt, now) {
      t += dt;
      LIGHT.uTime.value = t;
      const st = sky.update(t, now);
      daylight.apply(st, scene);
      daylight.fit(camera, centre, 85);
      // Exposure follows the light: open up a little at night so it's dark, not black.
      renderer.toneMappingExposure = 1.0 + 0.2 * st.night;
      const jump = Math.abs(st.hour - lastHour) > 0.25;
      probe.update(t, probeAt, jump);
      if (jump) lastHour = st.hour;
      if (probe.texture) scene.environment = probe.texture;
      helicopters.update(dt, now);
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
  build: (ctx) => buildYacht(ctx),
};
