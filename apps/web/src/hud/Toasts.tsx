import { useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useUi } from "../bridge.ts";
import { Button, CloseIcon, errorText, Face } from "../ui/index.tsx";
import { useShip, type QuestionRow } from "../overlay/ship.tsx";
import { find } from "../phone/Conversation.tsx";
import { phone, usePhone } from "../phone/state.ts";

// Toasts: a crew member asking (stays until answered or waved off), a delivery landing, someone
// getting stuck, a pull request opening, a new hire flying in. Quiet while the phone or helm is open.

interface Note { id: string; tone: "green" | "red" | "dim"; title: string; body: string; crewId?: string; href?: string; threadId?: string; until: number }

const LABEL: Record<string, string> = { allow: "Allow", always: "Always", deny: "Deny" };

function QuestionToast({ q, onHide }: { q: QuestionRow; onHide: () => void }) {
  const { byId } = useShip();
  const answer = useMutation(api.questions.answer);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const who = byId.get(q.crewId);
  const opts = (q.options ?? (q.kind === "approval" ? ["allow", "deny"] : [])).filter((o) => o !== "always").slice(0, 3);
  const go = (a: string) => { setBusy(true); void answer({ questionId: q._id, answer: a }).catch((x) => { setErr(errorText(x)); setBusy(false); }); };
  return (
    <div className="toast amber fade-up">
      <div className="t-head">
        <Face avatar={who?.avatar} look={who?.look} computer={who?.role === "computer"} size={26} />
        <div className="t-who"><span className="lab t-amber">{q.crewName} needs you</span><span className="dim clip">{who?.live?.taskTitle ?? who?.live?.threadTitle ?? ""}</span></div>
        <button className="t-x" onClick={onHide} aria-label="Hide"><CloseIcon /></button>
      </div>
      <div className={`t-body ${q.kind === "approval" ? "mono" : ""}`}>{q.prompt}</div>
      <div className="t-actions">
        {q.kind === "approval" || (q.options && q.options.length <= 3)
          ? opts.map((o, i) => <Button key={o} size="sm" kind={i === 0 ? "amber" : "soft-amber"} disabled={busy} onClick={() => go(o)}>{LABEL[o] ?? o}</Button>)
          : <Button size="sm" kind="amber" onClick={() => phone.openThread(q.threadId)}>Answer</Button>}
        <span style={{ flex: 1 }} />
        {who?.role === "crew" ? <Button size="sm" kind="ghost" onClick={() => find(q.crewId)}>Find</Button> : null}
        {q.threadId ? <Button size="sm" kind="ghost" onClick={() => phone.openThread(q.threadId)}>Open</Button> : null}
      </div>
      {err ? <div className="error">{err}</div> : null}
    </div>
  );
}

export function Toasts() {
  const { crew, questions, threads, byId, snap } = useShip();
  const helm = useUi((s) => s.helm);
  const fold = usePhone((s) => s.fold);
  const [notes, setNotes] = useState<Note[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const seen = useRef<Set<string> | null>(null);
  const started = useRef(Date.now());

  // New events since the page opened become notes.
  useEffect(() => {
    if (!snap || !threads) return;
    const keys = new Set<string>();
    const fresh: Note[] = [];
    const now = Date.now();
    for (const c of crew) {
      if (c.lastEnded && (c.lastEnded.state === "landed" || c.lastEnded.state === "failed") && c.lastEnded.kind === "task") {
        const k = `end:${c._id}:${c.lastEnded.endedAt}`;
        keys.add(k);
        if (seen.current && !seen.current.has(k) && c.lastEnded.endedAt > started.current) {
          fresh.push(c.lastEnded.state === "landed"
            ? { id: k, tone: "green", title: `${c.name} delivered`, body: c.lastEnded.taskTitle ?? "Their task", crewId: c._id, until: now + 9000 }
            : { id: k, tone: "red", title: `${c.name} got stuck`, body: c.lastEnded.taskTitle ?? "Their task", crewId: c._id, until: now + 12000 });
        }
      }
      if (c.arrivesAt > now) {
        const k = `arrive:${c._id}`;
        keys.add(k);
        if (seen.current && !seen.current.has(k)) fresh.push({ id: k, tone: "dim", title: `${c.name} is flying in`, body: "The helicopter lands on the helipad, aft.", crewId: c._id, until: now + 8000 });
      }
    }
    for (const t of threads ?? []) {
      if (t.state !== "done") continue;
      const k = `done:${t._id}`;
      keys.add(k);
      if (seen.current && !seen.current.has(k)) fresh.push({ id: k, tone: "green", title: t.prs.filter((p) => p.url).length > 1 ? "Pull requests ready" : t.prUrl ? "Pull request ready" : "Thread finished", body: t.title, threadId: t._id, ...(t.prUrl ? { href: t.prUrl } : {}), until: now + 15000 });
    }
    if (seen.current) for (const k of seen.current) keys.add(k);
    seen.current = keys;
    if (fresh.length) setNotes((n) => [...n, ...fresh].slice(-4));
  }, [crew, threads, snap]);

  useEffect(() => {
    if (!notes.length) return;
    const t = setInterval(() => setNotes((n) => n.filter((x) => x.until > Date.now())), 1000);
    return () => clearInterval(t);
  }, [notes.length]);

  if (helm || fold === "open") return null;
  const qs = fold === "cover" ? [] : questions.filter((q) => !hidden.has(q._id)).slice(0, 2);
  return (
    <div className="toasts">
      {qs.map((q) => <QuestionToast key={q._id} q={q} onHide={() => setHidden((h) => new Set(h).add(q._id))} />)}
      {notes.map((n) => {
        const who = n.crewId ? byId.get(n.crewId) : undefined;
        return (
          <div key={n.id} className={`toast ${n.tone} fade-up`}>
            <div className="t-head">
              {who ? <Face avatar={who.avatar} look={who.look} size={26} /> : <Face computer size={26} />}
              <div className="t-who"><span className={`lab t-${n.tone}`}>{n.title}</span><span className="clip t-line">{n.body}</span></div>
              <button className="t-x" onClick={() => setNotes((x) => x.filter((y) => y.id !== n.id))} aria-label="Hide"><CloseIcon /></button>
            </div>
            {n.href || n.threadId ? (
              <div className="t-actions">
                {n.href ? <a className="btn sm soft" href={n.href} target="_blank" rel="noreferrer">Open the pull request</a> : null}
                {n.threadId ? <Button size="sm" kind="ghost" onClick={() => phone.openThread(n.threadId!)}>Thread</Button> : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
