# Launch video soundtrack

Two takes, 60.0 s each, MP3 256 kbps, loudness -14 LUFS integrated, true peak -1 dBTP (written by
`scripts/audio/build.mjs`; credits in `../CREDITS.md`). Instrumental. The section times below were
measured from each take's energy (kick, bass, overall level), not just taken from the prompt.

## Sundeck House: `offsite-launch-a-sundeck-house.mp3`

**The drop lands at 26.9 s.**

- 0.0 s: quiet intro, no kick or bass
- 10.7 s: the groove: kick and bass come in
- 23.4 s: breakdown: kick and bass drop out
- 26.9 s: the drop: the full band hits
- 39.1 s: a two-bar break
- 43.2 s: the groove again, to the end
- 56.4 s: last chord rings out

## Lo-fi Lagoon: `offsite-launch-b-lofi-lagoon.mp3`

**The drop lands at 27.3 s.**

- 0.0 s: intro, no drums or bass
- 10.6 s: the beat comes in
- 26.6 s: transition bar
- 27.3 s: the stop: a beat of near-silence
- 27.6 s: the hit; bass and drums build back
- 29.3 s: full groove, bass and drums up about 6 dB
- 55.9 s: last chord rings out

## The other candidates

Rendered to `scripts/audio/.cache/takes/` (git-ignored) by the build, for auditioning:

- Yacht Disco (`take-c-yacht-disco.mp3`): drop at 27.9 s
- Stitched (Stable Audio) (`take-d-stitched.mp3`): drop at 26.4 s

Every Eleven Music take came back with its drop at 31 to 34 s rather than 27 s, so each was re-cut
on its own bar lines: whole bars out before the drop, the same number repeated after it, joins
crossfaded over 30 ms. The uncut takes are in `scripts/audio/.cache/take-*.wav`.
