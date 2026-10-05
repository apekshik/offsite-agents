import { useEffect, useState, type ReactNode } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { scene } from "../bridge.ts";
import { signIn, signInAvailable } from "../auth.ts";
import { Game } from "../game/Game.tsx";
import { Overlay } from "../overlay/Overlay.tsx";
import { Button, Card, Chip, errorText, Face, Field, Input } from "../ui/index.tsx";
import { CodeEntry, LoginSteps, MachineCard, ProjectForm } from "./setup.tsx";
import "./screens.css";

// The way aboard: sign in → make your ship → meet the crew → connect your machine → choose the
// project → aboard (the game under the overlay). The machine steps can be skipped; the crew lounges
// until a machine is connected. A ?connect=<code> link (from `offsite login`) approves that machine.

const skipKey = (officeId: string) => `offsite:setup-skipped:${officeId}`;
const readSkip = (officeId: string) => { try { return localStorage.getItem(skipKey(officeId)) === "1"; } catch { return false; } };
const writeSkip = (officeId: string) => { try { localStorage.setItem(skipKey(officeId), "1"); } catch { /* private mode */ } };

function dropParam(name: string) {
  const u = new URL(location.href);
  u.searchParams.delete(name);
  history.replaceState({}, "", u.toString());
}

function Shell({ step, children, wide }: { step?: 1 | 2 | 3; children: ReactNode; wide?: boolean }) {
  return (
    <div className="screen">
      <div className="screen-sky"><i className="sun" /><i className="sea" /><i className="glint g1" /><i className="glint g2" /><i className="glint g3" /></div>
      <div className={`screen-card ${wide ? "wide" : ""}`}>
        <div className="sc-top">
          <span className="disp wordmark">Offsite</span>
          {step ? (
            <span className="sc-steps">
              {["Your ship", "Your machine", "The project"].map((s, i) => <span key={s} className={i + 1 === step ? "on" : i + 1 < step ? "done" : ""}>{s}</span>)}
            </span>
          ) : null}
        </div>
        {children}
      </div>
    </div>
  );
}

function Splash({ text }: { text?: string }) {
  return <Shell><div className="sc-splash"><span className="dots"><i /><i /><i /></span>{text ? <span className="dim">{text}</span> : null}</div></Shell>;
}

function SignIn() {
  const can = signInAvailable();
  return (
    <Shell>
      <div className="sc-hero">
        <h1 className="disp">Take your agents on an offsite.</h1>
        <p className="ink2">Your Claude Code and Codex crew, working (and lounging) on a superyacht in your browser. They run on your own machine, on your own subscriptions.</p>
      </div>
      {can ? <Button kind="primary" size="lg" onClick={() => void signIn()}>Sign in</Button>
        : <p className="dim">Sign-in isn't set up on this server. Locally, open <span className="mono">?dev=yourname</span>.</p>}
    </Shell>
  );
}

function MakeShip({ onMade }: { onMade: (id: string) => void }) {
  const create = useMutation(api.offices.create);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    setErr(null);
    try { onMade(await create({ name: name.trim() || "Sea Legs", world: "yacht" })); } catch (x) { setErr(errorText(x)); setBusy(false); }
  };
  return (
    <Shell step={1}>
      <div className="sc-hero">
        <h1 className="disp">Make your ship</h1>
        <p className="ink2">Name it and pick where your crew works. You can change the name later.</p>
      </div>
      <Field label="Ship's name">
        <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Sea Legs" maxLength={40} onKeyDown={(e) => { if (e.key === "Enter") void go(); }} />
      </Field>
      <div className="worlds">
        <Card tone="accent" className="world on">
          <div className="world-art yacht"><i className="sun" /><i className="hull" /><i className="deck" /></div>
          <div className="world-text">
            <span className="world-name">The Yacht</span>
            <span className="dim">A superyacht at golden hour: an office deck of desks, sun loungers, a pool and a bar, the bridge. New crew fly in by helicopter.</span>
          </div>
        </Card>
        <Card quiet className="world off">
          <div className="world-art soon" />
          <div className="world-text">
            <span className="world-name dim">More worlds</span>
            <span className="dim">A Mars base, a space station. Later.</span>
          </div>
        </Card>
      </div>
      {err ? <div className="error">{err}</div> : null}
      <div className="actions"><Button kind="primary" size="lg" disabled={busy} onClick={() => void go()}>{busy ? "Launching…" : "Make the ship"}</Button></div>
    </Shell>
  );
}

function Meet({ officeId, onNext }: { officeId: string; onNext: () => void }) {
  const crew = useQuery(api.crew.list, { officeId: officeId as Id<"offices"> });
  const sorted = [...(crew ?? [])].sort((a, b) => Number(b.role === "computer") - Number(a.role === "computer"));
  return (
    <Shell step={1}>
      <div className="sc-hero">
        <h1 className="disp">Meet your crew</h1>
        <p className="ink2">The ship's computer plans the work and hands it out. The crew do it, at desks or on loungers with laptops. Hire more whenever you like.</p>
      </div>
      <div className="meet">
        {crew === undefined ? <span className="dim">…</span> : sorted.map((c) => (
          <div key={c._id} className="meet-row fade-up">
            <Face avatar={c.avatar} look={c.look} computer={c.role === "computer"} size={44} />
            <div className="meet-who">
              <span className="meet-name">{c.name} <Chip>{c.harness === "codex" ? "Codex" : c.harness === "sim" ? "Sim crew" : "Claude Code"}</Chip></span>
              <span className="dim">{c.role === "computer" ? "Lives at the helm on the bridge. Talk to it there, or on your phone." : c.specialty ?? "Ready for anything."}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="actions"><Button kind="primary" size="lg" onClick={onNext}>Next: connect your machine</Button></div>
    </Shell>
  );
}

function Connect({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  const machines = useQuery(api.machines.mine);
  return (
    <Shell step={2} wide>
      <div className="sc-hero">
        <h1 className="disp">Connect your machine</h1>
        <p className="ink2">Your crew runs on your computer, with your own Claude Code and Codex logins. Offsite never sees them.</p>
      </div>
      <LoginSteps />
      <CodeEntry />
      {machines?.length ? <div className="sc-machines">{machines.map((m) => <MachineCard key={m._id} m={m} />)}</div> : null}
      <div className="actions">
        <Button kind="primary" size="lg" disabled={!machines?.length} onClick={onNext}>Next: choose the project</Button>
        <Button kind="ghost" onClick={onSkip}>Skip for now and come aboard</Button>
      </div>
      <p className="dim sc-fine">Skipping is fine: the crew lounges on deck until a machine is connected. Connect one later from the phone's Ship tab.</p>
    </Shell>
  );
}

function Project({ officeId, onDone, onSkip }: { officeId: string; onDone: () => void; onSkip: () => void }) {
  return (
    <Shell step={3} wide>
      <div className="sc-hero">
        <h1 className="disp">Choose the project</h1>
        <p className="ink2">The folder on your machine the crew works on. Each task gets its own git worktree and branch; finished work lands on one branch per thread.</p>
      </div>
      <ProjectForm officeId={officeId} onSaved={onDone} submitLabel="Save and come aboard" />
      <div className="actions"><Button kind="ghost" onClick={onSkip}>Skip for now and come aboard</Button></div>
    </Shell>
  );
}

function Approve({ code, onDone }: { code: string; onDone: () => void }) {
  const [done, setDone] = useState(false);
  return (
    <Shell>
      <div className="sc-hero">
        <h1 className="disp">Connect a machine</h1>
        <p className="ink2">A computer running <span className="mono">offsite login</span> asked to join your ship with this code.</p>
      </div>
      <CodeEntry initial={code} onApproved={() => setDone(true)} />
      <div className="actions"><Button kind={done ? "primary" : "ghost"} onClick={onDone}>{done ? "Continue" : "Not now"}</Button></div>
    </Shell>
  );
}

/** The world under the overlay, with a veil while the ship builds. */
function Aboard({ officeId }: { officeId: string }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = setInterval(() => { if (scene.captain()) { setReady(true); clearInterval(t); } }, 250);
    return () => clearInterval(t);
  }, []);
  return (
    <>
      <Game officeId={officeId} />
      <Overlay officeId={officeId} />
      <div className={`boarding ${ready ? "gone" : ""}`}><span className="disp">Boarding</span><span className="dots"><i /><i /><i /></span></div>
    </>
  );
}

export function Gate() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const me = useQuery(api.users.me, isAuthenticated ? {} : "skip");
  const ensure = useMutation(api.users.ensure);
  const offices = useQuery(api.offices.mine, me ? {} : "skip");
  const machines = useQuery(api.machines.mine, me ? {} : "skip");
  const [connect, setConnect] = useState(() => new URLSearchParams(location.search).get("connect"));
  const [made, setMade] = useState<string | null>(null);
  const [stage, setStage] = useState<"meet" | "connect" | "project" | null>(null);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [ensureErr, setEnsureErr] = useState<string | null>(null);

  useEffect(() => {
    if (isAuthenticated && me === null) void ensure().catch((e) => setEnsureErr(errorText(e)));
  }, [isAuthenticated, me, ensure]);

  if (isLoading) return <Splash />;
  if (!isAuthenticated) return <SignIn />;
  if (ensureErr) return <Shell><p className="error">{ensureErr}</p></Shell>;
  if (!me || offices === undefined || machines === undefined) return <Splash text="Checking the manifest" />;
  if (connect) return <Approve code={connect} onDone={() => { dropParam("connect"); setConnect(null); }} />;

  const office = (made ? offices.find((o) => o._id === made) : undefined) ?? offices[0];
  if (!office) return <MakeShip onMade={(id) => { setMade(id); setStage("meet"); }} />;
  const id = office._id;
  const skip = () => { writeSkip(id); setSkipped((s) => new Set(s).add(id)); setStage(null); };
  const skippedHere = skipped.has(id) || readSkip(id);

  if (stage === "meet") return <Meet officeId={id} onNext={() => setStage("connect")} />;
  if (stage === "connect" || (!skippedHere && stage === null && machines.length === 0)) {
    return <Connect onNext={() => setStage("project")} onSkip={skip} />;
  }
  if (stage === "project" || (!skippedHere && stage === null && !office.repo)) {
    return <Project officeId={id} onDone={() => setStage(null)} onSkip={skip} />;
  }
  return <Aboard key={id} officeId={id} />;
}
