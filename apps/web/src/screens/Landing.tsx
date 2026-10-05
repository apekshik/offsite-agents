import { useState } from "react";
import { signIn, signInAvailable } from "../auth.ts";
import { Backdrop } from "../landing/Backdrop.tsx";
import "./landing.css";

// The front door: the yacht at night behind a big "Offsite", one line on what it is, and Sign in.

/** The launch video. Empty hides its link. */
export const LAUNCH_VIDEO_URL = "";
export const GITHUB_URL = "https://github.com/apekshik/offsite-agents";

function PlayIcon() {
  return <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4.5 2.8v10.4L13 8z" fill="currentColor" /></svg>;
}
function GitHubIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path fill="currentColor" d="M8 .2a8 8 0 0 0-2.5 15.6c.4 0 .5-.2.5-.4v-1.5c-2.2.5-2.7-1-2.7-1-.4-.9-.9-1.2-.9-1.2-.7-.5.1-.5.1-.5.8.1 1.2.8 1.2.8.7 1.3 1.9.9 2.4.7 0-.5.3-.9.5-1.1-1.8-.2-3.6-.9-3.6-4 0-.9.3-1.6.8-2.1-.1-.2-.4-1 .1-2.1 0 0 .7-.2 2.2.8a7.5 7.5 0 0 1 4 0c1.5-1 2.2-.8 2.2-.8.4 1.1.2 1.9.1 2.1.5.6.8 1.3.8 2.1 0 3.1-1.9 3.8-3.6 4 .3.3.6.8.6 1.5v2.2c0 .2.1.5.6.4A8 8 0 0 0 8 .2" />
    </svg>
  );
}

/** checking: sign-in hasn't said yet whether you're signed in; the buttons wait. */
export function Landing({ checking = false }: { checking?: boolean }) {
  const can = signInAvailable();
  const [going, setGoing] = useState(false);
  return (
    <div className="landing">
      <Backdrop live />
      <main className="ld-hero">
        <span className="ld-rule" aria-hidden="true" />
        <h1 className="ld-word">Offsite</h1>
        <p className="ld-tag">Take your coding agents on an <span className="ld-accent">offsite</span>.</p>
        <p className="ld-line">
          Your Claude Code and Codex crew, on a superyacht in your browser. They run on your machine, on your own subscriptions. No API keys.
        </p>
        <div className={`ld-actions ${checking ? "waiting" : ""}`} aria-busy={checking}>
          {can ? (
            <button type="button" className="btn primary lg ld-signin" disabled={going} onClick={() => { setGoing(true); void signIn(location.pathname + location.search).finally(() => setTimeout(() => setGoing(false), 4000)); }}>
              {going ? "Opening sign-in…" : "Sign in"}
            </button>
          ) : (
            <p className="ld-note">Sign-in isn't set up on this server. Locally, open <span className="mono">?dev=yourname</span>.</p>
          )}
          {LAUNCH_VIDEO_URL ? (
            <a className="btn lg ld-link" href={LAUNCH_VIDEO_URL} target="_blank" rel="noopener noreferrer"><PlayIcon />Watch the video</a>
          ) : null}
          <a className="btn lg ld-link" href={GITHUB_URL} target="_blank" rel="noopener noreferrer"><GitHubIcon />GitHub</a>
        </div>
      </main>
      <footer className="ld-foot">Open source, MIT licensed. Offsite never stores your provider logins.</footer>
    </div>
  );
}
