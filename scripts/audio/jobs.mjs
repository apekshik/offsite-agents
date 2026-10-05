// Every sound and piece of music Offsite generates on fal.ai: the model, the exact input, and why.
// scripts/audio/generate.mjs runs these (each once: results are cached in scripts/audio/.cache,
// git-ignored), scripts/audio/build.mjs turns the cache into the game's and the video's files, and
// writes assets/audio/CREDITS.md from this list.
//
// Models (checked on fal.ai, October 2026; each page marks the model "Commercial use"):
//   fal-ai/elevenlabs/sound-effects/v2   $0.002 per second   ElevenLabs, via fal
//   fal-ai/elevenlabs/music              $0.60 per minute (rounded up)   ElevenLabs Eleven Music, via fal
//   fal-ai/stable-audio-25/text-to-audio $0.20 per clip      Stability AI Stable Audio 2.5, via fal

export const SFX = "fal-ai/elevenlabs/sound-effects/v2";
export const MUSIC = "fal-ai/elevenlabs/music";
export const STABLE = "fal-ai/stable-audio-25/text-to-audio";

export const LICENSES = {
  [SFX]: "ElevenLabs Sound Effects v2 via fal.ai. fal's model page marks it \"Commercial use\"; generated output may be used commercially under fal's Terms of Service and ElevenLabs' terms for API output.",
  [MUSIC]: "ElevenLabs Eleven Music via fal.ai. fal's model page marks it \"Commercial use\" (a fal partner model). ElevenLabs says Eleven Music is trained on licensed material and cleared for commercial use, including advertising, social video and games. Note: ElevenLabs' own self-serve music terms exclude film, broadcast TV and studio (AAA) games, which need enterprise terms; a marketing video and an open-source browser game fall outside that exclusion.",
  [STABLE]: "Stability AI Stable Audio 2.5 via fal.ai. fal's model page marks it \"Commercial use\"; Stability AI describes Stable Audio 2.5 as trained on a fully licensed dataset and commercially safe. Used only for a candidate soundtrack take that was not picked; no shipped file uses it.",
};

const NO_VOX = ["vocals", "lyrics", "singing", "rap", "spoken word", "choir"];
const fx = (id, text, seconds, { loop = false, influence = 0.5, group } = {}) => ({
  id, group, endpoint: SFX, loop,
  input: { text, duration_seconds: seconds, prompt_influence: influence, loop, output_format: "pcm_44100" },
});

// ---------- the launch video's soundtrack: 60 s, a drop at 27 s ----------
// Sections: goofing off (0-20), the calm before (20-27), the scramble (27-38), the night shift
// (38-56), the ending (56-60). Eleven Music's composition plan holds each section to its length.

const plan = (positive, sections) => ({
  composition_plan: {
    positive_global_styles: positive,
    negative_global_styles: [...NO_VOX, "distorted guitar", "heavy metal"],
    sections: sections.map(([section_name, duration_ms, positive_local_styles, negative_local_styles = []]) => ({
      section_name, duration_ms, positive_local_styles, negative_local_styles, lines: [],
    })),
  },
  respect_sections_durations: true,
  output_format: "pcm_44100",
});

export const SOUNDTRACK = [
  {
    id: "take-a-sundeck-house",
    group: "soundtrack",
    endpoint: MUSIC,
    title: "Sundeck House",
    input: plan(["tropical house", "instrumental", "steel drums", "marimba", "plucked synths", "warm sub bass", "sunny", "playful", "polished modern production", "118 bpm"], [
      ["Sunny goofing off", 20000, ["laid-back tropical house groove", "playful marimba and steel drum melody", "light shakers and finger snaps", "whistling synth lead", "carefree and a little silly"], ["big build-up", "heavy drums"]],
      ["Calm before", 7000, ["the groove thins out to marimba and bass", "a soft riser hints something is about to happen"], ["drop", "loud drums"]],
      ["Phones buzz", 11000, ["opens with a sharp vinyl record scratch and a sudden beat drop", "energetic four-on-the-floor kick", "rising synth arpeggios", "snare roll build", "urgent but fun scramble"], ["slow tempo"]],
      ["Night shift groove", 18000, ["warm confident deep house groove", "lush electric piano chords", "round bass", "smooth and focused late-night feel"], ["riser", "chaotic"]],
      ["Ending", 4000, ["the groove resolves on a final warm chord", "short reverb tail", "clean ending"], ["new melody", "abrupt cut"]],
    ]),
  },
  {
    id: "take-b-lofi-lagoon",
    group: "soundtrack",
    endpoint: MUSIC,
    title: "Lo-fi Lagoon",
    input: plan(["lo-fi hip hop", "instrumental", "ukulele", "vinyl crackle", "dusty drums", "warm", "playful", "sunny", "90 bpm"], [
      ["Lazy afternoon", 20000, ["laid-back lo-fi beat", "plucky ukulele melody", "playful kalimba hits", "soft vinyl crackle", "sunny and goofy"], ["big build-up"]],
      ["Something's coming", 7000, ["beat drops out to ukulele and a low hum", "a gentle tension swell"], ["drums"]],
      ["Scramble", 11000, ["starts with a loud vinyl record scratch", "punchy boom-bap drums kick back in harder", "funky bass line", "horn stabs", "energy keeps rising"], ["slow"]],
      ["Working late", 18000, ["smooth neo-soul groove", "Rhodes electric piano", "deep warm bass", "brushed snare", "confident and calm night feel"], ["chaotic"]],
      ["Ending", 4000, ["a final Rhodes chord that rings out", "clean ending"], ["abrupt cut"]],
    ]),
  },
  {
    id: "take-c-yacht-disco",
    group: "soundtrack",
    endpoint: MUSIC,
    title: "Yacht Disco",
    input: plan(["nu-disco", "instrumental", "funky slap bass", "bongos", "clavinet", "string stabs", "sunny", "playful", "112 bpm"], [
      ["Pool party", 20000, ["breezy nu-disco groove", "bongos and congas", "playful clavinet riff", "bright guitar licks", "cheeky and fun"], ["huge drop"]],
      ["Hold on", 7000, ["the band drops to bass and bongos", "a filter sweep rises"], ["full drums"]],
      ["All hands", 11000, ["a tape-stop and vinyl scratch, then a big disco drop", "driving four-on-the-floor", "sweeping strings", "rising energy"], ["slow"]],
      ["Night cruise", 18000, ["filtered French house groove", "warm analog pads", "confident bass", "sleek nighttime vibe"], ["chaotic"]],
      ["Ending", 4000, ["a final stab and a string swell that resolves", "clean ending"], ["abrupt cut"]],
    ]),
  },
  // Take D is stitched in build.mjs from three Stable Audio 2.5 sections and a record scratch.
  { id: "take-d-part1-sunny", group: "soundtrack-parts", endpoint: STABLE, input: { prompt: "Sunny laid-back tropical house instrumental, playful marimba and steel drum melody, light shakers, warm sub bass, carefree and a little silly, 118 BPM, no vocals", seconds_total: 29, num_inference_steps: 8, guidance_scale: 1, seed: 4127 } },
  { id: "take-d-part2-scramble", group: "soundtrack-parts", endpoint: STABLE, input: { prompt: "Energetic tropical house drop instrumental, driving four-on-the-floor kick, rising synth arpeggios, snare roll build, urgent but fun, 118 BPM, no vocals", seconds_total: 13, num_inference_steps: 8, guidance_scale: 1, seed: 4128 } },
  { id: "take-d-part3-night", group: "soundtrack-parts", endpoint: STABLE, input: { prompt: "Warm confident deep house night groove instrumental, lush electric piano chords, round bass, smooth steady beat, ends on a final chord with a clean ending, 118 BPM, no vocals", seconds_total: 23, num_inference_steps: 8, guidance_scale: 1, seed: 4129 } },
];

// ---------- the game: music for the sun-deck bar ----------

export const BAR_MUSIC = {
  id: "bar-lounge",
  group: "music",
  endpoint: MUSIC,
  loop: true,
  input: {
    prompt: "Tropical lounge music for a superyacht's sun-deck bar: a relaxed bossa nova meets chill house groove, nylon-string guitar, soft steel drums, vibraphone, brushed percussion, warm round bass, 100 BPM. Steady, even energy the whole way through, no intro build, no big drop and no ending, so it loops. Instrumental only.",
    music_length_ms: 90000,
    force_instrumental: true,
    output_format: "pcm_44100",
  },
};

// ---------- sound effects ----------

export const EFFECTS = [
  // ambience
  fx("ocean-hull", "Gentle ocean waves washing and lapping against the hull of a large yacht at sea, steady calm water, close stereo ambience, no music, no voices", 20, { loop: true, group: "ambience" }),
  fx("wind-deck", "Soft steady sea breeze across the open deck of a ship, gentle wind gusts, faint flapping of canvas, no water, no voices", 20, { loop: true, group: "ambience" }),
  fx("night-sea", "Night on a yacht at sea: soft gentle waves lapping the hull, distant halyards and rigging clinking softly against a mast in a light breeze, calm and quiet, no insects, no crickets, no birds", 20, { loop: true, group: "ambience" }),
  fx("gull-1", "A single seagull calling overhead, two or three cries, outdoors by the sea, clean, no waves", 3, { group: "ambience", influence: 0.6 }),
  fx("gull-2", "Two seagulls squawking back and forth in the distance over open water", 3, { group: "ambience", influence: 0.6 }),
  fx("gull-3", "A herring gull's long laughing call, outdoors by the sea", 3, { group: "ambience", influence: 0.6 }),
  fx("gull-4", "A seagull's short squawk as it flies past close by", 2, { group: "ambience", influence: 0.6 }),
  fx("dolphin-splash", "A dolphin leaps out of the sea and dives back in nearby: one clean splash with a short spray of water", 3, { group: "ambience", influence: 0.6 }),
  // helicopter (approach is ARRIVAL.approachMs long)
  fx("heli-approach", "A helicopter approaching from far away over the sea, getting steadily louder as it arrives, slowing into a loud close hover, realistic rotor thump", 14, { group: "helicopter" }),
  fx("heli-idle", "A helicopter idling on a helipad with its rotors turning, steady turbine whine and soft rotor whoosh, constant level", 10, { loop: true, group: "helicopter" }),
  fx("heli-takeoff", "A helicopter on a helipad spooling up and taking off, rotors speeding up, lifting off and flying away into the distance until faint", 10, { group: "helicopter" }),
  fx("heli-rotor", "Steady helicopter rotor blades chopping in flight, constant thump of the main rotor with turbine hum, close, no doppler", 8, { loop: true, group: "helicopter" }),
  fx("heli-flyover", "A helicopter flying fast overhead from left to right, a dramatic flyover with doppler, loud thumping rotor that passes and fades away", 8, { group: "helicopter" }),
  // the bar and the pool
  fx("clink-cheers", "Two cocktail glasses clinking together and a few friends cheerfully saying cheers at an outdoor bar", 3, { group: "bar" }),
  fx("ice-glass", "Ice cubes dropping into a glass and a drink poured over them, close-up, crisp", 2.5, { group: "bar", influence: 0.6 }),
  fx("cannonball", "Someone does a cannonball jump into a swimming pool: a big splash, then the water settling", 3, { group: "bar", influence: 0.6 }),
  fx("hot-tub", "An outdoor hot tub: steady bubbling jets and gentle churning water, close, constant level, no voices", 12, { loop: true, group: "bar" }),
  fx("pool-swim", "A person swimming gentle laps in an outdoor swimming pool, soft rhythmic water splashes and lapping", 12, { loop: true, group: "bar" }),
  // the phone
  fx("phone-buzz", "A smartphone vibrating on a wooden table: two short buzzes, close-up, dry, no ringtone", 1.5, { group: "phone", influence: 0.6 }),
  fx("fold-open", "A foldable smartphone unfolding open with a crisp satisfying hinge click, close-up, very short", 0.6, { group: "phone", influence: 0.6 }),
  fx("fold-close", "A foldable smartphone snapping shut, a soft magnetic clack, close-up, very short", 0.6, { group: "phone", influence: 0.6 }),
  fx("send-tick", "A soft, subtle user-interface tick for sending a message, a gentle muted wooden click, very short and clean", 0.5, { group: "phone", influence: 0.6 }),
  fx("landed-chime", "A gentle warm notification chime: two rising bell tones, a pleasant success sound, soft and clean with a short tail", 2, { group: "phone", influence: 0.6 }),
  // work
  fx("typing", "Soft typing on a mechanical keyboard, a steady relaxed typing rhythm in a quiet office, close but gentle, no voices", 12, { loop: true, group: "work" }),
  // The first take was mostly silence; this prompt asks for a constant bed.
  fx("office-murmur", "Busy open-plan office room tone: a constant low murmur of many people talking softly far away, indistinct and steady, distant keyboards and a printer, no clear words", 20, { loop: true, group: "work", influence: 0.6 }),
  fx("server-hum", "A server room: steady low electrical hum and whirring cooling fans, with occasional soft computer chirps and beeps, constant level", 20, { loop: true, group: "work" }),
  fx("package-thump", "A small cardboard package set down firmly on a wooden counter: a single soft thump with a slight cardboard rustle", 1.2, { group: "work", influence: 0.6 }),
  // sliced into single steps by build.mjs
  fx("steps-teak", "Slow footsteps in boat shoes walking across a teak wooden yacht deck, five separate steps with gaps between them, close, dry, outdoors", 5, { group: "steps", influence: 0.6 }),
  // the video
  fx("whoosh", "A clean, smooth cinematic whoosh for a title card transition, an airy swish, short", 1.5, { group: "video", influence: 0.6 }),
  fx("record-scratch", "A DJ vinyl record scratch, a quick comedic scratch-stop, dry", 1.2, { group: "video", influence: 0.6 }),
];

export const ALL = [...SOUNDTRACK, BAR_MUSIC, ...EFFECTS];

/** What one call costs, in USD, from fal's unit prices. */
export function estimate(job, seconds) {
  if (job.endpoint === MUSIC) {
    const ms = job.input.music_length_ms ?? job.input.composition_plan.sections.reduce((n, s) => n + s.duration_ms, 0);
    return Math.ceil(ms / 60000) * 0.6;
  }
  if (job.endpoint === STABLE) return 0.2;
  return (job.input.duration_seconds ?? seconds) * 0.002;
}
