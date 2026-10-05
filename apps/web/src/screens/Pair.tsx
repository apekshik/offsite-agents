import { useEffect, useRef, useState, type ReactNode } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { signIn, signInAvailable } from "../auth.ts";
import { Button, Card, errorText } from "../ui/index.tsx";
import "./screens.css";
import "./pair.css";

// /pair?code=XXXX-XXXX: where `npx offsite-agents` sends the captain to approve a machine in one click. Sign in if
// needed (sign-in comes back here), see which machine is asking, approve it or turn it down.

const CODE = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/;
const normalize = (s: string | null) => {
  const raw = (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  return raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : "";
};
const RUN = "npx offsite-agents";

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="screen">
      <div className="screen-sky"><i className="sun" /><i className="sea" /><i className="glint g1" /><i className="glint g2" /><i className="glint g3" /></div>
      <div className="screen-card pair-card">
        <div className="sc-top"><span className="disp wordmark">Offsite</span></div>
        {children}
      </div>
    </div>
  );
}

const Waiting = ({ text }: { text?: string }) => (
  <Shell><div className="sc-splash"><span className="dots"><i /><i /><i /></span>{text ? <span className="dim">{text}</span> : null}</div></Shell>
);

const Warning = () => <p className="dim sc-fine">Only approve a code from a terminal you started yourself: whoever runs it gets to work on your ship, with your crew.</p>;

export function Pair() {
  const [code] = useState(() => normalize(new URLSearchParams(location.search).get("code")));
  const { isLoading, isAuthenticated } = useConvexAuth();
  const me = useQuery(api.users.me, isAuthenticated ? {} : "skip");
  const ensure = useMutation(api.users.ensure);
  const [ensureErr, setEnsureErr] = useState<string | null>(null);

  useEffect(() => {
    if (isAuthenticated && me === null) void ensure().catch((e) => setEnsureErr(errorText(e)));
  }, [isAuthenticated, me, ensure]);

  if (!CODE.test(code)) {
    return (
      <Shell>
        <div className="sc-hero">
          <h1 className="disp">Connect a machine</h1>
          <p className="ink2">This link is missing its code. On the computer you want to connect, run <span className="mono">{RUN}</span>: it opens this page with a fresh one.</p>
        </div>
      </Shell>
    );
  }
  if (isLoading) return <Waiting />;
  if (!isAuthenticated) {
    return (
      <Shell>
        <div className="sc-hero">
          <h1 className="disp">Connect your machine</h1>
          <p className="ink2">A computer asked to join your ship with the code <span className="mono pair-code-inline">{code}</span>. Sign in to approve it; you'll come straight back here.</p>
        </div>
        {signInAvailable()
          ? <div className="actions"><Button kind="primary" size="lg" onClick={() => void signIn(location.pathname + location.search)}>Sign in</Button></div>
          : <p className="dim">Sign-in isn't set up on this server. Locally, add <span className="mono">&amp;dev=yourname</span> to this address.</p>}
        <Warning />
      </Shell>
    );
  }
  if (ensureErr) return <Shell><p className="error">{ensureErr}</p></Shell>;
  if (!me) return <Waiting text="Checking the manifest" />;
  return <Approve code={code} />;
}

type Found = { name: string; hostname: string; os: string | null };

function Approve({ code }: { code: string }) {
  const lookup = useMutation(api.machines.lookup);
  const approve = useMutation(api.machines.approve);
  const deny = useMutation(api.machines.deny);
  const ships = useQuery(api.offices.mine);
  // Lookups count against the captain when they miss, so each code is looked up once.
  const looked = useRef<string | null>(null);
  const [found, setFound] = useState<Found | null | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [outcome, setOutcome] = useState<"approved" | "denied" | null>(null);

  useEffect(() => {
    if (looked.current === code) return;
    looked.current = code;
    lookup({ userCode: code }).then(
      (r) => { if (r.ok) setFound({ name: r.name, hostname: r.hostname, os: r.os ?? null }); else { setFound(null); setErr(r.error); } },
      (x) => { setFound(null); setErr(errorText(x)); },
    );
  }, [code, lookup]);

  const act = async (what: "approve" | "deny") => {
    setBusy(what);
    setErr(null);
    try {
      if (what === "deny") { await deny({ userCode: code }); setOutcome("denied"); return; }
      const r = await approve({ userCode: code });
      if (!r.ok) setErr(r.error); else setOutcome("approved");
    } catch (x) { setErr(errorText(x)); } finally { setBusy(null); }
  };

  // Machines belong to the captain, not to one ship: a connected machine crews any of them. Name the newest.
  const ship = ships?.[0];
  const others = (ships ?? []).slice(1).map((s) => s.name);

  if (outcome === "approved") {
    return (
      <Shell>
        <div className="sc-hero">
          <svg className="pair-check" viewBox="0 0 24 24" width="36" height="36" aria-hidden><circle cx="12" cy="12" r="11" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <h1 className="disp">{found?.name ?? "Your machine"} is connected</h1>
          <p className="ink2">You can close this tab; your crew is aboard.</p>
        </div>
        <div className="actions"><Button kind="ghost" onClick={() => location.assign("/")}>{ship ? `Go to ${ship.name}` : "Make your ship"}</Button></div>
      </Shell>
    );
  }
  if (outcome === "denied") {
    return (
      <Shell>
        <div className="sc-hero">
          <h1 className="disp">Turned down</h1>
          <p className="ink2">That terminal won't be connected. If it was yours after all, run <span className="mono">{RUN}</span> there again for a new code.</p>
        </div>
      </Shell>
    );
  }
  if (found === undefined || ships === undefined) return <Waiting text="Finding your machine" />;
  if (!found) {
    return (
      <Shell>
        <div className="sc-hero">
          <h1 className="disp">Connect a machine</h1>
          <p className="ink2">{err ?? "No machine is waiting with that code."}</p>
        </div>
      </Shell>
    );
  }

  const detail = [found.os, found.hostname && found.hostname !== found.name ? found.hostname : null].filter(Boolean).join(" · ");
  return (
    <Shell>
      <div className="sc-hero">
        <h1 className="disp">Connect {found.name} to {ship ? ship.name : "Offsite"}?</h1>
        <p className="ink2">It will run your crew with the Claude Code and Codex logins on that computer. Offsite never sees them.</p>
      </div>
      <Card tone="accent" className="pair-machine">
        <span className="pair-machine-name">{found.name}</span>
        {detail ? <span className="dim">{detail}</span> : null}
        <span className="pair-code"><span className="dim">Code</span> <span className="mono">{code}</span> <span className="dim">should match your terminal</span></span>
      </Card>
      {others.length ? <p className="dim sc-fine">A machine crews all your ships, so {others.join(", ")} can use it too.</p> : null}
      {err ? <div className="error">{err}</div> : null}
      <div className="actions">
        <Button kind="primary" size="lg" disabled={!!busy} onClick={() => void act("approve")}>{busy === "approve" ? "Connecting…" : "Approve"}</Button>
        <Button kind="ghost" disabled={!!busy} onClick={() => void act("deny")}>That's not me</Button>
      </div>
      <Warning />
    </Shell>
  );
}
