// The yacht's dimensions, in metres. The bow points to -z, starboard is +x, the waterline is y = 0.
// Laid out after the concept art (docs/art/yacht): a helipad on the bow's foredeck, the bridge
// stacked behind it under a mast with two radomes, a double-height glass office midship with a
// canopy deck on its roof, the sun deck aft (pool, hot tub, loungers, a round bar), promenades
// down both sides, terraces stepping back to a swim platform at the stern.

export const BOW = -70; // the stem's tip at the foredeck
export const TRANSOM = 62;
export const PLATFORM = { z0: 62, z1: 68.6, w: 9.2, y: 1.0 }; // the swim platform
export const BEAM = 12.8; // half the hull's width: 25.6 m, room for real side decks

// Deck levels: the floor's top surface.
export const D1 = 5.6; // promenades along the sides, terraces aft
export const D2 = 10.2; // the foredeck and helipad, the office, the aft promenades
export const D3 = 14.2; // the sun deck aft; a tier of the bridge house forward
export const D4 = 18.0; // the office's roof (the canopy deck), and the bridge
export const D5 = 21.6; // the bridge's roof: mast and radomes
export const SLAB = 0.62; // floor thickness: the white fascia round each deck's edge

export const PAD = { x: 0, z: -52.5, r: 8.0 };

/** The lower deck, inside the hull at the swim platform's height, and its ceiling under D1. */
export const LD = PLATFORM.y;
export const LD_CEIL = D1 - SLAB;
/** The beach club's openings in the transom, either side of the stair well (x is the starboard one's). */
export const STERN_DOOR = { x0: 4.0, x1: 10.6, top: 4.55 }; // the helipad, on the foredeck at D2

// Where things are along the ship.
// The office's glass stands well in from the hull: a 4 m side deck runs down each side of it.
export const OFFICE = { z0: -22, z1: 15, glass: 8.2, edge: 12.45 };
export const SUN = { z0: 15, z1: 48.6, w: 11.6 }; // the sun deck at D3
export const CANOPY = { z0: -21, z1: 15, w: 11.6 }; // the canopy deck at D4, shading the side decks
export const BRIDGE = { z0: -31.6, z1: -21, w: 6.9 }; // the bridge house at D4

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Height of the hull's top edge (its sheer): high over the foredeck, stepping down to the promenades. */
export function hullTop(z: number): number {
  const fore = D2 + 0.32 + 0.9 * Math.max(0, (-40 - z) / 30) ** 2;
  const aft = D1 + 0.34;
  return aft + (fore - aft) * (1 - smooth(-41, -33, z));
}

/** The hull's half-width at deck level along its length: a full, flared bow, parallel sides, a slight taper aft. */
export function deckHalfBeam(z: number): number {
  if (z < BOW) return 0;
  if (z < -26) {
    const t = (-26 - z) / (-26 - BOW);
    return BEAM * Math.pow(Math.max(0, 1 - Math.pow(t, 2.4)), 0.6);
  }
  if (z > 40) return BEAM * (1 - 0.05 * ((Math.min(z, TRANSOM) - 40) / (TRANSOM - 40)) ** 2);
  return BEAM;
}

const TOP_AT_BOW = hullTop(BOW);
/** Where the stem is at height y: raked forward, so the bow overhangs the water. */
export function stemZ(y: number): number {
  return y >= 0 ? BOW + (TOP_AT_BOW - y) * 0.62 : BOW + TOP_AT_BOW * 0.62 - y * 0.3;
}
/** The height of the stem at z (the inverse of stemZ), or the keel's depth aft of the forefoot. */
export function stemY(z: number): number {
  const z0 = stemZ(0);
  if (z <= z0) return TOP_AT_BOW - (z - BOW) / 0.62;
  return Math.max(KEEL, -(z - z0) / 0.3);
}
export const KEEL = -3.2; // the hull is drawn down to here (the sea is opaque below)

/** The hull's half-width at (z, y): the deck's planform, fined toward the stem below it, flared above the water. */
export function halfBeam(z: number, y: number): number {
  const zs = stemZ(y);
  if (z <= zs) return 0;
  let zr = z;
  if (z < -26) zr = BOW + ((z - zs) * (-26 - BOW)) / (-26 - zs);
  let f = 1;
  if (y < 5) f = 1 - 0.07 * Math.pow(Math.min(1, (5 - y) / 5), 1.6);
  if (y < 0) f *= Math.pow(Math.max(0, 1 - (y / (KEEL - 0.4)) ** 2), 0.35);
  return deckHalfBeam(zr) * f;
}

/** The hull's outline at the waterline, for the sea (wake, foam, reflections). */
export const WATERLINE = {
  bow: stemZ(0),
  stern: PLATFORM.z1,
  halfBeam: (z: number) => (z > TRANSOM ? PLATFORM.w : halfBeam(z, 0)),
  top: (z: number) => (z > TRANSOM ? PLATFORM.y : hullTop(z)),
};
