import type { HarnessAdapter, HarnessStatus, Session, StartSession } from "../adapter.ts";
import { computerScript } from "./computer.ts";
import { crewScript } from "./crew.ts";
import { lookScript } from "./look.ts";
import { SimSession, type SimScript } from "./session.ts";

export { SimSession, Stopped, type SimContext, type SimScript } from "./session.ts";
export { planFor, partsOf } from "./computer.ts";
export { simLookLines } from "./look.ts";
export { keepBoth } from "./repo.ts";

export interface SimOptions {
  /** Same seed, same inputs, same run. */
  seed?: number;
  /** Multiplies every pause: 1 is demo speed (30–90 s a task), 0 runs as fast as the machine can. */
  timeScale?: number;
}

export const SIM_STATUS: HarnessStatus = {
  harness: "sim", installed: true, version: "1.0.0", auth: "authenticated", email: null, plan: "Scripted crew",
  models: [{ id: "sim", name: "Sim crew", efforts: ["low", "medium", "high", "max"] }],
  message: "A scripted crew: no CLI, no spending.",
};

const scriptFor = (input: StartSession): SimScript =>
  input.kind === "look" ? lookScript : input.crew.role === "computer" ? computerScript : crewScript;

/** The sim crew: works like a harness, costs nothing. Used by `offsite start --sim`, demos and tests. */
export function createSimAdapter(opts: SimOptions = {}): HarnessAdapter {
  const seed = opts.seed ?? 1;
  const timeScale = opts.timeScale ?? 1;
  return {
    kind: "sim",
    probe: async () => ({ ...SIM_STATUS }),
    start: async (input: StartSession): Promise<Session> => new SimSession(input, scriptFor(input), { seed, timeScale }),
  };
}

export const simAdapter = createSimAdapter();
