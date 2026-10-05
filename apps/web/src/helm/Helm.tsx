import { useEffect, useState, type CSSProperties } from "react";
import { ui, useUi } from "../bridge.ts";
import { COMPUTER_NAME } from "@offsite/contracts";
import { ActivityLabel, Button, Card, clock, Dot, Face, Key, OrchestratorBadge, useNow } from "../ui/index.tsx";
import { activityOf, ComputerLabel, useShip } from "../overlay/ship.tsx";
import { NewThread, QuestionCard, ThreadList, ThreadView } from "../phone/Conversation.tsx";
import { CrewDetail } from "../phone/Crew.tsx";
import { fillScale, shrinkToFit, useViewport } from "../phone/fit.ts";
import { planName } from "../screens/setup.tsx";
import { Review } from "../review/Review.tsx";
import { closeReview } from "../review/open.ts";
import "./helm.css";

// The helm console on the bridge: Computah's interface, the same as the phone's, big. Threads on the
// left, the conversation in the middle, the ship on the right (what waits on you, who's aboard,
// pull requests). The game opens it (walk up to the helm, E); Esc steps away.

interface ProbeRow { harness: string; installed: boolean; auth: string; plan: string | null; profile: string | null }
const NAME: Record<string, string> = { claude: "Claude Code", codex: "Codex" };

function Accounts() {
  const { machine } = useShip();
  const rows = (Array.isArray(machine?.probe) ? (machine!.probe as ProbeRow[]) : []).filter((p) => !p.profile && p.installed && p.auth === "authenticated" && p.harness !== "sim");
  return <>{rows.map((p) => <span key={p.harness} className="hm-acct">{planName(p.harness, p.plan) ?? NAME[p.harness] ?? p.harness} · <span className="ink">signed in</span></span>)}</>;
}

function Aboard({ onPick, picked }: { onPick: (id: string) => void; picked: string | null }) {
  const { crew, computer } = useShip();
  const now = useNow(2000);
  return (
    <div className="hm-aboard">
      {computer ? (
        <button className={`hm-person ${picked === computer._id ? "on" : ""}`} onClick={() => onPick(computer._id)}>
          <Face computer size={26} />
          <span className="clip">{computer.name} <OrchestratorBadge /></span>
          <ComputerLabel c={computer} />
        </button>
      ) : null}
      {crew.map((c) => (
        <button key={c._id} className={`hm-person ${picked === c._id ? "on" : ""}`} onClick={() => onPick(c._id)}>
          <Face avatar={c.avatar} look={c.look} size={26} />
          <span className="clip">{c.name}</span>
          <ActivityLabel activity={activityOf(c, now)} />
        </button>
      ))}
    </div>
  );
}

export function Helm() {
  const open = useUi((s) => s.helm);
  const threadId = useUi((s) => s.threadId);
  const review = useUi((s) => s.review);
  const { office, machine, questions, threads } = useShip();
  const now = useNow(5000);
  // As big as the open phone gets on a big screen (FILL of the window), and fit with a margin on a small one.
  const vp = useViewport();
  const scale = Math.max(shrinkToFit(1600, 900, vp.w, vp.h, 24), fillScale(1600, 900, vp.w, vp.h));
  const [person, setPerson] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);

  useEffect(() => {
    if (!open) { setPerson(null); setComposing(false); return; }
    if (!ui.get().threadId && threads?.length) ui.set({ threadId: (threads.find((t) => t.openQuestions > 0) ?? threads[0]!)._id });
  }, [open, threads]);

  if (!open) return null;
  // Each pull request, with its repo when the ship has several. Threads from before repos have only prUrl.
  const many = (office?.repos.length ?? 0) > 1;
  const prs = (threads ?? []).flatMap((t) => (t.prs.some((p) => p.url) ? t.prs.filter((p) => p.url) : t.prUrl ? [{ repo: null, url: t.prUrl, branch: t.branch ?? "" }] : [])
    .map((p) => ({ key: `${t._id}:${p.repo ?? ""}`, title: t.title, url: p.url!, repo: p.repo })));
  const center = person ? (
    <div className="hm-center-crew">
      <Button kind="ghost" size="sm" onClick={() => setPerson(null)}>← Back to the thread</Button>
      <CrewDetail key={person} crewId={person} />
    </div>
  ) : composing || !threadId ? (
    <div className="hm-new">
      <Face computer size={44} />
      <span className="disp">What should the crew do?</span>
      <span className="dim">Say it the way you'd tell a colleague. {COMPUTER_NAME} reads the repo, plans the work and hands it out.</span>
      <NewThread big autoFocus onStarted={() => setComposing(false)} placeholder="Add a settings page with a dark mode toggle…" />
      {threadId ? <Button kind="ghost" size="sm" onClick={() => setComposing(false)}>Cancel</Button> : null}
    </div>
  ) : <ThreadView key={threadId} threadId={threadId} big />;

  return (
    <div className="helm-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) ui.set({ helm: false }); }}>
      <div className="helm" style={{ "--s": scale } as CSSProperties}>
        <div className="hm-top">
          <span className="disp hm-ship">{office?.name ?? "Your ship"}</span>
          <span className="lab t-accent">Bridge</span>
          <span style={{ flex: 1 }} />
          <span className="hm-acct"><Dot tone={machine?.online ? "on" : machine ? "off" : "amber"} />{machine ? `${machine.name} · ${machine.online ? "online" : "offline"}` : "No machine connected"}</span>
          <Accounts />
          <span className="disp hm-clock">{clock(now)}</span>
          <button className="hm-close" onClick={() => ui.set({ helm: false })} aria-label="Step away from the helm"><Key>Esc</Key> Step away</button>
        </div>
        <div className={`hm-cols ${review ? "reviewing" : ""}`}>
          <div className="hm-threads">
            <div className="hm-col-head"><span className="lab dim">Threads</span><Button kind="soft" size="sm" onClick={() => { setPerson(null); setComposing(true); }}>+ New</Button></div>
            <div className="hm-scroll"><ThreadList selected={composing || person ? null : threadId} onSelect={(id) => { setPerson(null); setComposing(false); ui.set({ threadId: id, ...(ui.get().review?.threadId === id ? {} : { review: null }) }); }} progress /></div>
          </div>
          <Card className="hm-center">{center}</Card>
          {review ? (
            <Card className="hm-changes"><Review key={`${review.threadId}:${review.taskId}`} target={review} onClose={closeReview} big /></Card>
          ) : (
          <div className="hm-ship-col">
            <div className="hm-scroll">
              {questions.length ? <span className="lab t-amber">Waiting on you</span> : null}
              {questions.map((q) => <QuestionCard key={q._id} q={q} wide />)}
              <span className="lab dim hm-sec">Aboard</span>
              <Aboard picked={person} onPick={(id) => setPerson(id === person ? null : id)} />
              <span className="lab dim hm-sec">Pull requests</span>
              {prs.length ? prs.map((p) => {
                const n = /\/pull\/(\d+)/.exec(p.url)?.[1];
                return (
                  <a key={p.key} className="card quiet hm-pr" href={p.url} target="_blank" rel="noreferrer">
                    <Dot tone="on" />
                    <span className="clip">{n ? `#${n} ` : ""}{p.title}</span>
                    {many && p.repo ? <span className="chip repo-chip">{p.repo}</span> : null}
                    <span className="lab t-green">Open</span>
                  </a>
                );
              }) : <span className="dim hm-none">None yet. Finished threads open one in each repo they change.</span>}
            </div>
          </div>
          )}
        </div>
      </div>
    </div>
  );
}
