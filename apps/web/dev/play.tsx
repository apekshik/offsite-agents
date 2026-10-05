import { createRoot } from "react-dom/client";
import { ConvexProviderWithAuth, useConvexAuth, useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { convex } from "../src/convex.ts";
import { useOffsiteAuth } from "../src/auth.ts";
import { Game } from "../src/game/Game.tsx";

// The whole game against the dev deployment, with a bare debug panel instead of the real interface
// (that is src/overlay, built separately). /dev/play.html?dev=alice signs in as alice.

function Panel({ officeId }: { officeId: Id<"offices"> }) {
  const snap = useQuery(api.world.snapshot, { officeId });
  const threads = useQuery(api.threads.list, { officeId });
  const create = useMutation(api.threads.create);
  const answer = useMutation(api.questions.answer);
  const [text, setText] = useState("");
  if (!snap) return null;
  return (
    <div style={{ position: "fixed", right: 12, top: 12, width: 320, maxHeight: "90vh", overflow: "auto", background: "rgba(4,7,11,.78)", padding: 12, fontSize: 12 }}>
      <b>{snap.office.name}</b> {snap.office.hasRepo ? "" : "· no project set"}
      <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) void create({ officeId, text }); setText(""); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask the computer…" style={{ width: "100%", marginTop: 8 }} />
      </form>
      {snap.questions.map((q) => (
        <div key={q._id} style={{ marginTop: 8, color: "#ffc861" }}>
          {q.crewName}: {q.prompt}{" "}
          {(q.options ?? ["yes", "no"]).map((o) => <button key={o} onClick={() => void answer({ questionId: q._id, answer: o })}>{o}</button>)}
        </div>
      ))}
      <div style={{ marginTop: 8 }}>
        {snap.crew.map((c) => (
          <div key={c._id}>{c.name} · {c.live ? `${c.live.state} ${c.live.taskTitle ?? c.live.threadTitle ?? ""} ${c.live.step?.summary ?? ""}` : "free"}</div>
        ))}
      </div>
      <div style={{ marginTop: 8, opacity: 0.7 }}>
        {threads?.map((t) => <div key={t._id}>{t.state} · {t.title} · {t.tasks.landed}/{t.tasks.total}</div>)}
      </div>
    </div>
  );
}

function Aboard() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const ensure = useMutation(api.users.ensure);
  const me = useQuery(api.users.me, isAuthenticated ? {} : "skip");
  const offices = useQuery(api.offices.mine, me ? {} : "skip");
  const createOffice = useMutation(api.offices.create);
  useEffect(() => { if (isAuthenticated && me === null) void ensure(); }, [isAuthenticated, me, ensure]);
  useEffect(() => { if (offices && offices.length === 0) void createOffice({ name: "Sea Legs", world: "yacht" }); }, [offices, createOffice]);
  if (isLoading) return null;
  if (!isAuthenticated) return <p style={{ padding: 24 }}>Open with ?dev=yourname</p>;
  const office = offices?.[0];
  if (!office) return null;
  return (<><Game officeId={office._id} /><Panel officeId={office._id} /></>);
}

createRoot(document.getElementById("root")!).render(
  <ConvexProviderWithAuth client={convex} useAuth={useOffsiteAuth}><Aboard /></ConvexProviderWithAuth>,
);
