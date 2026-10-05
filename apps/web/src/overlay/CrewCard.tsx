import { useEffect, useRef } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { scene, ui, useUi } from "../bridge.ts";
import { activityTone, Button, Chip, CloseIcon, ConfirmButton, Face, Key, useNow } from "../ui/index.tsx";
import { crewLine } from "../phone/Crew.tsx";
import { phone, usePhone } from "../phone/state.ts";
import { activityOf, harnessName, useShip } from "./ship.tsx";
import { openReview } from "../review/open.ts";

// A crew member the captain clicked in the world: a small card beside them, following them around
// (and docked to the side when they walk out of view).

export function CrewCard() {
  const id = useUi((s) => s.crewCard);
  const locked = useUi((s) => s.pointerLocked);
  const helm = useUi((s) => s.helm);
  const fold = usePhone((s) => s.fold);
  const { byId, questions } = useShip();
  const interrupt = useMutation(api.runs.interrupt);
  const now = useNow(1000);
  const el = useRef<HTMLDivElement>(null);
  const c = id ? byId.get(id) : undefined;

  useEffect(() => {
    if (!id) return;
    let raf = 0;
    let far = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const box = el.current;
      if (!box) return;
      const at = scene.locate(id);
      const w = box.offsetWidth, h = box.offsetHeight;
      let x = innerWidth - w - 20, y = 120;
      if (at && at.onScreen) {
        x = Math.min(innerWidth - w - 16, Math.max(16, at.x + 36));
        y = Math.min(innerHeight - h - 70, Math.max(70, at.y - 30));
      }
      box.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
      // Walked well away from them: the card goes.
      far = at && at.distance > 30 ? far + 1 : 0;
      if (far > 90) ui.set({ crewCard: null });
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [id]);

  if (!id || !c || helm || fold === "open") return null;
  const a = activityOf(c, now);
  const tone = activityTone(a);
  const line = crewLine(c, now);
  const q = questions.find((x) => x.crewId === c._id);
  return (
    <div className={`crew-card ${tone === "amber" ? "amber" : tone === "accent" ? "accent" : ""}`} ref={el}>
      <div className="cc-head">
        <Face avatar={c.avatar} look={c.look} computer={c.role === "computer"} size={34} />
        <div className="cc-who">
          <span className="cc-name">{c.name} <Chip>{harnessName(c.harness)}</Chip></span>
          <span className={`cc-line clip t-${tone}`}>{line.text}</span>
          {line.sub ? <span className={`cc-sub clip ${line.mono ? "mono" : ""}`}>{line.sub}</span> : null}
        </div>
        <button className="t-x" onClick={() => ui.set({ crewCard: null })} aria-label="Close"><CloseIcon /></button>
      </div>
      {q ? <div className="mono t-amber" style={{ fontSize: 12.5 }}>{q.prompt}</div> : null}
      {c.specialty ? <span className="cc-sub">{c.specialty}</span> : null}
      {locked ? (
        <span className="cc-hint"><Key>Esc</Key> frees the mouse to use this card</span>
      ) : (
        <div className="actions">
          {q ? <Button kind="amber" size="sm" onClick={() => (q.threadId ? phone.openThread(q.threadId) : phone.openCrew(c._id))}>Answer</Button> : null}
          <Button kind={q ? "plain" : "soft"} size="sm" onClick={() => phone.openCrew(c._id)}>{c.live ? "Watch" : "More"}</Button>
          {!c.live && c.lastEnded?.state === "landed" && c.lastEnded.taskId && c.lastEnded.threadId
            ? <Button size="sm" onClick={() => openReview({ threadId: c.lastEnded!.threadId!, taskId: c.lastEnded!.taskId })}>Changes{c.lastEnded.diff ? ` · +${c.lastEnded.diff.added} −${c.lastEnded.diff.removed}` : ""}</Button> : null}
          {c.role === "crew" ? <Button size="sm" onClick={() => phone.editLook(c._id)}>Look</Button> : null}
          {c.live ? <span style={{ marginLeft: "auto" }}><ConfirmButton size="sm" confirm="Stop?" onConfirm={() => void interrupt({ runId: c.live!.runId as Id<"runs"> })}>Stop</ConfirmButton></span> : null}
        </div>
      )}
    </div>
  );
}
