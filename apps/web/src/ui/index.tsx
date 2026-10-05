import { useEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type InputHTMLAttributes, type ReactNode } from "react";
import { ACTIVITY_LABEL, DEFAULT_AVATAR, type CrewActivity } from "@offsite/contracts";
import "./ui.css";

// The design system's pieces. Plain components over ui.css: no state of the ship in here.

export type Tone = "accent" | "amber" | "green" | "red" | "dim";

/** Colour means state: cyan working, amber needs you, green landed, grey off duty, red failed. */
export function activityTone(a: CrewActivity): Tone {
  if (a === "asking") return "amber";
  if (a === "landed") return "green";
  if (a === "failed") return "red";
  if (a === "idle" || a === "arriving") return "dim";
  return "accent";
}

const cx = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(" ");

export function Card({ tone, quiet, className, style, children, onClick, title }: {
  tone?: Tone | undefined; quiet?: boolean; className?: string; style?: CSSProperties; children?: ReactNode; onClick?: () => void; title?: string;
}) {
  const cls = cx("card", tone && tone !== "dim" && tone, quiet && "quiet", className);
  if (onClick) return <button type="button" className={cls} style={style} onClick={onClick} title={title}>{children}</button>;
  return <div className={cls} style={style} title={title}>{children}</div>;
}

type ButtonKind = "primary" | "amber" | "soft" | "soft-amber" | "ghost" | "danger" | "plain";
export function Button({ kind = "plain", size, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { kind?: ButtonKind; size?: "sm" | "lg" }) {
  return <button type="button" className={cx("btn", kind !== "plain" && kind, size, className)} {...rest} />;
}

/** A Stop-style button that asks once: the first press arms it for a few seconds. */
export function ConfirmButton({ children, confirm, onConfirm, size, disabled }: { children: ReactNode; confirm: ReactNode; onConfirm: () => void; size?: "sm" | "lg"; disabled?: boolean }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3500);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <Button kind="danger" size={size} disabled={disabled} className={armed ? "armed" : undefined} onClick={() => { if (armed) { setArmed(false); onConfirm(); } else setArmed(true); }}>
      {armed ? confirm : children}
    </Button>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx("input", className)} {...rest} />;
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="lab">{label}</span>
      {children}
      {hint ? <span className="hint">{hint}</span> : null}
    </label>
  );
}

export function Pill({ tone, children, className }: { tone?: Tone | undefined; children: ReactNode; className?: string }) {
  return <span className={cx("pill", tone && tone !== "dim" && tone, className)}>{children}</span>;
}

export function Chip({ children }: { children: ReactNode }) {
  return <span className="chip">{children}</span>;
}

export function Key({ children }: { children: ReactNode }) {
  return <kbd className="key">{children}</kbd>;
}

export function Dot({ tone }: { tone: "on" | "off" | "amber" | "accent" }) {
  return <span className={cx("dot", tone)} />;
}

export function ActivityLabel({ activity, children, className }: { activity: CrewActivity; children?: ReactNode; className?: string }) {
  return <span className={cx("lab", `t-${activityTone(activity)}`, className)}>{ACTIVITY_LABEL[activity]}{children}</span>;
}

/** Arrow → for send buttons. */
export function SendIcon({ color = "currentColor" }: { color?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}
export function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

// ---- faces ----

interface FaceSpec { skin: string; hairColor: string; hair: string; head: string; face: string }

/** The colours and parts a face needs, from an AvatarSpec (and a designed look's base, which wins for parts). */
export function faceSpec(avatar: unknown, look?: unknown): FaceSpec {
  const a = (avatar && typeof avatar === "object" ? avatar : {}) as Record<string, unknown>;
  const base = ((look as { meta?: { base?: Record<string, unknown> } } | null)?.meta?.base ?? {}) as Record<string, unknown>;
  const str = (k: string, fallback: string) => (typeof base[k] === "string" ? (base[k] as string) : typeof a[k] === "string" ? (a[k] as string) : fallback);
  const hex = (k: "skin" | "hairColor") => (typeof a[k] === "string" && /^#[0-9a-f]{6}$/i.test(a[k] as string) ? (a[k] as string) : DEFAULT_AVATAR[k]);
  return { skin: hex("skin"), hairColor: hex("hairColor"), hair: str("hair", "short"), head: str("head", "box"), face: str("face", "dots") };
}

/**
 * A crew member's little block head, drawn from their avatar: skin, hair colour, a few parts. The
 * ship's computer gets the robot face. `ring` outlines it in a state colour.
 */
export function Face({ avatar, look, computer, size = 22, ring, title }: {
  avatar?: unknown; look?: unknown; computer?: boolean; size?: number; ring?: string | undefined; title?: string | undefined;
}) {
  if (computer) return <span className="bot" style={{ "--fs": `${size}px` } as CSSProperties} title={title} aria-hidden={!title} />;
  const f = faceSpec(avatar, look);
  const cls = cx(
    "face",
    f.hair === "long" && "long",
    (f.head === "round") && "round",
    f.head === "cat" && "cat",
    (f.head === "tv" || f.head === "helmet") && "tv",
    f.face === "visor" && "visor",
    f.face === "smile" && size >= 30 && "smile",
    ring && "ring",
  );
  return (
    <span className={cls} style={{ "--fs": `${size}px`, "--skin": f.skin, "--hair": f.hairColor, ...(ring ? { "--ring": ring } : {}) } as CSSProperties} title={title} aria-hidden={!title}>
      {f.hair !== "none" && f.head !== "tv" && f.head !== "helmet" ? <span className="hair" /> : null}
      {f.face !== "none" ? <span className="eyes" /> : null}
    </span>
  );
}

// ---- small hooks ----

/** The wall clock, ticking every `ms`. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** "18:24" in the captain's own time zone. */
export function clock(now: number): string {
  return new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** How long ago or how long: "now", "40s", "2 min", "1 h 5 min". */
export function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 5) return "now";
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}

/** Golden hour, afternoon…: what the light is doing on deck. */
export function partOfDay(now: number): string {
  const h = new Date(now).getHours();
  if (h < 5) return "Night watch";
  if (h < 8) return "Sunrise";
  if (h < 12) return "Morning";
  if (h < 17) return "Afternoon";
  if (h < 20) return "Golden hour";
  return "Evening";
}

/** Scroll a list to its end when it grows, unless the reader has scrolled up. */
export function useStickToBottom<T extends HTMLElement>(dep: unknown) {
  const ref = useRef<T>(null);
  const stuck = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => { stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (el && stuck.current) el.scrollTop = el.scrollHeight;
  }, [dep]);
  return ref;
}

/** A Convex error's readable message (ConvexError keeps its data; others say what they can). */
export function errorText(e: unknown): string {
  const data = (e as { data?: unknown } | null)?.data;
  if (typeof data === "string") return data;
  const msg = e instanceof Error ? e.message : String(e);
  const m = /Uncaught ConvexError: (.*?)(\n|$)/.exec(msg) ?? /Uncaught Error: (.*?)(\n|$)/.exec(msg);
  return m?.[1] ?? msg.split("\n")[0] ?? "Something went wrong";
}

/** Text with `code` spans, ``` blocks and links: how the computer and the crew write. */
export function RichText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  const blocks = text.split(/```[\w-]*\n?/);
  blocks.forEach((block, i) => {
    if (i % 2 === 1) {
      parts.push(<pre key={i} className="mono rich-pre">{block.replace(/\n$/, "")}</pre>);
      return;
    }
    const bits = block.split(/(`[^`\n]+`|https?:\/\/[^\s)]+)/g);
    bits.forEach((b, j) => {
      if (!b) return;
      if (b.startsWith("`") && b.endsWith("`") && b.length > 2) parts.push(<code key={`${i}-${j}`} className="mono rich-code">{b.slice(1, -1)}</code>);
      else if (/^https?:\/\//.test(b)) parts.push(<a key={`${i}-${j}`} href={b} target="_blank" rel="noreferrer">{b.replace(/^https?:\/\/(www\.)?github\.com\//, "")}</a>);
      else parts.push(b.replace(/\*\*(.+?)\*\*/g, "$1"));
    });
  });
  return <>{parts}</>;
}
