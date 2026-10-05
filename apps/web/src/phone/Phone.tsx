import { useEffect, useRef, useState, type CSSProperties } from "react";
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
      <div className="cv-foot"><Key>F</Key><Key>F</Key> unfold <Key>F</Key> put away</div>
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

function OpenPhone() {
  const tab = usePhone((s) => s.tab);
  return (
    <>
      <div className="leaf leaf-left"><LeftPane tab={tab} /></div>
      <div className="hinge" />
      <div className="leaf leaf-right"><RightPane tab={tab} /></div>
    </>
  );
}

// ---- the device, with its transitions ----

const COVER = { w: 320, h: 760 };
const OPEN = { w: 1000, h: 740 };

export function Phone() {
  const fold = usePhone((s) => s.fold);
  const creator = usePhone((s) => s.creator);
  const { threads } = useShip();
  const [view, setView] = useState<Fold>(fold);
  const [leaving, setLeaving] = useState<{ from: Fold; to: Fold } | null>(null);
  const [from, setFrom] = useState<Fold>("away");
  const coverScale = useFit(COVER.w, COVER.h, 24);
  const openScale = useFit(OPEN.w, OPEN.h + 30, 28);

  const timer = useRef(0);
  useEffect(() => {
    if (fold === view) return;
    setLeaving({ from: view, to: fold });
    setFrom(view);
    setView(fold);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setLeaving(null), 420);
  }, [fold, view]);
  useEffect(() => () => clearTimeout(timer.current), []);

  // Unfolding with nothing chosen: open the thread that needs you, else the newest.
  useEffect(() => {
    if (fold !== "open" || ui.get().threadId || !threads?.length) return;
    const pick = threads.find((t) => t.openQuestions > 0) ?? threads[0]!;
    ui.set({ threadId: pick._id });
  }, [fold, threads]);

  const cover = (cls: string) => (
    <div className={`phone-cover-wrap ${cls}`} style={{ "--s": coverScale } as CSSProperties}>
      <div className="device cover"><Cover /></div>
    </div>
  );
  const open = (cls: string) => (
    <div className={`phone-open-wrap ${cls}`} style={{ "--s": openScale } as CSSProperties}>
      <div className="device open"><OpenPhone /></div>
      <div className="device-hint"><Key>F</Key> half view <Key>Esc</Key> put away</div>
    </div>
  );

  return (
    <>
      {view === "open" ? <div className={`phone-backdrop ${creator ? "deep" : ""}`} onClick={() => phone.putAway()} /> : null}
      {leaving?.from === "cover" ? cover(leaving.to === "open" ? "leave-to-open" : "leave-down") : null}
      {leaving?.from === "open" ? open(leaving.to === "cover" ? "folding" : "leave-down") : null}
      {view === "cover" ? cover(from === "open" ? "enter-from-open" : "enter-up") : null}
      {view === "open" ? open(from === "cover" ? "unfolding" : "unfolding enter-up") : null}
    </>
  );
}
