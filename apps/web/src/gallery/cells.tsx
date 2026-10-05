import type { ReactNode } from "react";
import { ConvexProvider, ConvexProviderWithAuth } from "convex/react";
import { Gate } from "../screens/Gate.tsx";
import { Landing } from "../screens/Landing.tsx";
import { Overlay } from "../overlay/Overlay.tsx";
import { ui } from "../bridge.ts";
import { phone } from "../phone/state.ts";
import { openReview } from "../review/open.ts";
import { DemoBackend } from "../demo/backend.ts";
import { STARTING_CAST, type DemoSetup } from "../demo/ship.ts";
import { OFFICE } from "../film/story.ts";

// The gallery's cells: one screen of the real interface each, in one state, on fixture data (a DemoBackend per cell).
// Each cell is its own page (gallery.html?cell=<name>), so the interface's global stores (the phone, the bridge) never
// clash; the gallery index shows them side by side in frames. No 3D world: the overlay sits on the night poster.

export interface Cell {
  name: string;
  title: string;
  group: string;
  setup: DemoSetup;
  /** Seeds the fixture ship before the first render. */
  seed?: (d: DemoBackend) => void;
  /** "overlay": the HUD, phone, helm, cards over the poster. "gate": the way aboard. "landing": the front door. */
  kind: "overlay" | "gate" | "landing";
  /** The ship's clock holds this long after the cell loads (default 3 s), so screenshots match. */
  holdAfterMs?: number;
  /** Puts the interface in this cell's state, after the first render. */
  show?: (d: DemoBackend) => void;
}

const ABOARD: DemoSetup = { scene: "day", office: true, machine: true, repos: true, folderDelayMs: 300 };
const FRESH: DemoSetup = { scene: "day", office: false, machine: false, repos: false, cast: STARTING_CAST, folderDelayMs: 300 };
const NEW_SHIP: DemoSetup = { ...FRESH, office: true };
const ASK = "Add a dark mode toggle to settings";

const newest = (d: DemoBackend) => d.ship.threadList()[0]?._id ?? null;
const busy = (d: DemoBackend) => d.ship.snapshot().crew.find((c) => c.role === "crew" && c.live)?._id ?? null;
/** A thread `seconds` along, with every question answered on the way (so it has landed work by then). */
const along = (text: string, seconds: number) => (d: DemoBackend) => { const t = d.ship.startThread(text, 0); d.ship.answerAll(t); d.ship.skip(seconds); };
/** Presses a button by its text, once it's there (for steps only reachable by clicking, like Meet your crew). */
const press = (text: string) => () => {
  const t = setInterval(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent?.trim() === text);
    if (b) { clearInterval(t); b.click(); }
  }, 100);
};

export const CELLS: Cell[] = [
  // The phone.
  { group: "Phone", name: "phone-cover", title: "Cover: someone needs you, the latest delivery, the crew", kind: "overlay", setup: ABOARD, seed: along(ASK, 40), show: () => phone.takeOut() },
  { group: "Phone", name: "phone-threads-empty", title: "Threads: none yet", kind: "overlay", setup: ABOARD, show: () => phone.openThread(null) },
  { group: "Phone", name: "phone-thinking", title: "Conversation: Computah reading the repos", kind: "overlay", setup: ABOARD, holdAfterMs: 1000, seed: (d) => { d.ship.startThread(ASK, 0.5); }, show: (d) => phone.openThread(newest(d)) },
  { group: "Phone", name: "phone-plan", title: "Conversation: Computah's reply and plan", kind: "overlay", setup: ABOARD, seed: (d) => { d.ship.startThread("Add a billing page and a usage chart", 12); }, show: (d) => phone.openThread(newest(d)) },
  { group: "Phone", name: "phone-computah-asks", title: "Conversation: Computah asks before it plans", kind: "overlay", setup: ABOARD, seed: (d) => { d.ship.startThread("Ship the new onboarding emails?", 4); }, show: (d) => phone.openThread(newest(d)) },
  { group: "Phone", name: "phone-question", title: "Conversation: a crew member asks permission", kind: "overlay", setup: ABOARD, seed: (d) => { d.ship.startThread(ASK, 21); }, show: (d) => phone.openThread(newest(d)) },
  { group: "Phone", name: "phone-finished", title: "Conversation: finished, with pull requests", kind: "overlay", setup: ABOARD, seed: along("Add a billing page and a usage chart", 110), show: (d) => phone.openThread(newest(d)) },
  { group: "Phone", name: "phone-crew-watch", title: "Crew: watching someone work", kind: "overlay", setup: ABOARD, seed: (d) => { d.ship.startThread(ASK, 24); d.ship.answerAll(newest(d)!); }, show: (d) => phone.openCrew(busy(d)) },
  { group: "Phone", name: "phone-crew-off", title: "Crew: off duty", kind: "overlay", setup: ABOARD, show: (d) => phone.openCrew(d.ship.snapshot().crew.find((c) => c.role === "crew")?._id ?? null) },
  { group: "Phone", name: "phone-hire", title: "Crew: hiring someone", kind: "overlay", setup: ABOARD, show: () => { phone.set({ fold: "open", tab: "crew", hiring: true }); } },
  { group: "Phone", name: "phone-ship", title: "Ship: machines and repos", kind: "overlay", setup: ABOARD, show: () => phone.openShip() },
  { group: "Phone", name: "phone-review", title: "Review: a landed task's diff", kind: "overlay", setup: ABOARD, seed: along(ASK, 60), show: (d) => { const t = newest(d)!; openReview({ threadId: t, taskId: d.ship.tasks(t).find((x) => x.state === "landed")?._id ?? null }); } },

  // Around the ship.
  { group: "Aboard", name: "hud-no-machine", title: "HUD: no machine connected", kind: "overlay", setup: NEW_SHIP },
  { group: "Aboard", name: "toasts", title: "Toasts: a question, a delivery, a new hire", kind: "overlay", setup: ABOARD, seed: (d) => {
      d.ship.startThread(ASK, 21);
      d.ship.landIn(d.ship.startThread("Fix the flaky checkout test", 0), 2);
      setTimeout(() => d.ship.hire("Ezra", 30), 600);
    } },
  { group: "Aboard", name: "crew-card", title: "Crew card: someone at work", kind: "overlay", setup: ABOARD, seed: (d) => { d.ship.startThread(ASK, 14); }, show: (d) => ui.set({ crewCard: busy(d) }) },
  { group: "Aboard", name: "crew-card-asking", title: "Crew card: someone waiting on you", kind: "overlay", setup: ABOARD, seed: (d) => { d.ship.startThread(ASK, 21); }, show: (d) => ui.set({ crewCard: d.ship.snapshot().questions[0]?.crewId ?? null }) },
  { group: "Aboard", name: "helm", title: "Helm console", kind: "overlay", setup: ABOARD, seed: (d) => { d.ship.startThread(ASK, 21); }, show: () => ui.set({ helm: true }) },
  { group: "Aboard", name: "helm-review", title: "Helm console: the diff viewer", kind: "overlay", setup: ABOARD, seed: along("Add a billing page and a usage chart", 110), show: (d) => { ui.set({ helm: true }); openReview({ threadId: newest(d)!, taskId: null }); } },
  { group: "Aboard", name: "creator", title: "The look customizer", kind: "overlay", setup: ABOARD, show: (d) => { const c = d.ship.snapshot().crew.find((x) => x.role === "crew"); if (c) phone.editLook(c._id); } },

  // The way aboard.
  { group: "Way aboard", name: "landing", title: "The front door", kind: "landing", setup: FRESH },
  { group: "Way aboard", name: "onboarding-ship", title: "Make your ship", kind: "gate", setup: FRESH },
  { group: "Way aboard", name: "onboarding-meet", title: "Meet your crew", kind: "gate", setup: FRESH, show: press("Make the ship") },
  { group: "Way aboard", name: "onboarding-machine", title: "Connect your machine: waiting", kind: "gate", setup: NEW_SHIP },
  { group: "Way aboard", name: "onboarding-paired", title: "Connect your machine: paired", kind: "gate", setup: NEW_SHIP, seed: (d) => { setTimeout(() => d.ship.pairMachine(), 700); } },
  { group: "Way aboard", name: "onboarding-repos", title: "Your repos: what the runner found", kind: "gate", setup: { ...NEW_SHIP, machine: true } },
  { group: "Way aboard", name: "onboarding-browse", title: "Your repos: browsing folders", kind: "gate", setup: { ...NEW_SHIP, machine: true }, show: press("Browse…") },

  // Empty and error states.
  { group: "Empty and error states", name: "empty-no-machine-thread", title: "Asking with no machine connected", kind: "overlay", setup: NEW_SHIP, seed: (d) => { d.ship.startThread(ASK, 4); }, show: (d) => phone.openThread(newest(d)) },
  { group: "Empty and error states", name: "empty-ship-tab", title: "Ship tab: nothing connected", kind: "overlay", setup: NEW_SHIP, show: () => phone.openShip() },
  { group: "Empty and error states", name: "error-diff", title: "Review: the diff couldn't be read", kind: "overlay", setup: { ...ABOARD, failDiffs: true }, seed: along(ASK, 60), show: (d) => { const t = newest(d)!; openReview({ threadId: t, taskId: d.ship.tasks(t)[0]?._id ?? null }); } },
  { group: "Empty and error states", name: "error-offline", title: "Machine offline", kind: "overlay", setup: { ...ABOARD, offline: true }, show: () => phone.openShip() },
  { group: "Empty and error states", name: "empty-scan", title: "Your repos: none found", kind: "gate", setup: { ...NEW_SHIP, machine: true, noRepos: true } },
  { group: "Empty and error states", name: "error-scan", title: "Your repos: the runner couldn't look", kind: "gate", setup: { ...NEW_SHIP, machine: true, folderError: "Couldn't read ~/Developer: permission denied." } },
];

const signedIn = () => ({ isLoading: false, isAuthenticated: true, fetchAccessToken: async () => "gallery" });

/** One cell, rendered as the app would. */
export function CellView({ cell, demo }: { cell: Cell; demo: DemoBackend }): ReactNode {
  if (cell.kind === "landing") return <Landing />;
  if (cell.kind === "gate") return <ConvexProviderWithAuth client={demo.asClient()} useAuth={signedIn}><Gate /></ConvexProviderWithAuth>;
  return (
    <ConvexProvider client={demo.asClient()}>
      <div className="gallery-world" aria-hidden="true" />
      <Overlay officeId={OFFICE} />
    </ConvexProvider>
  );
}
