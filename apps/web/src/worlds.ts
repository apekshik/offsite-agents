// The worlds a ship can be: one list for the world picker (screens/Gate.tsx) and, later, the game.
// The game builds a world from its module (src/game/Game.tsx has a WORLDS map from id to module;
// extend it when a world below lands). Flip `ready` when a world can be built and played, and add
// its id to convex/offices.ts's WORLDS so a ship can be made in it.

/** How a world says the few things the interface mentions about it. */
export interface WorldWords {
  /** How new crew arrive: "helicopter", "lander". */
  vehicle: string;
  /** Where it sets them down: "helipad", "landing pad". */
  pad: string;
  /** Where the helm (Computah's console) is: "on the bridge", "in the hub dome". */
  helm: string;
  /** Where finished work is carried: "to the bridge", "to the hub". */
  dropoff: string;
}

export interface WorldInfo {
  /** The id a ship stores (offices.world) and the game looks up. */
  id: string;
  name: string;
  /** One line for the picker. */
  blurb: string;
  /** A small picture for the picker (apps/web/public/worlds, 720×405 WebP). */
  art: string;
  /** Built and playable. Worlds that aren't show as coming soon and can't be picked. */
  ready: boolean;
  words: WorldWords;
}

export const WORLD_LIST: readonly WorldInfo[] = [
  {
    id: "yacht",
    name: "The Yacht",
    blurb: "A superyacht at sea: an office deck of desks, loungers, a pool and a bar, the bridge. New crew fly in by helicopter.",
    art: "/worlds/yacht.webp",
    ready: true,
    words: { vehicle: "helicopter", pad: "helipad", helm: "on the bridge", dropoff: "to the bridge" },
  },
  {
    id: "airship",
    name: "The Airship",
    blurb: "A steampunk airship above the clouds, with brass, propellers and a long glass gondola to work in.",
    art: "/worlds/airship.webp",
    ready: false,
    words: { vehicle: "gyrocopter", pad: "landing deck", helm: "in the wheelhouse", dropoff: "to the wheelhouse" },
  },
  {
    id: "moon-base",
    name: "Moon Base",
    blurb: "A base terraced into a crater, Earth over the rim: a work hall dug into the wall, a glass hub dome, a greenhouse, low-gravity hoops. New crew land by lander.",
    art: "/worlds/moon-base.webp",
    ready: true,
    words: { vehicle: "lander", pad: "landing pad", helm: "in the hub dome", dropoff: "to the hub" },
  },
  {
    id: "space-station",
    name: "Space Station",
    blurb: "Zero-g in orbit, the Earth turning below, desks on every wall and a docking port for arrivals.",
    art: "/worlds/space-station.webp",
    ready: false,
    words: { vehicle: "shuttle", pad: "docking port", helm: "on the command deck", dropoff: "to the command deck" },
  },
];

/** The world with this id, if there is one. */
export const worldInfo = (id: string): WorldInfo | undefined => WORLD_LIST.find((w) => w.id === id);

/** A world's name mid-sentence: "Moving to the Yacht", "Arriving at Moon Base". */
export const inSentence = (w: WorldInfo): string => w.name.replace(/^The /, "the ");

/** A ship's world (the yacht while it isn't known yet). */
export const worldOf = (id: string | null | undefined): WorldInfo => worldInfo(id ?? "") ?? WORLD_LIST[0]!;
