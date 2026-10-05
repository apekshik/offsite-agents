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
   * Helicopter arrivals, as touchdown times (ms since epoch, the server's crew.arrivesAt).
   * The world flies one in for each time within ARRIVAL's window (@offsite/contracts) and away
   * again; it decides nothing else. Called whenever the crew list changes.
   */
  setArrivals(touchdowns: number[]): void;
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
