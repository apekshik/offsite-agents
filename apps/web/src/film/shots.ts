import type { Blocking, CaptainSetup, FilmGroup, Shot, Still } from "./dsl.ts";
import { T } from "./story.ts";
import { dolly } from "./camera.ts";

// The launch film's shots and the README's pictures. Times in `ui` are seconds into the shot
// (negative: during the warm-up); `story` is the story second at the shot's first frame (story.ts T).
//
// The cut (60 s, assembled later; the terminal and end card are made outside the game):
//   0–5     arrival        the helicopter comes in out of the sunset; an aerial with room for a title
//   5–20    bar, hottub, pool, hammock, fishing, dolphins, gym, cards   off duty, a gag each
//   20–27   captain, typing                                 the captain on the sun deck asks for it
//   27–38   plan, scramble, core, hire, office              the plan, the run to the desks, a new hire
//   38–50   night-office, monitors, delivery, diff          night: at work, a package, the diff
// Shots carry a little more than the cut needs at each end; .shots/film/SHOTLOG.md has the in and
// out points.
//
// The off-duty life is the director's own (director.ts, crew.ts, banter.ts): staged here only so
// each shot knows who is where. A group's lines are banter.ts's, picked by the group's id.

const SUNSET = 19.0;
const NIGHT = 21.5;
const GOLDEN = 18.4;
/** Speech bubbles in the close off-duty shots: big enough to read at a glance on a phone. */
const BIG = 1.7;
/** The phone in the shots that are about what's on it: as large as the frame allows. */
const PHONE = 1.3;

// ---- who is where in the evening, off duty (the same in every shot, for continuity) ----

const EVENING: Record<string, Blocking> = {
  // Pike ("ops, infra, the bar") behind the round bar; the aft stools stay free for the captain's camera.
  pike: { slot: "bartender", group: "bar" },
  wren: { slot: "bar-stool-5", group: "bar" },
  nova: { slot: "bar-stool-7", group: "bar" },
  bodhi: { slot: "bar-stool-6", group: "bar" },
  kofi: { slot: "hot-tub-2", group: "tub" },
  marlo: { slot: "hot-tub-4", group: "tub" },
  ines: { slot: "hot-tub-6", group: "tub" },
  teo: { slot: "pool-5" },
  coral: { slot: "pool-4" },
  otis: { slot: "fishing-3" },
  lumi: { slot: "lounger-13", act: "nap" },
  juniper: { slot: "hammock-d2s35" },
  // Mira flies in at the start and takes up the bow rail, phone out.
  mira: { slot: "rail-bow-1", act: "selfie" },
  // Below decks, at the rail round Computah's core: she gets the first buzz down there.
  sable: { slot: "core-2", act: "rail" },
};

/** The bar's and the hot tub's talk (banter.ts), when a shot wants to hear it. */
const BAR: FilmGroup = { mood: "bar", id: "film-bar-10", round: 1, lineAt: 0.3 }; // "what'll it be?" "something with no merge conflicts"
const TUB: FilmGroup = { mood: "tub", id: "film-tub-9", round: 1, lineAt: 0.35 }; // "this is nice" "warmer than prod"

/** The captain on the sun deck, by the aft rail, the sunset over his left shoulder. */
const CAPTAIN_SUNDECK: CaptainSetup = { at: [-2.4, 14.2, 46.4], facing: -12, view: "third", pitch: 0.08, dist: 3.2 };
/** Out of the way (in the bridge's back corner) for shots that aren't about him. */
const CAPTAIN_AWAY: CaptainSetup = { at: [3.5, 18, -21.5], facing: 180, hidden: true };
/** On the bridge at night, by the drop-off counter, looking forward over the helm. */
const CAPTAIN_BRIDGE: CaptainSetup = { at: [-1.7, 18, -23.3], facing: 196, view: "third", pitch: 0.1, dist: 2.7 };

export const SHOTS: Shot[] = [
  // ---------------- 0–5 s: the arrival ----------------
  {
    name: "arrival", note: "0–5 s · Mira's helicopter comes in out of the sunset toward the bow; sky for a title",
    // A long lens high off the starboard bow follows the helicopter in out of the sunset, zooming
    // out as it comes: from above, it stays below the horizon (never across the sun's disc), and the
    // yacht slides into frame under it as it swings in to the pad.
    story: 9.5, duration: 7.5, hour: SUNSET - 0.1, stage: EVENING, captain: CAPTAIN_AWAY,
    camera: {
      dolly: [
        { pos: [14, 44, -112], at: [-30, 18, 40], fov: 22 },
        { pos: [8, 40, -104], at: [-30, 17, 40], fov: 36 },
      ],
      track: { object: "helicopter", up: 6 }, trackLag: 0.5,
    },
  },

  // ---------------- 5–20 s: off duty ----------------
  {
    name: "bar", note: "off duty · Pike tends the bar: \"what'll it be?\" \"something with no merge conflicts\"",
    bubbles: BIG, story: 30, duration: 5.2, hour: SUNSET, stage: EVENING, groups: { bar: BAR }, captain: CAPTAIN_AWAY,
    // From beside the stools, side on to Pike and Wren across the counter, the sun behind the camera.
    camera: { dolly: [{ pos: [-3.7, 15.55, 44.8], at: [-0.2, 15.8, 41.7], fov: 44 }, { pos: [-3.4, 15.53, 44.55], at: [-0.2, 15.8, 41.7], fov: 44 }] },
  },
  {
    name: "hottub", note: "off duty · the hot tub: \"this is nice\" \"warmer than prod\"",
    bubbles: BIG, story: 36, duration: 4.6, hour: SUNSET, stage: EVENING, groups: { tub: TUB }, captain: CAPTAIN_AWAY,
    // From forward of the tub, a little above: Kofi faces us, Marlo and Ines either side.
    camera: { dolly: [{ pos: [-6.2, 15.9, 38.7], at: [-6.0, 14.95, 42.7], fov: 48 }, { pos: [-6.15, 15.8, 39.1], at: [-6.0, 14.95, 42.7], fov: 48 }] },
  },
  {
    name: "pool", note: "off duty · Bodhi's cannonball into the pool; Teo and Coral get soaked",
    // Bodhi gets off his stool in the warm-up and goes for the pool: crew.ts's run-up, tuck and splash.
    bubbles: BIG, story: 58, duration: 5, warmup: 3, hour: SUNSET, captain: CAPTAIN_AWAY, focus: ["teo", "coral", "bodhi"],
    stage: { ...EVENING, bodhi: { slot: "deck-chair-sun-2" } },
    // From the pool's forward port corner, across the water to the deck chairs: he runs at us and jumps.
    camera: { dolly: [{ pos: [-6.6, 16.1, 25.4], at: [-0.4, 14.5, 30.6], fov: 46 }, { pos: [-6.4, 16.0, 25.9], at: [-0.4, 14.5, 30.6], fov: 46 }] },
    ui: [
      // Up off the deck chair, a few steps to the run-up beside it, and in between Teo and Coral.
      { at: -1.0, do: { stage: { bodhi: { slot: "pool-2" } } } },
      { at: 2.7, do: { say: "coral", text: "BODHI!", ms: 1800 } },
    ],
  },
  {
    name: "hammock", note: "off duty · Juniper asleep in a hammock, talking in her sleep",
    bubbles: BIG, story: 52, duration: 3.6, hour: SUNSET, stage: EVENING, captain: CAPTAIN_AWAY, focus: ["juniper"],
    camera: { orbit: { slot: "hammock-d2s35" }, radius: 3.3, height: 1.7, from: 138, to: 120, lookUp: 1.0, fov: 46 },
    ui: [{ at: 1.0, do: { say: "juniper", text: "…just ship it…", ms: 2300 } }],
  },
  {
    name: "fishing", note: "off duty · Otis reels one in off the stern: a boot. again.",
    // fishCycle (kit props.ts) for Otis: the reel in starts ~0.5 s in, the boot comes up at ~1.8 s.
    bubbles: BIG, story: 64, duration: 4.8, warmup: 34.2, hour: SUNSET, stage: EVENING, captain: CAPTAIN_AWAY, focus: ["otis"],
    // Off the starboard quarter, close: the rod, the line, and what comes up on it.
    camera: { dolly: [{ pos: [7.4, 2.45, 71.4], at: [4.4, 2.45, 68.2], fov: 42 }, { pos: [7.1, 2.5, 71.6], at: [4.4, 2.45, 68.2], fov: 42 }] },
  },
  {
    name: "dolphins", note: "off duty · dolphins leap alongside the bow; up on the rail Mira is busy with a selfie",
    story: 46.2, duration: 4, hour: SUNSET, stage: EVENING, captain: CAPTAIN_AWAY,
    // Low over the water off the port bow, looking forward along the hull: the leaps in front, Mira on the rail above.
    camera: { dolly: [{ pos: [-31, 4.0, -22], at: [-17, 4.6, -39], fov: 46 }, { pos: [-31.4, 4.3, -23.2], at: [-17, 4.8, -39], fov: 46 }] },
  },
  {
    name: "gym", note: "off duty · below decks in the gym: a treadmill and curls, \"is it DNS?\" \"it's always DNS\"",
    bubbles: BIG, story: 75, duration: 4.4, hour: SUNSET, captain: CAPTAIN_AWAY,
    stage: { ...EVENING, lumi: { slot: "treadmill-2", group: "gym" }, bodhi: { slot: "weight-bench", group: "gym" } },
    groups: { gym: { mood: "chat", id: "film-chat-116", lineAt: 0.3 } },
    // From aft in the gym: Bodhi faces us on the bench, Lumi runs side on at the window.
    camera: { dolly: [{ pos: [6.6, 2.6, 30.2], at: [7.4, 1.7, 25.2], fov: 52 }, { pos: [6.5, 2.5, 29.8], at: [7.4, 1.7, 25.2], fov: 52 }] },
  },
  {
    name: "cards", note: "off duty · cards in the beach club: \"did you write tests?\" \"I wrote a test\" \"singular?\"",
    bubbles: BIG, story: 84, duration: 6, hour: SUNSET, captain: CAPTAIN_AWAY,
    stage: {
      ...EVENING,
      teo: { slot: "beach-sofa-1", act: "cards", group: "cards" }, coral: { slot: "beach-sofa-2", act: "cards", group: "cards" },
      juniper: { slot: "beach-armchair-p", act: "cards", group: "cards" }, lumi: { slot: "beach-armchair-s", act: "cards", group: "cards" },
    },
    groups: { cards: { mood: "cards", id: "film-cards-0", lineAt: 0.2 } },
    // Side on to the table from starboard and a little above, so no one has their back to us.
    camera: { dolly: [{ pos: [4.9, 3.25, 53.4], at: [-0.1, 1.85, 53.75], fov: 44 }, { pos: [4.7, 3.2, 53.9], at: [-0.1, 1.85, 53.75], fov: 44 }] },
  },

  // ---------------- 20–27 s: the captain asks ----------------
  {
    name: "captain", note: "20–23 s · the captain on the sun deck takes out the phone",
    story: T.phoneOut - 1.2, duration: 3, hour: SUNSET + 0.05, stage: EVENING, captain: CAPTAIN_SUNDECK, phoneUi: false,
    // Off the stern, above the rail so the phone coming out isn't behind it.
    camera: { dolly: [{ pos: [-1.0, 16.05, 49.6], at: [-2.5, 15.3, 46.4], fov: 40 }, { pos: [-1.3, 16.1, 49.0], at: [-2.5, 15.35, 46.4], fov: 40 }] },
    ui: [{ at: 1.2, do: { phone: "cover" } }],
  },
  {
    name: "typing", note: "23–27 s · unfolds it, types the request, sends it",
    phoneScale: PHONE, story: T.unfold - 0.4, duration: T.send - T.unfold + 0.9, hour: SUNSET + 0.05, stage: EVENING, captain: CAPTAIN_SUNDECK,
    camera: { captain: true },
    ui: [
      { at: -1.9, do: { phone: "cover" } },
      { at: 0.4, do: { phone: "open" } },
      { at: T.typeFrom - T.unfold + 0.4, do: { type: "Add dark mode and a billing page", cps: 11 } },
      { at: T.send - T.unfold + 0.42, do: { send: true } },
    ],
  },

  // ---------------- 27–38 s: the plan, the scramble, the hire ----------------
  {
    name: "plan", note: "27–31 s · Computah reads the repos, replies, and its plan appears",
    phoneScale: PHONE, story: T.send + 0.3, duration: T.plan - T.send + 1.6, hour: SUNSET + 0.05, stage: EVENING, captain: CAPTAIN_SUNDECK,
    camera: { captain: true },
    ui: [{ at: -1.9, do: { phone: "cover" } }, { at: -1.5, do: { phone: "open" } }, { at: -0.2, do: { thread: "dark" } }],
  },
  {
    name: "scramble", note: "31–35 s · phones buzz: drinks down, out of the hot tub, a run for the desks",
    story: T.scramble - 0.6, duration: 5, hour: SUNSET + 0.08, stage: EVENING, captain: CAPTAIN_SUNDECK,
    camera: { dolly: [{ pos: [-14, 22.5, 58], at: [0, 14.5, 36], fov: 50 }, { pos: [-16, 26, 50], at: [0, 13.5, 26], fov: 50 }], ease: "gentle" },
  },
  {
    name: "core", note: "32–34 s · below decks, Sable at the glowing core: her phone buzzes and she's off",
    bubbles: BIG, story: T.scramble + 0.6, duration: 4, hour: SUNSET + 0.08, stage: EVENING, captain: CAPTAIN_AWAY, focus: ["sable"],
    // In front of her and to her left, the column of light beside her: her face as the phone buzzes.
    camera: { dolly: [{ pos: [-3.5, 2.35, -13.1], at: [0.4, 2.0, -12.4], fov: 50 }, { pos: [-3.3, 2.35, -12.7], at: [0.4, 2.0, -12.4], fov: 50 }] },
  },
  {
    name: "hire", note: "33–36 s · Ezra, the new hire, lands on the helipad",
    bubbles: BIG, story: T.ezraLands - 3.2, duration: 6.5, hour: SUNSET + 0.1, stage: EVENING, captain: CAPTAIN_AWAY,
    // From the starboard bow, clear of the bridge deck's overhang: it slides in over the pad and settles.
    camera: { dolly: [{ pos: [13.5, 13.9, -44.5], at: [0, 12.6, -53.5], fov: 46 }, { pos: [12.8, 13.5, -45.5], at: [0, 12.2, -53], fov: 46 }] },
    // Ezra steps out 1.8 s after touchdown.
  },
  {
    name: "office", note: "35–38 s · the crew come in from the decks and sit down; the screens wake",
    // From the bar, the hot tub and the core they reach their desks between ~146 (Nova runs down the
    // aisle, Marlo and Wren) and ~152 (Sable); Otis, from the stern, at ~158. If that changes, find it with
    // pnpm film office --peek --story 132 --warmup 6 --duration 28 --where 0,4,8,12,16,20,24
    // The warm-up starts before the scramble, so they walk here (anyone at work when a shot loads is just seated).
    story: 144.5, duration: 6, warmup: 144.5 - T.scramble + 1.3, hour: SUNSET + 0.1, stage: EVENING, captain: CAPTAIN_AWAY,
    // From the aft end, down the middle aisle to the wall board.
    camera: { dolly: [{ pos: [0.3, 12.4, 9.5], at: [2.2, 10.9, -6], fov: 50 }, { pos: [0.3, 12.2, 8.2], at: [2.2, 10.9, -6], fov: 50 }] },
  },

  // ---------------- 38–50 s: night ----------------
  {
    name: "night-office", note: "38–42 s · night: the office deck lit, everyone at work",
    story: T.night + 2, duration: 4, hour: NIGHT, captain: CAPTAIN_AWAY,
    // From above the office floor, so its deck edge hides the lit cabins on the deck below.
    camera: { dolly: [{ pos: [-26, 17.2, -24], at: [-4, 12.4, -9], fov: 42 }, { pos: [-26, 16.6, 4], at: [-4, 12.4, -7], fov: 42 }], ease: "gentle" },
  },
  {
    name: "monitors", note: "42–45 s · over a shoulder: code on the monitor",
    story: T.night + 6, duration: 3, hour: NIGHT, captain: CAPTAIN_AWAY,
    // Over Wren's right shoulder, at whichever desk she has.
    camera: { follow: "wren", offset: [0.6, 1.68, -0.1], lookAhead: 1.0, lookUp: 1.0, fov: 40, lag: 0.3 },
  },
  {
    name: "delivery", note: "45–48 s · Otis brings his package up to the bridge and sets it on the counter",
    // He finishes at his desk at T.otisLands and walks the package up through the office and over the
    // canopy deck: in at the bridge door at ~9068, at the counter at ~T.otisDelivers, celebrating for 6 s. Check with
    // pnpm film delivery --peek --story 9050 --warmup 40 --duration 30 --where 0,3,6,9,12,15,18,21,24,27
    story: T.otisDelivers - 4.5, duration: 7.5, warmup: T.otisDelivers - 4.5 - T.otisLands + 2, hour: NIGHT, captain: CAPTAIN_AWAY,
    camera: { dolly: [{ pos: [-0.2, 19.7, -26.4], at: [-2.0, 18.9, -21.0], fov: 52 }, { pos: [-0.8, 19.6, -26.0], at: [-3.0, 18.8, -21.8], fov: 52 }], track: { crew: "otis", up: 1.0 }, trackLag: 0.6 },
  },
  {
    name: "diff", note: "48–50 s · on the bridge, the captain opens Otis's changes on the phone",
    phoneScale: PHONE, story: T.otisDelivers + 8, duration: 4, hour: NIGHT, captain: CAPTAIN_BRIDGE,
    camera: { captain: true },
    ui: [{ at: 0.5, do: { review: { thread: "dark", task: "sweep" } } }],
  },
];

// ---------------- the README's pictures ----------------

const still = (s: Omit<Still, "duration"> & { duration?: number }): Still => ({ duration: 1 / 60, ...s });

/** The README's "life on board" pictures: shown two to a row, so their bubbles are drawn larger still. */
const LIFE: Pick<Shot, "size" | "bubbles"> = { size: [1600, 900], bubbles: 2.1 };

/**
 * One frame of a clip, `t` seconds in, as a still: the same story time, staging, talk and camera
 * (a dolly held where it is at that frame), so the picture is the moment in the film. `s` overrides
 * anything, the camera included, to frame it closer.
 */
function frameOf(clip: string, t: number, s: Pick<Still, "name" | "file" | "note"> & Partial<Shot>): Still {
  const shot = SHOTS.find((x) => x.name === clip);
  if (!shot) throw new Error(`No shot called ${clip}`);
  const cam = shot.camera;
  const camera: Shot["camera"] = "dolly" in cam && !cam.track ? { hold: dolly(cam.dolly, t / shot.duration, cam.ease) } : cam;
  const groups = shot.groups && Object.fromEntries(Object.entries(shot.groups).map(([k, g]) => [k, { ...g, lineAt: g.lineAt - t }]));
  const ui = shot.ui?.map((a) => ({ ...a, at: a.at - t }));
  return still({ ...shot, ...LIFE, duration: 1 / 60, story: shot.story + t, warmup: (shot.warmup ?? 2) + t, camera, groups, ui, ...s });
}

const GALLERY_VIEWS: { name: string; pose: { pos: [number, number, number]; at: [number, number, number]; fov: number } }[] = [
  { name: "aerial", pose: { pos: [-118, 112, 52], at: [0, 6, 2], fov: 50 } },
  { name: "stern", pose: { pos: [26, 12, 100], at: [0, 9, 45], fov: 45 } },
  { name: "sundeck", pose: { pos: [-15, 23.5, 60], at: [0, 14.5, 33], fov: 50 } },
  { name: "office", pose: { pos: [-22, 14, -20], at: [-2, 11.2, -8], fov: 45 } },
];

export const STILLS: Still[] = [
  still({ name: "hero", file: "hero.png", note: "the yacht at golden hour", story: 60, hour: GOLDEN, stage: EVENING, camera: { hold: { pos: [-62, 30, -98], at: [2, 8, -6], fov: 40 } } }),
  still({ name: "hero-2x", file: "hero@2x.png", note: "the hero at twice the size", size: [3840, 2160], story: 60, hour: GOLDEN, stage: EVENING, camera: { hold: { pos: [-62, 30, -98], at: [2, 8, -6], fov: 40 } } }),

  // Life on board: the crew off duty and at work, a line each, under the README's title.
  frameOf("bar", 3.6, { name: "life-bar", file: "life-bar.png", note: "life · the bar: \"something with no merge conflicts\"" }),
  frameOf("hottub", 2.3, { name: "life-hottub", file: "life-hottub.png", note: "life · the hot tub: \"this is nice\" \"warmer than prod\"" }),
  frameOf("pool", 2.4, {
    name: "life-cannonball", file: "life-cannonball.png", note: "life · Bodhi's cannonball, mid-air",
    // Closer in on him in the air, Coral's shout to the right.
    camera: { hold: { pos: [-6.5, 16.05, 25.64], at: [-1.36, 16.17, 31.79], fov: 30 } },
    ui: [{ at: -3.4, do: { stage: { bodhi: { slot: "pool-2" } } } }, { at: -0.2, do: { say: "coral", text: "BODHI!", ms: 1800 } }],
  }),
  frameOf("gym", 2.2, { name: "life-gym", file: "life-gym.png", note: "life · the gym: \"is it DNS?\" \"it's always DNS\"" }),
  frameOf("scramble", 1.8, {
    name: "life-scramble", file: "life-scramble.png", note: "life · phones buzz: drinks down, out of the hot tub",
    // Closer than the clip's wide: the bar and the hot tub as the phones go off.
    camera: { hold: { pos: [-4.2, 17.6, 35.2], at: [-1.39, 15.14, 42.62], fov: 38 } },
  }),
  still({
    name: "life-night", file: "life-night.png", note: "life · the office at night: Otis about to land his sweep", story: T.otisLands - 2, hour: NIGHT, captain: CAPTAIN_AWAY, ...LIFE,
    focus: ["otis", "teo", "wren", "sable"],
    // From aft of the front desks: Otis and Teo at work under the office wall board.
    camera: { hold: { pos: [0.6, 12.1, -9.4], at: [-1.2, 11.3, -15.0], fov: 52 } },
    ui: [{ at: -0.8, do: { say: "otis", text: "green across the board", ms: 3000 } }],
  }),

  // How a thread plays out, in six steps.
  still({
    name: "thread-1-ask", file: "thread-1-ask.png", note: "1 · ask on the phone", story: T.send - 0.15, hour: SUNSET + 0.05, stage: EVENING, captain: CAPTAIN_SUNDECK, camera: { captain: true }, warmup: 4,
    ui: [{ at: -3.5, do: { phone: "cover" } }, { at: -3, do: { phone: "open" } }, { at: -2.8, do: { type: "Add dark mode and a billing page", cps: 20 } }],
  }),
  still({
    name: "thread-2-plan", file: "thread-2-plan.png", note: "2 · Computah plans", story: T.plan + 1.2, hour: SUNSET + 0.05, stage: EVENING, captain: CAPTAIN_SUNDECK, camera: { captain: true },
    ui: [{ at: -1.8, do: { phone: "cover" } }, { at: -1.5, do: { phone: "open" } }, { at: -1.4, do: { thread: "dark" } }],
  }),
  still({
    name: "thread-3-crew", file: "thread-3-crew.png", note: "3 · crew assigned, a hire by helicopter", story: T.ezraLands + 2.6, hour: SUNSET + 0.1, stage: EVENING, captain: CAPTAIN_AWAY, warmup: 6,
    camera: { hold: { pos: [7.2, 12.9, -37.2], at: [-0.5, 11.6, -50.5], fov: 46 } },
  }),
  still({
    name: "thread-4-work", file: "thread-4-work.png", note: "4 · the crew at work", story: T.night + 4, hour: NIGHT, captain: CAPTAIN_AWAY,
    camera: { hold: { pos: [0.6, 12.2, -21.5], at: [0, 11.0, -4], fov: 60 } },
  }),
  still({
    name: "thread-5-review", file: "thread-5-review.png", note: "5 · a package delivered, the diff reviewed", story: T.otisDelivers + 12, hour: NIGHT,
    captain: CAPTAIN_BRIDGE, camera: { captain: true },
    ui: [{ at: -1.5, do: { review: { thread: "dark", task: "sweep" } } }],
  }),
  still({
    name: "thread-6-pr", file: "thread-6-pr.png", note: "6 · finished, with a pull request in each repo", story: T.finished + 3, hour: NIGHT,
    captain: CAPTAIN_BRIDGE, camera: { captain: true },
    ui: [{ at: -1.8, do: { phone: "cover" } }, { at: -1.5, do: { phone: "open" } }, { at: -1.4, do: { thread: "dark" } }],
  }),

  // Meet the crew.
  still({
    name: "cast", file: "cast.png", note: "the crew, lined up on the helipad", story: 40, hour: GOLDEN, captain: CAPTAIN_AWAY, warmup: 1,
    lineup: { at: [0, 10.2, -50.5], facing: 0, spacing: 1.15, crew: ["wren", "otis", "kofi", "sable", "marlo", "nova", "juniper", "ines", "bodhi", "teo", "coral", "pike", "lumi", "mira"] },
    camera: { hold: { pos: [0, 11.9, -38.6], at: [0, 11.05, -50.5], fov: 50 } },
  }),

  // The yacht, at sunset and at night.
  ...GALLERY_VIEWS.flatMap((v) => [
    still({ name: `yacht-sunset-${v.name}`, file: `yacht-sunset-${v.name}.png`, note: `the yacht at sunset: ${v.name}`, story: 70, hour: SUNSET, stage: EVENING, captain: CAPTAIN_AWAY, camera: { hold: v.pose } }),
    still({ name: `yacht-night-${v.name}`, file: `yacht-night-${v.name}.png`, note: `the yacht at night: ${v.name}`, story: T.night + 8, hour: NIGHT, captain: CAPTAIN_AWAY, camera: { hold: v.pose } }),
  ]),

  // The interface.
  still({
    name: "phone", file: "phone.png", note: "the phone, open on the crew", story: T.night + 10, hour: NIGHT, captain: CAPTAIN_SUNDECK, camera: { captain: true },
    ui: [{ at: -1.8, do: { phone: "cover" } }, { at: -1.5, do: { tab: "crew", crew: "otis" } }],
  }),
  still({
    name: "helm", file: "helm.png", note: "the helm console, with a question waiting", story: T.sableAsks + 6, hour: NIGHT,
    captain: { at: [0, 18, -25.6], facing: 180, view: "third", pitch: 0.1, dist: 2.6 }, camera: { captain: true },
    ui: [{ at: -1.5, do: { helm: true } }, { at: -1.4, do: { thread: "dark" } }],
  }),
  still({
    name: "crew-card", file: "crew-card.png", note: "a crew card beside its crew member", story: T.night + 12, hour: NIGHT, hud: true, captain: CAPTAIN_AWAY,
    // In front of Wren and to her right, wherever she works; her card sits beside her.
    camera: { follow: "wren", offset: [1.6, 1.55, 2.6], lookAhead: 0, lookUp: 1.0, fov: 50, lag: 0 },
    ui: [{ at: -1, do: { crewCard: "wren" } }],
  }),
];
