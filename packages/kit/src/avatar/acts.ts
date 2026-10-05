// Adapted from Ready Player One (github.com/apekshik/ready-player-one).
//
// Held poses ("acts"): what a body does while it stays somewhere. RPO's (leaning on a rail,
// a bar stool, a sofa, chatting, listening, pointing…) plus the crew's own: typing at a desk, a
// laptop on the lap, reclined on a lounger, sunbathing, in a hammock, fishing, carrying the
// finished work, slumped with their head in their hands, on the phone, thinking, celebrating,
// waving, treading water; and off duty: napping, dancing, cards, selfies, stretching, a drink in a
// deck chair, huddling over someone's screen, the cannonball's tuck and climbing out of the pool.
//
// Gestures (GESTURES, below) layer over any act for a moment: talking with the hands, a nod, a
// laugh that doubles them over, raising a glass, the phone buzzing, shaking off pool water, a
// yawn and a stretch at the desk, a sip of coffee. They are written to read from across the deck.
//
// Each act fills a pose (pose.ts) that starts as whatever the body was doing (so an upper-body
// act like carry or phone walks fine), and may hold something: a prop placed on a part of the
// body, and hands that reach for its grips (avatar.ts does the reaching, with two-bone IK).
// Seats and loungers are data the world provides (Slot.seat); FIT is what these poses are
// fitted to, so a world can build furniture that matches.

import type { CrewActivity, SlotKind } from "@offsite/contracts";
import * as THREE from "three";
import {
  type Pose, type Side, LR, SIDES, TAU, arm, armTo, bend, fr, hash, holdDrink, lerp, onBeat, onHip, plant, seat, shift, smooth, tip,
} from "./pose.ts";
import { fishCycle, type PropKind } from "./props.ts";
import type { Vec3 } from "./sanitize.ts";

/** Furniture the poses are fitted to (metres; angles in radians from vertical). */
export const FIT = {
  chair: { seat: 0.46 },
  /** A desk: the top sits this far above the seat; the laptop's middle this far in front of the hip point. */
  desk: { seat: 0.46, above: 0.28, reach: 0.44 },
  deckChair: { seat: 0.42 },
  /** Backrest recline, and where its surface passes behind the hip point (along the back). */
  lounger: { seat: 0.36, back: 0.98, behind: 0.13 },
  hammock: { seat: 0.62, back: 1.28 },
  stool: { seat: 0.78 },
  sofa: { seat: 0.44 },
  rail: { height: 1.05 },
} as const;

/** What an act knows about the body doing it. */
export interface ActBody {
  /** Standing hip height, metres. */
  hip: number;
  /** Standing shoulder height, metres. */
  shoulder: number;
  /** Seat height for sitting and lying acts, metres (the act's own default if the world gave none). */
  seat: number;
  /** The hand they lead with: 0 is their right (-x). */
  lead: Side;
  /** A number of their own, so two people doing the same act don't move in step. */
  seed: number;
  /** Sitting or lying (the act has a seat): gestures leave the legs alone. */
  seated?: boolean;
}

/** Where a prop hangs: the feet's frame in metres (root), or a part of the body. */
export type Anchor = "root" | "hips" | "lap" | "chest" | "head" | "hand_r" | "hand_l";

export interface Hold {
  prop?: PropKind;
  at?: Anchor;
  pos?: Vec3 | ((B: ActBody) => Vec3);
  /** Euler XYZ, radians. */
  rot?: Vec3;
  /** Hands to the prop's grips, or to points (null: leave that hand to the pose) in an anchor's frame. */
  hands?: "grips" | { at: Anchor; points: [Vec3 | null, Vec3 | null] };
  /** Which way each elbow points, in the chest's frame: [right, left]. */
  pole?: [Vec3, Vec3];
  /** Fingers (or thumbs) busy: the hands tap. */
  typing?: boolean;
  /** Keep the prop upright in the world (a drink). */
  upright?: boolean;
  /** Bigger than life, so it reads from a distance (the phone). */
  scale?: number;
}

export interface ActDef {
  pose(p: Pose, t: number, B: ActBody): void;
  /** Only arms and head: layers over walking or standing. */
  upper?: boolean;
  /** Sitting or lying: the seat height it is written for when the world gives none. */
  seat?: number;
  hold?: Hold;
  /** The world's rocking or swaying: none. Swim lowers the body into the water instead. */
  swim?: boolean;
}

// A quaternion's Euler for a frame whose +z faces `normal` and +y leans toward `up`.
function facing(normal: Vec3, up: Vec3): Vec3 {
  const z = new THREE.Vector3(...normal).normalize();
  const x = new THREE.Vector3(...up).cross(z).normalize();
  const y = z.clone().cross(x);
  const e = new THREE.Euler().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  return [e.x, e.y, e.z];
}

const DOWN_OUT = (k: Side, out = 0.55, back = -0.35): Vec3 => [SIDES[k] * out, -1, back];
const POLE_TYPE: [Vec3, Vec3] = [DOWN_OUT(0, 0.7, -0.5), DOWN_OUT(1, 0.7, -0.5)];
const POLE_HOLD: [Vec3, Vec3] = [DOWN_OUT(0, 0.9, -0.3), DOWN_OUT(1, 0.9, -0.3)];
const POLE_UP: [Vec3, Vec3] = [[-1, 0.5, 0.1], [1, 0.5, 0.1]];

// Steady, even-tempered timing for RPO's club acts (b in beats at 120 bpm).
const beats = (t: number) => t * 2;

// Hands somewhere in front (the IK takes over once the prop is in place).
function reach(p: Pose, uaX = -0.9, faX = -1.1) {
  for (const k of LR) arm(p, k, uaX, 0.16, faX, -0.2);
}
// Now and then, the eyes leave the screen: a glance to one side and back.
function glance(t: number, seed: number) {
  return smooth(0.82, 0.95, Math.sin(t * 0.21 + seed * 7.3));
}

// Lying back at recline r (from vertical), hips at the seat: legs out along the surface.
function recline(p: Pose, B: ActBody, r: number) {
  p.y = (B.seat + 0.1 - B.hip) / B.hip;
  p.hpX = -r; p.hpY = 0; p.hpZ = 0;
  for (const k of LR) {
    p.thX[k] = -Math.PI / 2 + r;
    p.shX[k] = 0.04;
    p.thZ[k] = SIDES[k] * 0.05;
    p.ftX[k] = 0.45;
  }
  p.chX = 0; p.chY = 0; p.chZ = 0;
  p.hdX = 0; p.hdY = 0; p.hdZ = 0;
  p.sx = 0; p.sz = 0;
}
// Knee k up, the foot flat on the surface beside the other leg.
function kneeUp(p: Pose, k: Side, r: number, lift = 0.45, shinWorld = -0.62) {
  const thigh = -Math.PI / 2 - lift;
  p.thX[k] = thigh + r;
  p.shX[k] = shinWorld - thigh;
  p.ftX[k] = -shinWorld - 0.05;
}

/** Treading water: legs cycling, arms sculling out to the sides. */
export function treadWater(p: Pose, t: number) {
  const tr = t * 2.6;
  for (const k of LR) {
    const q = tr + k * Math.PI;
    p.thX[k] = -0.35 + 0.35 * Math.sin(q);
    p.thZ[k] = SIDES[k] * 0.1;
    p.shX[k] = 0.9 + 0.3 * Math.cos(q);
    p.ftX[k] = 0.3;
    p.uaX[k] = -0.45; p.uaY[k] = 0;
    p.uaZ[k] = SIDES[k] * (0.85 + 0.2 * Math.sin(tr * 2));
    p.faX[k] = -0.5 + 0.2 * Math.sin(tr * 2); p.faY[k] = 0; p.faZ[k] = 0;
  }
  p.hpX = 0.15; p.hpY = 0; p.hpZ = 0;
  p.chX = 0; p.hdX = -0.1;
}

const PHONE_ROT = facing([0, 0.66, -0.75], [0, 0.75, 0.66]);

function listen(p: Pose, t: number) {
  for (const k of LR) arm(p, k, -0.35, -0.08, -0.95, -0.35, -0.25);
  p.chX = 0.1;
  p.hdX = 0.06 + Math.sin(t * 0.7) * 0.03; p.hdY = 0; p.hdZ = 0.07;
}

// Lying in a hammock, sagging a little, rocking with it.
function inHammock(p: Pose, t: number, B: ActBody) {
  const r = FIT.hammock.back;
  recline(p, B, r);
  for (const k of LR) {
    p.thX[k] = -1.82 + r;
    p.shX[k] = 0.32;
    p.ftX[k] = 0.35;
    p.thZ[k] = SIDES[k] * (0.04 + 0.02 * k);
  }
  p.hpZ = 0.035 * Math.sin(t * 0.8 + B.seed);
  p.chX = 0.18;
  p.hdX = 0.55;
  // Without a laptop: hands resting on the belly.
  for (const k of LR) arm(p, k, -0.55, 0.15, -1.75, -0.55);
}

export const ACTS = {
  // ---------- at work ----------

  /** Seated at a desk, typing on a laptop. */
  type: {
    seat: FIT.desk.seat,
    pose(p, t, B) {
      seat(p, B.seat, B.hip, 0.1);
      for (const k of LR) p.thZ[k] = SIDES[k] * 0.1;
      p.chX += 0.08;
      reach(p);
      const g = glance(t, B.seed);
      p.hdX = 0.22 + 0.03 * Math.sin(t * 1.3) - 0.12 * g;
      p.hdY = (B.seed % 2 ? 0.5 : -0.5) * g;
    },
    hold: {
      prop: "laptop", at: "root", pos: (B) => [0, B.seat + FIT.desk.above, FIT.desk.reach],
      hands: "grips", typing: true, pole: POLE_TYPE,
    },
  },

  /** Sitting with the laptop on their lap. */
  laptop: {
    seat: FIT.deckChair.seat,
    pose(p, t, B) {
      seat(p, B.seat, B.hip, -0.12);
      for (const k of LR) { p.thZ[k] = SIDES[k] * 0.03; p.thX[k] -= 0.08; p.shX[k] += 0.08; }
      p.chX += 0.32;
      reach(p, -0.6, -1.4);
      const g = glance(t, B.seed);
      p.hdX = 0.5 - 0.25 * g;
      p.hdY = 0.3 * g * (B.seed % 2 ? 1 : -1);
    },
    hold: { prop: "laptop", at: "lap", pos: [0, -0.2, 0.08], rot: [Math.PI / 2, 0, 0], hands: "grips", typing: true, pole: POLE_TYPE },
  },

  /** Reclined on a lounger, knees up, the laptop on their thighs. */
  "lounge-laptop": {
    seat: FIT.lounger.seat,
    pose(p, t, B) {
      const r = FIT.lounger.back;
      recline(p, B, r);
      kneeUp(p, 0, r, 0.42, -0.95);
      kneeUp(p, 1, r, 0.42, -0.95);
      for (const k of LR) p.thZ[k] = SIDES[k] * 0.06;
      p.chX = 0.36;
      reach(p, -0.5, -1.2);
      const g = glance(t, B.seed);
      p.hdX = 0.42 - 0.3 * g;
      p.hdY = 0.25 * g * (B.seed % 2 ? 1 : -1);
    },
    hold: { prop: "laptop", at: "lap", pos: [0, -0.15, 0.08], rot: [Math.PI / 2, 0, 0], hands: "grips", typing: true, pole: POLE_TYPE },
  },

  /** Stretched out on a lounger in the sun, hands behind the head, one knee up. */
  sunbathe: {
    seat: FIT.lounger.seat,
    pose(p, t, B) {
      const r = FIT.lounger.back;
      recline(p, B, r);
      kneeUp(p, B.lead, r, 0.62, -0.6);
      p.thZ[B.lead] = SIDES[B.lead] * -0.02;
      p.hdX = -0.02;
      p.hdY = 0.18 * Math.sin(t * 0.07 + B.seed);
      for (const k of LR) arm(p, k, -0.3, 2.5, -2.2);
    },
    hold: {
      hands: { at: "head", points: [[-0.1, 0.22, -0.16], [0.1, 0.22, -0.16]] },
      pole: POLE_UP,
    },
  },

  /** Lying in a hammock with the laptop on their belly. */
  hammock: {
    seat: FIT.hammock.seat,
    pose: inHammock,
    hold: { prop: "laptop", at: "chest", pos: [0, -0.16, 0.12], rot: [Math.PI / 2 - 0.25, 0, 0], hands: "grips", typing: true, pole: POLE_TYPE },
  },

  /** Seated, elbows on knees, head in hands: it didn't go well. */
  slump: {
    seat: FIT.chair.seat,
    pose(p, t, B) {
      seat(p, B.seat, B.hip, 0.3);
      for (const k of LR) { p.thZ[k] = SIDES[k] * 0.16; p.shX[k] += 0.15; p.ftX[k] = -0.1; }
      const sigh = Math.pow(Math.max(0, Math.sin(t * 0.45 + B.seed)), 6);
      p.chX = 0.52 - 0.12 * sigh;
      p.hdX = 0.5 - 0.15 * sigh;
      p.hdY = 0.12 * Math.sin(t * 0.7) * (1 - sigh);
      for (const k of LR) arm(p, k, -1.3, 0.3, -2.0);
    },
    hold: {
      hands: { at: "head", points: [[-0.155, 0.17, 0.06], [0.155, 0.17, 0.06]] },
      pole: [[-0.25, -1, 0.7], [0.25, -1, 0.7]],
    },
  },

  /** Hand on chin, the other arm across the body, weight on one leg. */
  think: {
    pose(p, t, B) {
      const k = B.lead, s = SIDES[k];
      shift(p, 0.03 * s); p.hpZ -= 0.05 * s; p.chZ += 0.03 * s;
      bend(p, (1 - k) as Side, 0.1);
      arm(p, (1 - k) as Side, -0.5, -0.1, -1.7, -0.6);
      arm(p, k, -0.9, 0.05, -2.2);
      p.chX += 0.04;
      p.hdX = -0.18 + 0.06 * Math.sin(t * 0.4);
      p.hdZ = -0.12 * s;
      p.hdY = 0.3 * Math.sin(t * 0.15 + B.seed);
      plant(p);
    },
    hold: { hands: { at: "head", points: [[-0.01, -0.02, 0.15], null] }, pole: [[-0.15, -1, 0.35], [0.15, -1, 0.35]] },
  },

  // ---------- on the move ----------

  /** The finished work, boxed, carried in both hands (walks or stands). */
  carry: {
    upper: true,
    pose(p) {
      p.chX -= 0.07;
      p.hdX += 0.06;
      reach(p, -0.6, -1.3);
    },
    hold: { prop: "box", at: "chest", pos: [0, -0.2, 0.31], hands: "grips", pole: POLE_HOLD },
  },

  /** Holding the foldable phone in both hands, looking down at it (walks or stands). */
  phone: {
    upper: true,
    pose(p, t) {
      p.chX += 0.07;
      p.hdX = 0.5 + 0.03 * Math.sin(t * 0.9);
      p.hdY *= 0.3;
      reach(p, -0.7, -1.5);
    },
    hold: { prop: "phone", at: "chest", pos: [0, -0.03, 0.3], rot: PHONE_ROT, scale: 1.35, hands: "grips", typing: true, pole: POLE_HOLD },
  },

  /** An arm up, waving (walks or stands). */
  wave: {
    upper: true,
    pose(p, t, B) {
      const k = B.lead;
      arm(p, k, -0.25, 2.5, -0.15, 0.55 + 0.45 * Math.sin(t * 10));
      p.chZ -= SIDES[k] * 0.06;
      p.hdZ -= SIDES[k] * 0.1;
    },
  },

  /** Arms up, hopping: it landed. */
  celebrate: {
    pose(p, t, B) {
      const c = fr(t / 2.6 + B.seed * 0.13);
      const hop = c < 0.62 ? Math.max(0, Math.sin(c * 2.6 * 7.5)) : 0;
      for (const k of LR) {
        arm(p, k, -0.2, 2.7 + 0.15 * Math.sin(t * 15 + k), -0.2, 0.2);
        p.thX[k] = -0.35 * hop;
        p.shX[k] = 0.06 + 0.7 * hop;
        p.ftX[k] = 0.3 * hop;
      }
      p.y = 0.2 * hop;
      p.hdX = -0.3;
      p.hdY = 0;
    },
  },

  // ---------- off duty ----------

  /**
   * Standing at the stern with a rod out over the water: a cast, a long wait, a bite, reeling in,
   * and either a little dance with a fish or a long look at an old boot.
   */
  fish: {
    pose(p, t, B) {
      const k = B.lead;
      const f = fishCycle(t, B.seed);
      p.thZ[0] = -0.07; p.thZ[1] = 0.07;
      p.thX[(1 - k) as Side] -= 0.16;
      bend(p, 0, 0.06); bend(p, 1, 0.06);
      shift(p, 0.02 * Math.sin(t * 0.3 + B.seed));
      p.chX += 0.04;
      p.hdX = 0.22;
      p.hdY = 0.15 * Math.sin(t * 0.13 + B.seed);
      reach(p, -0.8, -1.0);
      if (f.phase === "cast") {
        // Wind up, then lean into the throw.
        const wind = smooth(0, 0.45, f.k) * (1 - smooth(0.45, 0.6, f.k));
        p.chX -= 0.25 * wind; p.chY = 0.3 * wind * SIDES[k];
        p.chX += 0.2 * smooth(0.45, 0.6, f.k) * (1 - smooth(0.7, 1, f.k));
      } else if (f.phase === "bite") {
        p.hdX = 0.4; p.chX += 0.1;
      } else if (f.phase === "reel") {
        p.chX -= 0.12; p.hdX = 0.05; bend(p, 0, 0.08); bend(p, 1, 0.08);
      } else if (f.phase === "show") {
        p.hdX = -0.35;
        if (f.catch === "fish") {
          // A hop or two, chin up.
          const hop = Math.max(0, Math.sin(f.k * 4 * TAU)) * (1 - smooth(0.5, 0.7, f.k));
          p.y += 0.12 * hop; p.chX -= 0.15;
        } else if (f.catch === "boot") {
          // A long look, a slump.
          p.chX += 0.25 * smooth(0, 0.3, f.k); p.hdY = 0.25 * Math.sin(f.k * 9); p.lift = -0.02;
        } else {
          p.lift = 0.06 * smooth(0, 0.2, f.k) * (1 - smooth(0.5, 0.8, f.k)); p.hdZ = 0.2;
        }
      }
      plant(p);
    },
    hold: { prop: "rod", at: "hips", pos: [-0.04, 0.13, 0.19], rot: [0.98, 0.05, 0], hands: "grips", pole: POLE_HOLD },
  },

  /** Sitting on the edge of the swim platform, legs over the side, a line in the water. */
  "fish-sit": {
    seat: 0,
    pose(p, t, B) {
      seat(p, B.seat, B.hip, -0.05);
      for (const k of LR) {
        // Legs hanging over the edge, swinging a little.
        p.shX[k] = Math.PI / 2 - 0.2 + 0.18 * Math.sin(t * 1.1 + k * 2.1 + B.seed);
        p.ftX[k] = 0.35;
        p.thZ[k] = SIDES[k] * 0.08;
      }
      p.chX += 0.12;
      p.hdX = 0.25;
      p.hdY = 0.12 * Math.sin(t * 0.17 + B.seed);
      reach(p, -0.8, -1.0);
    },
    hold: { prop: "rod", at: "hips", pos: [-0.04, 0.06, 0.26], rot: [1.12, 0.05, 0], hands: "grips", pole: POLE_HOLD },
  },

  /** Treading water. */
  swim: {
    swim: true,
    pose(p, t, B) {
      treadWater(p, t + B.seed);
      p.y = -(B.shoulder - 0.08) / B.hip + 0.025 * Math.sin(t * 2.6);
    },
  },

  /** Standing about with a drink, a sip now and then. */
  drink: {
    pose(p, t, B) {
      const k = B.lead, s = SIDES[k];
      shift(p, -0.03 * s); p.hpZ += 0.05 * s;
      bend(p, k, 0.1);
      holdDrink(p, k, t + B.seed * 3);
      arm(p, (1 - k) as Side, 0.05, 0.12, -0.3);
      p.hdY += 0.25 * Math.sin(t * 0.11 + B.seed);
      plant(p);
    },
    hold: { prop: "drink", at: "hand_r", pos: [0, -0.07, 0.045], upright: true },
  },


  // ---------- off duty, with company ----------

  /** In a deck chair with a drink, one leg over the other. */
  "sit-drink": {
    seat: FIT.deckChair.seat,
    pose(p, t, B) {
      const k = B.lead, o = (1 - k) as Side;
      seat(p, B.seat, B.hip, -0.22);
      p.thX[o] -= 0.28; p.thZ[o] += SIDES[o] * -0.22; p.shX[o] += 0.12;
      arm(p, o, 0.15, 0.3, -0.5);
      holdDrink(p, k, t + B.seed * 3);
      p.hdY += 0.35 * Math.sin(t * 0.1 + B.seed);
    },
    hold: { prop: "drink", at: "hand_r", pos: [0, -0.07, 0.045], upright: true, scale: 1.25 },
  },

  /** Flat out on a lounger, arms folded on the belly, head lolled to one side. */
  nap: {
    seat: FIT.lounger.seat,
    pose(p, t, B) {
      const r = FIT.lounger.back + 0.12;
      recline(p, B, r);
      for (const k of LR) { p.thZ[k] = -SIDES[k] * 0.03; p.shX[k] = 0.08; }
      kneeUp(p, B.lead, r, 0.3, -0.85);
      for (const k of LR) arm(p, k, -0.25, 0.32, -1.95, 0.25);
      // Breathing deep, a snore that jerks the head now and then.
      const snore = Math.pow(Math.max(0, Math.sin(t * 0.7 + B.seed)), 24);
      p.chX = 0.05 * Math.sin(t * 1.2 + B.seed) - 0.08 * snore;
      const side = B.seed % 2 ? 1 : -1;
      p.hdZ = side * 0.42; p.hdY = side * 0.35; p.hdX = 0.08 + 0.12 * snore;
    },
  },

  /** Asleep in a hammock, hands on the belly, head to one side. */
  "nap-hammock": {
    seat: FIT.hammock.seat,
    pose(p, t, B) {
      inHammock(p, t, B);
      for (const k of LR) arm(p, k, -0.3, 0.32, -1.25, -0.85);
      const side = B.seed % 2 ? 1 : -1;
      p.hdX = 0.35; p.hdZ = side * 0.4; p.hdY = side * 0.3;
      p.chX = 0.14 + 0.04 * Math.sin(t * 1.1 + B.seed);
    },
  },

  /** Swinging in a hammock, hands behind the head. */
  "hammock-rest": {
    seat: FIT.hammock.seat,
    pose(p, t, B) {
      inHammock(p, t, B);
      for (const k of LR) arm(p, k, -0.3, 2.5, -2.2);
      p.hdX = 0.4; p.hdY = 0.25 * Math.sin(t * 0.09 + B.seed);
      p.thX[B.lead] -= 0.35; p.shX[B.lead] += 0.6;
    },
    hold: { hands: { at: "head", points: [[-0.1, 0.22, -0.16], [0.1, 0.22, -0.16]] }, pole: POLE_UP },
  },

  /** Sprawled in a deck chair, arms hanging, head back: out cold. */
  "nap-chair": {
    seat: FIT.deckChair.seat,
    pose(p, t, B) {
      seat(p, B.seat, B.hip, -0.62);
      for (const k of LR) { p.thX[k] += 0.3; p.shX[k] -= 0.75; p.ftX[k] = 0.45; p.thZ[k] = SIDES[k] * 0.16; }
      for (const k of LR) arm(p, k, 0.3, 0.5, -0.12);
      const side = B.seed % 2 ? 1 : -1;
      const snore = Math.pow(Math.max(0, Math.sin(t * 0.7 + B.seed)), 24);
      p.chX = -0.2 + 0.03 * Math.sin(t * 1.2 + B.seed);
      p.hdX = -0.55 + 0.15 * snore; p.hdZ = side * 0.35; p.hdY = side * 0.2;
    },
  },

  /** Dancing, in one of three styles (by seed): the disco point, the two-step, the robot. */
  dance: {
    pose(p, t, B) {
      const b = beats(t) + (B.seed % 7) * 0.13, beat = fr(b), bounce = onBeat(beat, 0.5);
      const style = B.seed % 3;
      const step = Math.sin(Math.PI * b); // side to side, a step a beat
      if (style === 0) {
        // Disco: weight side to side, an arm pointing up and across, then down to the hip.
        shift(p, 0.06 * step);
        p.hpZ = -0.1 * step; p.chZ = 0.12 * step;
        const up = Math.floor(b / 2) % 2 ? 1 : 0;
        const k = (Math.floor(b / 4) % 2) as Side;
        arm(p, k, -0.25, lerp(0.6, 2.75, up), lerp(-1.4, -0.1, up), 0.1);
        onHip(p, (1 - k) as Side);
        p.hdX = -0.1 * up; p.hdZ = 0.15 * step;
      } else if (style === 1) {
        // Two-step: knees bouncing, fists pumping in time.
        shift(p, 0.045 * step);
        for (const k of LR) {
          const pump = Math.sin(TAU * b * 0.5 + k * Math.PI);
          arm(p, k, -0.7 - 0.45 * pump, 0.35, -1.9 + 0.3 * pump);
        }
        p.chY = 0.25 * step; p.hdY = -0.2 * step; p.chX = 0.08;
      } else {
        // The robot: square arms ticking from pose to pose.
        const tick = Math.floor(b * 2) % 4;
        const a = [[-0.4, 0.5, -1.57], [-1.57, 0.2, -1.57], [0.2, 1.4, -1.2], [-1.0, 0.9, 0]][tick]!;
        const c = [[-1.57, 0.2, -1.57], [-0.4, 0.5, -1.57], [-1.0, 0.9, 0], [0.2, 1.4, -1.2]][tick]!;
        arm(p, 0, a[0]!, a[1]!, a[2]!); arm(p, 1, c[0]!, c[1]!, c[2]!);
        p.hdY = [0.4, -0.4, 0, 0.2][tick]!; p.chY = [0.2, -0.2, 0.1, -0.1][tick]!;
      }
      for (const k of LR) bend(p, k, 0.08 + 0.14 * bounce);
      p.y -= 0.02 * bounce;
      plant(p);
    },
  },

  /** At a table with a hand of cards: study it, glance round the table, slap one down. */
  cards: {
    seat: FIT.deckChair.seat,
    pose(p, t, B) {
      const k = B.lead, o = (1 - k) as Side;
      seat(p, B.seat, B.hip, 0.12);
      p.chX += 0.12;
      const c = fr((t + B.seed * 1.7) / 7) * 7; // a card every 7 s
      const play = smooth(5.2, 5.6, c) * (1 - smooth(6.2, 6.8, c));
      // The free hand hovers at the fan, then plucks a card and slaps it down on the table.
      arm(p, k, lerp(-1.05, -1.3, play), lerp(0.05, 0.12, play), lerp(-1.75, -0.3, play), lerp(-0.4, -0.1, play));
      arm(p, o, -0.9, 0.12, -1.6, -0.3);
      p.hdX = lerp(0.18, 0.45, play);
      p.hdY = 0.45 * Math.sin(t * 0.23 + B.seed) * smooth(0.5, 0.9, Math.sin(t * 0.31 + B.seed * 3)) * (1 - play);
      if (play > 0.5) p.chX += 0.1;
    },
    hold: {
      // The fan held up in front of the chest, faces toward them, backs to the table.
      prop: "cards", at: "chest", pos: [0.05, 0.02, 0.33], rot: [-0.3, 0, 0], scale: 1.25,
      hands: { at: "chest", points: [null, [0.09, -0.02, 0.31]] }, pole: POLE_HOLD,
    },
  },

  /** A phone up at arm's length: a peace sign, a pout, a lean in. */
  selfie: {
    pose(p, t, B) {
      const k = B.lead, o = (1 - k) as Side, s = SIDES[k];
      const c = fr((t + B.seed) / 9) * 9;
      const peace = smooth(0.5, 1.0, c) * (1 - smooth(4.5, 5.0, c));
      arm(p, k, -2.1, 0.45, -0.25, 0.2);
      p.wrX[k] = -0.5;
      arm(p, o, lerp(0.05, -0.55, peace), lerp(0.12, 0.62, peace), lerp(-0.3, -2.35, peace), lerp(0, 0.3, peace));
      shift(p, 0.04 * s); p.hpZ -= 0.08 * s;
      p.chZ += 0.06 * s;
      // Looking up into the phone, head tilted for the shot.
      p.hdX = -0.32; p.hdY = s * -0.15; p.hdZ = s * (0.18 + 0.1 * Math.sin(t * 0.8));
      plant(p);
    },
    hold: { prop: "handset", at: "hand_r", pos: [0, -0.09, 0.03], rot: [Math.PI / 2, Math.PI, 0], scale: 1.3 },
  },

  /** Stretching on deck: reach up and lean side to side, fold forward, roll the shoulders. */
  stretch: {
    pose(p, t, B) {
      const c = fr((t + B.seed * 2.3) / 12) * 12;
      const up = smooth(0, 1, c) * (1 - smooth(5, 6, c));
      const fold = smooth(6, 7, c) * (1 - smooth(9, 10, c));
      const side = Math.sin(t * 0.9) * up;
      for (const k of LR) armTo(p, k, up, -0.15, 2.9, -0.1, 0);
      p.chZ = 0.35 * side; p.hpZ = -0.08 * side;
      tip(p, 0.95 * fold); p.chX += 0.35 * fold; p.hdX += 0.3 * fold;
      for (const k of LR) armTo(p, k, fold, -1.4, 0.15, -0.1, 0);
      const roll = 1 - up - fold;
      if (roll > 0) {
        p.lift = 0.03 * Math.max(0, Math.sin(t * 3)) * roll;
        p.hdY += 0.5 * Math.sin(t * 0.6 + B.seed) * roll;
      }
      p.thZ[0] -= 0.06; p.thZ[1] += 0.06;
      plant(p);
    },
  },

  /** Leaning over someone's desk: a hand on the chair back, the other pointing at their screen. */
  huddle: {
    pose(p, t, B) {
      const k = B.lead, o = (1 - k) as Side;
      tip(p, 0.32); p.chX += 0.22;
      arm(p, o, -0.95, 0.12, -0.55);
      const c = fr((t + B.seed) / 6) * 6;
      const point = smooth(0.5, 1, c) * (1 - smooth(3.5, 4.2, c));
      const chin = smooth(4.4, 4.8, c) * (1 - smooth(5.6, 6, c));
      arm(p, k, lerp(-0.5, -1.45, point), 0.1, lerp(-0.4, -0.18, point));
      if (chin > 0) armTo(p, k, chin, -0.9, 0.05, -2.2);
      p.hdX = 0.1 + 0.05 * Math.sin(t * 2.3); p.hdY = 0.15 * Math.sin(t * 0.4);
      bend(p, o, 0.1);
      plant(p);
    },
  },

  /** On a treadmill (or just jogging on the spot): a light run, arms pumping. */
  jog: {
    pose(p, t, B) {
      const ph = t * 9 + B.seed;
      for (const k of LR) {
        const q = ph + k * Math.PI, sw = Math.sin(q), up = Math.max(0, Math.cos(q - 0.3));
        p.thX[k] = -0.15 - 0.45 * sw - 0.12;
        p.shX[k] = 0.2 + 1.1 * up;
        p.ftX[k] = 0.25 * Math.max(0, -sw);
        arm(p, k, 0.6 * sw - 0.1, 0.16, -1.45);
      }
      p.hpX = 0.12; p.chX = 0.1; p.hdX = -0.1;
      p.chY = 0.12 * Math.sin(ph);
      p.y = 0.03 * Math.abs(Math.sin(ph)) - 0.03;
    },
  },

  /** On the sauna bench: leaning back on the wall, hands on the knees, now and then a hand across the brow. */
  sauna: {
    seat: FIT.chair.seat,
    pose(p, t, B) {
      const k = B.lead;
      seat(p, B.seat, B.hip, -0.25);
      for (const q of LR) { p.thZ[q] = SIDES[q] * 0.16; p.shX[q] -= 0.2; }
      for (const q of LR) arm(p, q, -0.55, 0.2, -0.75);
      const c = fr((t + B.seed * 1.3) / 8) * 8;
      const wipe = smooth(5.5, 6, c) * (1 - smooth(7, 7.6, c));
      if (wipe > 0) {
        armTo(p, k, wipe, -1.35, 0.55, -2.25, -0.2);
        p.wrZ[k] = SIDES[k] * 0.8 * Math.sin(c * 6) * wipe;
      }
      p.chX = -0.08; p.hdX = -0.3 + 0.12 * wipe; p.hdY = 0.2 * Math.sin(t * 0.08 + B.seed);
    },
  },

  /** Bent over something at waist height, a wrench going; up now and then to stretch the back. */
  tinker: {
    pose(p, t, B) {
      const k = B.lead, o = (1 - k) as Side;
      const c = fr((t + B.seed * 2.1) / 14) * 14;
      const up = smooth(10, 10.6, c) * (1 - smooth(12.6, 13.4, c));
      tip(p, 0.6 * (1 - up)); p.chX += 0.35 * (1 - up) - 0.25 * up;
      bend(p, 0, 0.1); bend(p, 1, 0.1);
      const turn = Math.sin(t * 5 + B.seed);
      arm(p, k, -1.0 + 0.1 * turn, 0.2, -0.75, -0.2);
      p.wrZ[k] = 0.6 * turn;
      arm(p, o, -0.9, 0.18, -0.95, -0.3);
      if (up > 0) { onHip(p, k); onHip(p, o); for (const q of LR) armTo(p, q, 1 - up, -1.0, 0.2, -0.8); }
      p.hdX = 0.35 * (1 - up) - 0.25 * up;
      plant(p);
    },
  },

  /** The cannonball: knees hugged to the chest, mid-air. */
  tuck: {
    pose(p) {
      for (const k of LR) {
        p.thX[k] = -2.3; p.shX[k] = 2.45; p.ftX[k] = 0.4; p.thZ[k] = SIDES[k] * 0.12;
        arm(p, k, -1.25, 0.25, -1.55, -0.3);
      }
      p.hpX = 0.15; p.chX = 0.45; p.hdX = 0.3;
      p.y = 0.25;
    },
  },

  /** Hauling out of the pool: palms on the edge, a knee up onto the deck. */
  climb: {
    pose(p, t, B) {
      const k = B.lead;
      for (const q of LR) arm(p, q, -1.15, 0.28, -0.45);
      p.thX[k] = -1.7; p.shX[k] = 2.0; p.ftX[k] = 0.2;
      p.thX[(1 - k) as Side] = 0.15; p.shX[(1 - k) as Side] = 0.5;
      p.hpX = 0.35; p.chX = 0.35; p.hdX = -0.25 + 0.05 * Math.sin(t * 8);
    },
  },

  // ---------- from Ready Player One ----------

  /** On a bar stool: feet on the rung, a drink in hand, turning to talk. */
  stool: {
    seat: FIT.stool.seat,
    pose(p, t, B) {
      const b = beats(t), k = B.lead;
      seat(p, B.seat, B.hip);
      for (const q of LR) { p.thX[q] -= 0.15; p.shX[q] += 0.35; p.ftX[q] = 0.25; }
      p.thZ[0] = -0.12; p.thZ[1] = 0.12;
      p.chX += 0.1;
      arm(p, (1 - k) as Side, -0.95, 0.3, -1.1, -0.3);
      holdDrink(p, k, t + B.seed * 3);
      p.hdY += 0.6 * Math.sin(t * 0.13 + B.seed * 9) * smooth(0.3, 0.8, Math.sin(t * 0.07 + B.seed * 4) * 0.5 + 0.5);
      p.hdX += 0.05 + 0.08 * onBeat(fr(b), 0.4);
      p.chY += 0.15 * Math.sin(t * 0.13 + B.seed * 9);
    },
    hold: { prop: "drink", at: "hand_r", pos: [0, -0.07, 0.045], upright: true },
  },

  /** Over a rail on their forearms, looking out. */
  rail: {
    pose(p, t, B) {
      const b = beats(t);
      tip(p, 0.18); p.chX += 0.42;
      for (const k of LR) arm(p, k, -1.0, 0.28, -0.95, -0.35);
      bend(p, B.lead, 0.12);
      p.hdX += 0.1 + 0.05 * onBeat(fr(b / 4), 0.5); p.hdY += 0.45 * Math.sin(t * 0.08 + B.seed * 9);
      plant(p);
    },
  },

  /** Leaning on a counter, forearms on it. */
  lean: {
    pose(p, t, B) {
      tip(p, 0.08); p.chX += 0.3;
      for (const k of LR) arm(p, k, -0.85, 0.32, -0.95, -0.25);
      p.thZ[B.lead] -= SIDES[B.lead] * 0.12;
      bend(p, B.lead, 0.1);
      p.hdX -= 0.12; p.hdY += 0.35 * Math.sin(t * 0.17 + B.seed * 7);
      plant(p);
    },
  },

  /** Back to a counter, elbows on it behind. */
  leanBack: {
    pose(p, t, B) {
      shift(p, 0, 0.04); p.chX -= 0.12;
      for (const k of LR) arm(p, k, 0.55, 0.35, -1.25, -0.15);
      p.thX[B.lead] -= 0.2; p.shX[B.lead] += 0.25;
      p.hdY += 0.5 * Math.sin(t * 0.11 + B.seed * 5);
      p.hdX += 0.05;
      plant(p);
    },
  },

  /** Standing in a group: talking with the hands, or listening with arms folded. */
  chat: {
    pose(p, t, B) {
      const k = B.lead, turn = Math.sin(t * 0.21 + B.seed * 13);
      shift(p, 0.03 * SIDES[k]); p.hpZ -= 0.04 * SIDES[k];
      bend(p, k, 0.1);
      if (turn > 0.2) {
        const g = Math.sin(t * 3.1 + B.seed * 3), h = Math.sin(t * 2.3 + 1);
        arm(p, k, -0.45 - 0.15 * g, 0.25, -1.35 - 0.3 * h, -0.2);
        arm(p, (1 - k) as Side, -0.25 - 0.1 * h, 0.18, -1.1 - 0.25 * g, -0.1);
        p.wrZ[k] = 0.5 * g;
        p.hdX += 0.08 * Math.sin(t * 4.1); p.hdY += 0.2 * Math.sin(t * 0.7);
      } else {
        arm(p, 0, -0.5, 0.05, -1.75, -1.05); arm(p, 1, -0.5, 0.05, -1.75, -1.05); // folded
        const laugh = smooth(0.85, 0.95, Math.sin(t * 0.37 + B.seed * 7));
        p.chX -= 0.12 * laugh; p.hdX -= (0.25 + 0.06 * Math.sin(t * 22)) * laugh;
      }
      plant(p);
    },
  },

  /** Sunk into a low seat, leaning back, an arm along the back, legs crossed. */
  sofa: {
    seat: FIT.sofa.seat,
    pose(p, t, B) {
      const k = B.lead;
      seat(p, B.seat, B.hip, -0.28);
      p.chX -= 0.05;
      arm(p, (1 - k) as Side, 0.3, 1.25, -0.55);
      arm(p, k, -0.45, 0.12, -1.35);
      p.thX[k] -= 0.25; p.thZ[k] += SIDES[k] * -0.2; p.shX[k] += 0.1;
      p.hdY += 0.4 * Math.sin(t * 0.09 + B.seed); p.hdX -= 0.05;
    },
  },

  /** Hands folded in front, the head tilted to hear you. */
  listen: { pose: listen },

  /** As listening, one hand lifting as they speak. */
  talk: {
    pose(p, t, B) {
      listen(p, t);
      const k = B.lead;
      arm(p, k, -0.55 + 0.08 * Math.sin(t * 1.7), 0.12, -1.25 + 0.15 * Math.sin(t * 2.3), -0.15);
      p.hdX = 0.02 + 0.05 * Math.sin(t * 2.1); p.hdZ = 0.04;
    },
  },

  /** One arm out ahead, toward what they're looking at. */
  point: {
    pose(p, t, B) {
      listen(p, t);
      arm(p, B.lead, -1.45, 0.12, -0.12);
      p.chX = 0.04; p.hdX = -0.05; p.hdZ = 0;
    },
  },

  /** A hand held out, palm up, the other over the heart. */
  offer: {
    pose(p, t, B) {
      const k = B.lead;
      arm(p, k, -0.95, 0, -0.5, 0, -0.15);
      arm(p, (1 - k) as Side, -0.5, -0.2, -1.9, -0.6);
      p.chX = 0.14;
      p.hdX = 0.32 + Math.sin(t * 0.8) * 0.02; p.hdY = 0; p.hdZ = 0;
    },
  },

  /** Feet apart, hands clasped in front, watching the deck. */
  guard: {
    pose(p, t, B) {
      p.thZ[0] = -0.08; p.thZ[1] = 0.08;
      for (const k of LR) arm(p, k, -0.25, -0.05, -1.05, -0.75);
      p.chX -= 0.03; p.lift = 0.01;
      p.hdY += 0.7 * Math.sin(t * 0.13 + B.seed * 3) * smooth(0.2, 0.6, Math.abs(Math.sin(t * 0.05 + B.seed)));
      plant(p);
    },
  },

  /** Head bowed, a hand to the face; now and then a sob. */
  weep: {
    pose(p, t) {
      const sob = Math.pow(Math.max(0, Math.sin(t * 1.1)), 4) * Math.sin(t * 15);
      arm(p, 1, -1.1, 0.4, -2.1, 0.35, 0.15);
      arm(p, 0, -0.45, -0.15, -1.6, -0.5);
      p.chX = 0.22 + 0.04 * sob;
      p.hdX = 0.5 + 0.05 * sob; p.hdY = 0.15; p.hdZ = 0.08;
      p.lift = 0.012 * sob;
    },
  },

  /** A hand on the hip, chin up, weight on one leg. */
  pose: {
    pose(p, t, B) {
      const k = B.lead, o = (1 - k) as Side;
      onHip(p, k);
      arm(p, o, 0.1, 0.18, -0.25);
      shift(p, 0.05 * SIDES[k]); p.hpZ -= 0.1 * SIDES[k]; p.chZ += 0.05 * SIDES[k];
      p.thX[o] -= 0.15; p.thZ[o] -= SIDES[o] * 0.05;
      p.hdX -= 0.12; p.hdY += SIDES[k] * 0.25;
      plant(p, [k === 0, k === 1]);
      p.ftX[o] = 0.2;
    },
  },

  /** At the edge of the pool, looking down into it. */
  edge: {
    pose(p, t, B) {
      tip(p, 0.05); p.chX += 0.15; p.hdX += 0.45;
      arm(p, 0, -0.2, 0.12, -0.5); arm(p, 1, -0.2, 0.12, -0.5);
      bend(p, 0, 0.06); bend(p, 1, 0.06);
      p.hdY += 0.4 * Math.sin(t * 0.2 + B.seed * 5);
      plant(p);
    },
  },

  /** Behind the bar: shake a cocktail, pour it, wipe the counter. */
  bartend: {
    pose(p, t, B) {
      const b = beats(t), c = fr(b / 16) * 16, k = B.lead, s = SIDES[k];
      if (c < 8) {
        const shake = Math.sin(TAU * b * 2);
        arm(p, k, -1.25 + 0.22 * shake, 0.25, -1.95 + 0.1 * shake);
        arm(p, (1 - k) as Side, -1.2 + 0.22 * shake, -0.3, -2.0 + 0.1 * shake, 0, 0.2);
        p.chY += s * 0.12; p.hdY -= s * 0.15; p.lift = 0.008 * Math.abs(shake);
      } else if (c < 12) {
        const w = smooth(8, 8.6, c) * (1 - smooth(11.4, 12, c));
        arm(p, k, -0.85, 0.15, -0.8);
        p.wrX[k] = 0.9 * w; p.wrZ[k] = -0.4 * w;
        arm(p, (1 - k) as Side, -0.6, 0.15, -1.2);
        p.chX += 0.15; p.hdX += 0.3;
      } else {
        arm(p, k, -0.7 + 0.12 * Math.cos(t * 4), 0.2 + 0.12 * Math.sin(t * 4), -0.85);
        arm(p, (1 - k) as Side, 0.05, 0.12, -0.35);
        p.chX += 0.2; p.hdX += 0.1;
      }
      bend(p, 0, 0.06); bend(p, 1, 0.06);
      plant(p);
    },
  },

  /** A hand holding a headphone to one ear, the other on the decks, nodding. */
  dj: {
    pose(p, t, B) {
      const b = beats(t), dn = onBeat(fr(b), 0.7), bar = fr(b / 64) * 64, k = B.lead;
      const drop = smooth(0, 0.5, bar) * (1 - smooth(6, 7, bar));
      arm(p, k, -0.35, 1.05, -2.35, -0.2);
      arm(p, (1 - k) as Side, -0.8, 0.12, -0.75 + 0.06 * Math.sin(TAU * b * 2));
      p.wrX[(1 - k) as Side] = -0.5;
      if (drop > 0) for (const q of LR) armTo(p, q, drop, -0.25, 2.65, -0.2 - 0.4 * dn, 0.1);
      tip(p, 0.08); p.chX += 0.18 + 0.1 * dn; p.hdX += 0.15 + 0.3 * dn;
      bend(p, 0, 0.12 + 0.1 * dn); bend(p, 1, 0.12 + 0.1 * dn);
      plant(p);
    },
  },
} satisfies Record<string, ActDef>;

export type ActId = keyof typeof ACTS;
export const ACT_IDS = Object.keys(ACTS) as ActId[];
export const isAct = (id: unknown): id is ActId => typeof id === "string" && id in ACTS;
export const actDef = (id: ActId): ActDef => ACTS[id];

/**
 * A suggestion for what someone does at a spot, by what they are doing. The director may pick
 * differently; this keeps the world and the phone telling the same story by default.
 */
export function actFor(activity: CrewActivity, slot: SlotKind | null): ActId | null {
  const working = !["arriving", "idle", "landed", "failed", "asking"].includes(activity);
  if (activity === "asking") return slot ? "talk" : null;
  if (activity === "landed") return slot === "dropoff" ? "celebrate" : "carry";
  switch (slot) {
    case "desk": return activity === "failed" ? "slump" : working ? "type" : "think";
    case "lounger": return working ? "lounge-laptop" : "sunbathe";
    case "hammock": return "hammock";
    case "deck-chair": return working ? "laptop" : "sofa";
    case "bar-stool": return "stool";
    case "pool": case "hot-tub": return "swim";
    case "rail": return activity === "thinking" ? "think" : "rail";
    case "fishing": return "fish";
    case "helm": case "computer": return working ? "talk" : "listen";
    case "dropoff": return "celebrate";
    case "helipad": case "crew-spawn": return "wave";
    default: return activity === "failed" ? "slump" : null;
  }
}

/** Typing comes in bursts: 1 while the fingers are going, easing to 0 in the pauses. */
export function typingBurst(t: number, seed: number) {
  return smooth(-0.35, 0.05, Math.sin(t * 0.55 + seed * 3.1) + 0.4 * Math.sin(t * 1.7 + seed));
}

/** A hand's tap while typing: how far it lifts (m), at time t. */
export function keyTap(t: number, k: Side, seed: number) {
  const rate = 15 + 4 * hash(seed, k);
  return Math.pow(Math.max(0, Math.sin(t * rate + k * 1.9 + seed)), 3) * 0.014 + lerp(0, 0.004, Math.sin(t * 2.3 + k));
}

// ---------- gestures ----------

/** How long gestures blend in and out, seconds. */
const G_IN = 0.18, G_OUT = 0.3;

export interface GestureDef {
  /** A one-shot's length, seconds; none loops until replaced. */
  dur?: number;
  /** How far each hand ([their right, left]) lets go of what the act has it holding, 0..1. "other" is the hand without the drink. */
  free?: [number, number] | "other" | "both";
  /** Something it brings out in a hand for the while (a mug, a phone), in that hand's frame. */
  item?: { kind: PropKind; hand: "lead" | "other"; pos: Vec3; rot?: Vec3; scale?: number };
  /** g: seconds since it started; t: the animation clock. Edits the pose the act made. */
  pose(p: Pose, g: number, t: number, B: ActBody): void;
}

/** 0 → 1 → 0 over a one-shot of length dur. */
export const gestureWeight = (g: number, dur?: number) =>
  dur === undefined ? smooth(0, G_IN, g) : Math.min(smooth(0, G_IN, g), 1 - smooth(dur - G_OUT, dur, g));

export const GESTURES = {
  /** Talking with the free hand, the head bobbing along. */
  talk: {
    pose(p, g, t, B) {
      const o = (1 - B.lead) as Side, s = SIDES[o];
      const a = Math.sin(t * 4.2 + B.seed), b = Math.sin(t * 2.7 + 1.3);
      arm(p, o, -0.75 - 0.25 * a, 0.35 + 0.1 * b, -1.25 - 0.35 * b, -0.35);
      p.wrZ[o] = s * 0.5 * a;
      p.hdX += 0.07 * Math.sin(t * 5.1); p.hdY += 0.12 * Math.sin(t * 1.3);
      p.chY += 0.06 * s * a;
    },
  },
  /** Listening: a slow nod now and then, the head tipped a little. */
  listen: {
    pose(p, g, t, B) {
      const nod = Math.pow(Math.max(0, Math.sin(t * 1.6 + B.seed)), 6);
      p.hdX += 0.16 * nod; p.hdZ += 0.07;
    },
  },
  /** Two quick nods: yes. */
  nod: {
    dur: 0.9,
    pose(p, g) { p.hdX += 0.22 * Math.max(0, Math.sin(g * 14)); },
  },
  /** Laughing: thrown back, then doubled over, a hand slapping a knee, shaking. */
  laugh: {
    dur: 2.4,
    free: "other",
    pose(p, g, t, B) {
      const o = (1 - B.lead) as Side;
      const back = smooth(0, 0.25, g) * (1 - smooth(0.4, 0.7, g));
      const fold = smooth(0.45, 0.8, g) * (1 - smooth(1.8, 2.3, g));
      const shake = Math.sin(g * 26);
      p.chX += -0.3 * back + 0.6 * fold + 0.06 * shake;
      p.hdX += -0.4 * back - 0.25 * fold + 0.07 * shake;
      if (!B.seated) { tip(p, 0.55 * fold); bend(p, 0, 0.16 * fold); bend(p, 1, 0.16 * fold); p.y -= 0.05 * fold; }
      const slap = Math.max(0, Math.sin(g * 9));
      arm(p, o, lerp(-0.3, -0.75, fold) - 0.15 * slap * fold, 0.25, lerp(-1.6, -0.5, fold), 0.2);
      p.lift = 0.015 * shake;
    },
  },
  /** Raising a glass to the middle of the group, a clink, then a sip. */
  cheers: {
    dur: 2.2,
    pose(p, g, t, B) {
      const k = B.lead, s = SIDES[k];
      const up = smooth(0.05, 0.45, g) * (1 - smooth(1.05, 1.35, g));
      const clink = Math.exp(-Math.pow((g - 0.7) * 10, 2));
      arm(p, k, lerp(p.uaX[k], -1.75, up), lerp(Math.abs(p.uaZ[k]), 0.2, up), lerp(p.faX[k], -0.55 + 0.1 * clink, up), -0.1 * up);
      p.uaY[k] = s * -0.35 * up;
      p.chX -= 0.06 * up; p.hdX -= 0.15 * up;
      if (g > 1.2) holdDrink(p, k, 9.5 + (g - 1.2) * 1.1, 1);
    },
  },
  /** A sip of the drink in hand. */
  sip: {
    dur: 1.6,
    pose(p, g, t, B) { holdDrink(p, B.lead, 9.5 + g * 0.95, 1); },
  },
  /** The phone buzzes: a jolt, then it's out in the free hand and they look at it. */
  buzz: {
    dur: 1.4,
    free: "other",
    item: { kind: "handset", hand: "other", pos: [0, -0.09, 0.04], rot: [Math.PI / 2 + 0.3, Math.PI, 0], scale: 1.3 },
    pose(p, g, t, B) {
      const o = (1 - B.lead) as Side;
      const jolt = Math.exp(-Math.pow((g - 0.08) * 14, 2));
      p.lift += 0.05 * jolt;
      if (!B.seated) p.y += 0.04 * jolt;
      p.chX -= (B.seated ? 0.45 : 0.15) * jolt;
      const look = smooth(0.15, 0.45, g);
      arm(p, o, lerp(p.uaX[o], -1.25, look), lerp(Math.abs(p.uaZ[o]), 0.25, look), lerp(p.faX[o], -1.95, look), 0.25 * look);
      p.hdX = lerp(p.hdX, 0.45, look); p.hdY = lerp(p.hdY, SIDES[o] * -0.2, look); p.hdZ *= 1 - look;
      if (B.seated) p.chX -= 0.35 * look; // sat up for it
    },
  },
  /** Shaking off pool water like a dog: twist, flap, head going. */
  shake: {
    dur: 1.2,
    free: "both",
    pose(p, g) {
      const w = Math.sin(g * 28);
      p.hpY = 0.18 * w; p.chY = 0.3 * w; p.hdY = -0.45 * w;
      for (const k of LR) arm(p, k, -0.2, 0.65 + 0.4 * Math.sin(g * 28 + k * Math.PI), -0.6, 0.3 * w);
      p.lift = 0.03 * Math.abs(w);
    },
  },
  /** A big yawn and a stretch, arms overhead (sitting at a desk, or standing). */
  yawn: {
    dur: 3.2,
    free: "both",
    pose(p, g) {
      const up = smooth(0.2, 0.9, g) * (1 - smooth(2.3, 3.0, g));
      for (const k of LR) armTo(p, k, up, -0.3, 2.85, -0.35 - 0.2 * Math.sin(g * 2), 0.2);
      p.chX -= 0.3 * up; p.hdX -= 0.45 * up; p.chZ += 0.12 * Math.sin(g * 2.4) * up;
    },
  },
  /** A sip of coffee from a mug, then back to it. */
  coffee: {
    dur: 3.4,
    free: "other",
    item: { kind: "mug", hand: "other", pos: [0.0, -0.1, 0.02], rot: [0, -Math.PI / 2, 0], scale: 1.25 },
    pose(p, g, t, B) {
      const o = (1 - B.lead) as Side;
      const lift = smooth(0.2, 0.9, g) * (1 - smooth(2.5, 3.2, g));
      holdDrink(p, o, 9.5 + 0.3 + 1.0 * smooth(0.4, 2.6, g) * (g < 2.6 ? 1 : 0), lift);
      p.chX -= 0.08 * lift;
    },
  },
  /** Leaning in at the screen. */
  lean: {
    pose(p, g, t) { p.chX += 0.16; p.hdX += 0.06 + 0.03 * Math.sin(t * 0.7); },
  },
  /** Jolted awake: lying or sitting, they sit bolt upright. */
  wake: {
    dur: 1.1,
    pose(p, g, t, B) {
      const up = smooth(0, 0.15, g) * (1 - smooth(0.7, 1.1, g));
      p.chX -= (B.seated ? 0.7 : 0.2) * up; p.hdX -= 0.35 * up; p.hdY += 0.5 * Math.sin(g * 12) * up;
      for (const k of LR) armTo(p, k, up * 0.6, -0.3, 0.5, -0.4);
    },
  },
} satisfies Record<string, GestureDef>;

export type GestureId = keyof typeof GESTURES;
export const GESTURE_IDS = Object.keys(GESTURES) as GestureId[];
export const isGesture = (id: unknown): id is GestureId => typeof id === "string" && id in GESTURES;
