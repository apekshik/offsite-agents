# Offsite: Moon Base ("Terraced Crater")

> In this repo: the brief as it was handed over, next to the world built from it (`worlds/moon-base`). The images are
> kept here as JPGs under the same names (`00-masterplan/*.jpg`, `01-zones/*.jpg`); `02-style-references/` and
> `99-archive-not-canonical/` weren't part of the package.

Concept-art handoff for building the moon base location of **Offsite**, a browser game (three.js) where the player runs a company of AI coding agents. The yacht was the first location; the moon base is the second. The goal is the same as on the yacht: a big place with lots of agents and lots for them to do, split into work and play.

> **How to read this document.** The images are concept art, not blueprints. They were generated one at a time and do not agree perfectly. Where they disagree, **the masterplan wins** (`00-masterplan/terraced-crater-masterplan.png`). Sections marked **Observed** describe what is in the images. Sections marked **Proposed** are design suggestions that were not decided by the art and can be changed.

---

## 1. Package contents

| Path | What it is | Status |
|---|---|---|
| `00-masterplan/terraced-crater-masterplan.png` | High aerial view of the whole base. **Source of truth for layout.** | Canonical |
| `01-zones/01-work-hall.png` | Main office interior inside a terrace hab | Canonical, see notes |
| `01-zones/02-hub-dome.png` | Central glass dome on the crater floor: cafe and lounge | Canonical, see notes |
| `01-zones/03-greenhouse.png` | Greenhouse on the upper terrace | Canonical |
| `01-zones/04-rover-garage.png` | Rover garage bays, lower right | Canonical |
| `01-zones/05-landing-pad.png` | Landing pad, new crew arrival | Canonical |
| `01-zones/06-mining-ice-rig.png` | Mining and ice extraction rig, lower-left pit | Canonical |
| `01-zones/07-sports-dome-lookout.png` | Low-gravity sports dome plus rim lookout | Canonical, see notes |
| `01-zones/08-night-overview.png` | Whole base at night, same layout as masterplan | Canonical |
| `02-style-references/hab-interior-style.png` | Original small-hab interior. Reference for wall material, crew outfits, props | Style reference |
| `02-style-references/small-base-exterior-style.png` | Original small-base exterior. Reference for hab shapes, airlocks, rover, suits | Style reference |
| `99-archive-not-canonical/*` | The two rejected layout options (radial hub, canyon street) | Do **not** build from these |

All images are 1088 x 608 (16:9) PNGs. `manifest.json` lists every file with its role and original source URL.

---

## 2. Art direction (applies everywhere)

**Observed across the approved images:**

- **Render style:** stylized real-time 3D game render. Chunky, clean, buildable geometry. Soft global illumination, gentle bloom on lights. Rich colour but not photoreal.
- **Lighting:** harsh, low sun with long hard shadows on the regolith. Black starry sky. Earth on the horizon (upper right in the masterplan). Interiors are warm (orange/amber light) against the cold grey exterior.
- **Architecture:** habs are **half-buried** and covered in **thick, horizontally layered, 3D-printed regolith** (moon soil) walls. Small **round glowing viewports**, arched airlock doors. Glass is used only for special structures (hub dome, greenhouse, sports dome, rim lookout).
- **Colour palette:** grey regolith, white structures and suits, **orange** equipment, crates and accents, warm amber window light. Blue for ice in the mining pit; green for the greenhouse.
- **Crew (agents):** stylized blocky figures with rounded-box heads, torsos and limbs and simple dot eyes. Never realistic humans. Indoors: **grey and orange coveralls**. Outdoors: chunky **white spacesuits** with round helmets.
- **Vehicles:** six-wheeled white/orange rovers; white landers with orange details.
- **Low gravity:** shown by crew leaping, floating mugs, high jumps in sports, dust plumes.
- **Rules:** no readable text, logos or watermarks. Screens show abstract code-like lines only. **Nothing from the yacht**: no teak, pools with umbrellas, palm trees, sun loungers or sailor uniforms.

---

## 3. Overall structure

### 3.1 Concept (Observed)

The base is built **inside a large crater**. The crater wall is cut into **stepped terrace rings**, like an amphitheatre. Each terrace ring is lined with half-buried habs facing inward toward the crater floor. Ramps and switchback roads connect the terraces. The crater floor holds the central social dome, landing pads and vehicle traffic. Industry (mining) sits in a deeper pit cut into the floor. Solar fields sit on the rim plain outside the crater.

### 3.2 Map (Observed from the masterplan, camera looking roughly "north" into the crater)

```
                 RIM PLAIN: solar fields, antennas, Earth on horizon (NE)
   +-------------------------------------------------------------------+
   | [Rim lookout        [Greenhouse       [Sports dome,                |
   |  pavilion, NW]       long glowing      lit, NE]      storage tanks |
   |                      dome, N]                        / radiators,E |
   |   UPPER TERRACES: rings of habs with round viewports               |
   |  [Tall tower, W]                                                   |
   |   MIDDLE TERRACES: more habs, ramps, crates                        |
   |   [Ring landing          [Lander descending, dust plume, centre-E] |
   |    pad, W]                                                         |
   |              [HUB DOME: central glass dome, crater floor]          |
   |                                          [ROVER GARAGE bays, SE]   |
   | [MINING / ICE PIT, SW:                                             |
   |  orange gantry over glowing blue ice]    [Ring landing pad, SE]    |
   |                                              solar panels (S/SE)   |
   +-------------------------------------------------------------------+
```

Directions are relative to the masterplan image (top = north / far side of crater, bottom = near side). They are for orientation only.

### 3.3 Vertical tiers (Proposed reading of the masterplan)

| Tier | Contents | Mood |
|---|---|---|
| Rim plain (top) | Solar fields, antennas, rim lookout pavilion | Quiet, exposed, big views |
| Upper terraces | Greenhouse, sports dome, upper habs | Leisure and life support |
| Middle terraces | Most habs (work halls, quarters), tower | Work and living |
| Crater floor | Hub dome, landing pads, roads, garage | Social heart and traffic |
| Pit (lowest) | Mining and ice extraction rig | Industry |

### 3.4 Circulation (Observed / Proposed)

- **Observed:** switchback roads and ramps between terraces; covered tube corridors connect the hub dome to surrounding structures; rovers and suited crew move along roads; path lights line the routes (clear in the night view).
- **Proposed:** treat the tower on the west terraces as the vertical spine (lift/comms tower) so agents can move between tiers quickly. Agents walking outdoors wear suits; inside habs and domes they wear coveralls. Airlocks are the transition points.

---

## 4. Zones

Each zone lists what the art shows, what agents do there (gameplay), and known problems.

### 4.1 Main Work Hall: `01-zones/01-work-hall.png`
- **Where:** inside a hab on the middle terraces.
- **Observed:** large, open, double-height interior with a mezzanine walkway. Round windows look out at the terraces. About 7 to 8 crew spread far apart, facing different directions; one leaps with a crate. Screens show abstract code.
- **Gameplay (Proposed):** the core "coding" space. Agents sit at desks, think, walk between stations. Keep it spacious: few agents per room, wide gaps, desks facing varied directions (a direct note from the yacht reviews: avoid cramped rows facing one way).
- **Known issues:** walls read as ribbed metal rather than layered regolith, and windows are larger than the exterior viewports. **Use the regolith wall style from `02-style-references/hab-interior-style.png`** and smaller round windows.

### 4.2 Hub Dome: `01-zones/02-hub-dome.png`
- **Where:** centre of the crater floor.
- **Observed:** glass-paneled dome. Cafe, sunken lounge pits, a chess game, planters. View up the terraces to the tower, greenhouse and Earth. Busier than other spaces.
- **Gameplay (Proposed):** the social heart and default gathering point: breaks, chatting, meetings, onboarding new agents.
- **Known issues:** a second dome that looks like the hub itself is visible through the glass. In the build there is **one** hub dome.

### 4.3 Greenhouse: `01-zones/03-greenhouse.png`
- **Where:** upper terrace, north.
- **Observed:** long glass structure with shelves of glowing crops under pink grow lights; crew tending plants; view over the crater.
- **Gameplay (Proposed):** relaxed side activity (tending plants, harvesting), food for the cafe.
- **Note:** it is a long glass tunnel rather than a round dome. This matches the long greenhouse in the masterplan; keep it long.

### 4.4 Rover Garage: `01-zones/04-rover-garage.png`
- **Where:** bays dug into the terrace wall, south-east.
- **Observed:** open bays, rovers on lifts, crew mechanics. Landing pad, tower and greenhouse visible behind.
- **Gameplay (Proposed):** maintenance tasks, dispatching rovers to the mine or pads.

### 4.5 Landing Pad / Arrival: `01-zones/05-landing-pad.png`
- **Where:** ring landing pads on the crater floor (west and south-east in the masterplan).
- **Observed:** lander touching down in a dust plume, a new crew member stepping out, two crew waving from the pad.
- **Gameplay (Proposed):** the moon-base equivalent of the yacht's helicopter arrival. New agents spawn here and are walked to the hub dome.
- **Known issues:** the arriving crew member's backpack is not visible (faces camera). There may be a tiny marking on the lander hull; build it without markings.

### 4.6 Mining and Ice Rig: `01-zones/06-mining-ice-rig.png`
- **Where:** deep pit, south-west.
- **Observed:** orange gantry tower over glowing blue ice, conveyor carrying ice blocks, storage tanks, suited crew. Hub dome, greenhouse and sports dome in the background in the correct positions.
- **Gameplay (Proposed):** heavy outdoor work: mining, hauling, operating machinery. Ice feeds water and air (life-support flavour).

### 4.7 Sports Dome and Rim Lookout: `01-zones/07-sports-dome-lookout.png`
- **Where:** sports dome on the upper terrace (north-east); lookout pavilion on the rim (north-west).
- **Observed:** low-gravity basketball with crew flipping and dunking; the rim lounge visible across the crater.
- **Gameplay (Proposed):** play and downtime. Lookout = quiet thinking spot with the best view of Earth.
- **Known issues:** the arena and stands are much larger than the sports dome looks in the masterplan. Scale to the masterplan, or make the dome bigger in the build if you want the arena.

### 4.8 Night Overview: `01-zones/08-night-overview.png`
- **Observed:** the masterplan layout lit at night: every viewport, path light and dome glowing; ice pit glowing blue; stars and Earth.
- **Use:** lighting reference for a night/day cycle. Closest match to the masterplan of all zone shots.

---

## 5. Agent activity summary (Proposed)

| Activity | Zone | Indoors / outdoors | Outfit |
|---|---|---|---|
| Coding, thinking, reviewing | Work Hall | Indoors | Coveralls |
| Breaks, chat, meetings, onboarding | Hub Dome | Indoors | Coveralls |
| Gardening, harvesting | Greenhouse | Indoors | Coveralls |
| Rover maintenance | Rover Garage | Semi-open | Coveralls / suits |
| Arrival, departure | Landing Pads | Outdoors | Suits |
| Mining, hauling | Mining Pit | Outdoors | Suits |
| Low-gravity sports | Sports Dome | Indoors | Coveralls |
| Quiet time, stargazing | Rim Lookout | Indoors (glass) | Coveralls |
| Commuting between tiers | Roads, ramps, tower | Outdoors / tower | Suits / coveralls |

Zones not yet drawn but implied by the masterplan (Proposed): crew quarters in the terrace habs, airlock/suit rooms, the tower interior (lift/comms), storage and power (tanks and radiators on the east side).

---

## 6. Build notes for three.js (Proposed)

- **Crater:** model as concentric terrace rings (stepped cylinders/annuli) with a flat floor and a deeper pit offset south-west. Terraces are the main navigation structure.
- **Modular habs:** one hab kit (half-buried shell, layered regolith bands, round viewport, arched airlock door) instanced around each ring. Layered regolith can be a simple banded texture or stacked bevelled rings.
- **Instancing:** solar panels, crates, rovers, path lights and crew are good candidates for `InstancedMesh`.
- **Glass structures:** hub dome, greenhouse, sports dome and lookout use transmissive/transparent materials; keep the count low for performance.
- **Lighting:** one strong low directional light (sun) with long shadows, dark sky, emissive viewports + bloom. Night mode = dim sun, raise emissives.
- **Scale:** the art does not give dimensions. Pick one hab module size and derive terrace widths and ring radii from it. Interiors in the art are larger than the exteriors imply; treat interiors as "bigger on the inside" or enlarge the exterior shells.

---

## 7. Open questions for the build

1. Exact crater diameter, number of terrace rings and hab count per ring.
2. Whether interiors are separate scenes (enter a hab, load interior) or seamless.
3. Which habs are work halls versus crew quarters.
4. How many landing pads are active (the masterplan shows two ring pads plus a lander landing between them).
5. Whether to keep the sports arena at its interior scale or match the smaller exterior dome.
