import { ARRIVAL } from "@offsite/contracts";

// A helicopter flight's phase at a moment, from the same timings the world flies it by
// (ARRIVAL; a flight is { land, leave } as the kit's planFlights makes them, for the yacht's helicopter or the
// moon base's lander).

export type FlightPhase = "away" | "approach" | "ground" | "depart";

export interface Flight { land: number; leave: number }

/** Which phase a flight is in at `now` (ms since epoch), and how many ms into it. */
export function flightPhase(f: Flight, now: number): { phase: FlightPhase; ms: number } {
  const start = f.land - ARRIVAL.approachMs;
  if (now < start || now > f.leave + ARRIVAL.departMs) return { phase: "away", ms: 0 };
  if (now < f.land) return { phase: "approach", ms: now - start };
  if (now <= f.leave) return { phase: "ground", ms: now - f.land };
  return { phase: "depart", ms: now - f.leave };
}
