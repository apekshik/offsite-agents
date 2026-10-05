import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import type { ChangedFile, ChangeStats } from "@offsite/contracts";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { ReviewTarget } from "../bridge.ts";
import { ago, Button, CloseIcon, Face, errorText, useNow } from "../ui/index.tsx";
import type { Span, State } from "./highlight.ts";
import { languageOf, parsePatch, type DiffLine, type FilePatch } from "./parse.ts";
import "./review.css";

// The crew's work, for the captain to read: a task's changes or a thread's (per repo). A header (what, who, where,
// how big), the files with their counts, and the unified diff with line numbers and light colouring. The diff comes
// from the machine holding the repo (convex/diffs.ts); while it's being read the last one shows, if there is one.

type View = FunctionReturnType<typeof api.diffs.get>;
type Part = View["repos"][number];

/** "+38 −2 · 2 files", coloured. */
export function Stats({ s, files = true, className }: { s: ChangeStats | null | undefined; files?: boolean; className?: string }) {
  if (!s) return null;
  return (
    <span className={`rv-stats ${className ?? ""}`}>
      <span className={s.added ? "t-green" : "dim"}>+{s.added}</span> <span className={s.removed ? "t-red" : "dim"}>−{s.removed}</span>
      {files ? <span className="dim"> · {s.files} file{s.files === 1 ? "" : "s"}</span> : null}
    </span>
  );
}

// ---- colouring, loaded with the first diff ----

type Highlight = typeof import("./highlight.ts");
let highlighter: Promise<Highlight> | null = null;
function useHighlighter(): Highlight | null {
  const [h, setH] = useState<Highlight | null>(null);
  useEffect(() => {
    let live = true;
    highlighter ??= import("./highlight.ts");
    void highlighter.then((m) => { if (live) setH(m); });
    return () => { live = false; };
  }, []);
  return h;
}

const SIGN: Record<DiffLine["kind"], string> = { add: "+", del: "−", ctx: " ", note: "" };
const FOLD_AT = 400;

const FileDiff = memo(function FileDiff({ f, hl, id }: { f: FilePatch; hl: Highlight | null; id: string }) {
  const lines = f.hunks.reduce((n, h) => n + h.lines.length, 0);
  const [open, setOpen] = useState(lines <= FOLD_AT);
  // Colour each line once, carrying block comments down each side of the hunk.
  const coloured = useMemo(() => {
    if (!hl || !open) return null;
    const lang = languageOf(f.path);
    return f.hunks.map((h) => {
      let before: State = { block: null }, after: State = { block: null };
      return h.lines.map((l): Span[] => {
        if (l.kind === "note") return [[l.text, null]];
        const r = hl.highlightLine(l.text, lang, l.kind === "del" ? before : after);
        if (l.kind !== "add") before = r.state;
        if (l.kind !== "del") after = r.state;
        return r.spans;
      });
    });
  }, [hl, f, open]);
  return (
    <section className="rv-file" id={id}>
      <header className="rv-file-head">
        <span className="mono clip rv-file-path" title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}>{f.oldPath ? <><span className="dim">{f.oldPath} → </span>{f.path}</> : f.path}</span>
        <Stats s={{ added: f.added, removed: f.removed, files: 1 }} files={false} />
      </header>
      {f.binary ? <div className="rv-note dim">A binary file. Open it in your editor to see it.</div>
        : !f.hunks.length ? <div className="rv-note dim">{f.oldPath ? "Renamed, with no changes inside." : "No line changes (a mode change or an empty file)."}</div>
        : !open ? <button className="rv-unfold" onClick={() => setOpen(true)}>Show all {lines} lines</button>
        : (
          <div className="rv-code mono" role="table" aria-label={`Changes in ${f.path}`}>
            {f.hunks.map((h, hi) => (
              <div key={hi} role="rowgroup">
                <div className="rv-hunk" role="row"><span className="clip">{h.header.replace(/ @@.*$/, " @@")}{h.section ? <span className="rv-section"> {h.section}</span> : null}</span></div>
                {h.lines.map((l, li) => (
                  <div key={li} className={`rv-line ${l.kind}`} role="row">
                    <span className="rv-no" aria-hidden="true">{l.old ?? ""}</span>
                    <span className="rv-no" aria-hidden="true">{l.new ?? ""}</span>
                    <span className="rv-sign" aria-label={l.kind === "add" ? "added" : l.kind === "del" ? "removed" : undefined}>{SIGN[l.kind]}</span>
                    <span className="rv-text">
                      {coloured ? coloured[hi]![li]!.map(([t, k], i) => (k ? <span key={i} className={`hl-${k}`}>{t}</span> : t)) : l.text}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
    </section>
  );
});

const STATUS: Record<string, { l: string; c: string; label: string }> = {
  added: { l: "A", c: "t-green", label: "added" }, deleted: { l: "D", c: "t-red", label: "deleted" }, modified: { l: "M", c: "t-accent", label: "modified" },
  renamed: { l: "R", c: "t-amber", label: "renamed" }, copied: { l: "C", c: "t-amber", label: "copied" }, typechange: { l: "T", c: "dim", label: "type changed" },
};

function FileList({ files, onPick }: { files: ChangedFile[]; onPick: (path: string) => void }) {
  const most = Math.max(1, ...files.map((f) => f.added + f.removed));
  return (
    <div className="rv-files">
      {files.map((f) => {
        const st = STATUS[f.status] ?? STATUS["modified"]!;
        const slash = f.path.lastIndexOf("/");
        return (
          <button key={f.path} className="rv-frow" onClick={() => onPick(f.path)} title={`${f.path} (${st.label})`}>
            <span className={`rv-st ${st.c}`} aria-label={st.label}>{st.l}</span>
            <span className="clip rv-fname mono">{slash >= 0 ? <span className="dim">{f.path.slice(0, slash + 1)}</span> : null}{f.path.slice(slash + 1)}</span>
            {f.binary ? <span className="dim rv-fcount">binary</span> : (
              <>
                <span className="rv-fcount"><span className={f.added ? "t-green" : "dim"}>+{f.added}</span> <span className={f.removed ? "t-red" : "dim"}>−{f.removed}</span></span>
                <span className="rv-bar" aria-hidden="true"><i className="g" style={{ width: `${(36 * f.added) / most}px` }} /><i className="r" style={{ width: `${(36 * f.removed) / most}px` }} /></span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}

function Waiting({ part }: { part: Part }) {
  if (part.machine && !part.machine.online) {
    return (
      <div className="rv-empty">
        <span className="rv-empty-title">Your Mac is offline; the diff lives there.</span>
        <span className="dim">{part.machine.name} holds {part.repo.name}. Start <span className="mono">offsite</span> on it and the changes appear here.</span>
      </div>
    );
  }
  return (
    <div className="rv-empty">
      <span className="dots"><i /><i /><i /></span>
      <span className="dim">Reading the changes on {part.machine?.name ?? "your machine"}…</span>
    </div>
  );
}

function Body({ part, scroller }: { part: Part; scroller: React.RefObject<HTMLDivElement | null> }) {
  const d = part.diff;
  const hl = useHighlighter();
  const patches = useMemo(() => (d?.patch ? parsePatch(d.patch) : []), [d?.patch]);
  if (!d || d.sha === null) {
    if (d?.state === "failed") return <div className="rv-empty"><span className="t-red">Couldn't read the changes.</span><span className="dim">{d.error}</span></div>;
    return <Waiting part={part} />;
  }
  const pick = (path: string) => {
    const i = patches.findIndex((p) => p.path === path);
    const el = i >= 0 ? scroller.current?.querySelector(`#rvf-${i}`) : null;
    el?.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  return (
    <>
      {d.state === "failed" ? <div className="rv-warn">Couldn't refresh: {d.error} Showing the last read.</div> : null}
      {d.state === "pending" && part.machine && !part.machine.online ? <div className="rv-warn">Your Mac is offline; this is the last read of it.</div> : null}
      {d.files.length ? <FileList files={d.files} onPick={pick} /> : <div className="rv-empty"><span className="dim">No changes in {part.repo.name}.</span></div>}
      {d.truncated ? <div className="rv-warn">That's a big diff: it's cut at 300 KB here. Open it in your editor for the rest.</div> : null}
      {patches.map((f, i) => <FileDiff key={`${i}:${f.path}`} id={`rvf-${i}`} f={f} hl={hl} />)}
    </>
  );
}

export function Review({ target, onClose, closeLabel = "Back to the conversation", big }: { target: ReviewTarget; onClose: () => void; closeLabel?: string; big?: boolean }) {
  const threadId = target.threadId as Id<"threads">;
  const taskId = (target.taskId ?? undefined) as Id<"tasks"> | undefined;
  const args = taskId ? { threadId, taskId } : { threadId };
  const view = useQuery(api.diffs.get, args);
  const request = useMutation(api.diffs.request);
  const seen = useMutation(api.diffs.seen);
  const openEditor = useMutation(api.diffs.openEditor);
  const [err, setErr] = useState<string | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [opening, setOpening] = useState<Id<"editorRequests"> | null>(null);
  const [openErr, setOpenErr] = useState<string | null>(null);
  const opened = useQuery(api.diffs.editorRequest, opening ? { requestId: opening } : "skip");
  const scroller = useRef<HTMLDivElement>(null);
  const now = useNow(15_000);

  // Ask on open, and again whenever something lands (the diff is cached by sha, so this is cheap).
  const landedAt = view?.thread.lastLandedAt ?? null;
  useEffect(() => {
    setErr(null);
    void request(args).catch((e) => setErr(errorText(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, taskId, landedAt]);
  useEffect(() => {
    void seen(taskId ? { taskId } : { threadId }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, taskId]);

  const parts = view?.repos ?? [];
  const part = parts.find((p) => p.repo.name === pick) ?? parts[0];
  const many = parts.length > 1;
  const stats = part?.diff?.stats ?? view?.task?.diff ?? null;
  const pr = view?.thread.prs.find((p) => p.url && (p.repo === part?.repo.name || view.thread.prs.length === 1));
  const title = view?.task?.title ?? view?.thread.title ?? "…";
  const edit = async () => {
    setOpenErr(null);
    try { setOpening(await openEditor({ threadId, ...(taskId ? { taskId } : {}), ...(part ? { repoId: part.repo._id } : {}) })); }
    catch (e) { setOpenErr(errorText(e)); }
  };

  return (
    <div className={`review ${big ? "big" : ""}`}>
      <div className="rv-head">
        <div className="rv-top">
          {big ? <span className="lab dim">Changes</span> : <Button kind="ghost" size="sm" className="rv-back" onClick={onClose}>← {closeLabel}</Button>}
          {big ? <button className="t-x rv-x" onClick={onClose} aria-label="Close the changes"><CloseIcon /></button> : null}
        </div>
        <span className="rv-title">{title}</span>
        <div className="rv-meta">
          {view?.crew ? <span className="rv-who"><Face avatar={view.crew.avatar} look={view.crew.look} size={18} />{view.crew.name}</span> : null}
          {view?.task ? <span className="dim">{view.task.state === "landed" ? `landed ${view.task.landedAt ? `${ago(now - view.task.landedAt)} ago` : ""}` : view.task.state === "doing" ? "still working" : view.task.state}</span> : !view?.task && view ? <span className="dim">the whole thread</span> : null}
          {part ? <span className="chip repo-chip rv-repo">{part.repo.name}</span> : null}
          {view?.task?.branch ?? view?.thread.branch ? <span className="mono rv-branch clip">{view?.task?.branch ?? view?.thread.branch}</span> : null}
          <Stats s={stats} />
        </div>
        {many ? (
          <div className="tabs rv-repos" role="tablist">
            {parts.map((p) => (
              <button key={p.repo._id} role="tab" aria-selected={p === part} className={`tab ${p === part ? "on" : ""}`} onClick={() => setPick(p.repo.name)}>
                {p.repo.name} {p.diff?.stats ? <Stats s={p.diff.stats} files={false} /> : null}
              </button>
            ))}
          </div>
        ) : null}
        <div className="actions rv-actions">
          <Button kind="soft" size="sm" onClick={() => void edit()} disabled={!part || part.machine?.online === false || (opening !== null && !opened?.doneAt)} title={part?.machine?.online === false ? `${part.machine.name} is offline` : undefined}>
            {opening !== null && !opened?.doneAt ? "Opening…" : "Open in editor"}
          </Button>
          {pr?.url ? <a className="btn sm" href={pr.url} target="_blank" rel="noreferrer">Open pull request{/\/pull\/(\d+)/.exec(pr.url)?.[1] ? ` #${/\/pull\/(\d+)/.exec(pr.url)![1]}` : ""} ↗</a> : null}
          {part?.diff?.state === "pending" && part.diff.sha ? <span className="dim rv-refresh">Refreshing…</span> : null}
          {opened?.doneAt ? <span className={`rv-opened clip ${opened.ok ? "dim" : "t-red"}`}>{opened.result}</span> : null}
          {openErr ? <span className="t-red rv-opened clip">{openErr}</span> : null}
        </div>
      </div>
      <div className="rv-body" ref={scroller}>
        {err ? <div className="error">{err}</div> : null}
        {view === undefined ? <div className="rv-empty"><span className="dim">…</span></div>
          : !part ? <div className="rv-empty"><span className="dim">No changes yet: no task in this thread has started.</span></div>
          : <Body key={part.repo._id} part={part} scroller={scroller} />}
      </div>
    </div>
  );
}
