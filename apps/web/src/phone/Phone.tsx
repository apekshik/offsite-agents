import { useEffect, useState, type CSSProperties } from "react";
import { COMPUTER_NAME, isWorking } from "@offsite/contracts";
import { ui, useUi } from "../bridge.ts";
import { ActivityLabel, ago, Button, Card, clock, Dot, Face, Key, partOfDay, useNow } from "../ui/index.tsx";
import { activityOf, useShip } from "../overlay/ship.tsx";
import { NewThread, QuestionCard, ThreadList, ThreadView } from "./Conversation.tsx";
import { CrewDetail, CrewList, HireForm } from "./Crew.tsx";
import { ShipDetail, ShipSummary } from "./Ship.tsx";
import { phone, usePhone, type Fold, type PhoneTab } from "./state.ts";
import { forMe, useAboard } from "../people/people.ts";
import { Review, Stats } from "../review/Review.tsx";
import { closeReview, openReview } from "../review/open.ts";
import { HelmIcon, walkToHelm } from "../overlay/walk.tsx";
import { phoneScale, useViewport } from "./fit.ts";
import "./phone.css";
import "./spread.css";

// The foldable phone. F takes it out (the cover screen: who needs you, the latest delivery, the
// crew); a double F unfolds it on a hinge into Computah's interface (threads, the crew, the ship);
// F once more puts it away. Esc puts it away from anywhere. While it's out, H walks you to the
// helm and 1–9 to the crew, and the phone stays in your hands on the way (overlay/walk.tsx).

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
  const { office, crew, questions: all, officeId } = useShip();
  const aboard = useAboard(officeId);
  // Only what's for you (a friend aboard isn't asked for the captain's permissions).
  const questions = all.filter((q) => aboard.loading || forMe(q, aboard.me, aboard.isOwner));
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
          {delivered.lastEnded.state === "landed" && delivered.lastEnded.taskId && delivered.lastEnded.threadId ? (
            <div className="cv-changes">
              <Stats s={delivered.lastEnded.diff} />
              <button className="rv-link" onClick={() => openReview({ threadId: delivered.lastEnded!.threadId!, taskId: delivered.lastEnded!.taskId })}>View changes</button>
            </div>
          ) : null}
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

function LeftPane({ tab, ghost }: { tab: PhoneTab; ghost?: boolean }) {
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
        <span className="pn-title-acts">
          <Button kind="ghost" size="sm" className="pn-helm" onClick={walkToHelm} title="Walk to the helm (H). The phone stays open."><HelmIcon />Walk to the helm</Button>
          {tab === "crew" ? <Button kind="soft" size="sm" onClick={() => phone.set({ hiring: true })}>+ Hire</Button> : null}
        </span>
      </div>
      {tab === "threads" ? (ghost
        // The static copy on the swinging leaf: it looks like the composer, without a second input.
        ? <div className="card composer ghost-composer"><span className="dim">Ask {COMPUTER_NAME} for something…</span></div>
        : <NewThread />) : null}
      <div className="tabs">
        <button className={`tab ${tab === "threads" ? "on" : ""}`} onClick={() => phone.set({ tab: "threads", hiring: false })}>Threads</button>
        <button className={`tab ${tab === "crew" ? "on" : ""}`} onClick={() => phone.set({ tab: "crew" })}>Crew · {crew.length}</button>
        <button className={`tab ${tab === "ship" ? "on" : ""}`} onClick={() => phone.set({ tab: "ship", hiring: false })}>Ship</button>
      </div>
      <div className="pn-list">
        {tab === "threads" ? <ThreadList selected={threadId} onSelect={(id) => ui.set({ threadId: id, review: null })} /> : null}
        {tab === "crew" ? <CrewList selected={crewId} onSelect={(id) => phone.set({ crewId: id, hiring: false })} /> : null}
        {tab === "ship" ? <ShipSummary /> : null}
      </div>
    </div>
  );
}

function RightPane({ tab }: { tab: PhoneTab }) {
  const { crew, computer } = useShip();
  const threadId = useUi((s) => s.threadId);
  const review = useUi((s) => s.review);
  const crewId = usePhone((s) => s.crewId);
  const hiring = usePhone((s) => s.hiring);
  let body;
  if (tab === "threads" && review && review.threadId === threadId) {
    body = <Review key={`${review.threadId}:${review.taskId}`} target={review} onClose={closeReview} />;
  } else if (tab === "threads") {
    body = threadId ? <ThreadView key={threadId} threadId={threadId} /> : (
      <div className="empty-thread">
        <Face computer size={44} />
        <span className="disp">What should the crew do?</span>
        <span className="dim">Ask {COMPUTER_NAME} for something on the left. It reads the repo, splits the work, and hands it to whoever is free.</span>
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
 * One device, hinged like a book. The left leaf has two faces: its inner screen on the front, the
 * cover screen on its back. Folded, the leaf lies flipped over the right half, so you see the cover;
 * unfolding swings it open on the hinge while the phone slides to centre. It is one continuous
 * movement, never one phone swapped for another.
 *
 * Open, the two inner screens are one: the spread lies across both leaves and the hinge (a faint
 * crease over it), the list in its left third and the conversation in the rest. While the leaf
 * swings, its face shows a still, dimmed copy of the list; the spread fades in once it has landed
 * and out as it starts to close.
 */
function Book() {
  const tab = usePhone((s) => s.tab);
  const fold = usePhone((s) => s.fold);
  const open = fold === "open";
  return (
    <div className="book">
      <div className="flip">
        <div className="leaf leaf-left leaf-face">
          <div className="still" inert aria-hidden="true"><LeftPane tab={tab} ghost /></div>
        </div>
        <div className="leaf leaf-cover leaf-face back"><Cover /></div>
      </div>
      <div className="hinge" />
      <div className="leaf leaf-right" />
      <div className="spread" inert={!open} aria-hidden={!open}>
        <div className="sp-list"><LeftPane tab={tab} /></div>
        <div className="sp-main"><RightPane tab={tab} /></div>
        <div className="crease" aria-hidden="true" />
      </div>
    </div>
  );
}

export function Phone() {
  const fold = usePhone((s) => s.fold);
  const creator = usePhone((s) => s.creator);
  const { threads } = useShip();
  const vp = useViewport();
  const fit = phoneScale(vp.w, vp.h);
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
      <div className={`phone-wrap ${shown} ${leaving ? "leaving" : ""}`} style={{ "--s": shown === "open" ? fit.open : fit.cover } as CSSProperties}>
        <Book />
        <div className="device-hint">
          {shown === "open"
            ? <><Key>F</Key> half view <Key>Esc</Key> put away <span className="dh-walk" title="Walk there; the phone stays open"><Key>H</Key> helm · <Key>1–9</Key> crew</span></>
            : <><Key>F</Key> twice to unfold <Key>F</Key> put away</>}
        </div>
      </div>
    </>
  );
}
