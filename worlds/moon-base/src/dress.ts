// What crew wear on the base, after the concept art: grey and orange coveralls indoors, a white
// suit with a round helmet outdoors. Their own face, hair and hat stay with them indoors (only the
// head's pieces of a designed look are kept); outdoors the helmet covers it all.

import { bodyFit } from "@offsite/kit";
import type { AvatarSpec, Look, LookPiece, Vec3 } from "@offsite/contracts";
import { GARAGE, GREENHOUSE, HUB, LOOKOUT, QUARTERS, SPORTS, TIER_Y, WORK_HALL, chordD, dugFrame, wrap, type Dug } from "./dims.ts";
import { TUBE } from "./hub.ts";
import { HALL } from "./workhall.ts";
import { sportsFrame } from "./sports.ts";
import { angleOf } from "./kit.ts";

const GREY = "#8d9298", ORANGE = "#e8742a", DARK = "#3a3e45", WHITE = "#f1f1ec";

/** Whether a point is inside one of the base's rooms (the hub and its tubes, a hall dug into a terrace, a dome). */
export function indoors([x, y, z]: Vec3): boolean {
  const dh = Math.hypot(x - HUB.x, z - HUB.z);
  if (dh < HUB.r - 0.3 && y < HUB.h) return true;
  if (Math.abs(z - HUB.z) < TUBE.r && Math.abs(x - HUB.x) < HUB.r + TUBE.len + TUBE.module - 0.6 && y < 4) return true;
  for (const [d, depth, ceil] of [[WORK_HALL, HALL.depth, TIER_Y[2]!], [QUARTERS, QUARTERS.depth, TIER_Y[2]!], [GARAGE, GARAGE.depth, TIER_Y[1]!]] as [Dug, number, number][]) {
    const f = dugFrame(d);
    const dx = x - f.cx, dz = z - f.cz;
    const lx = dx * f.right[0] + dz * f.right[1], lz = dx * f.out[0] + dz * f.out[1];
    if (lz > 0.3 && lz < depth && Math.abs(lx) < d.w / 2 && y > f.y - 5 && y < ceil) return true;
  }
  const r = Math.hypot(x, z), a = angleOf(x, z);
  if (Math.abs(r - GREENHOUSE.r) < GREENHOUSE.half && wrap(a - GREENHOUSE.a0) >= 0 && wrap(a - GREENHOUSE.a0) <= GREENHOUSE.a1 - GREENHOUSE.a0 && y > TIER_Y[3]! - 0.5) return true;
  {
    const f = sportsFrame(), dx = x - f.cx, dz = z - f.cz;
    const lx = dx * f.right[0] + dz * f.right[1], lz = dx * f.out[0] + dz * f.out[1];
    const mid = SPORTS.len / 2 - SPORTS.half;
    if (Math.hypot(Math.max(0, Math.abs(lx) - mid), lz) < SPORTS.half - 0.3 && y > TIER_Y[3]! - 0.5) return true;
  }
  if (Math.hypot(x - LOOKOUT.x, z - LOOKOUT.z) < LOOKOUT.r - 0.3 && y > TIER_Y[4]! - 0.5) return true;
  void chordD;
  return false;
}

/** The coveralls' own pieces: an orange vest and shoulder panels over the grey, a belt, boots. */
function coverallPieces(spec: AvatarSpec): LookPiece[] {
  const f = bodyFit(spec);
  const p = (bone: LookPiece["bone"], pos: [number, number, number], size: [number, number, number], color: string): LookPiece =>
    ({ bone, shape: "box", pos, size, color, round: 0.25 }) as LookPiece;
  const out: LookPiece[] = [
    p("chest", [0, f.chestY, f.chestFront + 0.004], [f.chestHalfW * 1.5, f.chestH * 1.6, 0.03], ORANGE),
    p("chest", [0, f.chestY, -f.chestFront - 0.004], [f.chestHalfW * 1.6, f.chestH * 1.7, 0.03], ORANGE),
    p("chest", [0, f.bellyY - f.bellyH * 0.6, 0], [f.chestHalfW * 2.05, 0.05, f.chestFront * 2.15], DARK),
    p("chest", [f.chestHalfW * 0.45, f.chestY + f.chestH * 0.35, f.chestFront + 0.022], [0.07, 0.05, 0.012], GREY),
  ];
  for (const s of ["r", "l"] as const) {
    out.push(p(`upper_arm_${s}`, [0, -0.02, 0], [0.13 * f.w, 0.09, 0.13 * f.w], ORANGE));
    out.push(p(`foot_${s}`, [0, -0.01, 0.035 * f.hw], [0.13 * f.w, 0.1, 0.27 * f.hw], DARK));
  }
  return out;
}

/** What someone wears at a point on the base. */
export function dress(spec: AvatarSpec, look: Look | null, at: Vec3): { outfit: string; spec: AvatarSpec; look: Look | null } {
  if (!indoors(at)) {
    // Outdoors: the suit. It draws over everything; a designed look's pieces would poke through it.
    const suited: AvatarSpec = { ...spec, outfit: "astronaut", back: "none", top: WHITE, bottom: ORANGE, accent: ORANGE };
    return { outfit: "suit", spec: suited, look: look ? { meta: { ...look.meta, base: { ...look.meta.base, outfit: "astronaut", back: "none" }, hide: [] }, pieces: [] } : null };
  }
  const base: AvatarSpec = { ...spec, outfit: "none", back: "none", top: GREY, bottom: ORANGE };
  const pieces = coverallPieces(base);
  if (!look) return { outfit: "coveralls", spec: base, look: { meta: { name: "Coveralls", base: { outfit: "none", hair: spec.hair, head: spec.head, hat: spec.hat, face: spec.face, back: "none", build: spec.build } }, pieces } };
  // A designed look keeps its head; its body goes under the coveralls.
  const head = look.pieces.filter((x) => x.bone === "head");
  return {
    outfit: "coveralls", spec: base,
    look: { meta: { ...look.meta, base: { ...look.meta.base, outfit: "none", back: "none" }, hide: (look.meta.hide ?? []).filter((h) => h === "head") }, pieces: [...head, ...pieces].slice(0, 90) },
  };
}
