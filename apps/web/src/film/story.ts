import type { FunctionReturnType } from "convex/server";
import type { RunEvent } from "@offsite/contracts";
import { CREW_PRESETS, randomCrewAvatar } from "@offsite/kit";
import type { api } from "../../../../convex/_generated/api";
import type { Id, TableNames } from "../../../../convex/_generated/dataModel";
import type { CrewRow, MachineRow, MessageRow, OfficeRow, QuestionRow, Snapshot, TaskRow, ThreadRow } from "../overlay/ship.tsx";

// The demo ship for the film: a scripted crew, threads, tasks, runs, messages, deliveries and
// questions, as pure functions of story time. The fake Convex client (convex.ts) answers the
// interface's and the game's queries from here, so the real Game, phone, helm and HUD run on it.
//
// Story time is seconds from 19:00 (BASE_EPOCH in clock.ts). The arc:
//   0–118 s     golden hour, off duty. Mira flies in at the start.
//   ~120 s      the captain types "Add dark mode and a billing page" on the sun deck and sends it.
//   ~123–132 s  the computer reads the repos, plans eight tasks and hires Ezra; the crew scramble.
//   ~142 s      Ezra's helicopter lands.
//   9000 s on   21:30, night: everyone at work, packages on the counter, the thread finishes with
//               a pull request in each repo.

export type Users = FunctionReturnType<typeof api.users.me>;
export type Deliveries = FunctionReturnType<typeof api.diffs.deliveries>;
export type DiffView = FunctionReturnType<typeof api.diffs.get>;
export type RunEvents = FunctionReturnType<typeof api.runs.events>;

const id = <T extends TableNames>(s: string) => s as Id<T>;

/** Story seconds → ms since the epoch. */
export const at = (epoch: number, s: number) => epoch + Math.round(s * 1000);

// ---- the beats (story seconds); shots line up against these ----

export const T = {
  miraLands: 18,
  phoneOut: 116.5,
  unfold: 118,
  typeFrom: 119.6,
  send: 122.6,
  /** The computer's reply starts streaming. */
  reply: 125.0,
  plan: 128.0,
  /** First crew member gets up from leisure. */
  scramble: 128.8,
  ezraLands: 142.0,
  night: 9000,
  /** Otis's dark-mode sweep lands: he carries a package to the bridge. */
  otisLands: 9012,
  /** About when he sets it on the counter (the walk from his desk; check with --peek). */
  otisDelivers: 9070,
  sableAsks: 9100,
  finished: 9150,
} as const;

export const REQUEST = "Add dark mode and a billing page";

// ---- the crew ----

interface CrewDef {
  key: string;
  name: string;
  specialty: string;
  harness: "claude" | "codex";
  /** A kit preset id, or null for a seeded random look. */
  preset: string | null;
  hiredAt?: number;
  arrivesAt?: number;
}

const CREW: CrewDef[] = [
  { key: "wren", name: "Wren", specialty: "Design systems, CSS, the details", harness: "claude", preset: "wren" },
  { key: "otis", name: "Otis", specialty: "Front end, never in a hurry", harness: "claude", preset: "otis" },
  { key: "kofi", name: "Kofi", specialty: "First mate: settings, accounts, glue", harness: "codex", preset: "kofi" },
  { key: "sable", name: "Sable", specialty: "APIs and payments", harness: "codex", preset: "sable" },
  { key: "marlo", name: "Marlo", specialty: "Webhooks, queues, the plumbing", harness: "claude", preset: "marlo" },
  { key: "nova", name: "Nova", specialty: "Tests: end to end and back", harness: "codex", preset: "nova" },
  { key: "juniper", name: "Juniper", specialty: "Product pages, copy, polish", harness: "claude", preset: "juniper" },
  { key: "ines", name: "Ines", specialty: "Auth and security", harness: "claude", preset: "ines" },
  { key: "bodhi", name: "Bodhi", specialty: "Mobile web, accessibility", harness: "codex", preset: "bodhi" },
  { key: "teo", name: "Teo", specialty: "Databases and migrations", harness: "claude", preset: "teo" },
  { key: "coral", name: "Coral", specialty: "Build speed, CI", harness: "codex", preset: "coral" },
  { key: "pike", name: "Pike", specialty: "Ops, infra, the bar", harness: "claude", preset: "pike" },
  { key: "lumi", name: "Lumi", specialty: "Docs and onboarding", harness: "claude", preset: "lumi" },
  { key: "mira", name: "Mira", specialty: "Performance", harness: "codex", preset: null, hiredAt: 4, arrivesAt: T.miraLands },
  { key: "ezra", name: "Ezra", specialty: "Checkout flows", harness: "claude", preset: null, hiredAt: T.plan, arrivesAt: T.ezraLands },
];

export const CREW_KEYS = CREW.map((c) => c.key);
export const crewId = (key: string) => `crew_${key}`;
const COMPUTER = "crew_computer";

// ---- threads, tasks, messages ----

type Kind = "read" | "search" | "edit" | "write" | "bash" | "web" | "plan" | "agent";
interface TaskDef {
  key: string;
  thread: string;
  repo: "web" | "api";
  title: string;
  brief: string;
  crew: string;
  createdAt: number;
  startAt: number;
  landAt: number;
  dependsOn?: string[];
  diff: { added: number; removed: number; files: number };
  /** What they do, round and round, a step every `every` seconds. */
  steps: [Kind, string][];
  every?: number;
  report?: string;
}

interface ThreadDef {
  key: string;
  title: string;
  createdAt: number;
  slug: string;
  finishedAt?: number;
  prs?: { repo: "web" | "api"; n: number }[];
}

interface MessageDef {
  key: string;
  thread: string;
  at: number;
  author: "captain" | "computer" | "system" | string;
  kind: "text" | "plan" | "report" | "system";
  text: string;
  /** Streams in over this many seconds. */
  stream?: number;
  task?: string;
}

const THREADS: ThreadDef[] = [
  { key: "dark", title: REQUEST, createdAt: T.send, slug: "dark-mode-billing", finishedAt: T.finished, prs: [{ repo: "web", n: 412 }, { repo: "api", n: 87 }] },
  { key: "passkeys", title: "Sign in with passkeys", createdAt: 2400, slug: "passkeys" },
  { key: "tests", title: "Make the test suite twice as fast", createdAt: 3100, slug: "faster-tests" },
  { key: "docs", title: "Write the self-hosting guide", createdAt: 4200, slug: "self-hosting-guide" },
];

const P = T.plan;
const TASKS: TaskDef[] = [
  // "Add dark mode and a billing page": eight tasks over two repos.
  {
    key: "tokens", thread: "dark", repo: "web", title: "Dark theme tokens", crew: "wren", createdAt: P, startAt: T.scramble, landAt: 1480,
    brief: "Add a dark palette to the theme tokens and a data-theme switch on <html>.",
    diff: { added: 96, removed: 12, files: 4 },
    steps: [["read", "Read src/theme/tokens.css"], ["search", "rg -n \"#fff|#000\" src"], ["edit", "Edit src/theme/tokens.css"], ["bash", "pnpm test theme"]],
    report: "Dark palette in tokens.css, switched by data-theme on <html>. Contrast checked against WCAG AA.",
  },
  {
    key: "toggle", thread: "dark", repo: "web", title: "Theme toggle in settings", crew: "kofi", createdAt: P, startAt: T.scramble + 0.5, landAt: 1910,
    brief: "A light / dark / system control in Settings → Appearance, remembered per account.",
    diff: { added: 74, removed: 6, files: 3 },
    steps: [["read", "Read src/settings/Appearance.tsx"], ["edit", "Edit src/settings/Appearance.tsx"], ["write", "Write src/settings/useTheme.ts"], ["bash", "pnpm vitest settings"]],
    report: "Settings → Appearance has Light, Dark and System. It follows the OS until you pick.",
  },
  {
    key: "sweep", thread: "dark", repo: "web", title: "Dark mode pass over every component", crew: "otis", createdAt: P, startAt: T.scramble + 1.1, landAt: T.otisLands,
    brief: "Replace hard-coded colours with tokens across src/components; check each in both themes.",
    diff: { added: 214, removed: 97, files: 12 },
    steps: [["search", "rg -n \"color: #\" src/components"], ["edit", "Edit src/components/Card.tsx"], ["edit", "Edit src/components/Table.tsx"], ["bash", "pnpm storybook --smoke"], ["edit", "Edit src/components/Modal.tsx"]],
    every: 9,
    report: "Every component reads the tokens now: 12 files, no hard-coded colours left. Screenshots in both themes are in the PR.",
  },
  {
    key: "billing-api", thread: "dark", repo: "api", title: "Billing API: customers and subscriptions", crew: "sable", createdAt: P, startAt: T.scramble + 1.6, landAt: 2620,
    brief: "Stripe customers, subscriptions and the portal session, behind /billing.",
    diff: { added: 188, removed: 4, files: 6 },
    steps: [["read", "Read src/routes/index.ts"], ["web", "Stripe docs: subscriptions"], ["write", "Write src/billing/subscriptions.ts"], ["bash", "pnpm test billing"]],
    report: "/billing/customer, /billing/subscription and /billing/portal, with tests against Stripe's mock server.",
  },
  {
    key: "webhooks", thread: "dark", repo: "api", title: "Stripe webhooks", crew: "marlo", createdAt: P, startAt: T.scramble + 2.2, landAt: 3010,
    brief: "Verify signatures; keep subscriptions in step on invoice and subscription events.",
    diff: { added: 131, removed: 8, files: 4 },
    steps: [["read", "Read src/billing/subscriptions.ts"], ["write", "Write src/billing/webhooks.ts"], ["bash", "stripe trigger invoice.paid"], ["edit", "Edit src/routes/index.ts"]],
    report: "Signed webhooks for invoices and subscriptions; replays are idempotent.",
  },
  {
    key: "e2e", thread: "dark", repo: "web", title: "End-to-end tests for themes and billing", crew: "nova", createdAt: P, startAt: T.scramble + 2.9, landAt: 9120,
    brief: "Playwright: switching themes, upgrading a plan, the invoice list.",
    diff: { added: 162, removed: 0, files: 5 },
    steps: [["write", "Write e2e/theme.spec.ts"], ["bash", "pnpm playwright test theme"], ["write", "Write e2e/billing.spec.ts"], ["bash", "pnpm playwright test billing"]],
    report: "Theme switching and the whole upgrade flow are covered; 9 new tests, all green.",
  },
  {
    key: "billing-page", thread: "dark", repo: "web", title: "Billing page", crew: "juniper", createdAt: P, startAt: 2640, landAt: 9060, dependsOn: ["billing-api"],
    brief: "Settings → Billing: current plan, change plan, payment method, invoices.",
    diff: { added: 241, removed: 18, files: 7 },
    steps: [["read", "Read src/settings/index.tsx"], ["write", "Write src/settings/Billing.tsx"], ["edit", "Edit src/settings/Billing.tsx"], ["bash", "pnpm dev --smoke /settings/billing"]],
    report: "Settings → Billing shows the plan, lets you change it and the card, and lists invoices.",
  },
  {
    key: "checkout", thread: "dark", repo: "web", title: "Plan picker and checkout", crew: "ezra", createdAt: P, startAt: T.ezraLands, landAt: 9090,
    brief: "The plan picker and Stripe Checkout, back to a thank-you page.",
    diff: { added: 156, removed: 11, files: 5 },
    steps: [["read", "Read src/pricing/Plans.tsx"], ["edit", "Edit src/pricing/Plans.tsx"], ["write", "Write src/billing/checkout.ts"], ["bash", "pnpm test checkout"]],
    report: "Pick a plan, pay with Stripe Checkout, land on a thank-you page.",
  },
  // The rest of the evening's work, so everyone is busy at night.
  { key: "pk-api", thread: "passkeys", repo: "api", title: "WebAuthn registration and login", crew: "ines", createdAt: 2400, startAt: 2405, landAt: 9500, diff: { added: 220, removed: 14, files: 6 }, brief: "", steps: [["read", "Read src/auth/session.ts"], ["web", "webauthn.guide"], ["write", "Write src/auth/passkeys.ts"], ["bash", "pnpm test auth"]] },
  { key: "pk-ui", thread: "passkeys", repo: "web", title: "Passkey sign-in screen", crew: "bodhi", createdAt: 2400, startAt: 2410, landAt: 9600, diff: { added: 140, removed: 22, files: 4 }, brief: "", steps: [["edit", "Edit src/auth/SignIn.tsx"], ["bash", "pnpm test sign-in"], ["read", "Read src/auth/api.ts"]] },
  { key: "pk-db", thread: "passkeys", repo: "api", title: "Credentials table and migration", crew: "teo", createdAt: 2400, startAt: 2415, landAt: 9700, diff: { added: 64, removed: 0, files: 3 }, brief: "", steps: [["write", "Write migrations/0042_passkeys.sql"], ["bash", "pnpm db:migrate --dry-run"], ["edit", "Edit src/db/schema.ts"]] },
  { key: "pk-settings", thread: "passkeys", repo: "web", title: "Manage passkeys in settings", crew: "kofi", createdAt: 2400, startAt: 2420, landAt: 9800, diff: { added: 98, removed: 3, files: 3 }, brief: "", steps: [["edit", "Edit src/settings/Security.tsx"], ["bash", "pnpm vitest security"]] },
  { key: "t-cache", thread: "tests", repo: "web", title: "Cache the build between test runs", crew: "coral", createdAt: 3100, startAt: 3105, landAt: 9550, diff: { added: 41, removed: 19, files: 3 }, brief: "", steps: [["read", "Read vitest.config.ts"], ["edit", "Edit vitest.config.ts"], ["bash", "pnpm test --reporter=dot"]] },
  { key: "t-shard", thread: "tests", repo: "api", title: "Shard the API tests", crew: "pike", createdAt: 3100, startAt: 3110, landAt: 9650, diff: { added: 37, removed: 12, files: 2 }, brief: "", steps: [["edit", "Edit .github/workflows/ci.yml"], ["bash", "pnpm test --shard=1/4"]] },
  { key: "t-flaky", thread: "tests", repo: "web", title: "Fix the flaky checkout test", crew: "wren", createdAt: 3100, startAt: 3115, landAt: 9750, diff: { added: 12, removed: 9, files: 1 }, brief: "", steps: [["bash", "pnpm playwright test checkout --repeat-each=20"], ["read", "Read e2e/checkout.spec.ts"], ["edit", "Edit e2e/checkout.spec.ts"]] },
  { key: "t-profile", thread: "tests", repo: "api", title: "Profile the slowest suites", crew: "mira", createdAt: 3100, startAt: 3120, landAt: 9030, diff: { added: 23, removed: 41, files: 4 }, brief: "", steps: [["bash", "pnpm test --profile"], ["read", "Read profile.json"], ["edit", "Edit src/test/setup.ts"]], report: "The DB setup ran per test; it's per file now. The API suite is 2.3x faster." },
  { key: "d-guide", thread: "docs", repo: "web", title: "Self-hosting guide", crew: "lumi", createdAt: 4200, startAt: 4205, landAt: 9900, diff: { added: 310, removed: 0, files: 2 }, brief: "", steps: [["write", "Write docs/self-hosting.md"], ["read", "Read docker-compose.yml"], ["edit", "Edit docs/self-hosting.md"]] },
  { key: "d-stripe", thread: "docs", repo: "api", title: "Upgrade the Stripe SDK", crew: "sable", createdAt: 4200, startAt: 4210, landAt: 9850, diff: { added: 28, removed: 26, files: 3 }, brief: "", steps: [["bash", "pnpm up stripe"], ["bash", "pnpm test billing"], ["edit", "Edit src/billing/client.ts"]] },
  { key: "d-retry", thread: "docs", repo: "api", title: "Retry failed webhooks", crew: "marlo", createdAt: 4200, startAt: 4215, landAt: 9950, diff: { added: 52, removed: 7, files: 2 }, brief: "", steps: [["write", "Write src/billing/retry.ts"], ["bash", "pnpm test webhooks"]] },
  { key: "d-api", thread: "docs", repo: "api", title: "Document the billing endpoints", crew: "otis", createdAt: 4200, startAt: 9110, landAt: 9990, diff: { added: 88, removed: 0, files: 1 }, brief: "", steps: [["read", "Read src/billing/subscriptions.ts"], ["write", "Write docs/api/billing.md"]] },
];

const PLAN_TEXT = "Eight tasks across web and api. Billing's API lands first; the page and checkout build on it.";

const MESSAGES: MessageDef[] = [
  { key: "ask", thread: "dark", at: T.send, author: "captain", kind: "text", text: REQUEST },
  {
    key: "reply", thread: "dark", at: T.reply, author: "computer", kind: "text", stream: 2.2,
    text: "On it. Dark mode is new theme tokens plus a sweep through the components; billing is a Stripe API in **api** and a page on top of it in **web**. Eight tasks. Everyone's busy, so I've hired **Ezra** for checkout; he's on the helicopter.",
  },
  { key: "plan", thread: "dark", at: T.plan, author: "computer", kind: "plan", text: PLAN_TEXT },
  ...TASKS.filter((t) => t.thread === "dark").map((t): MessageDef => ({ key: `report-${t.key}`, thread: "dark", at: t.landAt, author: t.crew, kind: "report", text: t.report ?? "Done.", task: t.key })),
  {
    key: "finished", thread: "dark", at: T.finished, author: "system", kind: "system",
    text: `${REQUEST}\nDark mode everywhere, with a switch in Settings → Appearance. Billing: plans, Stripe Checkout, a billing page and invoices, with webhooks keeping it in step.\n\nPull requests: **web #412** and **api #87**, both on offsite/dark-mode-billing.`,
  },
  { key: "pk-ask", thread: "passkeys", at: 2400, author: "captain", kind: "text", text: "Let people sign in with passkeys" },
  { key: "pk-plan", thread: "passkeys", at: 2404, author: "computer", kind: "plan", text: "Four tasks." },
  { key: "t-ask", thread: "tests", at: 3100, author: "captain", kind: "text", text: "Make the test suite twice as fast" },
  { key: "t-plan", thread: "tests", at: 3104, author: "computer", kind: "plan", text: "Four tasks." },
  { key: "d-ask", thread: "docs", at: 4200, author: "captain", kind: "text", text: "Write the self-hosting guide, and tidy up billing while you're there" },
  { key: "d-plan", thread: "docs", at: 4204, author: "computer", kind: "plan", text: "Four tasks." },
];

/** The computer's own turns: [thread, from, to, steps]. */
const COMPUTER_RUNS: { thread: string; from: number; to: number; steps: [number, Kind, string][] }[] = [
  { thread: "dark", from: T.send + 0.3, to: T.plan + 0.6, steps: [[T.send + 0.3, "read", "Reading web and api"], [T.send + 1.2, "search", "Finding every hard-coded colour"], [T.reply - 0.4, "plan", "Planning"], [T.plan - 0.6, "agent", "Hiring Ezra"]] },
  { thread: "dark", from: T.finished - 20, to: T.finished, steps: [[T.finished - 20, "read", "Reviewing eight tasks"], [T.finished - 8, "bash", "gh pr create"]] },
];

const QUESTIONS: { key: string; crew: string; thread: string; task: string; from: number; to: number; kind: "approval" | "input"; prompt: string; options: string[] | null }[] = [
  { key: "q-migrate", crew: "sable", thread: "docs", task: "d-stripe", from: T.sableAsks, to: T.sableAsks + 45, kind: "approval", prompt: "pnpm db:migrate --env staging", options: ["allow", "always", "deny"] },
];

// ---- evaluation ----

export interface ShipState {
  snapshot: Snapshot;
  threads: ThreadRow[];
  messages: Map<string, MessageRow[]>;
  tasks: Map<string, TaskRow[]>;
  deliveries: Deliveries;
  office: NonNullable<OfficeRow>;
  machines: MachineRow[];
  me: NonNullable<Users>;
}

const REPOS = [
  { _id: id<"repos">("repo_web"), name: "web", machineId: id<"machines">("machine_studio"), path: "~/code/acme-web", defaultBranch: "main", setupCommand: "pnpm install" },
  { _id: id<"repos">("repo_api"), name: "api", machineId: id<"machines">("machine_studio"), path: "~/code/acme-api", defaultBranch: "main", setupCommand: "pnpm install" },
];
const OFFICE_ID = id<"offices">("office_sealegs");
export const OFFICE = OFFICE_ID as string;

function look(def: CrewDef): { avatar: unknown; look: unknown } {
  const p = def.preset ? CREW_PRESETS.find((x) => x.id === def.preset) : undefined;
  if (p) return { avatar: p.spec, look: p.look };
  const r = randomCrewAvatar(`film-${def.key}`);
  return { avatar: r.spec, look: r.look };
}
const LOOKS = new Map(CREW.map((c) => [c.key, look(c)]));

const threadOf = (key: string) => THREADS.find((t) => t.key === key)!;
const taskOf = (key: string) => TASKS.find((t) => t.key === key)!;
const branchOf = (t: ThreadDef) => `offsite/${t.slug}`;

/** Where a task is at story time s. */
function taskState(t: TaskDef, s: number): "todo" | "doing" | "review" | "landed" {
  if (s >= t.landAt) return "landed";
  if (s >= t.landAt - 1.2) return "review";
  if (s >= t.startAt) return "doing";
  return "todo";
}

/** The step a task is on at s: its own list, round and round. */
function stepOf(t: TaskDef, s: number): { i: number; kind: Kind; summary: string; since: number } {
  const every = t.every ?? 11;
  const n = Math.max(0, Math.floor((s - t.startAt) / every));
  const [kind, summary] = t.steps[n % t.steps.length]!;
  return { i: n, kind, summary, since: t.startAt + n * every };
}

function computerLive(s: number) {
  return COMPUTER_RUNS.find((r) => s >= r.from && s < r.to) ?? null;
}

export function shipAt(epoch: number, s: number, seen: ReadonlySet<string> = new Set()): ShipState {
  const ms = (x: number) => at(epoch, x);
  const open = QUESTIONS.filter((q) => s >= q.from && s < q.to);
  const crewRows: CrewRow[] = [];

  // The computer.
  const comp = computerLive(s);
  const compStep = comp ? [...comp.steps].reverse().find(([x]) => x <= s) ?? null : null;
  const compEnded = COMPUTER_RUNS.filter((r) => r.to <= s).at(-1) ?? null;
  crewRows.push({
    _id: id<"crew">(COMPUTER), _creationTime: ms(-86_400), officeId: OFFICE_ID, role: "computer", name: "Computer", handle: "computer",
    avatar: null, look: null, specialty: null, harness: "claude", model: null, effort: "high", profile: null,
    hiredAt: ms(-86_400), arrivesAt: ms(-86_400), dismissedAt: null,
    live: comp && {
      runId: id<"runs">(`run_computer_${comp.from}`), kind: "computer", state: "working", threadId: id<"threads">(`thread_${comp.thread}`),
      threadTitle: threadOf(comp.thread).title, taskId: null, taskTitle: null, repo: null,
      step: compStep ? { itemId: `c${compStep[0]}`, kind: compStep[1], summary: compStep[2], since: ms(compStep[0]) } : null,
      startedAt: ms(comp.from),
    },
    lastEnded: compEnded && { state: "landed", endedAt: ms(compEnded.to), kind: "computer", taskTitle: null, taskId: null, threadId: id<"threads">(`thread_${compEnded.thread}`), diff: null },
    lastStep: null,
    asking: false,
  });

  for (const def of CREW) {
    const hiredAt = def.hiredAt ?? -86_400;
    if (s < hiredAt) continue;
    const mine = TASKS.filter((t) => t.crew === def.key);
    const live = mine.find((t) => s >= t.startAt && s < t.landAt) ?? null;
    const ended = mine.filter((t) => s >= t.landAt).sort((a, b) => b.landAt - a.landAt)[0] ?? null;
    const step = live ? stepOf(live, s) : null;
    const { avatar, look: lk } = LOOKS.get(def.key)!;
    crewRows.push({
      _id: id<"crew">(crewId(def.key)), _creationTime: ms(hiredAt), officeId: OFFICE_ID, role: "crew", name: def.name, handle: def.key,
      avatar, look: lk, specialty: def.specialty, harness: def.harness, model: null, effort: "high", profile: null,
      hiredAt: ms(hiredAt), arrivesAt: ms(def.arrivesAt ?? -86_400), dismissedAt: null,
      live: live && {
        runId: id<"runs">(`run_${live.key}`), kind: "task", state: "working", threadId: id<"threads">(`thread_${live.thread}`),
        threadTitle: threadOf(live.thread).title, taskId: id<"tasks">(`task_${live.key}`), taskTitle: live.title, repo: live.repo,
        step: step && { itemId: `${live.key}-${step.i}`, kind: step.kind, summary: step.summary, since: ms(step.since) },
        startedAt: ms(live.startAt),
      },
      lastEnded: ended && {
        state: "landed", endedAt: ms(ended.landAt), kind: "task", taskTitle: ended.title, taskId: id<"tasks">(`task_${ended.key}`),
        threadId: id<"threads">(`thread_${ended.thread}`), diff: ended.diff,
      },
      lastStep: live && step && step.i > 0 ? live.steps[(step.i - 1) % live.steps.length]![1] : ended ? ended.steps.at(-1)![1] : null,
      asking: open.some((q) => q.crew === def.key),
    });
  }

  const questions: QuestionRow[] = open.map((q) => ({
    _id: id<"questions">(`question_${q.key}`), _creationTime: ms(q.from), officeId: OFFICE_ID, threadId: id<"threads">(`thread_${q.thread}`),
    runId: id<"runs">(`run_${q.task}`), crewId: id<"crew">(crewId(q.crew)), requestId: q.key, kind: q.kind, prompt: q.prompt, options: q.options,
    answer: null, answeredAt: null, deliveredAt: null, createdAt: ms(q.from), crewName: CREW.find((c) => c.key === q.crew)!.name,
  }));

  const office = {
    _id: OFFICE_ID, _creationTime: ms(-86_400 * 30), ownerId: id<"users">("user_captain"), name: "Sea Legs", world: "yacht",
    defaultHarness: "claude" as const, createdAt: ms(-86_400 * 30), repos: REPOS,
    machine: { _id: id<"machines">("machine_studio"), name: "Studio", lastSeenAt: ms(s) },
  };
  const snapshot: Snapshot = {
    office: { _id: OFFICE_ID, name: office.name, world: "yacht", hasRepo: true, repos: REPOS.map((r) => r.name) },
    crew: crewRows,
    questions,
  };

  // Tasks and threads.
  const tasks = new Map<string, TaskRow[]>();
  const taskRow = (t: TaskDef): TaskRow => {
    const st = taskState(t, s);
    return {
      _id: id<"tasks">(`task_${t.key}`), _creationTime: ms(t.createdAt), threadId: id<"threads">(`thread_${t.thread}`), officeId: OFFICE_ID,
      key: t.key, repoId: REPOS.find((r) => r.name === t.repo)!._id, title: t.title, brief: t.brief,
      dependsOn: (t.dependsOn ?? []).map((k) => id<"tasks">(`task_${k}`)), assignee: id<"crew">(crewId(t.crew)), state: st,
      branch: st === "todo" ? null : `${branchOf(threadOf(t.thread))}/${t.key}`, report: st === "landed" ? t.report ?? null : null, notes: null,
      createdAt: ms(t.createdAt), landedAt: st === "landed" ? ms(t.landAt) : null, diff: st === "landed" ? t.diff : null,
      seenAt: seen.has(t.key) ? ms(t.landAt) : null, repo: t.repo,
    };
  };
  const threads: ThreadRow[] = [];
  for (const th of THREADS) {
    if (s < th.createdAt) continue;
    const mine = TASKS.filter((t) => t.thread === th.key && s >= t.createdAt).map(taskRow);
    tasks.set(`thread_${th.key}`, mine);
    const done = th.finishedAt !== undefined && s >= th.finishedAt;
    const landed = mine.filter((t) => t.state === "landed");
    const prs = done ? (th.prs ?? []).map((p) => ({ repo: p.repo, url: `https://github.com/acme/${p.repo}/pull/${p.n}` as string | null, branch: branchOf(th) })) : [];
    threads.push({
      _id: id<"threads">(`thread_${th.key}`), title: th.title, state: done ? "done" : mine.some((t) => t.state !== "todo") ? "working" : "open",
      branch: mine.some((t) => t.branch) ? branchOf(th) : null, prUrl: prs[0]?.url ?? null,
      repos: REPOS.map((r) => r.name).filter((n) => mine.some((t) => t.repo === n)), prs,
      createdAt: ms(th.createdAt), lastMessageAt: ms(Math.max(th.createdAt, ...MESSAGES.filter((m) => m.thread === th.key && m.at <= s).map((m) => m.at))),
      crewIds: [...new Set(mine.map((t) => t.assignee).filter((x): x is Id<"crew"> => !!x))],
      tasks: { total: mine.length, landed: landed.length },
      diff: landed.length ? landed.reduce((a, t) => ({ added: a.added + t.diff!.added, removed: a.removed + t.diff!.removed, files: a.files + t.diff!.files }), { added: 0, removed: 0, files: 0 }) : null,
      openQuestions: questions.filter((q) => q.threadId === `thread_${th.key}`).length,
    });
  }
  threads.sort((a, b) => b.lastMessageAt - a.lastMessageAt);

  // Messages: the computer's reply streams in.
  const messages = new Map<string, MessageRow[]>();
  for (const th of THREADS) {
    const rows: MessageRow[] = [];
    for (const m of MESSAGES.filter((x) => x.thread === th.key && x.at <= s)) {
      const streaming = m.stream !== undefined && s < m.at + m.stream;
      const text = streaming ? m.text.slice(0, Math.max(1, Math.floor(m.text.length * ((s - m.at) / m.stream!)))) : m.text;
      rows.push({
        _id: id<"messages">(`message_${m.key}`), _creationTime: ms(m.at), threadId: id<"threads">(`thread_${th.key}`),
        author: m.author === "captain" ? { kind: "captain" } : m.author === "system" ? { kind: "system" } : { kind: "crew", crewId: id<"crew">(m.author === "computer" ? COMPUTER : crewId(m.author)) },
        kind: m.kind, text, runId: null, taskId: m.task ? id<"tasks">(`task_${m.task}`) : null, streaming, createdAt: ms(m.at),
      });
    }
    messages.set(`thread_${th.key}`, rows);
  }

  const deliveries: Deliveries = TASKS.filter((t) => s >= t.landAt).sort((a, b) => b.landAt - a.landAt).slice(0, 40).map((t) => ({
    taskId: id<"tasks">(`task_${t.key}`), threadId: id<"threads">(`thread_${t.thread}`), title: t.title, crewId: id<"crew">(crewId(t.crew)),
    crewName: CREW.find((c) => c.key === t.crew)!.name, landedAt: ms(t.landAt), diff: t.diff, seen: seen.has(t.key),
  }));

  const machines: MachineRow[] = [{
    _id: id<"machines">("machine_studio"), name: "Studio", hostname: "studio.local", lastSeenAt: ms(s), online: true,
    probe: [
      { harness: "claude", installed: true, auth: "authenticated", plan: "max", profile: null },
      { harness: "codex", installed: true, auth: "authenticated", plan: "pro", profile: null },
    ],
  }];
  const me = { _id: id<"users">("user_captain"), name: "Captain", email: null, avatar: null, look: null };
  return { snapshot, threads, messages, tasks, deliveries, office, machines, me };
}

/** A task's run, as events: the steps so far, for the phone's Watch. */
export function eventsAt(epoch: number, s: number, runId: string): RunEvents {
  const t = TASKS.find((x) => `run_${x.key}` === runId);
  if (!t || s < t.startAt) return [];
  const out: RunEvents = [];
  let seq = 0;
  const push = (atS: number, event: RunEvent) => out.push({ seq: seq++, at: at(epoch, atS), event });
  push(t.startAt, { type: "session.started", resumeCursor: null });
  push(t.startAt, { type: "turn.started", turnId: "t1" });
  const now = stepOf(t, Math.min(s, t.landAt - 0.001));
  const every = t.every ?? 11;
  for (let i = Math.max(0, now.i - 12); i <= now.i; i++) {
    const [kind, summary] = t.steps[i % t.steps.length]!;
    const from = t.startAt + i * every;
    push(from, { type: "item.started", itemId: `${t.key}-${i}`, kind, summary });
    if (i < now.i || s >= t.landAt) push(from + every * 0.8, { type: "item.completed", itemId: `${t.key}-${i}`, summary, detail: null, ok: true, ms: Math.round(every * 800) });
  }
  if (s >= t.landAt && t.report) push(t.landAt, { type: "content.final", text: t.report });
  return out;
}

/** What diffs.get answers for a task (or a whole thread): a real-looking patch for the dark-mode sweep. */
export function diffAt(epoch: number, s: number, threadKey: string, taskKey: string | null): DiffView {
  const th = threadOf(threadKey);
  const task = taskKey ? taskOf(taskKey) : null;
  const def = task ? CREW.find((c) => c.key === task.crew)! : null;
  const { avatar, look: lk } = def ? LOOKS.get(def.key)! : { avatar: null, look: null };
  const tasks = TASKS.filter((t) => t.thread === threadKey && (!task || t === task));
  const landed = tasks.filter((t) => s >= t.landAt);
  const done = th.finishedAt !== undefined && s >= th.finishedAt;
  const repos = REPOS.filter((r) => tasks.some((t) => t.repo === r.name && s >= t.startAt));
  return {
    thread: {
      _id: id<"threads">(`thread_${th.key}`), title: th.title, branch: branchOf(th), state: done ? "done" : "working",
      prs: done ? (th.prs ?? []).map((p) => ({ repo: p.repo, url: `https://github.com/acme/${p.repo}/pull/${p.n}` })) : [],
      lastLandedAt: Math.max(0, ...landed.map((t) => at(epoch, t.landAt))),
    },
    task: task && {
      _id: id<"tasks">(`task_${task.key}`), key: task.key, title: task.title, state: taskState(task, s),
      branch: `${branchOf(th)}/${task.key}`, diff: s >= task.landAt ? task.diff : null, landedAt: s >= task.landAt ? at(epoch, task.landAt) : null,
    },
    crew: def && { _id: id<"crew">(crewId(def.key)), name: def.name, avatar, look: lk },
    repos: repos.map((r) => {
      const patch = r.name === "web" ? SWEEP_PATCH : API_PATCH;
      const files = r.name === "web" ? SWEEP_FILES : API_FILES;
      const sum = landed.filter((t) => t.repo === r.name).reduce((a, t) => ({ added: a.added + t.diff.added, removed: a.removed + t.diff.removed, files: a.files + t.diff.files }), { added: 0, removed: 0, files: 0 });
      return {
        repo: { _id: r._id, name: r.name, defaultBranch: r.defaultBranch },
        machine: { name: "Studio", online: true },
        diff: {
          state: "ready" as const, requestedAt: at(epoch, s - 2), computedAt: at(epoch, s - 1), sha: "9f3c2e1", base: "a41b7d0",
          stats: task ? task.diff : sum, files, patch, truncated: false, error: null,
        },
      };
    }),
  };
}

const SWEEP_FILES = [
  { path: "src/components/Card.tsx", oldPath: null, status: "modified" as const, added: 14, removed: 9, binary: false },
  { path: "src/components/Table.tsx", oldPath: null, status: "modified" as const, added: 22, removed: 15, binary: false },
  { path: "src/theme/tokens.css", oldPath: null, status: "modified" as const, added: 31, removed: 2, binary: false },
  { path: "src/components/Modal.tsx", oldPath: null, status: "modified" as const, added: 11, removed: 8, binary: false },
];

const SWEEP_PATCH = `diff --git a/src/components/Card.tsx b/src/components/Card.tsx
index 3c41e2a..8d0f7b1 100644
--- a/src/components/Card.tsx
+++ b/src/components/Card.tsx
@@ -1,24 +1,29 @@
 import type { ReactNode } from "react";
+import { useTheme } from "../settings/useTheme";

 export function Card({ title, children, tone = "plain" }: CardProps) {
+  const { theme } = useTheme();
   return (
     <section
       className="card"
       style={{
-        background: "#ffffff",
-        color: "#1b1f24",
-        border: "1px solid #e3e6ea",
+        background: "var(--surface)",
+        color: "var(--ink)",
+        border: "1px solid var(--line)",
         borderRadius: 12,
-        boxShadow: "0 1px 2px rgba(0, 0, 0, 0.08)",
+        boxShadow: theme === "dark" ? "none" : "var(--shadow-1)",
       }}
+      data-tone={tone}
     >
-      <h3 style={{ color: "#0b0d10" }}>{title}</h3>
+      <h3 style={{ color: "var(--ink-strong)" }}>{title}</h3>
       {children}
     </section>
   );
 }
diff --git a/src/components/Table.tsx b/src/components/Table.tsx
index 77a10c4..b2e94d3 100644
--- a/src/components/Table.tsx
+++ b/src/components/Table.tsx
@@ -12,18 +12,22 @@ export function Table<T>({ rows, columns }: TableProps<T>) {
   return (
-    <table style={{ background: "#fff", borderColor: "#e3e6ea" }}>
+    <table style={{ background: "var(--surface)", borderColor: "var(--line)" }}>
       <thead>
-        <tr style={{ background: "#f6f7f9", color: "#5b6470" }}>
+        <tr style={{ background: "var(--surface-2)", color: "var(--ink-2)" }}>
           {columns.map((c) => (
             <th key={c.key}>{c.label}</th>
           ))}
         </tr>
       </thead>
       <tbody>
         {rows.map((r, i) => (
-          <tr key={i} style={{ background: i % 2 ? "#fafbfc" : "#fff" }}>
+          <tr key={i} style={{ background: i % 2 ? "var(--surface-2)" : "var(--surface)" }}>
             {columns.map((c) => <td key={c.key}>{c.render(r)}</td>)}
           </tr>
         ))}
diff --git a/src/theme/tokens.css b/src/theme/tokens.css
index 1f0a9c2..c7d3e55 100644
--- a/src/theme/tokens.css
+++ b/src/theme/tokens.css
@@ -1,9 +1,38 @@
 :root {
   --surface: #ffffff;
   --surface-2: #f6f7f9;
+  --ink: #1b1f24;
+  --ink-2: #5b6470;
+  --ink-strong: #0b0d10;
+  --line: #e3e6ea;
+  --accent: #2f6bff;
+  --shadow-1: 0 1px 2px rgba(0, 0, 0, 0.08);
 }
+
+/* Dark: follows the system until you pick in Settings → Appearance. */
+@media (prefers-color-scheme: dark) {
+  :root:not([data-theme="light"]) {
+    --surface: #0f1217;
+    --surface-2: #161a21;
+    --ink: #e7ebf0;
+    --ink-2: #9aa4b2;
+    --ink-strong: #ffffff;
+    --line: #262c36;
+    --accent: #6d9bff;
+  }
+}
+
+:root[data-theme="dark"] {
+  --surface: #0f1217;
+  --surface-2: #161a21;
+  --ink: #e7ebf0;
+  --ink-2: #9aa4b2;
+  --ink-strong: #ffffff;
+  --line: #262c36;
+  --accent: #6d9bff;
+}
diff --git a/src/components/Modal.tsx b/src/components/Modal.tsx
index 0d9e1b7..5aa21f8 100644
--- a/src/components/Modal.tsx
+++ b/src/components/Modal.tsx
@@ -8,14 +8,17 @@ export function Modal({ open, onClose, children }: ModalProps) {
   if (!open) return null;
   return (
-    <div className="backdrop" style={{ background: "rgba(0, 0, 0, 0.4)" }} onClick={onClose}>
-      <div className="modal" style={{ background: "#fff", color: "#1b1f24" }}>
+    <div className="backdrop" style={{ background: "var(--backdrop)" }} onClick={onClose}>
+      <div className="modal" style={{ background: "var(--surface)", color: "var(--ink)" }}>
         {children}
       </div>
     </div>
   );
 }
`;

const API_FILES = [
  { path: "src/billing/subscriptions.ts", oldPath: null, status: "added" as const, added: 64, removed: 0, binary: false },
  { path: "src/routes/index.ts", oldPath: null, status: "modified" as const, added: 4, removed: 0, binary: false },
];

const API_PATCH = `diff --git a/src/billing/subscriptions.ts b/src/billing/subscriptions.ts
new file mode 100644
index 0000000..4be1c0a
--- /dev/null
+++ b/src/billing/subscriptions.ts
@@ -0,0 +1,22 @@
+import { stripe } from "./client";
+import { requireAccount } from "../auth/session";
+
+/** The account's plan, from Stripe: what Settings → Billing shows. */
+export async function currentPlan(req: Request) {
+  const account = await requireAccount(req);
+  if (!account.stripeCustomerId) return { plan: "free", renewsAt: null };
+  const subs = await stripe.subscriptions.list({ customer: account.stripeCustomerId, status: "active", limit: 1 });
+  const sub = subs.data[0];
+  return sub ? { plan: sub.items.data[0]!.price.lookup_key, renewsAt: sub.current_period_end * 1000 } : { plan: "free", renewsAt: null };
+}
+
+/** A link to Stripe's customer portal: change the card, cancel, see invoices. */
+export async function portalSession(req: Request) {
+  const account = await requireAccount(req);
+  const session = await stripe.billingPortal.sessions.create({
+    customer: account.stripeCustomerId!,
+    return_url: new URL("/settings/billing", req.url).toString(),
+  });
+  return { url: session.url };
+}
diff --git a/src/routes/index.ts b/src/routes/index.ts
index 9a7e1c3..0b5d2f8 100644
--- a/src/routes/index.ts
+++ b/src/routes/index.ts
@@ -3,6 +3,10 @@ import { router } from "./router";
 router.get("/health", () => ok());
+router.get("/billing/subscription", currentPlan);
+router.post("/billing/portal", portalSession);
+router.post("/billing/checkout", checkoutSession);
+router.post("/billing/webhooks", stripeWebhook);
`;

/** Crew keys whose look and name a shot may refer to. */
export function crewName(key: string): string {
  return CREW.find((c) => c.key === key)?.name ?? key;
}
