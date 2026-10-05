import type { RunState } from "./model.ts";

/**
 * What a crew member is doing right now, as the world draws it. The world maps each activity to
 * a place and a pose (a desk, a lounger with a laptop, walking over to the captain…); the phone
 * maps it to a label. Both use crewActivity so they always agree.
 */
export type CrewActivity =
  | "arriving"   // the helicopter is bringing them in
  | "idle"       // nothing assigned: off enjoying the ship
  | "thinking"   // working, between tool steps
  | "reading"    // read
  | "searching"  // search / grep / glob
  | "editing"    // edit / write
  | "running"    // bash: tests, builds, commands
  | "browsing"   // web
  | "delegating" // Computah handing out work, or a harness subagent
  | "asking"     // waiting on the captain
  | "landed"     // just finished well: carrying the package to the bridge
  | "failed";    // just finished badly

export const ACTIVITY_LABEL: Record<CrewActivity, string> = {
  arriving: "Arriving",
  idle: "Off duty",
  thinking: "Thinking",
  reading: "Reading",
  searching: "Searching",
  editing: "Editing",
  running: "Running",
  browsing: "Browsing",
  delegating: "Delegating",
  asking: "Needs you",
  landed: "Delivered",
  failed: "Stuck",
};

/** How long a just-finished state lasts before the crew member goes off duty. */
export const AFTERGLOW_MS = 20_000;

export interface ActivityInput {
  now: number;
  /** When the helicopter sets them down. */
  arrivesAt: number;
  /** Their live run, if any. */
  live: { state: RunState } | null;
  /** The newest tool step of the live run that has not completed, if any. */
  openItem: { kind: string } | null;
  /** True when one of their runs is waiting on the captain. */
  asking: boolean;
  /** Their most recent ended run. */
  lastEnded: { state: RunState; endedAt: number } | null;
}

const ITEM_ACTIVITY: Record<string, CrewActivity> = {
  read: "reading",
  search: "searching",
  edit: "editing",
  write: "editing",
  bash: "running",
  web: "browsing",
  agent: "delegating",
  offsite: "delegating",
  plan: "thinking",
  ask: "asking",
};

export function crewActivity(i: ActivityInput): CrewActivity {
  if (i.now < i.arrivesAt) return "arriving";
  if (i.asking) return "asking";
  if (i.live) return i.openItem ? ITEM_ACTIVITY[i.openItem.kind] ?? "thinking" : "thinking";
  if (i.lastEnded && i.now - i.lastEnded.endedAt < AFTERGLOW_MS) {
    if (i.lastEnded.state === "landed") return "landed";
    if (i.lastEnded.state === "failed") return "failed";
  }
  return "idle";
}

/** True for the activities that mean "at work". */
export const isWorking = (a: CrewActivity) => !["arriving", "idle", "landed", "failed"].includes(a);
