import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { audio } from "../audio/index.ts";
import { ACTIVITY_LABEL, COMPUTER_NAME } from "@offsite/contracts";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { ui } from "../bridge.ts";
import { activityTone, ago, Button, Card, errorText, Face, Pill, RichText, SendIcon, useNow, useStickToBottom, type Tone } from "../ui/index.tsx";
import { activityOf, useShip, type CrewRow, type MessageRow, type QuestionRow, type TaskRow, type ThreadRow } from "../overlay/ship.tsx";
import { phone } from "./state.ts";
import { Stats } from "../review/Review.tsx";
import { openReview } from "../review/open.ts";
import { WalkFace } from "../overlay/walk.tsx";
import { forMe, useAboard, type Aboard } from "../people/people.ts";
import "./friends.css";

// The conversation with Computah, shared by the phone and the helm console: the threads, one thread
// (your messages, Computah's replies, its plan, crew reports), and questions.

// ---- questions ----

const OPTION_LABEL: Record<string, string> = { allow: "Allow", always: "Always allow", deny: "Deny", yes: "Yes", no: "No" };
const optionLabel = (o: string) => OPTION_LABEL[o] ?? (o.charAt(0).toUpperCase() + o.slice(1));

/** Ping someone and put the phone away, so the world can show the way. */
export function find(crewId: string) {
  ui.set({ ping: { crewId, at: Date.now() }, helm: false });
  phone.putAway();
}

/**
 * A crew member waiting on you: a permission (Allow / Deny) or a question (its options, or your own
 * words). The most important moment on the ship, so it is amber wherever it shows.
 */
export function QuestionCard({ q, context = true, findLink = true, wide = false, className }: { q: QuestionRow; context?: boolean; findLink?: boolean; wide?: boolean; className?: string }) {
  const { byId, officeId } = useShip();
  const aboard = useAboard(officeId);
  const answer = useMutation(api.questions.answer);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const now = useNow(5000);
  const who = byId.get(q.crewId);
  // With friends aboard: whom it's for, and a permission on the captain's machine is the captain's alone to give.
  const askedOf = "askedOf" in q && typeof q.askedOf === "string" ? aboard.byId.get(q.askedOf) : undefined;
  const forLabel = aboard.people.length > 1 && askedOf ? (askedOf.me ? "for you" : `for ${askedOf.name}`) : null;
  const captainOnly = q.kind === "approval" && !aboard.isOwner;
  const options = q.options ?? (q.kind === "approval" ? ["allow", "deny"] : []);
  const send = async (a: string) => {
    setBusy(a);
    setErr(null);
    try { await answer({ questionId: q._id, answer: a }); audio.ui("send"); } catch (e) { setErr(errorText(e)); setBusy(null); }
  };
  const where = who?.live?.taskTitle ?? null;
  const thread = who?.live?.threadTitle ?? null;
  return (
    <Card tone="amber" className={`question ${className ?? ""}`}>
      <div className="q-head">
        <Face avatar={who?.avatar} look={who?.look} computer={who?.role === "computer"} />
        <span className="lab t-amber clip">{q.crewName} {askedOf && !askedOf.me && aboard.people.length > 1 ? `asks ${askedOf.name}` : "needs you"}</span>
        {forLabel && askedOf?.me ? <span className="q-for t-amber">{forLabel}</span> : null}
        {findLink && who && who.role === "crew" ? <a href="#" className="q-find" onClick={(e) => { e.preventDefault(); find(q.crewId); }}>Find {q.crewName}</a> : <span className="q-age">{ago(now - q.createdAt)}</span>}
      </div>
      <div className={q.kind === "approval" ? "mono q-prompt" : "q-prompt q-ask"}>{q.prompt}</div>
      {context && (where || thread) ? <div className="q-ctx clip">{[where, thread].filter(Boolean).join(" · ")}</div> : null}
      {captainOnly ? <div className="q-ctx">Waiting on {aboard.owner?.name ?? "the captain"}: it runs on their machine.</div> : null}
      {options.length && !captainOnly ? (
        <div className={`q-opts ${wide ? "wide" : ""}`}>
          {options.map((o, i) => (
            <Button
              key={o}
              kind={i === 0 ? "amber" : o === "deny" && options.length > 2 ? "ghost" : "soft-amber"}
              disabled={busy !== null}
              onClick={() => void send(o)}
            >{busy === o ? "…" : optionLabel(o)}</Button>
          ))}
        </div>
      ) : null}
      {q.kind === "input" ? (
        <form className="q-say" onSubmit={(e) => { e.preventDefault(); if (text.trim()) void send(text.trim()); }}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={options.length ? "Or say something else…" : "Your answer…"} aria-label={`Answer ${q.crewName}`} />
          <Button kind="soft-amber" size="sm" type="submit" disabled={!text.trim() || busy !== null}>Answer</Button>
        </form>
      ) : null}
      {err ? <div className="error">{err}</div> : null}
    </Card>
  );
}

// ---- threads ----

export function threadState(t: ThreadRow, computer: CrewRow | undefined): { label: string; tone: Tone; detail: string } {
  if (t.state === "done") {
    const open = t.prs.filter((p) => p.url).length;
    if (open > 1) return { label: "Done", tone: "green", detail: `${open} pull requests` };
    const pr = t.prUrl ? /\/pull\/(\d+)/.exec(t.prUrl)?.[1] : null;
    return { label: "Done", tone: "green", detail: t.prUrl ? (pr ? `pull request #${pr}` : "pull request open") : t.prs.length > 1 ? "on its branches" : "on its branch" };
  }
  const thinking = computer?.live?.threadId === t._id;
  if (t.state === "working") {
    const d = t.tasks.total ? `${t.tasks.landed} of ${t.tasks.total} landed` : "starting";
    return { label: "Working", tone: "accent", detail: d };
  }
  if (thinking) return { label: "Open", tone: "dim", detail: `${COMPUTER_NAME} is ${(computer?.live?.step?.summary ?? "thinking").replace(/^./, (c) => c.toLowerCase())}` };
  return { label: "Open", tone: "dim", detail: t.tasks.total ? `${t.tasks.landed} of ${t.tasks.total} landed` : "talking it through" };
}

export function ThreadCard({ t, selected, onClick, progress }: { t: ThreadRow; selected: boolean; onClick: () => void; progress?: boolean }) {
  const { byId, computer, officeId, questions } = useShip();
  const aboard = useAboard(officeId);
  // What waits on you here: a friend isn't asked for the captain's permissions.
  const waiting = aboard.people.length > 1 ? questions.filter((q) => q.threadId === t._id && forMe(q, aboard.me, aboard.isOwner)).length : t.openQuestions;
  // "Maya asked": who started it, once there's more than one person who could have.
  const starter = "startedBy" in t && t.startedBy && aboard.people.length > 1 ? (t.startedBy.userId === aboard.me ? "You" : t.startedBy.name) : null;
  const st = threadState(t, computer);
  const thinking = computer?.live?.threadId === t._id;
  return (
    <Card tone={selected ? "accent" : undefined} quiet={!selected} className="thread-card" onClick={onClick}>
      <div className="tc-top">
        <span className="tc-title">{t.title}</span>
        {waiting ? <Pill tone="amber">{waiting} needs you</Pill> : null}
      </div>
      <div className="tc-meta">
        {t.crewIds.length ? <span className="faces">{t.crewIds.slice(0, 5).map((id) => { const c = byId.get(id); return <Face key={id} avatar={c?.avatar} look={c?.look} title={c?.name} />; })}</span>
          : thinking ? <Face computer /> : null}
        <span className={`lab t-${st.tone}`}>{st.label}</span>
        <span className="clip">{starter ? `· ${starter} asked ` : ""}· {st.detail}</span>
        {t.diff ? <Stats s={t.diff} files={false} className="tc-stats" /> : null}
      </div>
      {progress && t.state === "working" && t.tasks.total ? <div className="bar"><i style={{ width: `${(100 * t.tasks.landed) / t.tasks.total}%` }} /></div> : null}
    </Card>
  );
}

export function ThreadList({ selected, onSelect, progress }: { selected: string | null; onSelect: (id: string) => void; progress?: boolean }) {
  const { threads } = useShip();
  if (!threads) return <div className="empty dim">Loading threads…</div>;
  if (!threads.length) return <div className="empty dim">No threads yet. Ask {COMPUTER_NAME} for something above: “add a dark mode toggle to settings”.</div>;
  return (
    <div className="thread-list">
      {threads.map((t) => <ThreadCard key={t._id} t={t} selected={t._id === selected} onClick={() => onSelect(t._id)} progress={progress ?? false} />)}
    </div>
  );
}

/** "Ask Computah for something…": starts a thread. */
export function NewThread({ autoFocus, onStarted, placeholder = `Ask ${COMPUTER_NAME} for something…`, big }: { autoFocus?: boolean; onStarted?: (id: string) => void; placeholder?: string; big?: boolean }) {
  const { officeId } = useShip();
  const aboard = useAboard(officeId);
  const create = useMutation(api.threads.create);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const id = await create({ officeId, text: t });
      audio.ui("send");
      setText("");
      ui.set({ threadId: id });
      onStarted?.(id);
    } catch (x) { setErr(errorText(x)); } finally { setBusy(false); }
  };
  if (!aboard.canAsk) return <div className="card composer composer-off dim">{aboard.owner?.name ?? "The captain"} has turned off asking {COMPUTER_NAME} for friends aboard. You can read along.</div>;
  return (
    <>
      <form className={`card composer ${big ? "big" : ""}`} onSubmit={(e) => void submit(e)}>
        <label className="sr" htmlFor={big ? "new-thread-big" : "new-thread"}>New thread</label>
        {big ? (
          <textarea id="new-thread-big" rows={3} value={text} autoFocus={autoFocus} placeholder={placeholder} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submit(); } }} />
        ) : (
          <input id="new-thread" value={text} autoFocus={autoFocus} placeholder={placeholder} onChange={(e) => setText(e.target.value)} autoComplete="off" />
        )}
        <button className="iconbtn" type="submit" aria-label="Start thread" disabled={!text.trim() || busy}><SendIcon /></button>
      </form>
      {err ? <div className="error">{err}</div> : null}
    </>
  );
}

// ---- one thread ----

const TASK_STATE: Record<string, { icon: string; label: string; tone: Tone }> = {
  todo: { icon: "○", label: "Up next", tone: "dim" },
  doing: { icon: "●", label: "Working", tone: "accent" },
  review: { icon: "↻", label: "Landing", tone: "accent" },
  landed: { icon: "✓", label: "Landed", tone: "green" },
  failed: { icon: "✕", label: "Stuck", tone: "red" },
  cancelled: { icon: "–", label: "Stopped", tone: "dim" },
};

/** The repo a task is in, shown only when the ship has more than one. */
export function RepoChip({ name }: { name: string | null | undefined }) {
  const { office } = useShip();
  if (!name || (office?.repos.length ?? 0) < 2) return null;
  return <span className="chip repo-chip">{name}</span>;
}

/** "+38 −2 · View changes": opens the task's (or, without a task, the thread's) changes. */
export function ViewChanges({ threadId, taskId, stats, inline, label = "View changes" }: { threadId: string; taskId: string | null; stats?: { added: number; removed: number; files: number } | null | undefined; inline?: boolean; label?: string }) {
  return (
    <span className={`view-changes ${inline ? "inline" : ""}`}>
      {stats ? <Stats s={stats} files={!inline} /> : null}
      <button className="rv-link" onClick={(e) => { e.stopPropagation(); openReview({ threadId, taskId }); }}>{label}</button>
    </span>
  );
}

function PlanCard({ tasks, grid }: { tasks: TaskRow[]; grid?: boolean }) {
  const { byId } = useShip();
  const now = useNow(2000);
  const rows = tasks.map((t) => {
    const who = t.assignee ? byId.get(t.assignee) : undefined;
    let st = TASK_STATE[t.state] ?? TASK_STATE["todo"]!;
    if (t.state === "doing" && who && who.live?.taskId === t._id) {
      const a = activityOf(who, now);
      st = { ...st, label: ACTIVITY_LABEL[a], tone: activityTone(a), icon: a === "asking" ? "!" : st.icon };
    }
    if (t.state === "todo" && t.dependsOn.length) st = { ...st, label: "Waiting" };
    return { t, who, st };
  });
  if (grid) {
    return (
      <div className="plan-grid">
        {rows.map(({ t, who, st }) => (
          <Card key={t._id} tone={st.tone === "dim" ? undefined : st.tone} quiet={st.tone === "dim"} className="plan-tile">
            <span className={`lab t-${st.tone}`}>{st.label}<RepoChip name={t.repo} /></span>
            <span className="pt-title">{t.title}</span>
            <span className="pt-who">{who ? <><Face avatar={who.avatar} look={who.look} size={22} />{who.name}</> : <span className="dim">Whoever is free</span>}</span>
            {t.state === "landed" ? <ViewChanges threadId={t.threadId} taskId={t._id} stats={t.diff} /> : null}
          </Card>
        ))}
      </div>
    );
  }
  return (
    <Card className="plan">
      <span className="lab dim">{COMPUTER_NAME} planned {tasks.length} task{tasks.length === 1 ? "" : "s"}</span>
      {rows.map(({ t, who, st }) => (
        <div key={t._id} className="plan-row" title={t.brief}>
          <span className={`pr-icon t-${st.tone}`}>{st.icon}</span>
          <span className="pr-title">{t.title}<RepoChip name={t.repo} />{t.state === "landed" ? <ViewChanges threadId={t.threadId} taskId={t._id} stats={t.diff} inline /> : null}</span>
          {who ? <WalkFace crewId={who._id} name={who.name}><Face avatar={who.avatar} look={who.look} /></WalkFace> : null}
          <span className={`lab pr-state t-${st.tone}`}>{st.label}</span>
        </div>
      ))}
    </Card>
  );
}

function lower(s: string) { return s.charAt(0).toLowerCase() + s.slice(1); }

function Message({ m, tasks, isLatestPlan, big, thread, aboard }: { m: MessageRow; tasks: TaskRow[]; isLatestPlan: boolean; big?: boolean; thread?: ThreadRow | undefined; aboard: Aboard }) {
  const { byId } = useShip();
  if (m.author.kind === "captain") {
    // A person aboard. Yours on the right; with friends aboard, everyone else's on the left with their face and name.
    const userId = m.author.userId ?? aboard.owner?.userId;
    const person = userId ? aboard.byId.get(userId) : undefined;
    if (!userId || userId === aboard.me || aboard.people.length < 2) return <div className="msg me"><RichText text={m.text} /></div>;
    return (
      <div className="msg-row person">
        <Face avatar={person?.avatar} look={person?.look} size={big ? 26 : 22} title={person?.name} />
        <div className="msg them">
          <span className={`lab who ${person?.owner ? "t-amber" : "t-accent"}`}>{person?.name ?? "Someone"}{person?.owner ? " · captain" : ""}</span>
          <span><RichText text={m.text} /></span>
        </div>
      </div>
    );
  }
  if (m.author.kind === "system" || m.kind === "system") {
    const lines = m.text.split("\n");
    if (lines.length < 3) return <div className="msg-system">{m.text}</div>;
    return (
      <Card tone="green" className="msg-finished">
        <span className="lab t-green">Finished · {lines[0]}</span>
        <div className="mf-body"><RichText text={lines.slice(1).join("\n").trim()} /></div>
        {thread ? <ViewChanges threadId={thread._id} taskId={null} stats={thread.diff} label="View all changes" /> : null}
      </Card>
    );
  }
  const who = byId.get(m.author.crewId);
  const computer = who?.role === "computer";
  const faceOnly = <Face avatar={who?.avatar} look={who?.look} computer={computer} size={big ? 26 : 22} />;
  // A crew member's face walks you over to them.
  const face = who && who.role === "crew" ? <WalkFace crewId={who._id} name={who.name}>{faceOnly}</WalkFace> : faceOnly;
  if (m.kind === "plan") {
    if (!isLatestPlan || !tasks.length) return <div className="msg-row">{face}<div className="msg them"><RichText text={m.text} /></div></div>;
    return <div className="msg-plan"><PlanCard tasks={tasks} grid={big ?? false} /></div>;
  }
  if (m.kind === "report") {
    const task = tasks.find((t) => t._id === m.taskId);
    const failed = task?.state === "failed" || /^I couldn't finish/.test(m.text);
    return (
      <div className="msg-row">
        {face}
        <div className={`msg them report ${failed ? "red" : "green"}`}>
          <span className={`lab ${failed ? "t-red" : "t-green"}`}>{who?.name ?? "Someone"} · {failed ? "stuck on" : "landed"} {task ? lower(task.title) : "their task"}</span>
          <span><RichText text={m.text} /></span>
          {!failed && task?.state === "landed" ? <ViewChanges threadId={task.threadId} taskId={task._id} stats={task.diff} /> : null}
        </div>
      </div>
    );
  }
  return (
    <div className="msg-row">
      {face}
      <div className="msg them">
        {!computer ? <span className="lab dim">{who?.name ?? "Someone"}</span> : null}
        <span><RichText text={m.text} />{m.streaming ? <span className="caret" /> : null}</span>
      </div>
    </div>
  );
}

export function ThreadView({ threadId, big }: { threadId: string; big?: boolean }) {
  const { threads, computer, questions, officeId } = useShip();
  const aboard = useAboard(officeId);
  const id = threadId as Id<"threads">;
  const messages = useQuery(api.messages.list, { threadId: id });
  const tasks = useQuery(api.tasks.list, { threadId: id }) ?? [];
  const send = useMutation(api.threads.send);
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const t = threads?.find((x) => x._id === threadId);
  const qs = questions.filter((q) => q.threadId === threadId);
  const latestPlan = useMemo(() => [...(messages ?? [])].reverse().find((m) => m.kind === "plan")?._id, [messages]);
  const streaming = messages?.some((m) => m.streaming);
  const thinking = computer?.live?.threadId === threadId && !streaming;
  const last = messages?.[messages.length - 1];
  const list = useStickToBottom<HTMLDivElement>(`${messages?.length}:${last?.text.length}:${qs.length}:${thinking}`);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setText("");
    setErr(null);
    try { await send({ threadId: id, text: body }); audio.ui("send"); } catch (x) { setErr(errorText(x)); setText(body); }
  };
  const landed = tasks.filter((x) => x.state === "landed").length;
  return (
    <div className={`thread ${big ? "big" : ""}`}>
      <div className="thread-head">
        <span className="th-title">{t?.title ?? "…"}</span>
        <span className="th-meta">
          {t?.branch ? <span className="mono th-branch">{t.branch}</span> : null}
          {tasks.length ? <span>· {tasks.length} task{tasks.length === 1 ? "" : "s"} · {landed} landed</span> : null}
          {landed ? <ViewChanges threadId={threadId} taskId={null} stats={t?.diff} inline label="· View changes" /> : null}
          {t && t.prs.filter((p) => p.url).length > 1
            ? t.prs.filter((p) => p.url).map((p) => <a key={p.repo ?? p.url} href={p.url!} target="_blank" rel="noreferrer">· {p.repo ?? "pull request"} #{/\/pull\/(\d+)/.exec(p.url!)?.[1] ?? ""}</a>)
            : t?.prUrl ? <a href={t.prUrl} target="_blank" rel="noreferrer">· pull request</a> : null}
        </span>
      </div>
      <div className="thread-body" ref={list}>
        {messages === undefined ? <div className="empty dim">…</div> : null}
        {messages?.map((m) => <Message key={m._id} m={m} tasks={tasks} isLatestPlan={m._id === latestPlan} big={big ?? false} thread={t} aboard={aboard} />)}
        {thinking ? (
          <div className="msg-row">
            <Face computer size={big ? 26 : 22} />
            <div className="msg them thinking"><span className="dots"><i /><i /><i /></span>{computer?.live?.step ? <span className="dim">{computer.live.step.summary}</span> : null}</div>
          </div>
        ) : null}
        {qs.map((q) => <QuestionCard key={q._id} q={q} context={false} />)}
      </div>
      {!aboard.canAsk ? <div className="card composer composer-off dim">{aboard.owner?.name ?? "The captain"} has turned off asking {COMPUTER_NAME} for friends aboard. You can read along.</div> : (
      <form className="card composer" onSubmit={(e) => void submit(e)}>
        <label className="sr" htmlFor={`say-${big ? "helm" : "phone"}`}>Message {COMPUTER_NAME}</label>
        <input id={`say-${big ? "helm" : "phone"}`} value={text} onChange={(e) => setText(e.target.value)} placeholder={`Message ${COMPUTER_NAME}…`} autoComplete="off" />
        {big ? <Button kind="primary" type="submit" disabled={!text.trim()}>Send</Button>
          : <button className="iconbtn" type="submit" aria-label="Send" disabled={!text.trim()}><SendIcon /></button>}
      </form>)}
      {err ? <div className="error">{err}</div> : null}
    </div>
  );
}
