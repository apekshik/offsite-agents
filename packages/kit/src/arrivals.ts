import { ARRIVAL } from "@offsite/contracts";

// New crew arrive by air (the yacht's helicopter, the moon base's lander). Each arrival is a
// touchdown time on the server's clock (crew.arrivesAt); from those alone every client works out
// the same flights. A world flies one in for each, with ARRIVAL's timings.

export interface Flight { land: number; leave: number }

/**
 * Groups touchdowns into flights: one that lands while the last flight is still on the pad (or
 * only just leaving it) shares it, which waits for them.
 */
export function planFlights(touchdowns: number[]): Flight[] {
  const ts = [...new Set(touchdowns.filter((t) => Number.isFinite(t)))].sort((a, b) => a - b);
  const out: Flight[] = [];
  for (const t of ts) {
    const last = out[out.length - 1];
    if (last && t <= last.leave + 6000) last.leave = Math.max(last.leave, t + ARRIVAL.groundMs);
    else out.push({ land: t, leave: t + ARRIVAL.groundMs });
  }
  return out;
}

/** Whether a flight is anywhere in its window at `now`: on its way in, on the pad, or on its way out. */
export function inFlightWindow(f: Flight, now: number): boolean {
  return now >= f.land - ARRIVAL.approachMs && now <= f.leave + ARRIVAL.departMs;
}
