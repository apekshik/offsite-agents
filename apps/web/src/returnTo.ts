// Where to land after sign-in. WorkOS hands `state` back through the URL, so anyone can write it: only a path on
// this site gets through, never another origin.

/** `value` as a path on this site ("/pair?code=…"), or null. */
export function sameSitePath(value: unknown, origin = location.origin): string | null {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return null;
  try {
    const url = new URL(value, origin);
    return url.origin === origin && url.pathname !== "/callback" ? `${url.pathname}${url.search}${url.hash}` : null;
  } catch { return null; }
}
