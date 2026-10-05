import { useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { audio } from "../audio/index.ts";
import { useUi } from "../bridge.ts";
import { Button, CloseIcon, errorText, Face } from "../ui/index.tsx";
import { useShip, type QuestionRow } from "../overlay/ship.tsx";
import { find } from "../phone/Conversation.tsx";
import { phone, usePhone } from "../phone/state.ts";
import { COMPUTER_NAME } from "@offsite/contracts";
import { forMe, useAboard } from "../people/people.ts";

// Toasts: a crew member asking (stays until answered or waved off), a delivery landing, someone
// getting stuck, a pull request opening, a new hire flying in, a friend coming aboard or going ashore, a friend
// asking Computah for something. Quiet while the phone or helm is open.

interface Note {
  id: string; tone: "green" | "red" | "dim" | "accent"; title: string; body: string; crewId?: string; href?: string; threadId?: string; until: number;
  /** A person aboard (their face instead of a crew member's). */
  person?: { avatar: unknown; look: unknown };
}



const LABEL: Record<string, string> = { allow: "Allow", always: "Always", deny: "Deny" };

function QuestionToast({ q, onHide }: { q: QuestionRow; onHide: () => void }) {
  const { byId } = useShip();
  const answer = useMutation(api.questions.answer);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const who = byId.get(q.crewId);
  const opts = (q.options ?? (q.kind === "approval" ? ["allow", "deny"] : [])).filter((o) => o !== "always").slice(0, 3);
  const go = (a: string) => { setBusy(true); void answer({ questionId: q._id, answer: a }).then(() => audio.ui("send"), (x) => { setErr(errorText(x)); setBusy(false); }); };
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
  const { crew, questions: all, threads, byId, snap, officeId } = useShip();
  const aboard = useAboard(officeId);
  // Only what's for you buzzes and pops up: a question to someone else stays in the thread for them.
  const questions = all.filter((q) => aboard.loading || forMe(q, aboard.me, aboard.isOwner));
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
    // A question that wasn't waiting before buzzes the phone (not the ones already waiting when the page opened).
    let buzz = false;
    for (const q of questions) {
      const k = `q:${q._id}`;
      keys.add(k);
      if (seen.current && !seen.current.has(k)) buzz = true;
    }
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
    // Friends coming aboard and going ashore (not whoever was already on deck when the page opened).
    if (!aboard.loading) {
      for (const p of aboard.people) {
        if (p.me) continue;
        const k = `deck:${p.userId}:${p.onDeck ? "on" : "off"}`;
        keys.add(k);
        const flip = `deck:${p.userId}:${p.onDeck ? "off" : "on"}`;
        if (seen.current && !seen.current.has(k) && (seen.current.has(flip) || p.onDeck)) {
          fresh.push(p.onDeck
            ? { id: `${k}:${now}`, tone: "accent", title: `${p.name} came aboard`, body: p.owner ? "The captain is on deck." : "Say hello: they're on deck.", person: p, until: now + 7000 }
            : { id: `${k}:${now}`, tone: "dim", title: `${p.name} went ashore`, body: "They left the deck.", person: p, until: now + 6000 });
        }
        if (seen.current) seen.current.delete(flip);
      }
    }
    for (const t of threads ?? []) {
      // A friend asked Computah for something.
      if (t.startedBy && t.startedBy.userId !== aboard.me && t.createdAt > started.current) {
        const k = `asked:${t._id}`;
        keys.add(k);
        const who = aboard.byId.get(t.startedBy.userId);
        if (seen.current && !seen.current.has(k)) fresh.push({ id: k, tone: "accent", title: `${t.startedBy.name} asked ${COMPUTER_NAME}…`, body: t.title, threadId: t._id, ...(who ? { person: who } : {}), until: now + 10000 });
      }
      if (t.state !== "done") continue;
      const k = `done:${t._id}`;
      keys.add(k);
      if (seen.current && !seen.current.has(k)) fresh.push({ id: k, tone: "green", title: t.prs.filter((p) => p.url).length > 1 ? "Pull requests ready" : t.prUrl ? "Pull request ready" : "Thread finished", body: t.title, threadId: t._id, ...(t.prUrl ? { href: t.prUrl } : {}), until: now + 15000 });
    }
    if (seen.current) for (const k of seen.current) keys.add(k);
    seen.current = keys;
    if (fresh.length) setNotes((n) => [...n, ...fresh].slice(-4));
    // A delivery, or a thread finished with its pull requests: the chime. Someone asking: the buzz.
    if (fresh.some((n) => n.tone === "green")) audio.ui("landed");
    if (buzz) audio.ui("phone-buzz");
  }, [crew, threads, snap, questions, aboard]);

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
              {n.person ? <Face avatar={n.person.avatar} look={n.person.look} size={26} /> : who ? <Face avatar={who.avatar} look={who.look} size={26} /> : <Face computer size={26} />}
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
