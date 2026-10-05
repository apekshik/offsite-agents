import { useEffect, useRef, useState, type ReactNode } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { COMPUTER_NAME } from "@offsite/contracts";
import { api } from "../../../../convex/_generated/api";
import { signIn, signInAvailable } from "../auth.ts";
import { Backdrop } from "../landing/Backdrop.tsx";
import { Button, errorText, Face } from "../ui/index.tsx";
import { personLook } from "../people/look.ts";
import { welcomeAboard } from "./welcome.ts";
import "./screens.css";
import "./join.css";

// /join/<token>: a friend's invite. Who invited you aboard which ship; sign in (sign-in comes back here), and you're
// a member of it, landing aboard with a welcome. The work there runs on the captain's machines and subscriptions.

/** The token in /join/<token>, or null on any other page. */
export function joinToken(path = location.pathname): string | null {
  const m = /^\/join\/([A-Za-z0-9]{8,64})\/?$/.exec(path);
  return m ? m[1]! : null;
}

/** Back to the app's front, keeping a dev sign-in (?dev=name) on a dev server. */
function home() {
  const dev = new URLSearchParams(location.search).get("dev");
  location.replace(dev ? `/?dev=${encodeURIComponent(dev)}` : "/");
}

const WHY: Record<string, string> = {
  unknown: "This invite link doesn't work. Ask whoever sent it for a new one.",
  revoked: "This invite link was turned off. Ask the captain for a new one.",
  expired: "This invite link has expired: they last a week. Ask the captain for a new one.",
};

export function Join({ token }: { token: string }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const peek = useQuery(api.invites.peek, { token });
  const me = useQuery(api.users.me, isAuthenticated ? {} : "skip");
  const ensure = useMutation(api.users.ensure);
  const accept = useMutation(api.invites.accept);
  const [err, setErr] = useState<string | null>(null);
  const [going, setGoing] = useState(false);
  const tried = useRef(false);

  useEffect(() => {
    if (isAuthenticated && me === null) void ensure().catch((e) => setErr(errorText(e)));
  }, [isAuthenticated, me, ensure]);

  // Signed in and the link works: aboard, with a welcome.
  useEffect(() => {
    if (!me || !peek?.ok || tried.current) return;
    tried.current = true;
    void accept({ token }).then((r) => {
      if (r.joined) welcomeAboard(r.officeId);
      home();
    }, (e) => setErr(errorText(e)));
  }, [me, peek, accept, token]);

  const card = (body: ReactNode) => (
    <div className="screen">
      <Backdrop dim />
      <main className="screen-card join-card" aria-label="Invite">
        <div className="sc-top"><span className="disp wordmark">Offsite</span></div>
        {body}
      </main>
    </div>
  );

  if (peek === undefined || isLoading) return card(<div className="sc-splash-line"><span className="dots"><i /><i /><i /></span><span className="dim">Reading the invite</span></div>);
  if (!peek.ok) {
    return card(<>
      <div className="sc-hero"><h1 className="disp">This link can't bring you aboard</h1><p className="ink2">{WHY[peek.reason]}</p></div>
      <div className="actions"><Button kind="primary" onClick={home}>Go to Offsite</Button></div>
    </>);
  }
  const captain = personLook({ userId: "captain", avatar: peek.captain.avatar, look: peek.captain.look, owner: true });
  const invited = (
    <div className="join-who">
      <Face avatar={captain.avatar} look={captain.look} size={56} />
      <div className="sc-hero">
        <span className="lab t-accent">You're invited</span>
        <h1 className="disp">{peek.captain.name} invited you aboard {peek.ship}</h1>
      </div>
    </div>
  );
  const what = (
    <ul className="join-what">
      <li>Walk the decks together and talk to {COMPUTER_NAME} in the same threads.</li>
      <li>The crew's work runs on {peek.captain.name}'s machines and subscriptions, not yours. You don't need to install anything.</li>
      <li>{peek.captain.name} can take you off the ship, and you can leave whenever you like.</li>
    </ul>
  );
  if (!isAuthenticated) {
    return card(<>
      {invited}
      {what}
      <div className="actions">
        {signInAvailable()
          ? <Button kind="primary" size="lg" disabled={going} onClick={() => { setGoing(true); void signIn(location.pathname + location.search).finally(() => setTimeout(() => setGoing(false), 4000)); }}>{going ? "Opening sign-in…" : "Sign in to come aboard"}</Button>
          : <p className="dim">Sign-in isn't set up on this server. Locally, add <span className="mono">?dev=yourname</span> to this link.</p>}
      </div>
    </>);
  }
  return card(<>
    {invited}
    {err ? <><div className="error" role="alert">{err}</div><div className="actions"><Button kind="primary" onClick={home}>Go to Offsite</Button></div></>
      : <div className="sc-splash-line"><span className="dots"><i /><i /><i /></span><span className="dim">Coming aboard</span></div>}
  </>);
}
