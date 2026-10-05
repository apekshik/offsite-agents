// "Welcome aboard": the moment after coming aboard with an invite, shown once over the ship as it appears. The join
// page leaves a note for the ship it joined; Aboard reads it once.

const KEY = "offsite:welcome";

export function welcomeAboard(officeId: string) {
  try { sessionStorage.setItem(KEY, officeId); } catch { /* private mode: no welcome */ }
}

/** The ship to welcome you aboard, once; null after that (or for any other ship). */
export function takeWelcome(officeId: string): boolean {
  try {
    if (sessionStorage.getItem(KEY) !== officeId) return false;
    sessionStorage.removeItem(KEY);
    return true;
  } catch { return false; }
}
