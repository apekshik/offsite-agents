import { useMemo, useState, type CSSProperties, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { audio } from "../audio/index.ts";
import { ACTIVITY_LABEL, isWorking, type RunEvent } from "@offsite/contracts";
import { CREW_PRESETS } from "@offsite/kit";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { activityTone, ago, Button, Card, Chip, ConfirmButton, errorText, Face, Field, Input, RichText, useNow, useStickToBottom } from "../ui/index.tsx";
import { activityOf, harnessName, placeOf, useShip, workTitle, type CrewRow } from "../overlay/ship.tsx";
import { find, QuestionCard, RepoChip, ViewChanges } from "./Conversation.tsx";
import { phone } from "./state.ts";

// The crew tab: everyone aboard, and one of them up close (what they are doing, their live work,
// Find, Message, Stop, their look and specialty). Hiring lives here too.

/** "Editing · Settings page" / "Off duty · in a hammock, promenade" / "Needs you · walking to you". */
export function crewLine(c: CrewRow, now: number): { text: string; sub: string | null; mono: boolean } {
  const a = activityOf(c, now);
  const title = workTitle(c);
  if (c.role === "computer") {
    if (c.asking) return { text: "Needs you", sub: null, mono: false };
    return c.live
      ? { text: `At the helm · ${c.live.threadTitle ? `on “${c.live.threadTitle}”` : "thinking"}`, sub: c.live.step?.summary ?? null, mono: true }
      : { text: "At the helm · all quiet", sub: null, mono: false };
  }
  if (a === "asking") return { text: `${ACTIVITY_LABEL.asking} · walking to you`, sub: c.live?.step?.summary ?? null, mono: true };
  if (a === "arriving") return { text: "Arriving by helicopter", sub: null, mono: false };
  if (isWorking(a)) {
    const place = placeOf(c._id);
    const step = c.live?.step?.summary ?? null;
    return { text: title ? `${ACTIVITY_LABEL[a]} · ${title}` : ACTIVITY_LABEL[a], sub: step ?? (place ? place.charAt(0).toUpperCase() + place.slice(1) : null), mono: !!step };
  }
  if (a === "landed") return { text: `Delivered · ${c.lastEnded?.taskTitle ?? "their task"}`, sub: "Carrying it to the bridge", mono: false };
  if (a === "failed") return { text: `Stuck · ${c.lastEnded?.taskTitle ?? "their task"}`, sub: c.lastStep, mono: true };
  const place = placeOf(c._id);
  return { text: place ? `Off duty · ${place}` : "Off duty", sub: null, mono: false };
}

export function CrewRowCard({ c, selected, onClick }: { c: CrewRow; selected: boolean; onClick: () => void }) {
  const now = useNow(2000);
  const a = activityOf(c, now);
  const tone = activityTone(a);
  const line = crewLine(c, now);
  const computer = c.role === "computer";
  return (
    <div className={`card crew-row ${selected ? "accent" : tone === "amber" ? "amber" : "quiet"}`} onClick={onClick} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter") onClick(); }}>
      <Face avatar={c.avatar} look={c.look} computer={computer} size={30} />
      <div className="cr-main">
        <span className="cr-name">{c.name} <Chip>{harnessName(c.harness)}</Chip></span>
        <span className={`cr-line clip t-${computer && !c.asking ? "dim" : tone}`}>{line.text}</span>
        {line.sub ? <span className={`cr-sub clip ${line.mono ? "mono" : ""}`}>{line.sub}</span> : null}
      </div>
      {computer ? null : a === "asking"
        ? <Button kind="soft-amber" size="sm" onClick={(e) => { e.stopPropagation(); onClick(); }}>Answer</Button>
        : a !== "arriving" ? <Button kind={tone === "accent" ? "soft" : "plain"} size="sm" onClick={(e) => { e.stopPropagation(); find(c._id); }}>Find</Button> : null}
    </div>
  );
}

export function CrewList({ selected, onSelect }: { selected: string | null; onSelect: (id: string) => void }) {
  const { crew, computer } = useShip();
  return (
    <div className="crew-list">
      {computer ? <CrewRowCard c={computer} selected={selected === computer._id} onClick={() => onSelect(computer._id)} /> : null}
      {crew.map((c) => <CrewRowCard key={c._id} c={c} selected={selected === c._id} onClick={() => onSelect(c._id)} />)}
    </div>
  );
}

// ---- watching someone work ----

interface Step { id: string; kind: string; text: string; state: "running" | "ok" | "failed" | "ask" | "note"; ms: number | null; at: number }

function stepsOf(events: { seq: number; at: number; event: RunEvent }[]): { steps: Step[]; said: string } {
  const steps: Step[] = [];
  const byItem = new Map<string, Step>();
  let said = "";
  let fresh = false;
  const strip = (kind: string, s: string) => s.replace(new RegExp(`^${kind}\\s+`, "i"), "");
  for (const { at, event: e } of events) {
    switch (e.type) {
      case "item.started": {
        const s: Step = { id: e.itemId, kind: e.kind, text: strip(e.kind, e.summary), state: "running", ms: null, at };
        byItem.set(e.itemId, s);
        steps.push(s);
        fresh = true;
        break;
      }
      case "item.completed": {
        const s = byItem.get(e.itemId);
        if (s) { s.state = e.ok ? "ok" : "failed"; s.ms = e.ms; s.text = strip(s.kind, e.summary || s.text); }
        break;
      }
      case "request.opened": steps.push({ id: e.requestId, kind: "ask", text: e.prompt.split("\n")[0] ?? "", state: "ask", ms: null, at }); break;
      case "request.resolved": { const s = steps.find((x) => x.id === e.requestId); if (s) { s.state = e.decision === "deny" ? "failed" : "ok"; s.kind = e.decision; } break; }
      case "error": steps.push({ id: `err${at}`, kind: "error", text: e.message, state: "failed", ms: null, at }); break;
      case "steer.received": steps.push({ id: `steer${at}`, kind: "heard", text: e.text, state: "note", ms: null, at }); break;
      case "content.delta": if (fresh) { said = ""; fresh = false; } said += e.delta; break;
      case "content.final": said = e.text; fresh = false; break;
      default: break;
    }
  }
  return { steps: steps.slice(-60), said: said.trim() };
}

function Watch({ runId, compact }: { runId: string; compact?: boolean }) {
  const events = useQuery(api.runs.events, { runId: runId as Id<"runs"> });
  const now = useNow(1000);
  const { steps, said } = useMemo(() => stepsOf((events ?? []) as { seq: number; at: number; event: RunEvent }[]), [events]);
  const ref = useStickToBottom<HTMLDivElement>(`${steps.length}:${steps[steps.length - 1]?.state}`);
  return (
    <Card className={`watch ${compact ? "compact" : ""}`} style={{ "--bc": "rgba(238,243,247,.45)" } as CSSProperties}>
      <span className="lab dim">Watch</span>
      <div className="w-steps" ref={ref}>
        {events === undefined ? <span className="dim">…</span> : !steps.length ? <span className="dim">Getting started…</span> : null}
        {steps.map((s, i) => {
          const live = s.state === "running" && i === steps.length - 1;
          const tone = s.state === "failed" ? "t-red" : s.state === "ask" ? "t-amber" : s.state === "running" ? "t-accent" : s.state === "note" ? "dim" : "t-green";
          return (
            <div key={`${s.id}${i}`} className={`mono w-step ${live ? "live" : ""}`}>
              <span className={`w-kind ${tone}`}>{s.kind}</span>
              <span className="w-text clip">{s.text}</span>
              <span className={live ? "t-accent" : ""}>{s.state === "running" ? (live ? "now" : "…") : s.ms !== null ? `${(s.ms / 1000).toFixed(1)}s` : ago(now - s.at)}</span>
            </div>
          );
        })}
      </div>
      {said ? <div className="w-said"><RichText text={said.length > 360 ? `…${said.slice(-360)}` : said} /></div> : null}
    </Card>
  );
}

// ---- one crew member ----

function OffDuty({ name, place, landed }: { name: string; place: string | null; landed: boolean }) {
  return (
    <div className="off-duty">
      <i className="od-sun" />
      <i className="od-g" style={{ right: "calc(16% - 28px)", top: "calc(55% + 12px)", width: 130, opacity: 0.7 }} />
      <i className="od-g" style={{ right: "calc(16% - 4px)", top: "calc(55% + 26px)", width: 82, opacity: 0.45 }} />
      <i className="od-g" style={{ right: "calc(16% + 18px)", top: "calc(55% + 40px)", width: 38, opacity: 0.25 }} />
      <span className="disp od-title">{landed ? "Delivering" : "Off duty"}</span>
      <span className="od-where">{landed ? `${name} is carrying the work to the bridge.` : `${name} is ${place ?? "somewhere on deck"}.`}</span>
      <span className="od-back">Back when there's work</span>
    </div>
  );
}

function MessageBox({ c, onDone }: { c: CrewRow; onDone: () => void }) {
  const send = useMutation(api.threads.send);
  const [text, setText] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const threadId = c.live?.threadId ?? null;
  if (!threadId) {
    return <div className="note">{c.name} isn't on a thread right now. Messages reach the crew through the thread they're working on; start one and the computer brings them in.</div>;
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    try {
      await send({ threadId, text: `@${c.handle} ${t}` });
      audio.ui("send");
      setSent(t);
      setText("");
      setTimeout(onDone, 2200);
    } catch (x) { setErr(errorText(x)); }
  };
  return (
    <>
      <form className="card composer" onSubmit={(e) => void submit(e)}>
        <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={`Message ${c.name}…`} aria-label={`Message ${c.name}`} />
        <Button kind="primary" size="sm" type="submit" disabled={!text.trim()}>Send</Button>
      </form>
      <div className="note">{sent ? `Sent. The computer passes it to ${c.name} in “${c.live?.threadTitle ?? "their thread"}”.` : `Goes to ${c.name} through “${c.live?.threadTitle ?? "their thread"}”.`}</div>
      {err ? <div className="error">{err}</div> : null}
    </>
  );
}

function EditCrew({ c, onDone }: { c: CrewRow; onDone: () => void }) {
  const update = useMutation(api.crew.update);
  const dismiss = useMutation(api.crew.dismiss);
  const [name, setName] = useState(c.name);
  const [specialty, setSpecialty] = useState(c.specialty ?? "");
  const [harness, setHarness] = useState(c.harness);
  const [effort, setEffort] = useState(c.effort);
  const [model, setModel] = useState(c.model ?? "");
  const [err, setErr] = useState<string | null>(null);
  const computer = c.role === "computer";
  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await update({
        crewId: c._id, specialty: specialty.trim() || null, harness, effort, model: model.trim() || null,
        ...(computer || name.trim() === c.name ? {} : { name: name.trim() }),
      });
      onDone();
    } catch (x) { setErr(errorText(x)); }
  };
  return (
    <form className="edit-crew" onSubmit={(e) => void save(e)}>
      {!computer ? <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={20} /></Field> : null}
      <Field label="Specialty" hint="What the computer should hand them: “frontend and CSS”, “tests”…">
        <Input value={specialty} onChange={(e) => setSpecialty(e.target.value)} placeholder="Anything" maxLength={200} />
      </Field>
      <div className="row2">
        <Field label="Runs on">
          <select className="input" value={harness} onChange={(e) => setHarness(e.target.value as typeof harness)}>
            <option value="claude">Claude Code</option>
            <option value="codex">Codex</option>
            <option value="sim">Sim crew (no spending)</option>
          </select>
        </Field>
        <Field label="Effort">
          <select className="input" value={effort} onChange={(e) => setEffort(e.target.value as typeof effort)}>
            {(["low", "medium", "high", "max"] as const).map((x) => <option key={x} value={x}>{x.charAt(0).toUpperCase() + x.slice(1)}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Model" hint="Leave empty for the CLI's default."><Input className="mono" value={model} onChange={(e) => setModel(e.target.value)} placeholder="default" /></Field>
      {err ? <div className="error">{err}</div> : null}
      <div className="actions">
        <Button kind="primary" type="submit">Save</Button>
        <Button kind="ghost" onClick={onDone}>Cancel</Button>
        {!computer ? <span style={{ marginLeft: "auto" }}><ConfirmButton confirm={`Send ${c.name} home?`} onConfirm={() => void dismiss({ crewId: c._id }).then(onDone, (x) => setErr(errorText(x)))}>Send home</ConfirmButton></span> : null}
      </div>
    </form>
  );
}

export function CrewDetail({ crewId, compact }: { crewId: string; compact?: boolean }) {
  const { byId, questions } = useShip();
  const interrupt = useMutation(api.runs.interrupt);
  const now = useNow(1000);
  const [mode, setMode] = useState<"watch" | "message" | "edit">("watch");
  const c = byId.get(crewId);
  if (!c) return <div className="empty dim">They're no longer aboard.</div>;
  const computer = c.role === "computer";
  const a = activityOf(c, now);
  const tone = activityTone(a);
  const q = questions.find((x) => x.crewId === c._id);
  const place = placeOf(c._id);
  const facts = [harnessName(c.harness), `${c.effort} effort`, c.model, computer ? "at the helm" : place].filter(Boolean).join(" · ");
  const title = workTitle(c);
  return (
    <div className={`crew-detail ${compact ? "compact" : ""}`}>
      <div className="cd-head">
        <Face avatar={c.avatar} look={c.look} computer={computer} size={44} />
        <div className="cd-who">
          <span className="cd-name">{c.name}</span>
          <span className="dim cd-facts">{facts}</span>
          {c.specialty ? <span className="ink2 cd-facts">{c.specialty}</span> : null}
        </div>
      </div>
      <div className="cd-now">
        <span className={`lab t-${tone}`}>{c.live ? (a === "asking" ? "Needs you" : `${ACTIVITY_LABEL[a]} · working on`) : ACTIVITY_LABEL[a]}</span>
        {c.live ? (
          <>
            <span className="cd-task">{title ?? "Thinking"}<RepoChip name={c.live.repo} /></span>
            <span className="dim cd-thread">{[c.live.taskTitle ? c.live.threadTitle : null, c.live.startedAt ? ago(now - c.live.startedAt) : null].filter(Boolean).join(" · ")}</span>
          </>
        ) : a === "arriving" ? <span className="cd-task">On the helicopter, {ago(c.arrivesAt - now)} out</span>
          : (
            <span className="dim cd-thread">
              {c.lastEnded ? `${c.lastEnded.state === "landed" ? "Last delivered" : c.lastEnded.state === "failed" ? "Got stuck on" : "Last worked on"} ${c.lastEnded.taskTitle ? `“${c.lastEnded.taskTitle}”` : "a thread"} ${ago(now - c.lastEnded.endedAt)} ago.` : "Nothing yet. They'll get the next task that suits them."}
              {c.lastStep ? <><br /><span className="mono">{c.lastStep}</span></> : null}
            </span>
          )}
        {!c.live && c.lastEnded?.state === "landed" && c.lastEnded.taskId && c.lastEnded.threadId
          ? <ViewChanges threadId={c.lastEnded.threadId} taskId={c.lastEnded.taskId} stats={c.lastEnded.diff} /> : null}
      </div>
      {q ? <QuestionCard q={q} findLink={false} /> : null}
      {mode === "edit" ? <EditCrew c={c} onDone={() => setMode("watch")} />
        : mode === "message" ? <MessageBox c={c} onDone={() => setMode("watch")} />
        : c.live ? <Watch runId={c.live.runId} compact={compact ?? false} />
        : !computer && (a === "idle" || a === "landed") ? <OffDuty name={c.name} place={place} landed={a === "landed"} />
        : <div className="cd-spacer" />}
      {mode !== "edit" ? (
        <div className="actions">
          {!computer && a !== "arriving" ? <Button kind="primary" onClick={() => find(c._id)}>Find {c.name}</Button> : null}
          {!computer ? <Button kind={mode === "message" ? "soft" : "plain"} onClick={() => setMode(mode === "message" ? "watch" : "message")}>Message</Button> : null}
          {!computer ? <Button onClick={() => phone.editLook(c._id)}>Look</Button> : null}
          <Button kind="ghost" onClick={() => setMode("edit")}>Edit</Button>
          {c.live ? <span style={{ marginLeft: "auto" }}><ConfirmButton confirm={`Stop ${c.name}?`} onConfirm={() => void interrupt({ runId: c.live!.runId as Id<"runs"> })}>Stop</ConfirmButton></span> : null}
        </div>
      ) : null}
    </div>
  );
}

// ---- hiring ----

export function HireForm({ onHired, onCancel }: { onHired: (id: string) => void; onCancel: () => void }) {
  const { officeId, office, crew } = useShip();
  const hire = useMutation(api.crew.hire);
  const update = useMutation(api.crew.update);
  const [name, setName] = useState("");
  const [harness, setHarness] = useState<"claude" | "codex" | "sim">(office?.defaultHarness ?? "claude");
  const [specialty, setSpecialty] = useState("");
  const taken = new Set(crew.map((c) => c.name.toLowerCase()));
  const presets = CREW_PRESETS.filter((p) => !taken.has(p.name.toLowerCase()));
  const [preset, setPreset] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const chosen = presets.find((p) => p.id === preset);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const nm = name.trim() || chosen?.name;
      const id = await hire({ officeId, harness, ...(nm ? { name: nm } : {}), ...(specialty.trim() ? { specialty: specialty.trim() } : {}), ...(chosen ? { avatar: chosen.spec } : {}) });
      if (chosen?.look) await update({ crewId: id, look: chosen.look });
      onHired(id);
    } catch (x) { setErr(errorText(x)); setBusy(false); }
  };
  return (
    <form className="hire" onSubmit={(e) => void submit(e)}>
      <div className="hire-head">
        <span className="cd-name">Hire someone</span>
        <span className="dim">They fly in by helicopter and land on the helipad.</span>
      </div>
      <Field label="Look">
        <div className="preset-row">
          <button type="button" className={`preset ${preset === null ? "on" : ""}`} onClick={() => setPreset(null)}>
            <span className="preset-any">?</span><span>Surprise me</span>
          </button>
          {presets.slice(0, 9).map((p) => (
            <button type="button" key={p.id} className={`preset ${preset === p.id ? "on" : ""}`} onClick={() => setPreset(p.id)} title={p.blurb}>
              <Face avatar={p.spec} look={p.look} size={30} /><span>{p.name}</span>
            </button>
          ))}
        </div>
      </Field>
      <div className="row2">
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder={chosen?.name ?? "Any name"} maxLength={20} /></Field>
        <Field label="Runs on">
          <select className="input" value={harness} onChange={(e) => setHarness(e.target.value as typeof harness)}>
            <option value="claude">Claude Code</option>
            <option value="codex">Codex</option>
            <option value="sim">Sim crew (no spending)</option>
          </select>
        </Field>
      </div>
      <Field label="Specialty" hint="Optional. The computer reads it when it hands out work.">
        <Input value={specialty} onChange={(e) => setSpecialty(e.target.value)} placeholder="Frontend, tests, the database…" maxLength={200} />
      </Field>
      {err ? <div className="error">{err}</div> : null}
      <div className="actions">
        <Button kind="primary" type="submit" disabled={busy}>{busy ? "Calling the helicopter…" : "Hire"}</Button>
        <Button kind="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
