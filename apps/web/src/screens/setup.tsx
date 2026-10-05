import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { ago, Button, Card, Dot, errorText, Field, Input, useNow } from "../ui/index.tsx";

// Connecting a machine and choosing the project: used by the first-run screens and the phone's Ship tab.

type Machine = FunctionReturnType<typeof api.machines.mine>[number];

interface ProbeRow { harness: string; installed: boolean; version: string | null; auth: string; email: string | null; plan: string | null; message: string | null; profile: string | null }

function probeRows(probe: unknown): ProbeRow[] {
  if (!Array.isArray(probe)) return [];
  return probe.filter((p): p is ProbeRow => !!p && typeof p === "object" && typeof (p as ProbeRow).harness === "string")
    .filter((p) => !p.profile);
}

const NAMES: Record<string, string> = { claude: "Claude Code", codex: "Codex", sim: "Sim crew" };
const PLAN: Record<string, string> = { max: "Max", pro: "Pro", plus: "Plus", team: "Team", enterprise: "Enterprise", free: "Free" };
export const planName = (h: string, p: string | null) => {
  if (!p) return null;
  if (/^(claude|chatgpt)\b/i.test(p) || h === "sim") return p;
  const nice = PLAN[p.toLowerCase()] ?? p;
  return h === "claude" ? `Claude ${nice}` : h === "codex" ? `ChatGPT ${nice}` : nice;
};

/** What a machine found: each harness installed or not, signed in or not, on which plan. */
export function ProbeList({ probe }: { probe: unknown }) {
  const rows = probeRows(probe);
  if (!rows.length) return <div className="probe dim">Checking what's installed…</div>;
  return (
    <div className="probe">
      {rows.map((p) => {
        const ok = p.installed && p.auth === "authenticated";
        const plan = planName(p.harness, p.plan);
        return (
          <div key={p.harness} className="probe-row">
            <Dot tone={ok ? "on" : p.installed ? "amber" : "off"} />
            <span className="probe-name">{NAMES[p.harness] ?? p.harness}</span>
            <span className="probe-state clip">
              {!p.installed ? "Not installed"
                : p.auth === "authenticated" ? ["Signed in", plan, p.email].filter(Boolean).join(" · ")
                : p.auth === "unauthenticated" ? `Installed, not signed in: run \`${p.harness}\` and log in`
                : "Installed"}
            </span>
            {p.version ? <span className="mono dim probe-ver">{p.version.replace(/\s*\(.*\)$/, "")}</span> : null}
          </div>
        );
      })}
    </div>
  );
}

export function MachineCard({ m, chosen, onRevoke }: { m: Machine; chosen?: boolean; onRevoke?: () => void }) {
  const now = useNow(10_000);
  return (
    <Card tone={chosen ? "accent" : undefined} quiet={!chosen} className="machine">
      <div className="machine-head">
        <Dot tone={m.online ? "on" : "off"} />
        <span className="machine-name">{m.name}</span>
        <span className="dim clip">{m.hostname}</span>
        <span className="dim machine-seen">{m.online ? "online" : `seen ${ago(now - m.lastSeenAt)} ago`}</span>
        {onRevoke ? <Button kind="ghost" size="sm" onClick={onRevoke}>Disconnect</Button> : null}
      </div>
      <ProbeList probe={m.probe} />
    </Card>
  );
}

/** "Run this on your computer". */
export function LoginSteps() {
  return (
    <ol className="steps">
      <li>On the computer that has your code and your Claude Code or Codex login, run
        <pre className="mono cmd">npx offsite-agents login</pre>
        <span className="dim">Working from this repo? <span className="mono">pnpm runner login</span> does the same.</span>
      </li>
      <li>It prints a code like <span className="mono">K7QD-3MPX</span>. Enter it below, or open the link it shows.</li>
      <li>Then keep it running with <span className="mono">npx offsite-agents start</span>. Your crew works there, on your own subscriptions.</li>
    </ol>
  );
}

const CODE = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/;
export const formatCode = (s: string) => {
  const raw = s.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  return raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw;
};

/** Enter the runner's code and approve it. */
export function CodeEntry({ initial = "", onApproved }: { initial?: string; onApproved?: (m: { machineId: string; name: string }) => void }) {
  const [code, setCode] = useState(formatCode(initial));
  const valid = CODE.test(code);
  const pending = useQuery(api.machines.pending, valid ? { userCode: code } : "skip");
  const approve = useMutation(api.machines.approve);
  const deny = useMutation(api.machines.deny);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => { setErr(null); }, [code]);
  const go = async () => {
    setBusy(true);
    try {
      const r = await approve({ userCode: code });
      setDone(r.name);
      onApproved?.({ machineId: r.machineId, name: r.name });
    } catch (x) { setErr(errorText(x)); } finally { setBusy(false); }
  };
  if (done) return <Card tone="green" className="code-done"><span className="lab t-green">Connected</span><span>{done} is paired. It shows up below once it checks in.</span></Card>;
  return (
    <div className="code-entry">
      <Field label="The code from your terminal">
        <Input className="mono code-input" value={code} onChange={(e) => setCode(formatCode(e.target.value))} placeholder="XXXX-XXXX" autoComplete="off" spellCheck={false} />
      </Field>
      {valid && pending === undefined ? <div className="dim">Looking for it…</div> : null}
      {valid && pending === null ? <div className="dim">No machine is waiting with that code. Codes last 15 minutes; run the login again for a new one.</div> : null}
      {valid && pending ? (
        <Card tone="accent" className="code-found">
          <span>Connect <b>{pending.name}</b>{pending.hostname ? <span className="dim"> ({pending.hostname})</span> : null} to your ship?</span>
          <span className="dim">It can then run your crew with the Claude Code and Codex logins on that computer. Offsite never sees them.</span>
          <div className="actions">
            <Button kind="primary" disabled={busy} onClick={() => void go()}>{busy ? "Connecting…" : "Connect"}</Button>
            <Button kind="ghost" onClick={() => void deny({ userCode: code }).then(() => setCode(""))}>That's not mine</Button>
          </div>
        </Card>
      ) : null}
      {err ? <div className="error">{err}</div> : null}
    </div>
  );
}

/** The project the crew works on: a folder on one of your machines, its default branch, a setup command. */
export function ProjectForm({ officeId, onSaved, submitLabel = "Save" }: { officeId: string; onSaved?: () => void; submitLabel?: string }) {
  const id = officeId as Id<"offices">;
  const office = useQuery(api.offices.get, { officeId: id });
  const machines = useQuery(api.machines.mine);
  const setRepo = useMutation(api.offices.setRepo);
  const update = useMutation(api.offices.update);
  const [machineId, setMachineId] = useState<string>("");
  const [path, setPath] = useState("");
  const [branch, setBranch] = useState("main");
  const [setup, setSetup] = useState("");
  const [harness, setHarness] = useState<"claude" | "codex" | "sim">("claude");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (loaded || !office || !machines) return;
    setLoaded(true);
    setMachineId(office.repo?.machineId ?? machines.find((m) => m.online)?._id ?? machines[0]?._id ?? "");
    setPath(office.repo?.path ?? "");
    setBranch(office.repo?.defaultBranch ?? "main");
    setSetup(office.setupCommand ?? "");
    setHarness(office.defaultHarness);
  }, [office, machines, loaded]);
  if (!office || !machines) return <div className="dim">…</div>;
  if (!machines.length) return <div className="dim">Connect a machine first: the project is a folder on it.</div>;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setSaved(false);
    try {
      await setRepo({ officeId: id, machineId: machineId as Id<"machines">, path, defaultBranch: branch });
      await update({ officeId: id, setupCommand: setup.trim() || null, defaultHarness: harness });
      setSaved(true);
      onSaved?.();
    } catch (x) { setErr(errorText(x)); } finally { setBusy(false); }
  };
  return (
    <form className="project-form" onSubmit={(e) => void submit(e)}>
      <Field label="Machine">
        <select className="input" value={machineId} onChange={(e) => setMachineId(e.target.value)}>
          {machines.map((m) => <option key={m._id} value={m._id}>{m.name}{m.online ? "" : " (offline)"}</option>)}
        </select>
      </Field>
      <Field label="Project folder" hint="A git checkout on that machine. Each task gets its own worktree next to it.">
        <Input className="mono" value={path} onChange={(e) => setPath(e.target.value)} placeholder="~/code/my-app" spellCheck={false} />
      </Field>
      <div className="row2">
        <Field label="Default branch"><Input className="mono" value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" spellCheck={false} /></Field>
        <Field label="New crew run on">
          <select className="input" value={harness} onChange={(e) => setHarness(e.target.value as typeof harness)}>
            <option value="claude">Claude Code</option>
            <option value="codex">Codex</option>
            <option value="sim">Sim crew (no spending)</option>
          </select>
        </Field>
      </div>
      <Field label="Setup command" hint="Runs once in every new worktree. Optional.">
        <Input className="mono" value={setup} onChange={(e) => setSetup(e.target.value)} placeholder="pnpm install" spellCheck={false} />
      </Field>
      {err ? <div className="error">{err}</div> : null}
      <div className="actions">
        <Button kind="primary" type="submit" disabled={busy || !path.trim() || !machineId}>{busy ? "Saving…" : submitLabel}</Button>
        {saved && !onSaved ? <span className="t-green lab">Saved</span> : null}
      </div>
    </form>
  );
}
