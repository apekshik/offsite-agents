import type { Blocking, CaptainSetup, Shot, Still } from "./dsl.ts";
import { T } from "./story.ts";

// The launch film's shots and the README's pictures. Times in `ui` are seconds into the shot
// (negative: during the warm-up); `story` is the story second at the shot's first frame (story.ts T).
//
// The cut (60 s, assembled later; the terminal and end card are made outside the game):
//   0–5     arrival        the helicopter comes in at sunset; an aerial sweep with room for a title
//   5–20    bar, hottub, hammock, pool, fishing, dolphins   off duty
//   20–27   captain, typing                                 the captain on the sun deck asks for it
//   27–38   plan, scramble, hire, office                    the plan, a new hire, the run to the desks
//   38–50   night-office, monitors, delivery, diff          night: at work, a package, the diff
// Shots carry a little more than the cut needs at each end.

const SUNSET = 19.0;
const NIGHT = 21.5;
const GOLDEN = 18.4;

// ---- who is where in the evening, off duty (the same in every shot, for continuity) ----
// TODO(social-life): the director is learning groups, a bartender, cheers, naps, cannonballs and
// banter. As its acts land, swap them in here (or drop a blocking and let the director play).

const EVENING: Record<string, Blocking> = {
  // The bar's aft stools stay free: the captain's camera looks over them on the sun deck.
  wren: { slot: "bar-stool-6" },
  sable: { slot: "bar-stool-9" },
  bodhi: { slot: "bar-stool-7" },
  nova: { slot: "bar-stool-8" },
  kofi: { slot: "hot-tub-2" },
  marlo: { slot: "hot-tub-4" },
  ines: { slot: "hot-tub-6" },
  teo: { slot: "pool-2" },
  coral: { slot: "pool-4" },
  otis: { slot: "lounger-5" },
  lumi: { slot: "lounger-9" },
  juniper: { slot: "hammock-d2s35" },
  pike: { slot: "fishing-3" },
  mira: { slot: "rail-bow-3" },
};

/** The captain on the sun deck, by the aft rail, the sunset over his left shoulder. */
const CAPTAIN_SUNDECK: CaptainSetup = { at: [-2.4, 14.2, 46.4], facing: -12, view: "third", pitch: 0.08, dist: 3.2 };
/** Out of the way (in the bridge's back corner) for shots that aren't about him. */
const CAPTAIN_AWAY: CaptainSetup = { at: [3.5, 18, -21.5], facing: 180, hidden: true };

export const SHOTS: Shot[] = [
  // ---------------- 0–5 s: the arrival ----------------
  {
    name: "arrival", note: "0–5 s · the helicopter comes in at sunset, aerial sweep, room for a title",
    story: 9.8, duration: 5.5, hour: SUNSET, stage: EVENING, captain: CAPTAIN_SUNDECK,
    // Mira's helicopter comes in over the starboard bow; the sky above it is the title's.
    camera: {
      dolly: [
        { pos: [-74, 37, -4], at: [34, 24, -62], fov: 42 },
        { pos: [-56, 28, -26], at: [18, 15, -56], fov: 42 },
      ],
      ease: "gentle",
    },
  },

  // ---------------- 5–20 s: off duty ----------------
  {
    name: "bar", note: "off duty · drinks at the sun-deck bar, a toast",
    story: 30, duration: 3.5, hour: SUNSET, stage: EVENING, captain: CAPTAIN_AWAY, focus: ["wren", "bodhi", "nova", "sable"],
    camera: { dolly: [{ pos: [6.8, 15.35, 36.6], at: [0.8, 15.0, 42.4], fov: 46 }, { pos: [5.4, 15.25, 38.0], at: [0.8, 15.0, 42.4], fov: 46 }] },
    ui: [
      // TODO(social-life): a real cheers act (glasses up) when the director has one.
      { at: 0.4, do: { say: "nova", text: "to shipping on a friday!", ms: 2600 } },
      { at: 1.4, do: { say: "wren", text: "cheers 🥂", ms: 2000 } },
      { at: 1.7, do: { say: "bodhi", text: "cheers!", ms: 1800 } },
    ],
  },
  {
    name: "hottub", note: "off duty · banter in the hot tub",
    story: 36, duration: 3.5, hour: SUNSET, stage: EVENING, captain: CAPTAIN_AWAY, focus: ["kofi", "marlo", "ines"],
    camera: { dolly: [{ pos: [-9.4, 15.6, 46.6], at: [-6.0, 14.0, 42.6], fov: 48 }, { pos: [-8.7, 15.3, 45.6], at: [-6.0, 14.0, 42.6], fov: 48 }] },
    ui: [
      // TODO(social-life): the director's own banter (banter.ts) once the engine shows it; then drop these.
      { at: 0.2, do: { say: "kofi", text: "standup's at 9?", ms: 1600 } },
      { at: 1.3, do: { say: "marlo", text: "we're on a yacht", ms: 2200 } },
    ],
  },
  {
    name: "hammock", note: "off duty · a nap in a hammock on the promenade",
    story: 52, duration: 3, hour: SUNSET, stage: EVENING, captain: CAPTAIN_AWAY, focus: ["juniper"],
    // TODO(social-life): "nap-hammock" when the engine knows it.
    camera: { orbit: { slot: "hammock-d2s35" }, radius: 3.6, height: 1.6, from: 140, to: 115, lookUp: 0.7, fov: 42 },
    ui: [{ at: 0.6, do: { say: "juniper", text: "zzz", ms: 2200 } }],
  },
  {
    name: "pool", note: "off duty · the pool (cannonball to come)",
    story: 58, duration: 3, hour: SUNSET, stage: EVENING, captain: CAPTAIN_AWAY, focus: ["teo", "coral"],
    // TODO(social-life): Bodhi's cannonball, when there's an act for it.
    camera: { dolly: [{ pos: [-8.5, 15.0, 24.5], at: [-2.6, 14.2, 31.0], fov: 45 }, { pos: [-8.0, 15.4, 27.0], at: [-2.6, 14.2, 31.5], fov: 45 }] },
    ui: [{ at: 0.8, do: { say: "teo", text: "water's perfect", ms: 2000 } }],
  },
  {
    name: "fishing", note: "off duty · fishing off the stern, the wake behind",
    story: 64, duration: 3, hour: SUNSET, stage: EVENING, captain: CAPTAIN_AWAY,
    camera: { dolly: [{ pos: [10.5, 2.6, 75], at: [4.8, 2.0, 67.5], fov: 40 }, { pos: [9.0, 2.9, 77], at: [4.8, 2.0, 67.5], fov: 40 }] },
  },
  {
    name: "dolphins", note: "off duty · dolphins leap off the port bow; Mira watches from the rail",
    story: 46.2, duration: 4, hour: SUNSET, stage: EVENING, captain: CAPTAIN_AWAY,
    camera: { dolly: [{ pos: [-31, 3.6, -22], at: [-19, 1.6, -38], fov: 46 }, { pos: [-32, 4.2, -26], at: [-19, 2.0, -38], fov: 46 }] },
  },

  // ---------------- 20–27 s: the captain asks ----------------
  {
    name: "captain", note: "20–23 s · the captain on the sun deck takes out the phone",
    story: T.phoneOut - 1.2, duration: 3, hour: SUNSET + 0.05, stage: EVENING, captain: CAPTAIN_SUNDECK, phoneUi: false,
    camera: { dolly: [{ pos: [-1.0, 15.3, 49.6], at: [-2.5, 15.3, 46.4], fov: 40 }, { pos: [-1.3, 15.4, 49.0], at: [-2.5, 15.35, 46.4], fov: 40 }] },
    ui: [{ at: 1.2, do: { phone: "cover" } }],
  },
  {
    name: "typing", note: "23–27 s · unfolds it, types the request, sends it",
    story: T.unfold - 0.4, duration: T.send - T.unfold + 0.9, hour: SUNSET + 0.05, stage: EVENING, captain: CAPTAIN_SUNDECK,
    camera: { captain: true },
    ui: [
      { at: -1.9, do: { phone: "cover" } },
      { at: 0.4, do: { phone: "open" } },
      { at: T.typeFrom - T.unfold + 0.4, do: { type: "Add dark mode and a billing page", cps: 11 } },
      { at: T.send - T.unfold + 0.42, do: { send: true } },
    ],
  },

  // ---------------- 27–38 s: the plan, the hire, the scramble ----------------
  {
    name: "plan", note: "27–31 s · the computer reads the repos, replies, and its plan appears",
    story: T.send + 0.3, duration: T.plan - T.send + 1.6, hour: SUNSET + 0.05, stage: EVENING, captain: CAPTAIN_SUNDECK,
    camera: { captain: true },
    ui: [{ at: -1.9, do: { phone: "cover" } }, { at: -1.5, do: { phone: "open" } }, { at: -0.2, do: { thread: "dark" } }],
  },
  {
    name: "scramble", note: "31–35 s · phones buzz and the crew run for their desks",
    story: T.scramble - 0.6, duration: 5, hour: SUNSET + 0.08, stage: EVENING, captain: CAPTAIN_SUNDECK,
    camera: { dolly: [{ pos: [-14, 22.5, 58], at: [0, 14.5, 36], fov: 50 }, { pos: [-16, 26, 50], at: [0, 13.5, 26], fov: 50 }], ease: "gentle" },
  },
  {
    name: "hire", note: "33–36 s · Ezra, the new hire, lands on the helipad",
    story: T.ezraLands - 3.2, duration: 6.5, hour: SUNSET + 0.1, stage: EVENING, captain: CAPTAIN_AWAY,
    camera: { dolly: [{ pos: [9, 13.4, -35], at: [0, 13, -53], fov: 44 }, { pos: [7, 12.8, -37.5], at: [0, 12.2, -52], fov: 44 }], track: { object: "helicopter", up: 1 }, trackLag: 0.4 },
    // Ezra steps out 1.8 s after touchdown.
  },
  {
    name: "office", note: "35–38 s · the office fills up and the screens wake",
    // They sit down between ~146 and ~151 at the director's run. If that changes, find the moment with
    // pnpm film office --peek --story 132 --warmup 6 --duration 28 --where 0,4,8,12,16,20,24
    // The warm-up starts before the scramble, so they walk here (anyone at work when a shot loads is just seated).
    story: 145.5, duration: 5, warmup: 145.5 - T.scramble + 1.3, hour: SUNSET + 0.1, stage: EVENING, captain: CAPTAIN_AWAY,
    camera: { dolly: [{ pos: [0.6, 12.0, -21.0], at: [0, 11.2, -4], fov: 60 }, { pos: [0.4, 11.7, -19.2], at: [0, 11.1, -2], fov: 60 }] },
  },

  // ---------------- 38–50 s: night ----------------
  {
    name: "night-office", note: "38–42 s · night: the office deck lit, everyone at work",
    story: T.night + 2, duration: 4, hour: NIGHT, captain: CAPTAIN_AWAY,
    camera: { dolly: [{ pos: [-26, 14.5, -24], at: [-4, 11.0, -9], fov: 42 }, { pos: [-26, 13.5, 4], at: [-4, 11.0, -7], fov: 42 }], ease: "gentle" },
  },
  {
    name: "monitors", note: "42–45 s · over shoulders: code on the monitors",
    story: T.night + 6, duration: 3, hour: NIGHT, captain: CAPTAIN_AWAY,
    // Over Nova's right shoulder, at whichever desk she has.
    camera: { follow: "nova", offset: [0.8, 1.7, -0.45], lookAhead: 0.95, lookUp: 1.0, fov: 40, lag: 0.3 },
  },
  {
    name: "delivery", note: "45–48 s · packages on the counter; Otis brings another",
    // He finishes at his desk at T.otisLands and walks the package up to the bridge: ~55 s on the current walk.
    story: T.otisDelivers - 5, duration: 6, warmup: T.otisDelivers - 5 - T.otisLands + 2, hour: NIGHT, captain: CAPTAIN_AWAY,
    camera: { dolly: [{ pos: [-0.2, 19.7, -26.4], at: [-2.0, 18.9, -21.0], fov: 52 }, { pos: [-0.8, 19.6, -26.0], at: [-3.0, 18.8, -21.8], fov: 52 }], track: { crew: "otis", up: 1.0 }, trackLag: 0.6 },
  },
  {
    name: "diff", note: "48–50 s · the captain opens Otis's changes on the phone",
    story: T.otisDelivers + 8, duration: 4, hour: NIGHT,
    captain: { at: [-1.4, 18, -20.2], facing: 215, view: "third", pitch: 0.12, dist: 3.0 },
    camera: { captain: true },
    ui: [{ at: 0.3, do: { review: { thread: "dark", task: "sweep" } } }],
  },
];

// ---------------- the README's pictures ----------------

const still = (s: Omit<Still, "duration"> & { duration?: number }): Still => ({ duration: 1 / 60, ...s });

const GALLERY_VIEWS: { name: string; pose: { pos: [number, number, number]; at: [number, number, number]; fov: number } }[] = [
  { name: "aerial", pose: { pos: [-118, 112, 52], at: [0, 6, 2], fov: 50 } },
  { name: "stern", pose: { pos: [26, 12, 100], at: [0, 9, 45], fov: 45 } },
  { name: "sundeck", pose: { pos: [-15, 23.5, 60], at: [0, 14.5, 33], fov: 50 } },
  { name: "office", pose: { pos: [-22, 14, -20], at: [-2, 11.2, -8], fov: 45 } },
];

export const STILLS: Still[] = [
  still({ name: "hero", file: "hero.png", note: "the yacht at golden hour", story: 60, hour: GOLDEN, stage: EVENING, camera: { hold: { pos: [-62, 30, -98], at: [2, 8, -6], fov: 40 } } }),
  still({ name: "hero-2x", file: "hero@2x.png", note: "the hero at twice the size", size: [3840, 2160], story: 60, hour: GOLDEN, stage: EVENING, camera: { hold: { pos: [-62, 30, -98], at: [2, 8, -6], fov: 40 } } }),

  // How a thread plays out, in six steps.
  still({
    name: "thread-1-ask", file: "thread-1-ask.png", note: "1 · ask on the phone", story: T.send - 0.15, hour: SUNSET + 0.05, stage: EVENING, captain: CAPTAIN_SUNDECK, camera: { captain: true }, warmup: 4,
    ui: [{ at: -3.5, do: { phone: "cover" } }, { at: -3, do: { phone: "open" } }, { at: -2.8, do: { type: "Add dark mode and a billing page", cps: 20 } }],
  }),
  still({
    name: "thread-2-plan", file: "thread-2-plan.png", note: "2 · the computer plans", story: T.plan + 1.2, hour: SUNSET + 0.05, stage: EVENING, captain: CAPTAIN_SUNDECK, camera: { captain: true },
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
    captain: { at: [-1.4, 18, -20.2], facing: 215, view: "third", pitch: 0.12, dist: 3.0 }, camera: { captain: true },
    ui: [{ at: -1.5, do: { review: { thread: "dark", task: "sweep" } } }],
  }),
  still({
    name: "thread-6-pr", file: "thread-6-pr.png", note: "6 · finished, with a pull request in each repo", story: T.finished + 3, hour: NIGHT,
    captain: { at: [-1.4, 18, -20.2], facing: 215, view: "third", pitch: 0.12, dist: 3.0 }, camera: { captain: true },
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
