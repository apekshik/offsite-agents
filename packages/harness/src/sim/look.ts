import { pick } from "./random.ts";
import type { SimContext } from "./session.ts";

// A designed look, scripted: sunglasses and a sun hat on the default figure, as the JSON Lines a real designer
// streams (one meta line, piece lines, done). The hat's colour varies with the seed; the shape never does.

const HATS = ["#f2d98d", "#e9e2cf", "#f4a261", "#9bd1e5", "#e85d75"];

export function simLookLines(r: () => number, description: string): string[] {
  const hat = pick(r, HATS);
  const band = pick(r, ["#1d2a44", "#c2432e", "#2dd4bf", "#3d6fd4"]);
  const lens = "#14161c";
  const name = description.replace(/\s+/g, " ").trim().slice(0, 40) || "Sun Hat";
  return [
    { t: "meta", name, say: "Shades on, hat on. Ready for the sun deck.", hide: [], base: { hair: "short", face: "smile", height: 1, legs: 1, arms: 1, torso: 1, bulk: 1, headSize: 1 } },
    { t: "piece", bone: "head", shape: "box", pos: [-0.07, 0.2, 0.165], size: [0.1, 0.06, 0.02], color: lens },
    { t: "piece", bone: "head", shape: "box", pos: [0.07, 0.2, 0.165], size: [0.1, 0.06, 0.02], color: lens },
    { t: "piece", bone: "head", shape: "box", pos: [0, 0.21, 0.168], size: [0.05, 0.015, 0.015], color: lens },
    { t: "piece", bone: "head", shape: "cylinder", pos: [0, 0.355, 0], size: [0.56, 0.025, 0.56], color: hat },
    { t: "piece", bone: "head", shape: "cylinder", pos: [0, 0.43, 0], size: [0.3, 0.15, 0.3], taper: 0.85, color: hat },
    { t: "piece", bone: "head", shape: "cylinder", pos: [0, 0.385, 0], size: [0.31, 0.04, 0.31], color: band },
    { t: "done" },
  ].map((l) => JSON.stringify(l));
}

export async function lookScript(ctx: SimContext): Promise<void> {
  await ctx.think(2, 5);
  await ctx.say(simLookLines(ctx.r, ctx.text).join("\n"));
}
