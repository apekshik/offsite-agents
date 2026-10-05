import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { crewActivity, type CrewActivity, type RunState } from "@offsite/contracts";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { scene } from "../bridge.ts";

// The ship as the interface sees it: one subscription each to the world snapshot, the threads, your
// machines and the office, shared by the HUD, the phone, the helm and the crew card.

export type Snapshot = FunctionReturnType<typeof api.world.snapshot>;
export type CrewRow = Snapshot["crew"][number];
export type QuestionRow = Snapshot["questions"][number];
export type ThreadRow = FunctionReturnType<typeof api.threads.list>[number];
export type MachineRow = FunctionReturnType<typeof api.machines.mine>[number];
export type OfficeRow = FunctionReturnType<typeof api.offices.get>;
export type MessageRow = FunctionReturnType<typeof api.messages.list>[number];
export type TaskRow = FunctionReturnType<typeof api.tasks.list>[number];

export interface Ship {
  officeId: Id<"offices">;
  office: OfficeRow | undefined;
  snap: Snapshot | undefined;
  threads: ThreadRow[] | undefined;
  machines: MachineRow[] | undefined;
  me: FunctionReturnType<typeof api.users.me> | undefined;
  crew: CrewRow[];
  computer: CrewRow | undefined;
  questions: QuestionRow[];
  byId: Map<string, CrewRow>;
  /** The machine the project lives on, or the first one online. */
  machine: MachineRow | undefined;
}

const Ctx = createContext<Ship | null>(null);

export function ShipProvider({ officeId, children }: { officeId: string; children: ReactNode }) {
  const id = officeId as Id<"offices">;
  const office = useQuery(api.offices.get, { officeId: id });
  const snap = useQuery(api.world.snapshot, { officeId: id });
  const threads = useQuery(api.threads.list, { officeId: id });
  const machines = useQuery(api.machines.mine);
  const me = useQuery(api.users.me);
  const value = useMemo<Ship>(() => {
    const all = snap?.crew ?? [];
    const byId = new Map(all.map((c) => [c._id as string, c]));
    const machine = machines?.find((m) => m._id === office?.repo?.machineId) ?? machines?.find((m) => m.online) ?? machines?.[0];
    return {
      officeId: id, office, snap, threads, machines, me,
      crew: all.filter((c) => c.role === "crew"),
      computer: all.find((c) => c.role === "computer"),
      questions: snap?.questions ?? [],
      byId,
      machine,
    };
  }, [id, office, snap, threads, machines, me]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useShip(): Ship {
  const s = useContext(Ctx);
  if (!s) throw new Error("useShip outside ShipProvider");
  return s;
}

/** The computer's own label: it thinks, waits on you, or stands by at the helm. */
export function ComputerLabel({ c }: { c: CrewRow }) {
  if (c.asking) return <span className="lab t-amber">Needs you</span>;
  return c.live ? <span className="lab t-accent">Thinking</span> : <span className="lab t-dim">Standing by</span>;
}

/** What they are doing now, as the world draws it (contracts' crewActivity with the local clock). */
export function activityOf(c: CrewRow, now: number): CrewActivity {
  return crewActivity({
    now,
    arrivesAt: c.arrivesAt,
    live: c.live && { state: c.live.state as RunState },
    openItem: c.live?.step ? { kind: c.live.step.kind } : null,
    asking: c.asking,
    lastEnded: c.lastEnded && { state: c.lastEnded.state as RunState, endedAt: c.lastEnded.endedAt },
  });
}

export const HARNESS: Record<string, string> = { claude: "Claude Code", codex: "Codex", sim: "Sim crew" };
export const harnessName = (h: string) => HARNESS[h] ?? h;

/** What they work on: the task, else the thread. */
export function workTitle(c: CrewRow): string | null {
  return c.live?.taskTitle || c.live?.threadTitle || null;
}

const AREA: Record<string, string> = {
  office: "office deck", sun: "sun deck", promenade: "promenade", "side-deck": "side deck", canopy: "canopy deck",
  terrace: "aft terrace", stern: "stern", bridge: "bridge", bar: "sun deck", water: "",
};

/** Where they are on the ship, from the game: "in a hammock, promenade". Null before the world knows. */
export function placeOf(crewId: string): string | null {
  const w = scene.where(crewId);
  if (!w) return null;
  const area = w.tags.map((t) => AREA[t]).find((a) => a) ?? "";
  const n = /(\d+)$/.exec(w.slotId)?.[1];
  const at = (s: string) => (area ? `${s}, ${area}` : s);
  switch (w.kind) {
    case "desk": return `desk ${n ?? ""}, office deck`.replace(" ,", ",");
    case "lounger": return at("on a lounger");
    case "hammock": return at("in a hammock");
    case "deck-chair": return at(w.slotId.startsWith("sofa") ? "on a sofa" : "in a deck chair");
    case "bar-stool": return "at the bar";
    case "pool": return "in the pool";
    case "hot-tub": return "in the hot tub";
    case "rail": return at("at the rail");
    case "fishing": return "fishing off the stern";
    case "dropoff": return "delivering to the bridge";
    case "helm": case "computer": return "at the helm";
    case "helipad": case "crew-spawn": return "on the helipad";
    case "captain": return "on the way to you";
    default: return null;
  }
}
