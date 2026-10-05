import { useEffect, useState, type CSSProperties } from "react";
import { isWorking } from "@offsite/contracts";
import { ui, useUi } from "../bridge.ts";
import { ActivityLabel, ago, Button, Card, clock, Dot, Face, Key, partOfDay, useNow } from "../ui/index.tsx";
import { activityOf, useShip } from "../overlay/ship.tsx";
import { NewThread, QuestionCard, ThreadList, ThreadView } from "./Conversation.tsx";
import { CrewDetail, CrewList, HireForm } from "./Crew.tsx";
import { ShipDetail, ShipSummary } from "./Ship.tsx";
import { phone, usePhone, type Fold, type PhoneTab } from "./state.ts";
import "./phone.css";

// The foldable phone. F takes it out (the cover screen: who needs you, the latest delivery, the
// crew); a double F unfolds it on a hinge into the computer's interface (threads, the crew, the ship);
// F once more puts it away. Esc puts it away from anywhere.

/** How much to shrink a w×h design so it fits the window with a margin. */
export function useFit(w: number, h: number, margin = 40): number {
  const calc = () => Math.min(1, (innerWidth - margin * 2) / w, (innerHeight - margin * 2) / h);
  const [s, setS] = useState(calc);
  useEffect(() => {
    const on = () => setS(calc());
    addEventListener("resize", on);
    return () => removeEventListener("resize", on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w, h, margin]);
  return s;
}

function MachineStatus({ withTime }: { withTime?: boolean }) {
  const { machine } = useShip();
  const now = useNow(10_000);
  return (
    <span className="status-line">
      <Dot tone={machine?.online ? "on" : machine ? "off" : "amber"} />
      {machine ? `${machine.name}${machine.online ? "" : " · offline"}` : "No machine"}
      {withTime ? ` · ${clock(now)}` : null}
    </span>
  );
}

// ---- closed: the cover screen ----

function Cover() {
  const { office, crew, questions } = useShip();
  const now = useNow(1000);
  const working = crew.filter((c) => isWorking(activityOf(c, now))).length;
  const off = crew.filter((c) => activityOf(c, now) === "idle").length;
  const q = questions[0];
  const delivered = [...crew].filter((c) => c.lastEnded && (c.lastEnded.state === "landed" || c.lastEnded.state === "failed") && c.lastEnded.taskTitle)
    .sort((a, b) => b.lastEnded!.endedAt - a.lastEnded!.endedAt)[0];
  const sorted = [...crew].sort((a, b) => Number(b.asking) - Number(a.asking) || Number(!!b.live) - Number(!!a.live));
  return (
    <div className="cover-screen" onClick={(e) => { if (!(e.target as HTMLElement).closest("button,a,input,form")) phone.unfold(); }}>
      <div className="cv-top">
        <span className="lab t-accent">{office?.name ?? "Your ship"}</span>
        <MachineStatus />
      </div>
      <div className="cv-clock">
        <span className="disp">{clock(now)}</span>
        <span className="dim">{partOfDay(now)} · {working} at work · {off} off duty</span>
      </div>
      {q ? <QuestionCard q={q} wide findLink={false} /> : null}
      {questions.length > 1 ? <button className="cv-more lab t-amber" onClick={() => phone.openCrew(questions[1]!.crewId)}>+{questions.length - 1} more waiting on you</button> : null}
      {delivered?.lastEnded ? (
        <Card quiet className="cv-delivery">
          <div className="q-head">
            <Face avatar={delivered.avatar} look={delivered.look} />
            <span className={`lab ${delivered.lastEnded.state === "landed" ? "t-green" : "t-red"}`}>{delivered.name} {delivered.lastEnded.state === "landed" ? "landed" : "got stuck"}</span>
            <span className="q-age">{ago(now - delivered.lastEnded.endedAt)}</span>
          </div>
          <span className="cv-task">{delivered.lastEnded.taskTitle}</span>
        </Card>
      ) : null}
      <div className="cv-crew">
        <span className="lab dim">Crew</span>
        {sorted.slice(0, q ? 5 : 8).map((c) => (
          <div key={c._id} className="cv-row">
            <Face avatar={c.avatar} look={c.look} />
            <span className="clip">{c.name}</span>
            <ActivityLabel activity={activityOf(c, now)} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- open ----

function LeftPane({ tab }: { tab: PhoneTab }) {
  const { office, crew } = useShip();
  const threadId = useUi((s) => s.threadId);
  const crewId = usePhone((s) => s.crewId);
  const title = tab === "threads" ? "Threads" : tab === "crew" ? "Crew" : "Ship";
  return (
    <div className="pane left">
      <div className="pn-top">
        <span className="lab t-accent">{office?.name ?? "Your ship"}</span>
        <MachineStatus withTime />
      </div>
      <div className="pn-title">
        <span className="disp">{title}</span>
        {tab === "crew" ? <Button kind="soft" size="sm" onClick={() => phone.set({ hiring: true })}>+ Hire</Button> : null}
      </div>
      {tab === "threads" ? <NewThread /> : null}
      <div className="tabs">
        <button className={`tab ${tab === "threads" ? "on" : ""}`} onClick={() => phone.set({ tab: "threads", hiring: false })}>Threads</button>
        <button className={`tab ${tab === "crew" ? "on" : ""}`} onClick={() => phone.set({ tab: "crew" })}>Crew · {crew.length}</button>
        <button className={`tab ${tab === "ship" ? "on" : ""}`} onClick={() => phone.set({ tab: "ship", hiring: false })}>Ship</button>
      </div>
      <div className="pn-list">
        {tab === "threads" ? <ThreadList selected={threadId} onSelect={(id) => ui.set({ threadId: id })} /> : null}
        {tab === "crew" ? <CrewList selected={crewId} onSelect={(id) => phone.set({ crewId: id, hiring: false })} /> : null}
        {tab === "ship" ? <ShipSummary /> : null}
      </div>
    </div>
  );
}

function RightPane({ tab }: { tab: PhoneTab }) {
  const { crew, computer } = useShip();
  const threadId = useUi((s) => s.threadId);
  const crewId = usePhone((s) => s.crewId);
  const hiring = usePhone((s) => s.hiring);
  let body;
  if (tab === "threads") {
    body = threadId ? <ThreadView key={threadId} threadId={threadId} /> : (
      <div className="empty-thread">
        <Face computer size={44} />
        <span className="disp">What should the crew do?</span>
        <span className="dim">Ask the computer for something on the left. It reads the repo, splits the work, and hands it to whoever is free.</span>
      </div>
    );
  } else if (tab === "crew") {
    const id = crewId ?? crew[0]?._id ?? computer?._id ?? null;
    body = hiring ? <HireForm onHired={(nid) => phone.set({ hiring: false, crewId: nid })} onCancel={() => phone.set({ hiring: false })} />
      : id ? <CrewDetail key={id} crewId={id} /> : <div className="empty dim">Nobody aboard yet.</div>;
  } else body = <ShipDetail />;
  return <div className="pane right">{body}</div>;
}

/**
 * One device, hinged like a book. The left leaf has two faces: the threads (or crew, or ship) pane on
 * its front, the cover screen on its back. Folded, the leaf lies flipped over the right half, so you
 * see the cover; unfolding swings it open on the hinge while the phone slides to centre. It is one
 * continuous movement, never one phone swapped for another.
 */
function Book() {
  const tab = usePhone((s) => s.tab);
  return (
    <div className="book">
      <div className="flip">
        <div className="leaf leaf-left leaf-face"><LeftPane tab={tab} /></div>
        <div className="leaf leaf-cover leaf-face back"><Cover /></div>
      </div>
      <div className="hinge" />
      <div className="leaf leaf-right"><RightPane tab={tab} /></div>
    </div>
  );
}

const OPEN = { w: 1036, h: 740 };

export function Phone() {
  const fold = usePhone((s) => s.fold);
  const creator = usePhone((s) => s.creator);
  const { threads } = useShip();
  const scale = useFit(OPEN.w, OPEN.h + 30, 28);
  // Stay mounted for a moment after going away, so it can slide down out of view.
  const [shown, setShown] = useState<Exclude<Fold, "away"> | null>(fold === "away" ? null : fold);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (fold !== "away") { setShown(fold); setLeaving(false); return; }
    if (!shown) return;
    setLeaving(true);
    const t = window.setTimeout(() => { setShown(null); setLeaving(false); }, 260);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fold]);

  // Unfolding with nothing chosen: open the thread that needs you, else the newest.
  useEffect(() => {
    if (fold !== "open" || ui.get().threadId || !threads?.length) return;
    const pick = threads.find((t) => t.openQuestions > 0) ?? threads[0]!;
    ui.set({ threadId: pick._id });
  }, [fold, threads]);

  if (!shown) return null;
  return (
    <>
      {shown === "open" && !leaving ? <div className={`phone-backdrop ${creator ? "deep" : ""}`} onClick={() => phone.putAway()} /> : null}
      <div className={`phone-wrap ${shown} ${leaving ? "leaving" : ""}`} style={{ "--s": scale } as CSSProperties}>
        <Book />
        <div className="device-hint">
          {shown === "open"
            ? <><Key>F</Key> half view <Key>Esc</Key> put away</>
            : <><Key>F</Key> twice to unfold <Key>F</Key> put away</>}
        </div>
      </div>
    </>
  );
}
