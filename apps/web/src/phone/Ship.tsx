import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { signOut } from "../auth.ts";
import { Button, Card, errorText, Face, Field, Input } from "../ui/index.tsx";
import { useShip } from "../overlay/ship.tsx";
import { CodeEntry, HarnessField, LoginSteps, MachineCard, Repos } from "../screens/setup.tsx";
import { phone } from "./state.ts";
import { HelmIcon, walkToHelm } from "../overlay/walk.tsx";

import { Friends, ShipSwitcher } from "./Friends.tsx";
import { useAboard } from "../people/people.ts";
import { personLook } from "../people/look.ts";

// The Ship tab: your ship's name, your own look, your machines and the repos the crew works on, and who is aboard
// (Friends.tsx). A friend aboard someone else's ship sees it read-only, and how to leave.

export function ShipSummary() {
  const { office, officeId, me, machines, crew } = useShip();
  const aboard = useAboard(officeId);
  const owner = aboard.isOwner;
  const mine = me ? personLook({ userId: me._id, avatar: me.avatar, look: me.look, owner }) : null;
  const update = useMutation(api.offices.update);
  const setName = useMutation(api.users.setName);
  const [ship, setShip] = useState<string | null>(null);
  const [captain, setCaptain] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const save = (fn: () => Promise<unknown>) => void fn().catch((x) => setErr(errorText(x)));
  return (
    <div className="ship-summary">
      {owner ? (
        <Field label="Ship">
          <Input value={ship ?? office?.name ?? ""} onChange={(e) => setShip(e.target.value)} maxLength={40}
            onBlur={() => { if (ship !== null && ship.trim() && ship !== office?.name) save(() => update({ officeId, name: ship })); setShip(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
        </Field>
      ) : (
        <Field label="Ship"><div className="ship-name-ro"><b>{office?.name ?? ""}</b> <span className="dim">· {office?.owner.name}'s</span></div></Field>
      )}
      <Card quiet className="captain-card">
        <Face avatar={mine?.avatar ?? { skin: "#e8b894", hairColor: "#3a2a1e" }} look={mine?.look} size={44} />
        <div className="cd-who">
          <input className="bare-input cd-name" value={captain ?? me?.name ?? ""} aria-label="Your name" maxLength={20}
            onChange={(e) => setCaptain(e.target.value)}
            onBlur={() => { if (captain !== null && captain.trim() && captain !== me?.name) save(() => setName({ name: captain })); setCaptain(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
          <span className="dim">{owner ? `Captain · ${crew.length} crew aboard` : `Aboard ${office?.owner.name ?? "a friend"}'s ship`}</span>
        </div>
        <Button size="sm" onClick={() => phone.editLook("captain")}>Your look</Button>
      </Card>
      <Button kind="soft" size="sm" className="walk-helm" onClick={walkToHelm} title="The phone stays open while you walk (H)"><HelmIcon />Walk to the helm</Button>
      <div className="ship-facts">
        <div><span className="dim">The world</span><span>The Yacht</span></div>
        <div><span className="dim">Machines</span><span>{!owner ? `${office?.machine?.name ?? "None yet"} (${office?.owner.name}'s)` : machines?.length ? machines.map((m) => m.name).join(", ") : "None yet"}</span></div>
        <div><span className="dim">{office?.repos.length === 1 ? "Repo" : "Repos"}</span><span className="mono clip">{office?.repos.length ? office.repos.map((r) => r.name).join(", ") : "None yet"}</span></div>
        {owner && office?.repos.length === 1 ? <div><span className="dim">Folder</span><span className="mono clip">{office.repos[0]!.path}</span></div> : null}
      </div>
      <ShipSwitcher officeId={officeId} />
      {err ? <div className="error">{err}</div> : null}
      <div style={{ marginTop: "auto" }}><Button kind="ghost" size="sm" onClick={() => void signOut()}>Sign out</Button></div>
    </div>
  );
}

export function ShipDetail() {
  const { machines, officeId, office } = useShip();
  const revoke = useMutation(api.machines.revoke);
  const [adding, setAdding] = useState(false);
  const aboard = useAboard(officeId);
  const none = machines !== undefined && machines.length === 0;
  if (!aboard.loading && !aboard.isOwner) {
    // A friend's view: who's aboard and how to leave; the captain's machine and repos, to read.
    const online = office?.machine ? Date.now() - office.machine.lastSeenAt < 90_000 : false;
    return (
      <div className="ship-detail">
        <Friends officeId={officeId} shipName={office?.name ?? "this ship"} />
        <section>
          <div className="sec-head"><span className="disp sec-title">The crew's machine</span></div>
          <p className="dim sec-note">{office?.owner.name}'s crew work on {office?.owner.name}'s own computer, with {office?.owner.name}'s Claude Code and Codex.</p>
          <div className="ship-facts">
            <div><span className="dim">Machine</span><span>{office?.machine ? `${office.machine.name} · ${online ? "online" : "offline"}` : "None yet"}</span></div>
            <div><span className="dim">{office?.repos.length === 1 ? "Repo" : "Repos"}</span><span className="mono clip">{office?.repos.map((r) => r.name).join(", ") || "None yet"}</span></div>
          </div>
        </section>
      </div>
    );
  }
  return (
    <div className="ship-detail">
      <Friends officeId={officeId} shipName={office?.name ?? "this ship"} />
      <section>
        <div className="sec-head"><span className="disp sec-title">Machines</span>{!none && !adding ? <Button kind="soft" size="sm" onClick={() => setAdding(true)}>+ Connect another</Button> : null}</div>
        {none ? <p className="dim">No machine yet: the crew lounges until one is connected.</p> : null}
        {machines?.map((m) => <MachineCard key={m._id} m={m} chosen={!!office?.repos.some((r) => r.machineId === m._id)} onRevoke={() => void revoke({ machineId: m._id })} />)}
        {none || adding ? <><LoginSteps /><CodeEntry onApproved={() => setAdding(false)} /></> : null}
      </section>
      <section>
        <div className="sec-head"><span className="disp sec-title">Repos</span></div>
        <p className="dim sec-note">Each task is in one repo; a thread's work lands on one branch name in each it touches.</p>
        <Repos officeId={officeId} />
      </section>
      <section>
        <HarnessField officeId={officeId} />
      </section>
    </div>
  );
}
