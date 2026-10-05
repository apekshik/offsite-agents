import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { COMPUTER_NAME, RUNNER_COMMAND, runnerCommand } from "@offsite/contracts";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { ago, Button, Card, Chip, ConfirmButton, Dot, errorText, Field, Input, useNow } from "../ui/index.tsx";
import "./setup.css";

// Connecting a machine and the ship's repos: used by the first-run screens and the phone's Ship tab.

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

// RUNNER_COMMAND, the one command that brings a machine aboard, signs in through this site and pairs.
/** Keeps the runner going in the background, across restarts. */
const RUNNER_INSTALL = runnerCommand("install");

/** A command in a box, with a button that copies it. */
export function CopyCommand({ command, label = "Copy the command" }: { command: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    try { await navigator.clipboard.writeText(command); } catch {
      // No clipboard (an insecure page, an old browser): select the text so a keystroke copies it.
      const el = document.getElementById(`cmd-${command}`);
      if (el) getSelection()?.selectAllChildren(el);
      return;
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1800);
  };
  return (
    <div className="copy-cmd">
      <span className="copy-prompt" aria-hidden="true">$</span>
      <code id={`cmd-${command}`} className="mono copy-text">{command}</code>
      <button type="button" className={`copy-btn ${copied ? "done" : ""}`} onClick={() => void copy()} aria-label={copied ? "Copied" : label}>
        {copied ? (
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        ) : (
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="5" y="5" width="8.5" height="8.5" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M10.5 3.2V3a1.5 1.5 0 0 0-1.5-1.5H3.5A1.5 1.5 0 0 0 2 3v5.5A1.5 1.5 0 0 0 3.5 10h.3" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
        )}
        <span>{copied ? "Copied" : "Copy"}</span>
      </button>
      <span className="sr" aria-live="polite">{copied ? "Copied to the clipboard" : ""}</span>
    </div>
  );
}

/** "Run this on your computer": one command, and what it needs. */
export function LoginSteps() {
  return (
    <div className="run-step">
      <p className="run-lead">On the computer with your code and your Claude Code or Codex login, run:</p>
      <CopyCommand command={RUNNER_COMMAND} />
      <p className="run-fine dim">
        It opens this site to pair: approve it there and you're done. Needs Node 22 or newer.
        To keep it running in the background, run <code className="mono">{RUNNER_INSTALL}</code> once.
      </p>
    </div>
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
  const lookup = useMutation(api.machines.lookup);
  const approve = useMutation(api.machines.approve);
  const deny = useMutation(api.machines.deny);
  // undefined while looking; null when nothing waits with that code (lookups are counted, so they run once per code).
  const [pending, setPending] = useState<{ name: string; hostname: string } | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => {
    setErr(null);
    setPending(undefined);
    if (!valid) return;
    let live = true;
    lookup({ userCode: code }).then((r) => {
      if (!live) return;
      if (r.ok) setPending({ name: r.name, hostname: r.hostname });
      else { setPending(null); setErr(r.error); }
    }, (x) => { if (live) { setPending(null); setErr(errorText(x)); } });
    return () => { live = false; };
  }, [code, valid, lookup]);
  const go = async () => {
    setBusy(true);
    try {
      const r = await approve({ userCode: code });
      if (!r.ok) { setErr(r.error); return; }
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
      {valid && pending ? (
        <Card tone="accent" className="code-found">
          <span>Connect <b>{pending.name}</b>{pending.hostname ? <span className="dim"> ({pending.hostname})</span> : null} to your ship?</span>
          <span className="dim">It can then run your crew with the Claude Code and Codex logins on that computer. Offsite never sees them. Connect only a machine you just ran <span className="mono">{RUNNER_COMMAND}</span> on: whoever runs it gets to work on your ship.</span>
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

type RepoRow = FunctionReturnType<typeof api.repos.list>[number];

/** One repo: add it, or change it. A folder on one of your machines, its name on the ship, its default branch and setup command. */
export function RepoForm({ officeId, repo, onDone, onCancel, submitLabel }: { officeId: string; repo?: RepoRow; onDone?: () => void; onCancel?: () => void; submitLabel?: string }) {
  const machines = useQuery(api.machines.mine);
  const add = useMutation(api.repos.add);
  const update = useMutation(api.repos.update);
  const [machineId, setMachineId] = useState<string>(repo?.machineId ?? "");
  const [path, setPath] = useState(repo?.path ?? "");
  const [name, setName] = useState(repo?.name ?? "");
  const [branch, setBranch] = useState(repo?.defaultBranch ?? "main");
  const [setup, setSetup] = useState(repo?.setupCommand ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!machineId && machines?.length) setMachineId(machines.find((m) => m.online)?._id ?? machines[0]!._id);
  }, [machines, machineId]);
  if (!machines) return <div className="dim">…</div>;
  if (!machines.length) return <div className="dim">Connect a machine first: a repo is a folder on it.</div>;
  const folderName = path.trim().replace(/[\\/]+$/, "").split(/[\\/]/).at(-1)?.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") ?? "";
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const fields = { machineId: machineId as Id<"machines">, path, defaultBranch: branch, setupCommand: setup.trim() || null };
      if (repo?._id) await update({ repoId: repo._id, name: name.trim() || repo.name, ...fields });
      else await add({ officeId: officeId as Id<"offices">, ...fields, ...(name.trim() ? { name: name.trim() } : {}) });
      onDone?.();
    } catch (x) { setErr(errorText(x)); } finally { setBusy(false); }
  };
  return (
    <form className="project-form" onSubmit={(e) => void submit(e)}>
      <div className="row2">
        <Field label="Machine">
          <select className="input" value={machineId} onChange={(e) => setMachineId(e.target.value)}>
            {machines.map((m) => <option key={m._id} value={m._id}>{m.name}{m.online ? "" : " (offline)"}</option>)}
          </select>
        </Field>
        <Field label="Name" hint={`What ${COMPUTER_NAME} calls it.`}>
          <Input className="mono" value={name} onChange={(e) => setName(e.target.value.toLowerCase())} placeholder={folderName || "web"} maxLength={32} spellCheck={false} />
        </Field>
      </div>
      <Field label="Folder" hint="A git checkout on that machine. Each task gets its own worktree next to it.">
        <Input className="mono" value={path} onChange={(e) => setPath(e.target.value)} placeholder="~/code/my-app" spellCheck={false} autoFocus={!repo} />
      </Field>
      <div className="row2">
        <Field label="Default branch"><Input className="mono" value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" spellCheck={false} /></Field>
        <Field label="Setup command" hint="Runs once in every new worktree.">
          <Input className="mono" value={setup} onChange={(e) => setSetup(e.target.value)} placeholder="pnpm install" spellCheck={false} />
        </Field>
      </div>
      {err ? <div className="error">{err}</div> : null}
      <div className="actions">
        <Button kind="primary" type="submit" disabled={busy || !path.trim() || !machineId}>{busy ? "Saving…" : submitLabel ?? (repo ? "Save" : "Add repo")}</Button>
        {onCancel ? <Button kind="ghost" onClick={onCancel}>Cancel</Button> : null}
      </div>
    </form>
  );
}

/** A repo on the ship, compact: its name, folder, machine and branch, with edit and remove. */
function RepoItem({ officeId, repo, first, many, removeLast }: { officeId: string; repo: RepoRow; first: boolean; many: boolean; removeLast: boolean }) {
  const remove = useMutation(api.repos.remove);
  const [editing, setEditing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (editing) return <Card quiet className="repo editing"><RepoForm officeId={officeId} repo={repo} onDone={() => setEditing(false)} onCancel={() => setEditing(false)} /></Card>;
  return (
    <Card quiet className="repo">
      <div className="repo-head">
        <Chip>{repo.name}</Chip>
        <span className="mono clip repo-path">{repo.path}</span>
        {repo._id ? <Button kind="ghost" size="sm" onClick={() => setEditing(true)}>Edit</Button> : null}
        {repo._id && (many || removeLast) ? <ConfirmButton size="sm" confirm="Remove it?" onConfirm={() => void remove({ repoId: repo._id! }).catch((x) => setErr(errorText(x)))}>Remove</ConfirmButton> : null}
      </div>
      <div className="repo-facts dim">
        <span>{repo.machine?.name ?? "A disconnected machine"}</span>
        <span>· <span className="mono">{repo.defaultBranch}</span></span>
        {repo.setupCommand ? <span className="clip">· <span className="mono">{repo.setupCommand}</span></span> : null}
        {first && many ? <span>· {COMPUTER_NAME} works here</span> : null}
      </div>
      {err ? <div className="error">{err}</div> : null}
    </Card>
  );
}

/** Which harness new hires run on. */
export function HarnessField({ officeId }: { officeId: string }) {
  const office = useQuery(api.offices.get, { officeId: officeId as Id<"offices"> });
  const update = useMutation(api.offices.update);
  if (!office) return null;
  return (
    <Field label="New crew run on">
      <select className="input" value={office.defaultHarness} onChange={(e) => void update({ officeId: officeId as Id<"offices">, defaultHarness: e.target.value as "claude" | "codex" | "sim" })}>
        <option value="claude">Claude Code</option>
        <option value="codex">Codex</option>
        <option value="sim">Sim crew (no spending)</option>
      </select>
    </Field>
  );
}

/** The ship's repos: each one listed, edit and remove, and a form to add another (open at once when there are none). */
export function Repos({ officeId, removeLast = false }: { officeId: string; removeLast?: boolean }) {
  const repos = useQuery(api.repos.list, { officeId: officeId as Id<"offices"> });
  const [adding, setAdding] = useState(false);
  if (!repos) return <div className="dim">…</div>;
  const none = repos.length === 0;
  return (
    <div className="repos">
      {repos.map((r, i) => <RepoItem key={r._id ?? r.path} officeId={officeId} repo={r} first={i === 0} many={repos.length > 1} removeLast={removeLast} />)}
      {none || adding ? (
        <Card quiet={!none} className="repo editing">
          <RepoForm officeId={officeId} onDone={() => setAdding(false)} {...(none ? {} : { onCancel: () => setAdding(false) })} />
        </Card>
      ) : <div><Button kind="soft" size="sm" onClick={() => setAdding(true)}>+ Add another repo</Button></div>}
    </div>
  );
}
