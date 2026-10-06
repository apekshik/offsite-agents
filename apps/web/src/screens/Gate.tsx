import { Component, lazy, Suspense, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { COMPUTER_BLURB, COMPUTER_NAME } from "@offsite/contracts";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Backdrop } from "../landing/Backdrop.tsx";
import { WORLD_LIST, worldInfo, type WorldInfo } from "../worlds.ts";
import { newOffsite, useNewOffsite } from "./newOffsite.ts";
import { Landing } from "./Landing.tsx";
import { Button, Chip, errorText, Face, Field, Input, OrchestratorBadge } from "../ui/index.tsx";
import { CodeEntry, HarnessField, LoginSteps, MachineCard, Repos } from "./setup.tsx";
import "./screens.css";

// The way aboard: sign in → make your ship → meet the crew → connect your machine → your repos
// → aboard (the game under the overlay). The machine steps can be skipped; the crew lounges
// until a machine is connected. Machines are approved at /pair?code= (Pair.tsx); an older ?connect=<code>
// link goes there.
// Every step sits over the same night yacht as the front door.

const skipKey = (officeId: string) => `offsite:setup-skipped:${officeId}`;
const readSkip = (officeId: string) => { try { return localStorage.getItem(skipKey(officeId)) === "1"; } catch { return false; } };
const writeSkip = (officeId: string) => { try { localStorage.setItem(skipKey(officeId), "1"); } catch { /* private mode */ } };

const STEPS = ["Your ship", "Your machine", "Your repos"] as const;

function Stepper({ step }: { step: 1 | 2 | 3 }) {
  return (
    <ol className="stepper" aria-label={`Step ${step} of ${STEPS.length}`}>
      {STEPS.map((s, i) => {
        const n = i + 1, state = n === step ? "on" : n < step ? "done" : "todo";
        return (
          <li key={s} className={`st ${state}`} aria-current={state === "on" ? "step" : undefined}>
            <span className="st-dot" aria-hidden="true">
              {state === "done" ? <svg viewBox="0 0 16 16" width="12" height="12"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg> : n}
            </span>
            <span className="st-label">{s}</span>
            {state === "done" ? <span className="sr"> (done)</span> : null}
          </li>
        );
      })}
    </ol>
  );
}

function Shell({ step, children, wide, label }: { step?: 1 | 2 | 3; children: ReactNode; wide?: boolean; label?: string }) {
  return (
    <div className="screen">
      <Backdrop dim />
      <main className={`screen-card ${wide ? "wide" : ""}`} aria-label={label}>
        <div className="sc-top">
          <span className="disp wordmark">Offsite</span>
          {step ? <Stepper step={step} /> : null}
        </div>
        {children}
      </main>
    </div>
  );
}

function Splash({ text }: { text?: string }) {
  return (
    <div className="screen splash">
      <Backdrop dim />
      <div className="sc-splash" role="status">
        <span className="disp wordmark big">Offsite</span>
        <span className="sc-splash-line"><span className="dots"><i /><i /><i /></span>{text ? <span className="dim">{text}</span> : null}</span>
      </div>
    </div>
  );
}

function WorldCard({ w, on, onPick }: { w: WorldInfo; on: boolean; onPick: () => void }) {
  return (
    <label className={`world ${on ? "on" : ""} ${w.ready ? "" : "soon"}`}>
      <input type="radio" name="world" value={w.id} checked={on} disabled={!w.ready} onChange={onPick} className="world-radio" />
      <span className="world-art"><img src={w.art} alt="" loading="lazy" decoding="async" width={720} height={405} /></span>
      {w.ready ? (on ? <span className="world-badge pick">Your pick</span> : null) : <span className="world-badge">Coming soon</span>}
      <span className="world-text">
        <span className="world-name">{w.name}</span>
        <span className="world-blurb">{w.blurb}</span>
      </span>
    </label>
  );
}

/** What a new ship is called if you don't say, by world. */
const SAMPLE_NAME: Record<string, string> = { yacht: "Sea Legs", "moon-base": "Tranquility" };

/**
 * Name it and pick its world: your first ship, or (`back` set, from aboard one: the Places menu, the switcher)
 * another offsite of your own, separate from the one you came from, with a way back to it.
 */
function MakeShip({ onMade, world: start, back }: { onMade: (id: string) => void; world?: string | null | undefined; back?: { name: string; go: () => void } | undefined }) {
  const create = useMutation(api.offices.create);
  const [name, setName] = useState("");
  const [world, setWorld] = useState(() => (start && worldInfo(start)?.ready ? start : WORLD_LIST.find((w) => w.ready)?.id ?? "yacht"));
  const sample = SAMPLE_NAME[world] ?? "Sea Legs";
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const soon = WORLD_LIST.filter((w) => !w.ready).map((w) => w.name);
  // Asked for in a world (Places' "New offsite here"): that one first.
  const [worlds] = useState(() => [...WORLD_LIST].sort((a, b) => Number(b.id === start) - Number(a.id === start)));
  const go = async () => {
    setBusy(true);
    setErr(null);
    try { onMade(await create({ name: name.trim() || sample, world })); } catch (x) { setErr(errorText(x)); setBusy(false); }
  };
  // Esc anywhere goes back to the offsite you came from.
  const leave = useRef(back?.go);
  leave.current = back?.go;
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === "Escape" && leave.current) { e.preventDefault(); leave.current(); } };
    addEventListener("keydown", down);
    return () => removeEventListener("keydown", down);
  }, []);
  return (
    <Shell step={1} wide label={back ? "Make a new offsite" : "Make your ship"}>
      {back ? <Button kind="ghost" size="sm" className="sc-back" disabled={busy} onClick={back.go}>← Back to {back.name}</Button> : null}
      <div className="sc-hero">
        <h1 className="disp">{back ? "Make a new offsite" : "Make your ship"}</h1>
        <p className="ink2">{back
          ? `A separate offsite with its own crew, threads and repos. ${back.name} stays as it is: switch between them from the phone's Ship tab.`
          : "Name it and pick where your crew works. You can rename it later."}</p>
      </div>
      <Field label={back ? "Its name" : "Ship's name"}>
        <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={sample} maxLength={40}
          onKeyDown={(e) => { if (e.key === "Enter") void go(); }} />
      </Field>
      <div className="world-pick">
        <span className="lab dim" id="world-label">Where your crew works</span>
        <div className="worlds" role="radiogroup" aria-labelledby="world-label">
          {worlds.map((w) => <WorldCard key={w.id} w={w} on={w.id === world} onPick={() => setWorld(w.id)} />)}
        </div>
        {soon.length ? <p className="dim sc-fine">More worlds are on the way: {listOf(soon)}.</p> : null}
      </div>
      {err ? <div className="error" role="alert">{err}</div> : null}
      <div className="actions"><Button kind="primary" size="lg" disabled={busy} onClick={() => void go()}>{busy ? "Launching…" : back ? "Make the offsite" : "Make the ship"}</Button></div>
    </Shell>
  );
}

const listOf = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

function Meet({ officeId, onNext }: { officeId: string; onNext: () => void }) {
  const crew = useQuery(api.crew.list, { officeId: officeId as Id<"offices"> });
  const computah = crew?.find((c) => c.role === "computer");
  const rest = (crew ?? []).filter((c) => c.role !== "computer");
  return (
    <Shell step={1} label="Meet your crew">
      <div className="sc-hero">
        <h1 className="disp">Meet your crew</h1>
        <p className="ink2">{COMPUTER_NAME} runs the ship. The crew do the work, at desks or on loungers with laptops. Hire more whenever you like.</p>
      </div>
      {crew === undefined ? <div className="sc-splash-line"><span className="dots"><i /><i /><i /></span></div> : (
        <>
          {computah ? (
            <div className="computah fade-up">
              <Face avatar={computah.avatar} look={computah.look} computer size={52} />
              <div className="computah-who">
                <span className="computah-name">{COMPUTER_NAME} <OrchestratorBadge /></span>
                <span className="ink2">{COMPUTER_BLURB}</span>
                <span className="dim computah-where">Lives at the helm on the bridge. Talk to it there, or on your phone.</span>
              </div>
            </div>
          ) : null}
          {rest.length ? (
            <div className="meet">
              <span className="lab dim">Your crew</span>
              {rest.map((c) => (
                <div key={c._id} className="meet-row fade-up">
                  <Face avatar={c.avatar} look={c.look} size={40} />
                  <div className="meet-who">
                    <span className="meet-name">{c.name} <Chip>{c.harness === "codex" ? "Codex" : c.harness === "sim" ? "Sim crew" : "Claude Code"}</Chip></span>
                    <span className="dim">{c.specialty ?? "Ready for anything."}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </>
      )}
      <div className="actions"><Button kind="primary" size="lg" onClick={onNext}>Next: connect your machine</Button></div>
    </Shell>
  );
}

/** Watches for a machine that wasn't there when the step opened: then it celebrates, and moves on. */
function Connect({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  const machines = useQuery(api.machines.mine);
  const known = useRef<Set<string> | null>(null);
  const [paired, setPaired] = useState<string | null>(null);
  const next = useRef(onNext);
  next.current = onNext;
  useEffect(() => {
    if (!machines) return;
    if (!known.current) { known.current = new Set(machines.map((m) => m._id)); return; }
    const fresh = machines.find((m) => !known.current!.has(m._id));
    if (fresh) setPaired((p) => p ?? fresh.name);
  }, [machines]);
  useEffect(() => {
    if (!paired) return;
    const t = setTimeout(() => next.current(), 2800);
    return () => clearTimeout(t);
  }, [paired]);
  const some = !!machines?.length;
  return (
    <Shell step={2} wide label="Connect your machine">
      <div className="sc-hero">
        <h1 className="disp">Connect your machine</h1>
        <p className="ink2">Your crew runs on your computer, with your own Claude Code and Codex logins. Offsite never sees them.</p>
      </div>
      <LoginSteps />
      {paired ? (
        <div className="paired-card" role="status">
          <span className="paired-burst" aria-hidden="true">{Array.from({ length: 12 }, (_, i) => <i key={i} style={{ "--i": i } as CSSProperties} />)}</span>
          <span className="paired-check" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
          <span className="paired-text"><b>{paired} is aboard.</b><span className="dim">Your crew can work there now. Next, your repos…</span></span>
        </div>
      ) : (
        <div className="pairing-wait" role="status" aria-live="polite">
          <span className="radar" aria-hidden="true"><i /><i /></span>
          <span>Waiting for your machine…</span>
        </div>
      )}
      {some && !paired ? <div className="sc-machines">{machines.map((m) => <MachineCard key={m._id} m={m} />)}</div> : null}
      {paired ? null : (
        <details className="have-code">
          <summary>Have a code?</summary>
          <CodeEntry />
        </details>
      )}
      <div className="actions">
        {some ? <Button kind="primary" size="lg" onClick={onNext}>Next: your repos</Button> : null}
        <Button kind="ghost" onClick={onSkip}>Skip for now and come aboard</Button>
      </div>
      <p className="dim sc-fine">Skipping is fine: the crew lounges on deck until a machine is connected. Connect one later from the phone's Ship tab.</p>
    </Shell>
  );
}

function Project({ officeId, onDone, onSkip }: { officeId: string; onDone: () => void; onSkip: () => void }) {
  const repos = useQuery(api.repos.list, { officeId: officeId as Id<"offices"> });
  const some = !!repos?.length;
  return (
    <Shell step={3} wide label="Your repos">
      <div className="sc-hero">
        <h1 className="disp">Your repos</h1>
        <p className="ink2">The folders on your machines the crew works on: one, or several (say a web app and its API). {COMPUTER_NAME} puts each task in the repo it changes; a thread's work lands on one branch name in each.</p>
      </div>
      <Repos officeId={officeId} removeLast />
      {some ? <HarnessField officeId={officeId} /> : null}
      <div className="actions">
        {some ? <Button kind="primary" size="lg" onClick={onDone}>Come aboard</Button> : null}
        <Button kind="ghost" onClick={onSkip}>Skip for now and come aboard</Button>
      </div>
    </Shell>
  );
}

// The game and everything aboard: its own chunk (three.js, the world, the overlay), fetched once
// you're signed in, so the front door paints without it.
const loadAboard = () => import("./Aboard.tsx");
const Aboard = lazy(() => loadAboard().then((m) => ({ default: m.Aboard })));
const Boarding = () => <div className="boarding"><span className="disp">Boarding</span><span className="dots"><i /><i /><i /></span></div>;

export function Gate() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const me = useQuery(api.users.me, isAuthenticated ? {} : "skip");
  const ensure = useMutation(api.users.ensure);
  const offices = useQuery(api.offices.mine, me ? {} : "skip");
  const joined = useQuery(api.members.joined, me ? {} : "skip");
  const machines = useQuery(api.machines.mine, me ? {} : "skip");
  // An older pairing link: /?connect=CODE is now /pair?code=CODE.
  const [connect] = useState(() => new URLSearchParams(location.search).get("connect"));
  useEffect(() => { if (connect) location.replace(`/pair?code=${encodeURIComponent(connect)}`); }, [connect]);
  const [made, setMade] = useState<string | null>(null);
  // Another offsite of your own, asked for from aboard one (or /?new=ship): newOffsite.ts.
  const newShip = useNewOffsite();
  const [stage, setStage] = useState<"meet" | "connect" | "project" | null>(null);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [ensureErr, setEnsureErr] = useState<string | null>(null);

  // Signed in: start fetching the ship while the way aboard is still on screen.
  useEffect(() => { if (isAuthenticated) void loadAboard().catch(() => {}); }, [isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated && me === null) void ensure().catch((e) => setEnsureErr(errorText(e)));
  }, [isAuthenticated, me, ensure]);

  // The ship you're aboard: the one you just made, else the one you last boarded (yours, or a friend's you joined),
  // else your newest, else the newest you joined. A friend with no ship of their own never sees "make your ship".
  const want = made ?? me?.aboardId ?? null;
  // Once you're recorded aboard the one you made, that record leads again (the switcher moves it).
  useEffect(() => { if (made && me?.aboardId === made) setMade(null); }, [made, me?.aboardId]);
  const wantJoined = want ? joined?.find((j) => j._id === want) : undefined;
  const own = (want ? offices?.find((o) => o._id === want) : undefined) ?? (wantJoined ? undefined : offices?.[0]);
  const friend = own ? undefined : (wantJoined ?? joined?.[0]);
  const office = own ?? (friend ? { _id: friend._id, repoCount: 1 } : undefined);
  // A friend's ship you were just on and aren't any more (you left, or were taken off): say so, once.
  const lastFriend = useRef<{ _id: string; name: string } | null>(null);
  const [gone, setGone] = useState<string | null>(null);
  useEffect(() => {
    if (friend) { lastFriend.current = { _id: friend._id, name: friend.name }; return; }
    const was = lastFriend.current;
    if (was && joined && !joined.some((j) => j._id === was._id)) { setGone(was.name); lastFriend.current = null; }
  }, [friend, joined]);
  const skippedHere = !!office && (skipped.has(office._id) || readSkip(office._id));
  // A step the ship still needs stays on screen until you move on from it: pairing a machine
  // celebrates before the repos, and adding a first repo doesn't whisk you aboard mid-list. Only your own ship.
  const need = !own || skippedHere || stage !== null || !machines ? null
    : machines.length === 0 ? "connect" : !own.repoCount ? "project" : null;
  useEffect(() => { if (need) setStage(need); }, [need]);

  if (isLoading) return <Landing checking />;
  if (!isAuthenticated) return <Landing />;
  if (ensureErr) return <Shell><p className="error" role="alert">{ensureErr}</p></Shell>;
  if (!me || offices === undefined || joined === undefined || machines === undefined) return <Splash text="Checking the manifest" />;
  if (connect) return <Splash text="Opening the pairing page" />;

  if (gone) {
    return (
      <Shell label="Not aboard">
        <div className="sc-hero">
          <h1 className="disp">You're not aboard {gone} any more</h1>
          <p className="ink2">You left, or its captain took you off the ship. Ask them for a new invite link to come back.</p>
        </div>
        <div className="actions"><Button kind="primary" onClick={() => setGone(null)}>{office ? "Back to your ship" : "Make a ship of your own"}</Button></div>
      </Shell>
    );
  }
  if (!office || newShip) {
    const from = office ? friend?.name ?? own?.name : undefined;
    return (
      <MakeShip key={newShip?.world ?? ""} world={newShip?.world} back={from ? { name: from, go: newOffsite.end } : undefined}
        onMade={(id) => { setMade(id); newOffsite.end(); setStage("meet"); }} />
    );
  }
  const id = office._id;
  const skip = () => { writeSkip(id); setSkipped((s) => new Set(s).add(id)); setStage(null); };
  const current = own ? stage ?? need : null;

  // A machine paired already (another offsite of yours): on to the new one's repos.
  if (current === "meet") return <Meet officeId={id} onNext={() => setStage(machines.length ? "project" : "connect")} />;
  if (current === "connect") return <Connect onNext={() => setStage("project")} onSkip={skip} />;
  if (current === "project") return <Project officeId={id} onDone={() => setStage(null)} onSkip={skip} />;
  return (
    <NotAboard key={id} ship={friend?.name ?? own?.name ?? "that ship"}>
      <Suspense fallback={<Boarding />}><Aboard key={id} officeId={id} /></Suspense>
    </NotAboard>
  );
}

/**
 * A ship you were on and aren't any more (you left it, or its captain took you off): its queries refuse, and this
 * says so instead of a blank screen. The ship switcher has already moved you on by then, usually.
 */
class NotAboard extends Component<{ ship: string; children: ReactNode }, { gone: boolean }> {
  override state = { gone: false };
  static getDerivedStateFromError(e: unknown) {
    const text = String((e as { data?: unknown })?.data ?? (e as Error)?.message ?? e);
    if (/No such ship|No such thread/.test(text)) return { gone: true };
    throw e;
  }
  override render() {
    if (!this.state.gone) return this.props.children;
    return (
      <Shell label="Not aboard">
        <div className="sc-hero">
          <h1 className="disp">You're not aboard {this.props.ship} any more</h1>
          <p className="ink2">You left, or its captain took you off the ship. Ask them for a new invite link to come back.</p>
        </div>
        <div className="actions"><Button kind="primary" onClick={() => location.reload()}>Continue</Button></div>
      </Shell>
    );
  }
}
