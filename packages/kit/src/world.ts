import type * as THREE from "three";
import type { WorldLayout } from "@offsite/contracts";

// The contract between the app and a world (worlds/yacht, later Mars, a space station…).
// A world builds its whole place: geometry, sky, water, lights, sounds. It marks where things can
// happen (WorldLayout: slots and a walking graph). The app owns the renderer, the camera, the
// captain and the crew, and fills the world's slots by what the crew are doing.

export interface WorldContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** "low" on weak GPUs: fewer shadows, no ambient occlusion, simpler water. */
  quality: "low" | "high";
  /** Base URL for static assets (materials, sounds), e.g. "/". */
  assets: string;
}

/** Something the captain can use by walking up and pressing E: the helm, a door, the helicopter. */
export interface Interactable {
  id: string;
  label: string;
  /** Where the prompt shows, and the centre of the reach sphere. */
  at: THREE.Vector3;
  radius: number;
}

export interface BuiltWorld {
  /** Everything the world drew. The app adds it to the scene. */
  root: THREE.Object3D;
  layout: WorldLayout;
  /** Meshes the captain stands on and collides with (merged into a BVH by the kit). */
  colliders: THREE.Object3D[];
  interactables: Interactable[];
  /**
   * Arrivals by air (the yacht's helicopter, the moon base's lander), as touchdown times (ms
   * since epoch, the server's crew.arrivesAt). The world flies one in for each time within
   * ARRIVAL's window (@offsite/contracts) and away again (planFlights, arrivals.ts, groups them);
   * it decides nothing else. Called whenever the crew list changes.
   */
  setArrivals(touchdowns: number[]): void;
  /**
   * Optional: how busy the ship is, 0 (everyone off duty) to 1 (the whole crew working). The world
   * eases toward it over a couple of seconds and shows it however it likes (the yacht: office and
   * bridge lights, the server room's core, the radar, the wake). Call it whenever it changes.
   */
  setBusy?(level: number): void;
  /**
   * Optional: the aircraft in the air or on the pad at `now`, each with its flight's touchdown and
   * lift-off times (ms) and the object that flies it, so the app can place their sound.
   */
  aircraft?(now: number): { object: THREE.Object3D; land: number; leave: number }[];
  /**
   * Optional: how the captain moves here (the controller's options: gravity, take-off speed…).
   * Absent: the kit's defaults, the yacht's. A world in low gravity jumps higher and floats down.
   */
  captain?: { gravity?: number; jump?: number; walk?: number; sprint?: number };
  /**
   * Optional: what the place sounds like, for the app's beds and one-shots. Absent: the yacht's
   * (the sea and a breeze, gulls and dolphins, helicopters). `aircraft: "none"` keeps arrivals silent.
   */
  soundscape?: { sea?: boolean; wildlife?: boolean; aircraft?: "helicopter" | "none" };
  /** Called every frame. now is ms since epoch (server-aligned), dt is seconds. */
  update(dt: number, now: number): void;
  dispose(): void;
}

export interface WorldModule {
  id: string;
  name: string;
  /** One line for the picker: "A superyacht off the coast, somewhere warm." */
  blurb: string;
  build(ctx: WorldContext): Promise<BuiltWorld>;
}
