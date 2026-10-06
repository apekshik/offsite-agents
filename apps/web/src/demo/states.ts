import { STARTING_CAST, type DemoSetup } from "./ship.ts";
import type { DemoBackend } from "./backend.ts";

// Demo mode's starting points: /demo.html?state=<name> (or the Demo badge's menu). Each says how the ship starts and
// what is on screen once you're aboard. Everything after that is live: ask Computah, answer the crew, open the diffs.

export interface DemoState {
  name: string;
  /** For the badge's menu. */
  label: string;
  setup: DemoSetup;
  /** Signed out: the landing page first. */
  signedOut?: boolean;
  /** The sky's hour (?t=), for the world. */
  hour?: number;
  /** Seeds the ship (threads, hires, a machine on the way) as soon as the page loads. */
  seed?: (demo: DemoBackend) => void;
  /** What's on screen aboard: the phone, the helm, a card. Runs once the interface is up. */
  show?: (demo: DemoBackend, ui: DemoUi) => void;
}

/** The interface's own stores, handed in by main.tsx (so this file stays free of the app's modules). */
export interface DemoUi {
  phone: { takeOut(): void; unfold(): void; openThread(id: string | null): void; openCrew(id: string | null): void; openShip(): void; set(p: Record<string, unknown>): void; editLook(who: string): void };
  ui: { set(p: Record<string, unknown>): void };
  openReview(t: { threadId: string; taskId: string | null }): void;
}

const ABOARD: DemoSetup = { scene: "day", office: true, machine: true, repos: true };
const FRESH: DemoSetup = { scene: "day", office: false, machine: false, repos: false, cast: STARTING_CAST };
export const ASK = "Add a dark mode toggle to settings";
const ASK_TWO = "Add a billing page and a usage chart";

/** The working crew member on the newest thread, for showing their card or their Watch. */
const busyCrew = (demo: DemoBackend) => demo.ship.snapshot().crew.find((c) => c.role === "crew" && c.live)?._id ?? null;
const newest = (demo: DemoBackend) => demo.ship.threadList()[0]?._id ?? null;

export const STATES: DemoState[] = [
  { name: "aboard", label: "Aboard, golden hour, nothing asked yet", setup: ABOARD },
  { name: "friend", label: "Aboard a friend's ship (Maya's)", setup: { ...ABOARD, friendOf: "Maya" } },
  { name: "landing", label: "The landing page, signed out", setup: FRESH, signedOut: true },
  { name: "onboarding-ship", label: "Way aboard: make your ship", setup: FRESH },
  { name: "onboarding-machine", label: "Way aboard: waiting for your machine", setup: { ...FRESH, office: true } },
  {
    name: "onboarding-machine-paired", label: "Way aboard: a machine pairs", setup: { ...FRESH, office: true },
    seed: (d) => { setTimeout(() => d.ship.pairMachine(), 2500); },
  },
  { name: "onboarding-repos", label: "Way aboard: pick your repos", setup: { ...FRESH, office: true, machine: true } },
  { name: "no-machine", label: "Aboard with no machine (skipped setup)", setup: { ...FRESH, office: true } },
  { name: "working", label: "A thread under way: the crew scramble", setup: ABOARD, seed: (d) => { d.ship.startThread(ASK, 14); } },
  {
    name: "question", label: "A crew member needs you", setup: ABOARD,
    seed: (d) => { d.ship.startThread(ASK, 21); },
  },
  {
    name: "computah-asks", label: "Computah asks before it plans", setup: ABOARD,
    seed: (d) => { d.ship.startThread("Ship the new onboarding emails?", 4); },
  },
  {
    name: "phone-cover", label: "The phone, folded (its cover)", setup: ABOARD,
    seed: (d) => { d.ship.startThread(ASK, 21); },
    show: (_d, u) => u.phone.takeOut(),
  },
  {
    name: "phone-open", label: "The phone, unfolded on a thread with a plan", setup: ABOARD,
    seed: (d) => { d.ship.startThread(ASK, 14); },
    show: (d, u) => u.phone.openThread(newest(d)),
  },
  {
    name: "phone-crew", label: "The phone's crew tab, watching someone work", setup: ABOARD,
    seed: (d) => { d.ship.startThread(ASK_TWO, 16); },
    show: (d, u) => u.phone.openCrew(busyCrew(d)),
  },
  { name: "phone-ship", label: "The phone's ship tab", setup: ABOARD, show: (_d, u) => u.phone.openShip() },
  {
    name: "review", label: "A landed task's diff", setup: ABOARD,
    seed: (d) => { const t = d.ship.startThread(ASK, 0); d.ship.answerAll(t); d.ship.skip(60); },
    show: (d, u) => {
      const t = newest(d);
      const task = t ? d.ship.tasks(t).find((x) => x.state === "landed") : undefined;
      if (t) u.openReview({ threadId: t, taskId: task?._id ?? null });
    },
  },
  {
    name: "finished", label: "A finished thread with pull requests", setup: ABOARD,
    seed: (d) => { const t = d.ship.startThread(ASK_TWO, 0); d.ship.answerAll(t); d.ship.skip(110); },
    show: (d, u) => u.phone.openThread(newest(d)),
  },
  {
    name: "helm", label: "The helm console", setup: ABOARD,
    seed: (d) => { d.ship.startThread(ASK, 21); },
    show: (_d, u) => u.ui.set({ helm: true }),
  },
  {
    name: "crew-card", label: "A crew member's card", setup: ABOARD,
    seed: (d) => { d.ship.startThread(ASK, 14); },
    show: (d, u) => u.ui.set({ crewCard: busyCrew(d) }),
  },
  { name: "hire", label: "A new hire flies in", setup: ABOARD, seed: (d) => { d.ship.hire("Ezra", 25); } },
  {
    name: "creator", label: "The look customizer", setup: ABOARD,
    show: (d, u) => { const c = d.ship.snapshot().crew.find((x) => x.role === "crew"); if (c) u.phone.editLook(c._id); },
  },
  { name: "night", label: "Night: the whole crew at work, packages landing", setup: { ...ABOARD, scene: "night" }, hour: 21.5 },
];

export const stateNamed = (name: string | null) => STATES.find((s) => s.name === name) ?? STATES[0]!;
