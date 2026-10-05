// The worlds a ship can be: one list for the world picker (screens/Gate.tsx) and, later, the game.
// The game builds a world from its module (src/game/Game.tsx has a WORLDS map from id to module;
// extend it when a world below lands). Flip `ready` when a world can be built and played, and add
// its id to convex/offices.ts's WORLDS so a ship can be made in it.

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
}

export const WORLD_LIST: readonly WorldInfo[] = [
  {
    id: "yacht",
    name: "The Yacht",
    blurb: "A superyacht at sea: an office deck of desks, loungers, a pool and a bar, the bridge. New crew fly in by helicopter.",
    art: "/worlds/yacht.webp",
    ready: true,
  },
  {
    id: "airship",
    name: "The Airship",
    blurb: "A steampunk airship above the clouds, with brass, propellers and a long glass gondola to work in.",
    art: "/worlds/airship.webp",
    ready: false,
  },
  {
    id: "moon-base",
    name: "Moon Base",
    blurb: "Domes on the Moon with Earth on the horizon, rovers out on the regolith and a lander pad for new crew.",
    art: "/worlds/moon-base.webp",
    ready: false,
  },
  {
    id: "space-station",
    name: "Space Station",
    blurb: "Zero-g in orbit, the Earth turning below, desks on every wall and a docking port for arrivals.",
    art: "/worlds/space-station.webp",
    ready: false,
  },
];

/** The world with this id, if there is one. */
export const worldInfo = (id: string): WorldInfo | undefined => WORLD_LIST.find((w) => w.id === id);
