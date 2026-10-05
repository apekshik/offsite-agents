import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { MAX_REPOS, RUNNER_COMMAND, tildePath, type FolderEntry, type FoundRepo } from "@offsite/contracts";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Button, Dot, errorText, Input, Pill, useNow } from "../ui/index.tsx";
import { CopyCommand, RepoForm } from "./setup.tsx";

// Adding repos by picking them: the runner on the chosen machine looks for git repos in the usual places (or lists a
// folder, for Browse) and the captain ticks the ones the crew should work on. Typing a path stays one link away.
// Requests and answers: convex/folders.ts. Used by the way aboard ("Your repos") and the phone's Ship tab.

type Machine = FunctionReturnType<typeof api.machines.mine>[number];
type RepoRow = FunctionReturnType<typeof api.repos.list>[number];
type View = "found" | "browse" | "type";

/** A repo the captain ticked: where it is, and on which machine. */
interface Picked extends FoundRepo { machineId: string }
const keyOf = (machineId: string, path: string) => `${machineId}:${path}`;

/** "today", "3 days ago", "5 mo ago": when a repo last had a commit. */
function since(ms: number): string {
  const d = ms / 86_400_000;
  if (d < 1) return "today";
  if (d < 2) return "yesterday";
  if (d < 14) return `${Math.floor(d)} days ago`;
  if (d < 60) return `${Math.floor(d / 7)} wk ago`;
  if (d < 365) return `${Math.floor(d / 30)} mo ago`;
  return `${Math.floor(d / 365)} yr ago`;
}

const remoteText = (r: FoundRepo["remote"]) => (r ? (r.host === "github.com" ? r.slug : `${r.host}/${r.slug}`) : null);
const branchOk = (b: string | null) => (b && /^[\w./-]{1,100}$/.test(b) ? b : null);

/** Which machine to look on: online ones first. With one machine, just its name. */
function MachinePick({ machines, machineId, onPick }: { machines: Machine[]; machineId: string; onPick: (id: string) => void }) {
  if (machines.length === 1) {
    const m = machines[0]!;
    return <div className="pick-machine one"><Dot tone={m.online ? "on" : "off"} /><span>On <b>{m.name}</b></span></div>;
  }
  return (
    <div className="pick-machine" role="radiogroup" aria-label="Machine">
      {machines.map((m) => (
        <button key={m._id} type="button" role="radio" aria-checked={m._id === machineId} className={`pick-machine-btn ${m._id === machineId ? "on" : ""}`} onClick={() => onPick(m._id)}>
          <Dot tone={m.online ? "on" : "off"} /><span className="clip">{m.name}</span>{m.online ? null : <span className="dim">offline</span>}
        </button>
      ))}
    </div>
  );
}

/** One repo, to tick. Already on the ship: shown, but not pickable. */
function RepoChoice({ repo, picked, added, full, onToggle, now, extra }: {
  repo: FoundRepo; picked: boolean; added: boolean; full: boolean; onToggle: () => void; now: number; extra?: ReactNode;
}) {
  const remote = remoteText(repo.remote);
  const off = added || (full && !picked);
  return (
    <label className={`pick-row ${picked ? "on" : ""} ${off ? "off" : ""}`} title={full && !picked && !added ? `A ship holds at most ${MAX_REPOS} repos` : undefined}>
      <input type="checkbox" className="pick-check" checked={picked || added} disabled={off} onChange={onToggle} />
      <span className="pick-main">
        <span className="pick-line">
          <span className="pick-name clip">{repo.name}</span>
          {added ? <Pill tone="green" className="pick-added">Added</Pill> : null}
          {remote ? <span className="pick-remote mono clip">{remote}</span> : null}
        </span>
        <span className="pick-facts dim">
          <span className="mono clip pick-path">{repo.path}</span>
          {repo.branch ? <span className="mono pick-branch clip">{repo.branch}</span> : null}
          <span className="pick-when">{repo.lastCommitAt ? since(now - repo.lastCommitAt) : "no commits yet"}</span>
        </span>
      </span>
      {extra}
    </label>
  );
}

/** "Looking for repos on <machine>…" with a hint that moves along, and a nudge if the runner never answers. */
function Looking({ what, since: started, machine }: { what: string; since: number; machine: string }) {
  const now = useNow(500);
  const s = (now - started) / 1000;
  const hint = s < 1.5 ? "Checking ~/Developer, ~/code, ~/Projects and the other usual places…"
    : s < 4 ? "Reading each repo's branch and remote…"
    : s < 12 ? "Almost there…"
    : null;
  return (
    <div className="pick-looking" role="status" aria-live="polite">
      <div className="pick-looking-line"><span className="pick-pulse" aria-hidden="true"><i /><i /></span><span>{what}</span></div>
      <div className="bar pick-progress" aria-hidden="true"><i /></div>
      {hint ? <span className="dim pick-hint">{hint}</span> : (
        <span className="dim pick-hint">Still waiting on {machine}. A runner from before folder search doesn't answer: restart it with <code className="mono">{RUNNER_COMMAND}</code> to update it, or type a path.</span>
      )}
    </div>
  );
}

/** Keeps one folder request going: asks when `key` changes, asks again when its answer expires, and reads the answer. */
function useFolderRequest(ask: (fresh: boolean) => Promise<Id<"folderRequests">>, key: string) {
  const [requestId, setRequestId] = useState<Id<"folderRequests"> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [askedAt, setAskedAt] = useState(() => Date.now());
  const askRef = useRef(ask);
  askRef.current = ask;
  const turn = useRef(0);
  const start = useCallback((fresh = false) => {
    const n = ++turn.current;
    setErr(null);
    setRequestId(null);
    setAskedAt(Date.now());
    askRef.current(fresh).then((id) => { if (n === turn.current) setRequestId(id); }, (x) => { if (n === turn.current) setErr(errorText(x)); });
  }, []);
  useEffect(() => { start(); }, [key, start]);
  const req = useQuery(api.folders.get, requestId ? { requestId } : "skip");
  // Answers last ten minutes: one that has gone while the picker is open is asked for again.
  useEffect(() => { if (requestId && req === null) start(); }, [requestId, req, start]);
  return { req, err, askedAt, again: () => start(true) };
}

/** Adds repos by picking them from what the runner found, browsing for them, or typing a path. */
export function RepoPicker({ officeId, onDone, onCancel }: { officeId: string; onDone?: () => void; onCancel?: () => void }) {
  const machines = useQuery(api.machines.mine);
  const repos = useQuery(api.repos.list, { officeId: officeId as Id<"offices"> });
  const addMany = useMutation(api.repos.addMany);
  const [machineId, setMachineId] = useState<string>("");
  const [view, setView] = useState<View>("found");
  const [picked, setPicked] = useState<Map<string, Picked>>(new Map());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string[] | null>(null);
  const sorted = useMemo(() => [...(machines ?? [])].sort((a, b) => Number(b.online) - Number(a.online)), [machines]);
  useEffect(() => {
    if (!machineId && sorted.length) setMachineId(sorted[0]!._id);
  }, [sorted, machineId]);
  if (!machines || !repos) return <div className="dim">…</div>;
  if (!machines.length) return <div className="dim">Connect a machine first: a repo is a folder on it.</div>;
  const machine = machines.find((m) => m._id === machineId) ?? sorted[0]!;
  const room = Math.max(0, MAX_REPOS - repos.length);
  const full = picked.size >= room;
  const toggle = (r: FoundRepo) => setPicked((p) => {
    const next = new Map(p);
    const k = keyOf(machine._id, r.path);
    if (next.has(k)) next.delete(k);
    else if (next.size < room) next.set(k, { ...r, machineId: machine._id });
    return next;
  });
  const add = async () => {
    setBusy(true);
    setErr(null);
    try {
      const names = await addMany({
        officeId: officeId as Id<"offices">,
        repos: [...picked.values()].map((r) => ({
          machineId: r.machineId as Id<"machines">, path: r.path,
          defaultBranch: branchOk(r.defaultBranch) ?? branchOk(r.branch) ?? "main", setupCommand: r.setupCommand,
        })),
      });
      setPicked(new Map());
      setDone(names);
    } catch (x) { setErr(errorText(x)); } finally { setBusy(false); }
  };
  if (done) {
    return (
      <div className="pick-done fade-up" role="status">
        <span className="lab t-green">Added</span>
        <span>{done.length === 1 ? <>Added <b className="mono">{done[0]}</b>.</> : <>Added {done.length} repos: <span className="mono">{done.join(", ")}</span>.</>} {done.length === 1 ? "Edit it" : "Edit any of them"} to change its name, branch or setup command.</span>
        <div className="actions">
          {onDone ? <Button kind="soft" size="sm" onClick={onDone}>Done</Button> : null}
          <Button kind="ghost" size="sm" onClick={() => setDone(null)}>Add more</Button>
        </div>
      </div>
    );
  }

  const links = (
    <div className="pick-links">
      {view !== "found" ? <button type="button" className="linkish" onClick={() => setView("found")}>Found repos</button> : null}
      {view !== "browse" ? <button type="button" className="linkish" onClick={() => setView("browse")}>Browse…</button> : null}
      {view !== "type" ? <button type="button" className="linkish" onClick={() => setView("type")}>Type a path</button> : null}
    </div>
  );

  return (
    <div className="picker">
      <div className="pick-top">
        <MachinePick machines={sorted} machineId={machine._id} onPick={(id) => { setMachineId(id); if (view === "browse") setView("found"); }} />
        {links}
      </div>
      {view === "type" ? (
        <RepoForm officeId={officeId} initialMachineId={machine._id} onDone={onDone} onCancel={() => setView("found")} />
      ) : !machine.online ? (
        <div className="pick-offline">
          <span><b>{machine.name}</b> is offline; start the runner to see its folders:</span>
          <CopyCommand command={RUNNER_COMMAND} />
          <span className="dim">Or <button type="button" className="linkish" onClick={() => setView("type")}>type a path</button> on it instead.</span>
        </div>
      ) : view === "browse" ? (
        <BrowseFolders key={machine._id} machine={machine} repos={repos} picked={picked} full={full} onToggle={toggle} onType={() => setView("type")} />
      ) : (
        <FoundRepos key={machine._id} machine={machine} repos={repos} picked={picked} full={full} onToggle={toggle} onBrowse={() => setView("browse")} onType={() => setView("type")} />
      )}
      {view !== "type" && (machine.online || picked.size) ? (
        <div className="pick-foot">
          {err ? <div className="error">{err}</div> : null}
          <div className="actions">
            <Button kind="primary" disabled={busy || !picked.size} onClick={() => void add()}>
              {busy ? "Adding…" : picked.size ? `Add ${picked.size} repo${picked.size === 1 ? "" : "s"}` : "Pick repos to add"}
            </Button>
            {picked.size ? <Button kind="ghost" size="sm" onClick={() => setPicked(new Map())}>Clear</Button> : null}
            {onCancel ? <Button kind="ghost" onClick={onCancel}>Cancel</Button> : null}
            {room < MAX_REPOS && room <= 3 ? <span className="dim pick-room">{room ? `Room for ${room} more` : `A ship holds at most ${MAX_REPOS} repos`}</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Is this folder already on the ship (on this machine)? Paths compare with `~` for home, either way they were typed. */
function useAdded(repos: RepoRow[], machineId: string, home: string | null) {
  return useMemo(() => {
    const norm = (p: string) => (home ? tildePath(p.trim().replace(/(.)[\\/]+$/, "$1"), home) : p.trim());
    const set = new Set(repos.filter((r) => r.machineId === machineId).map((r) => norm(r.path)));
    return (path: string) => set.has(norm(path));
  }, [repos, machineId, home]);
}

interface ListProps { machine: Machine; repos: RepoRow[]; picked: Map<string, Picked>; full: boolean; onToggle: (r: FoundRepo) => void; onType: () => void }

/** The scan: every repo found, most recently changed first, with a search box. */
function FoundRepos({ machine, repos, picked, full, onToggle, onBrowse, onType }: ListProps & { onBrowse: () => void }) {
  const scan = useMutation(api.folders.scan);
  const { req, err, askedAt, again: lookAgain } = useFolderRequest((fresh) => scan({ machineId: machine._id, ...(fresh ? { again: true } : {}) }), machine._id);
  const [q, setQ] = useState("");
  const now = useNow(60_000);
  const result = req?.result?.kind === "scan" ? req.result : null;
  const isAdded = useAdded(repos, machine._id, result?.home ?? null);
  const shown = useMemo(() => {
    if (!result) return [];
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return result.repos.filter((r) => {
      const hay = `${r.name} ${r.path} ${remoteText(r.remote) ?? ""}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [result, q]);

  if (err) return <Failed text={err} onBrowse={onBrowse} onType={onType} />;
  if (!req || req.state === "pending") return <Looking what={`Looking for repos on ${machine.name}…`} since={req?.requestedAt ?? askedAt} machine={machine.name} />;
  if (req.state === "failed") return <Failed text={req.error ?? "The runner couldn't look."} onBrowse={onBrowse} onType={onType} onRetry={lookAgain} />;
  if (!result?.repos.length) {
    return (
      <div className="pick-empty">
        <span>No git repos found in the usual places. <button type="button" className="linkish" onClick={onBrowse}>Browse</button> or <button type="button" className="linkish" onClick={onType}>type a path</button>.</span>
        {result?.roots.length ? <span className="dim">Looked in {result.roots.join(", ")} and your home folder.</span> : null}
        <div><Button kind="ghost" size="sm" onClick={lookAgain}>Look again</Button></div>
      </div>
    );
  }
  return (
    <div className="pick-found">
      <div className="pick-search">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${result.repos.length} repos`} aria-label="Search repos" spellCheck={false} autoFocus />
        <Button kind="ghost" size="sm" onClick={lookAgain} title="Look again">Refresh</Button>
      </div>
      <div className="pick-list" role="group" aria-label="Repos found">
        {shown.map((r) => (
          <RepoChoice key={r.path} repo={r} now={now} added={isAdded(r.path)} picked={picked.has(keyOf(machine._id, r.path))} full={full} onToggle={() => onToggle(r)} />
        ))}
        {!shown.length ? <div className="dim pick-none">Nothing matches “{q}”.</div> : null}
      </div>
      {result.truncated || result.timedOut ? (
        <span className="dim pick-note">
          {result.truncated ? `Showing the first ${result.repos.length}.` : "Stopped looking after a few seconds."} Not here? <button type="button" className="linkish" onClick={onBrowse}>Browse</button> for it.
        </span>
      ) : null}
    </div>
  );
}

function Failed({ text, onBrowse, onType, onRetry, retry = "Try again" }: { text: string; onBrowse?: () => void; onType: () => void; onRetry?: () => void; retry?: string }) {
  return (
    <div className="pick-empty">
      <span className="error">{text}</span>
      <span className="dim">
        {onBrowse ? <><button type="button" className="linkish" onClick={onBrowse}>Browse</button> or </> : null}
        <button type="button" className="linkish" onClick={onType}>{onBrowse ? "type a path" : "Type a path"}</button> instead.
      </span>
      {onRetry ? <div><Button kind="ghost" size="sm" onClick={onRetry}>{retry}</Button></div> : null}
    </div>
  );
}

/** "~/Developer/web" → crumbs ~ › Developer › web, each a folder to go to. Outside home, just the path. */
function crumbsOf(path: string): { label: string; path: string | null }[] {
  if (path !== "~" && !path.startsWith("~/")) return [{ label: path, path: null }];
  const parts = path.split("/").slice(1);
  return [{ label: "~", path: "~" }, ...parts.map((p, i) => ({ label: p, path: ["~", ...parts.slice(0, i + 1)].join("/") }))];
}

/** One folder's subfolders, starting at home: go into a folder, tick a repo. */
function BrowseFolders({ machine, repos, picked, full, onToggle, onType }: ListProps) {
  const browse = useMutation(api.folders.browse);
  const [at, setAt] = useState<{ path: string; typed: boolean }>({ path: "~", typed: false });
  const [goTo, setGoTo] = useState("");
  const { req, err, askedAt, again } = useFolderRequest(() => browse({ machineId: machine._id, path: at.path, typed: at.typed }), `${machine._id}:${at.path}:${at.typed}`);
  const now = useNow(60_000);
  const result = req?.result?.kind === "browse" ? req.result : null;
  const isAdded = useAdded(repos, machine._id, result?.home ?? null);
  const go = (path: string, typed = at.typed && !path.startsWith("~")) => setAt({ path, typed });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const p = goTo.trim();
    if (!p) return;
    setAt({ path: p, typed: true });
    setGoTo("");
  };
  const crumbs = crumbsOf(result?.path ?? at.path);
  const row = (f: FolderEntry) => f.repo ? (
    <RepoChoice key={f.path} repo={f.repo} now={now} added={isAdded(f.path)} picked={picked.has(keyOf(machine._id, f.path))} full={full} onToggle={() => onToggle(f.repo!)}
      extra={<button type="button" className="pick-into" aria-label={`Open ${f.name}`} onClick={(e) => { e.preventDefault(); go(f.path); }}>›</button>} />
  ) : (
    <button key={f.path} type="button" className="pick-row folder" onClick={() => go(f.path)}>
      <span className="pick-folder-icon" aria-hidden="true" />
      <span className="pick-name clip">{f.name}</span>
      <span className="pick-into" aria-hidden="true">›</span>
    </button>
  );
  return (
    <div className="pick-found">
      <nav className="crumbs" aria-label="Folder">
        {crumbs[0]?.path === null ? <button type="button" className="linkish crumb-home" onClick={() => go("~", false)}>‹ Home</button> : null}
        {crumbs.map((c, i) => (
          <span key={i} className="crumb">
            {i ? <span className="crumb-sep" aria-hidden="true">/</span> : null}
            {c.path && i < crumbs.length - 1 ? <button type="button" className="linkish mono" onClick={() => go(c.path!)}>{c.label}</button> : <span className="mono">{c.label}</span>}
          </span>
        ))}
      </nav>
      {err ? <Failed text={err} onType={onType} onRetry={again} />
        : !req || req.state === "pending" ? <Looking what={`Opening ${at.path} on ${machine.name}…`} since={req?.requestedAt ?? askedAt} machine={machine.name} />
        : req.state === "failed" ? <Failed text={req.error ?? "The runner couldn't open that folder."} onType={onType} {...(at.path !== "~" ? { onRetry: () => go("~", false), retry: "Back to ~" } : {})} />
        : result ? (
          <div className="pick-list" role="group" aria-label={`Folders in ${result.path}`}>
            {result.parent ? (
              <button type="button" className="pick-row folder up" onClick={() => go(result.parent!)}><span className="pick-up" aria-hidden="true">‹</span><span className="dim">Up to {result.parent}</span></button>
            ) : null}
            {result.repo ? <RepoChoice repo={result.repo} now={now} added={isAdded(result.repo.path)} picked={picked.has(keyOf(machine._id, result.repo.path))} full={full} onToggle={() => onToggle(result.repo!)} extra={<span className="pill pick-this">This folder</span>} /> : null}
            {result.folders.map(row)}
            {!result.folders.length ? <div className="dim pick-none">No folders in here.</div> : null}
            {result.truncated ? <div className="dim pick-none">Showing the first {result.folders.length} folders. Type a path to go straight to one.</div> : null}
          </div>
        ) : null}
      <form className="pick-goto" onSubmit={submit}>
        <Input className="mono" value={goTo} onChange={(e) => setGoTo(e.target.value)} placeholder="Go to a folder: ~/work or /srv/code" aria-label="Go to a folder" spellCheck={false} />
        <Button type="submit" size="sm" disabled={!goTo.trim()}>Go</Button>
      </form>
    </div>
  );
}
