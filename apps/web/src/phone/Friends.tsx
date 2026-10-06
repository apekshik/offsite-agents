import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { COMPUTER_NAME, joinPath } from "@offsite/contracts";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Button, Card, ConfirmButton, Dot, errorText, Face } from "../ui/index.tsx";
import { useAboard, type Person } from "../people/people.ts";
import { useLinks } from "../net/index.ts";
import { useVoice, voice } from "../voice/index.ts";
import { newOffsite } from "../screens/newOffsite.ts";
import { phone } from "./state.ts";
import { worldOf } from "../worlds.ts";
import "./friends.css";

// Friends aboard, in the Ship tab: the captain's invite link and who they've brought aboard (remove, and whether they
// may talk to Computah); a friend's view of whose ship this is and how to leave; and the switcher between your own
// ships and ones you joined.

const DAY = 24 * 60 * 60_000;

/** "Maya · on deck, at the helm" and the like. */
export function personLine(p: Person): string {
  if (!p.onDeck) return p.owner ? "Captain · not on deck" : "Not on deck";
  const doing = p.act === "helm" ? "at the helm" : p.act === "phone" || p.act === "phone-open" ? "on the phone"
    : p.act === "hammock" ? "in a hammock" : p.act === "lounger" ? "on a lounger" : "on deck";
  return p.owner ? `Captain · ${doing}` : doing.charAt(0).toUpperCase() + doing.slice(1);
}

/** A row for someone aboard: their face (ringed while they talk), name, what they're doing, how they're linked. */
export function PersonRow({ p, children }: { p: Person; children?: React.ReactNode }) {
  const links = useLinks();
  const { speaking } = useVoice();
  const talking = speaking.includes(p.userId);
  const link = links[p.userId];
  return (
    <div className={`person-row ${talking ? "talking" : ""}`}>
      <span className="pr-face"><Face avatar={p.avatar} look={p.look} size={30} ring={talking ? "#6dffa8" : undefined} /></span>
      <div className="pr-main">
        <span className="pr-name">{p.name}{p.me ? <span className="dim"> (you)</span> : null}</span>
        <span className="pr-line dim clip">
          {p.onDeck && !p.me ? <Dot tone={link === "direct" ? "on" : link === "relayed" ? "amber" : "off"} /> : null}
          {personLine(p)}
          {p.onDeck && !p.me && link === "relayed" ? " · no direct link: no voice, movement a little behind" : null}
        </span>
      </div>
      {children}
    </div>
  );
}

/** Mute someone's voice, for you only. */
export function MuteButton({ userId, name }: { userId: string; name: string }) {
  const { mutedPeople } = useVoice();
  const muted = mutedPeople.includes(userId);
  return (
    <Button size="sm" kind={muted ? "soft-amber" : "ghost"} title={muted ? `Hear ${name} again` : `Mute ${name} (only for you)`} aria-pressed={muted}
      onClick={(e) => { e.stopPropagation(); voice.mutePerson(userId, !muted); }}>{muted ? "Muted" : "Mute"}</Button>
  );
}

function InviteLink({ officeId }: { officeId: Id<"offices"> }) {
  const current = useQuery(api.invites.current, { officeId });
  const create = useMutation(api.invites.create);
  const revoke = useMutation(api.invites.revoke);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const link = current ? `${location.origin}${joinPath(current.token)}` : null;
  const run = (fn: () => Promise<unknown>) => { setBusy(true); setErr(null); void fn().catch((x) => setErr(errorText(x))).finally(() => setBusy(false)); };
  const copy = () => {
    if (!link) return;
    void navigator.clipboard?.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }, () => setErr("Couldn't copy: select the link and copy it."));
  };
  return (
    <Card quiet className="invite">
      <span className="lab t-accent">Invite a friend</span>
      <p className="invite-why">Your friend can walk the decks with you and talk to {COMPUTER_NAME}; the work runs on your machines and your subscriptions.</p>
      {current === undefined ? <span className="dots"><i /><i /><i /></span> : link ? (
        <>
          <div className="invite-link">
            <input readOnly value={link} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} className="mono" />
            <Button kind="primary" size="sm" onClick={copy}>{copied ? "Copied" : "Copy"}</Button>
          </div>
          <div className="invite-meta">
            <span className="dim">Works for {Math.max(1, Math.round((current!.expiresAt - Date.now()) / DAY))} more day{Math.round((current!.expiresAt - Date.now()) / DAY) === 1 ? "" : "s"}{current!.used ? ` · ${current!.used} came aboard with it` : ""}</span>
            <span style={{ flex: 1 }} />
            <Button size="sm" kind="ghost" disabled={busy} onClick={() => run(() => create({ officeId }))}>New link</Button>
            <ConfirmButton size="sm" confirm="Turn it off?" onConfirm={() => run(() => revoke({ officeId }))}>Turn off</ConfirmButton>
          </div>
        </>
      ) : (
        <div><Button kind="primary" size="sm" disabled={busy} onClick={() => run(() => create({ officeId }))}>Make an invite link</Button></div>
      )}
      {err ? <div className="error">{err}</div> : null}
    </Card>
  );
}

/** The Ship tab's people section: the captain's (invite, friends, the switch) or a friend's (whose ship, leave). */
export function Friends({ officeId, shipName }: { officeId: Id<"offices">; shipName: string }) {
  const aboard = useAboard(officeId);
  const update = useMutation(api.offices.update);
  const remove = useMutation(api.members.remove);
  const leave = useMutation(api.members.leave);
  const board = useMutation(api.users.board);
  const [err, setErr] = useState<string | null>(null);
  const run = (fn: () => Promise<unknown>) => void fn().catch((x) => setErr(errorText(x)));
  if (aboard.loading) return null;
  const friends = aboard.people.filter((p) => !p.owner);
  const captain = aboard.owner;
  return (
    <section className="friends">
      <div className="sec-head"><span className="disp sec-title">Aboard</span><span className="dim">{aboard.people.length} {aboard.people.length === 1 ? "person" : "people"}</span></div>
      {aboard.isOwner ? <InviteLink officeId={officeId} /> : (
        <p className="dim sec-note">
          You're aboard {captain?.name}'s ship. The crew work on {captain?.name}'s machines and subscriptions.{" "}
          {aboard.membersCanAsk ? `You can talk to ${COMPUTER_NAME} in threads.` : `${captain?.name} has turned off asking ${COMPUTER_NAME} for friends; you can read along.`}
        </p>
      )}
      <div className="people">
        {aboard.people.map((p) => (
          <PersonRow key={p.userId} p={p}>
            {!p.me && p.onDeck ? <MuteButton userId={p.userId} name={p.name} /> : null}
            {aboard.isOwner && !p.owner ? <ConfirmButton size="sm" confirm={`Remove ${p.name}?`} onConfirm={() => run(() => remove({ officeId, userId: p.userId as Id<"users"> }))}>Remove</ConfirmButton> : null}
          </PersonRow>
        ))}
        {aboard.isOwner && !friends.length ? <p className="dim sec-note">Nobody else yet. Send a friend the link above.</p> : null}
      </div>
      {aboard.isOwner ? (
        <label className="ask-toggle">
          <input type="checkbox" checked={aboard.membersCanAsk} onChange={(e) => run(() => update({ officeId, membersCanAsk: e.target.checked }))} />
          <span><b>Friends can ask {COMPUTER_NAME}</b><span className="dim"> · they start threads and talk in them; it all runs on your machines. Off, they read along.</span></span>
        </label>
      ) : (
        <div><ConfirmButton size="sm" confirm={`Leave ${shipName}?`} onConfirm={() => run(async () => { await leave({ officeId }); await board({ officeId: null }); })}>Leave this ship</ConfirmButton></div>
      )}
      {err ? <div className="error">{err}</div> : null}
    </section>
  );
}

/** Your offsites and ones you joined, each with its world: go aboard another, or make a new one (newOffsite.ts). */
export function ShipSwitcher({ officeId }: { officeId: string }) {
  const mine = useQuery(api.offices.mine);
  const joined = useQuery(api.members.joined);
  const board = useMutation(api.users.board);
  const [err, setErr] = useState<string | null>(null);
  if (!mine || !joined) return null;
  const ships = [
    ...mine.map((o) => ({ _id: o._id as string, name: o.name, whose: "Yours", world: o.world })),
    ...joined.map((j) => ({ _id: j._id as string, name: j.name, whose: `${j.owner}'s`, world: j.world })),
  ];
  const go = (id: string) => void board({ officeId: id as Id<"offices"> }).catch((x) => setErr(errorText(x)));
  return (
    <div className="switcher">
      <span className="lab dim">Your offsites</span>
      {ships.map((s) => (
        <div key={s._id} className={`switch-row ${s._id === officeId ? "here" : ""}`}>
          <span className="clip"><b>{s.name}</b> <span className="dim">· {s.whose} · {worldOf(s.world).name}</span></span>
          {s._id === officeId ? <span className="lab t-accent">Aboard</span> : <Button size="sm" kind="soft" onClick={() => go(s._id)}>Go aboard</Button>}
        </div>
      ))}
      <button type="button" className="switch-new" onClick={() => { phone.putAway(); newOffsite.start(); }}>+ New offsite</button>
      {err ? <div className="error">{err}</div> : null}
    </div>
  );
}
