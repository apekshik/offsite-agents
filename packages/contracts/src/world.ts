// What a world (the yacht, a Mars base, a space station…) must provide, as plain data. A world
// builds its own scene; Offsite only needs to know where things can happen. The director in the
// app fills these spots with crew by what they are doing, so any world that marks them works.

export type Vec3 = [number, number, number];

export type SlotKind =
  | "desk"          // a workstation: a chair and a screen; where focused work happens
  | "lounger"       // a sun lounger, usually under an umbrella: work on a laptop, or sunbathe
  | "hammock"
  | "deck-chair"
  | "bar-stool"
  | "pool"          // a spot in the water
  | "hot-tub"
  | "rail"          // leaning on the railing, looking out
  | "fishing"       // a rod off the stern
  | "gym"           // a treadmill, a bench, the weights: standing (or running) at it
  | "cinema"        // a bean bag in front of a film: sitting low, facing the screen
  | "sauna"         // a bench in the sauna: sitting
  | "workshop"      // tinkering with a jet ski or the tender: standing at it
  | "core"          // at the rail round the ship's computer core, watching it think
  | "helm"          // the bridge console: the ship's computer's big screen
  | "computer"      // where the ship's computer stands (its robot body)
  | "dropoff"       // where finished work is delivered: packages pile here
  | "helipad"       // where the helicopter lands
  | "crew-spawn"    // where a new crew member steps out of the helicopter
  | "captain-spawn";

export interface Slot {
  id: string;
  kind: SlotKind;
  /** Where a body stands (or the seat's floor point under the hips), in world metres. */
  pos: Vec3;
  /** Yaw in radians: the way the body faces (0 faces +z). */
  facing: number;
  /** Seat surface height above pos.y, when the body sits or lies here. */
  seat?: number;
  /** The id of the nav node nearest this slot; bodies walk the graph to it, then step onto pos. */
  nav: string;
  /** Free-form tags a world can use: "shade", "upper-deck", "office". */
  tags?: string[];
}

export interface NavNode {
  id: string;
  pos: Vec3;
}

/** Walkable paths: nodes, and undirected edges between nodes that can see each other on foot. */
export interface NavGraph {
  nodes: NavNode[];
  edges: [string, string][];
}

/** Places where a ping or a label might sit above something. */
export interface WorldLayout {
  slots: Slot[];
  nav: NavGraph;
}

/** Which kinds of spot suit each activity, best first. The director picks a free one. */
export const ACTIVITY_SPOTS = {
  arriving: ["crew-spawn"],
  idle: ["lounger", "pool", "bar-stool", "hammock", "fishing", "rail", "hot-tub", "deck-chair", "gym", "cinema", "sauna", "workshop", "core"],
  thinking: ["desk", "rail", "deck-chair", "lounger"],
  reading: ["hammock", "lounger", "desk", "deck-chair"],
  searching: ["desk", "lounger"],
  editing: ["desk", "lounger"],
  running: ["lounger", "deck-chair", "desk"],
  browsing: ["lounger", "desk", "hammock"],
  delegating: ["desk", "helm", "core"],
  asking: [], // walks to the captain, wherever they are
  landed: ["dropoff"],
  failed: ["desk", "rail"],
} as const satisfies Record<string, readonly SlotKind[]>;
