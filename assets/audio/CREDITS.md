# Audio credits

Every sound and piece of music in Offsite was generated for it on [fal.ai](https://fal.ai), by `scripts/audio/generate.mjs`
(the prompts live in `scripts/audio/jobs.mjs`), then cut, looped and encoded by `scripts/audio/build.mjs`.
No third-party recordings or samples are included.

## Models and terms

- `fal-ai/elevenlabs/sound-effects/v2`: ElevenLabs Sound Effects v2 via fal.ai. fal's model page marks it "Commercial use"; generated output may be used commercially under fal's Terms of Service and ElevenLabs' terms for API output.
- `fal-ai/elevenlabs/music`: ElevenLabs Eleven Music via fal.ai. fal's model page marks it "Commercial use" (a fal partner model). ElevenLabs says Eleven Music is trained on licensed material and cleared for commercial use, including advertising, social video and games. Note: ElevenLabs' own self-serve music terms exclude film, broadcast TV and studio (AAA) games, which need enterprise terms; a marketing video and an open-source browser game fall outside that exclusion.
- `fal-ai/stable-audio-25/text-to-audio`: Stability AI Stable Audio 2.5 via fal.ai. fal's model page marks it "Commercial use"; Stability AI describes Stable Audio 2.5 as trained on a fully licensed dataset and commercially safe. Used only for a candidate soundtrack take that was not picked; no shipped file uses it.

fal's Terms of Service make no promise that output is original; prompts here avoid artist names, songs and lyrics.

## The launch video's soundtrack (`assets/audio/video/`)

| file | model | prompt |
|---|---|---|
| `video/offsite-launch-a-sundeck-house.mp3` | `fal-ai/elevenlabs/music` | Composition plan. Global: tropical house, instrumental, steel drums, marimba, plucked synths, warm sub bass, sunny, playful, polished modern production, 118 bpm; avoid vocals, lyrics, singing, rap, spoken word, choir, distorted guitar, heavy metal. Sunny goofing off (20 s): laid-back tropical house groove, playful marimba and steel drum melody, light shakers and finger snaps, whistling synth lead, carefree and a little silly. Calm before (7 s): the groove thins out to marimba and bass, a soft riser hints something is about to happen. Phones buzz (11 s): opens with a sharp vinyl record scratch and a sudden beat drop, energetic four-on-the-floor kick, rising synth arpeggios, snare roll build, urgent but fun scramble. Night shift groove (18 s): warm confident deep house groove, lush electric piano chords, round bass, smooth and focused late-night feel. Ending (4 s): the groove resolves on a final warm chord, short reverb tail, clean ending. (re-cut on its bar lines so the drop lands at 26.9 s) |
| `video/offsite-launch-b-lofi-lagoon.mp3` | `fal-ai/elevenlabs/music` | Composition plan. Global: lo-fi hip hop, instrumental, ukulele, vinyl crackle, dusty drums, warm, playful, sunny, 90 bpm; avoid vocals, lyrics, singing, rap, spoken word, choir, distorted guitar, heavy metal. Lazy afternoon (20 s): laid-back lo-fi beat, plucky ukulele melody, playful kalimba hits, soft vinyl crackle, sunny and goofy. Something's coming (7 s): beat drops out to ukulele and a low hum, a gentle tension swell. Scramble (11 s): starts with a loud vinyl record scratch, punchy boom-bap drums kick back in harder, funky bass line, horn stabs, energy keeps rising. Working late (18 s): smooth neo-soul groove, Rhodes electric piano, deep warm bass, brushed snare, confident and calm night feel. Ending (4 s): a final Rhodes chord that rings out, clean ending. (re-cut on its bar lines so the drop lands at 27.3 s) |

## The video's effects pack (`assets/audio/video/sfx/`)

| file | model | prompt |
|---|---|---|
| `video/sfx/phone-buzz.wav` | `fal-ai/elevenlabs/sound-effects/v2` | A smartphone vibrating on a wooden table: two short buzzes, close-up, dry, no ringtone |
| `video/sfx/helicopter-flyover.wav` | `fal-ai/elevenlabs/sound-effects/v2` | A helicopter flying fast overhead from left to right, a dramatic flyover with doppler, loud thumping rotor that passes and fades away |
| `video/sfx/glass-clink-cheers.wav` | `fal-ai/elevenlabs/sound-effects/v2` | Two cocktail glasses clinking together and a few friends cheerfully saying cheers at an outdoor bar |
| `video/sfx/pool-cannonball-splash.wav` | `fal-ai/elevenlabs/sound-effects/v2` | Someone does a cannonball jump into a swimming pool: a big splash, then the water settling |
| `video/sfx/keyboard-typing.wav` | `fal-ai/elevenlabs/sound-effects/v2` | Soft typing on a mechanical keyboard, a steady relaxed typing rhythm in a quiet office, close but gentle, no voices |
| `video/sfx/landed-chime.wav` | `fal-ai/elevenlabs/sound-effects/v2` | A gentle warm notification chime: two rising bell tones, a pleasant success sound, soft and clean with a short tail |
| `video/sfx/title-whoosh.wav` | `fal-ai/elevenlabs/sound-effects/v2` | A clean, smooth cinematic whoosh for a title card transition, an airy swish, short |
| `video/sfx/record-scratch.wav` | `fal-ai/elevenlabs/sound-effects/v2` | A DJ vinyl record scratch, a quick comedic scratch-stop, dry |
| `video/sfx/package-thump.wav` | `fal-ai/elevenlabs/sound-effects/v2` | A small cardboard package set down firmly on a wooden counter: a single soft thump with a slight cardboard rustle |
| `video/sfx/helicopter-approach.wav` | `fal-ai/elevenlabs/sound-effects/v2` | A helicopter approaching from far away over the sea, getting steadily louder as it arrives, slowing into a loud close hover, realistic rotor thump |

## The game (`apps/web/public/audio/`, each as `.ogg` Opus and `.m4a` AAC)

| file | model | prompt |
|---|---|---|
| `ocean.ogg/.m4a` | `fal-ai/elevenlabs/sound-effects/v2` | Gentle ocean waves washing and lapping against the hull of a large yacht at sea, steady calm water, close stereo ambience, no music, no voices (looped: tail crossfaded into the head) |
| `wind.ogg/.m4a` | `fal-ai/elevenlabs/sound-effects/v2` | Soft steady sea breeze across the open deck of a ship, gentle wind gusts, faint flapping of canvas, no water, no voices (looped: tail crossfaded into the head) |
| `night.ogg/.m4a` | `fal-ai/elevenlabs/sound-effects/v2` | Night on a yacht at sea: soft gentle waves lapping the hull, distant halyards and rigging clinking softly against a mast in a light breeze, calm and quiet, no insects, no crickets, no birds (looped: tail crossfaded into the head) |
| `murmur.ogg/.m4a` | `fal-ai/elevenlabs/sound-effects/v2` | Busy open-plan office room tone: a constant low murmur of many people talking softly far away, indistinct and steady, distant keyboards and a printer, no clear words (looped: tail crossfaded into the head) |
| `typing.ogg/.m4a` | `fal-ai/elevenlabs/sound-effects/v2` | Soft typing on a mechanical keyboard, a steady relaxed typing rhythm in a quiet office, close but gentle, no voices (looped: tail crossfaded into the head) |
| `server-hum.ogg/.m4a` | `fal-ai/elevenlabs/sound-effects/v2` | A server room: steady low electrical hum and whirring cooling fans, with occasional soft computer chirps and beeps, constant level (looped: tail crossfaded into the head) |
| `pool-swim.ogg/.m4a` | `fal-ai/elevenlabs/sound-effects/v2` | A person swimming gentle laps in an outdoor swimming pool, soft rhythmic water splashes and lapping (looped: tail crossfaded into the head) |
| `hot-tub.ogg/.m4a` | `fal-ai/elevenlabs/sound-effects/v2` | An outdoor hot tub: steady bubbling jets and gentle churning water, close, constant level, no voices (looped: tail crossfaded into the head) |
| `heli-idle.ogg/.m4a` | `fal-ai/elevenlabs/sound-effects/v2` | A helicopter idling on a helipad with its rotors turning, steady turbine whine and soft rotor whoosh, constant level (looped: tail crossfaded into the head) |
| `heli-rotor.ogg/.m4a` | `fal-ai/elevenlabs/sound-effects/v2` | Steady helicopter rotor blades chopping in flight, constant thump of the main rotor with turbine hum, close, no doppler (looped: tail crossfaded into the head) |
| `gull-1.ogg/.m4a` | `fal-ai/elevenlabs/sound-effects/v2` | A single seagull calling overhead, two or three cries, outdoors by the sea, clean, no waves |
| `gull-2.ogg/.m4a` | `fal-ai/elevenlabs/sound-effects/v2` | Two seagulls squawking back and forth in the distance over open water |
| `gull-3.ogg/.m4a` | `fal-ai/elevenlabs/sound-effects/v2` | A herring gull's long laughing call, outdoors by the sea |
| `gull-4.ogg/.m4a` | `fal-ai/elevenlabs/sound-effects/v2` | A seagull's short squawk as it flies past close by |
| `dolphin-splash.ogg/.m4a` | `fal-ai/elevenlabs/sound-effects/v2` | A dolphin leaps out of the sea and dives back in nearby: one clean splash with a short spray of water |
| `heli-approach.ogg/.m4a` | `fal-ai/elevenlabs/sound-effects/v2` | A helicopter approaching from far away over the sea, getting steadily louder as it arrives, slowing into a loud close hover, realistic rotor thump |
| `heli-takeoff.ogg/.m4a` | `fal-ai/elevenlabs/sound-effects/v2` | A helicopter on a helipad spooling up and taking off, rotors speeding up, lifting off and flying away into the distance until faint |
| `clink-cheers.ogg/.m4a` | `fal-ai/elevenlabs/sound-effects/v2` | Two cocktail glasses clinking together and a few friends cheerfully saying cheers at an outdoor bar |
| `ice-glass.ogg/.m4a` | `fal-ai/elevenlabs/sound-effects/v2` | Ice cubes dropping into a glass and a drink poured over them, close-up, crisp |
| `cannonball.ogg/.m4a` | `fal-ai/elevenlabs/sound-effects/v2` | Someone does a cannonball jump into a swimming pool: a big splash, then the water settling |
| `package-thump.ogg/.m4a` | `fal-ai/elevenlabs/sound-effects/v2` | A small cardboard package set down firmly on a wooden counter: a single soft thump with a slight cardboard rustle |
| `phone-buzz.ogg/.m4a` | `fal-ai/elevenlabs/sound-effects/v2` | A smartphone vibrating on a wooden table: two short buzzes, close-up, dry, no ringtone |
| `fold-open.ogg/.m4a` | `fal-ai/elevenlabs/sound-effects/v2` | A foldable smartphone unfolding open with a crisp satisfying hinge click, close-up, very short |
| `fold-close.ogg/.m4a` | `fal-ai/elevenlabs/sound-effects/v2` | A foldable smartphone snapping shut, a soft magnetic clack, close-up, very short |
| `send-tick.ogg/.m4a` | `fal-ai/elevenlabs/sound-effects/v2` | A soft, subtle user-interface tick for sending a message, a gentle muted wooden click, very short and clean |
| `landed-chime.ogg/.m4a` | `fal-ai/elevenlabs/sound-effects/v2` | A gentle warm notification chime: two rising bell tones, a pleasant success sound, soft and clean with a short tail |
| `step-1.ogg/.m4a` | `fal-ai/elevenlabs/sound-effects/v2` | Slow footsteps in boat shoes walking across a teak wooden yacht deck, five separate steps with gaps between them, close, dry, outdoors (one step sliced from the take) |
| `step-2.ogg/.m4a` | `fal-ai/elevenlabs/sound-effects/v2` | Slow footsteps in boat shoes walking across a teak wooden yacht deck, five separate steps with gaps between them, close, dry, outdoors (one step sliced from the take) |
| `step-3.ogg/.m4a` | `fal-ai/elevenlabs/sound-effects/v2` | Slow footsteps in boat shoes walking across a teak wooden yacht deck, five separate steps with gaps between them, close, dry, outdoors (one step sliced from the take) |
| `bar-music.ogg/.m4a` | `fal-ai/elevenlabs/music` | Tropical lounge music for a superyacht's sun-deck bar: a relaxed bossa nova meets chill house groove, nylon-string guitar, soft steel drums, vibraphone, brushed percussion, warm round bass, 100 BPM. Steady, even energy the whole way through, no intro build, no big drop and no ending, so it loops. Instrumental only. (looped: tail crossfaded into the head) |
