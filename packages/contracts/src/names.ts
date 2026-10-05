// Names for crew who arrive without one. Short, distinct when called out across a deck.
export const CREW_NAMES = [
  "Juniper", "Otis", "Marlo", "Wren", "Ines", "Rafe", "Coral", "Bodhi", "Sable", "Tamsin",
  "Kofi", "Lumi", "Ezra", "Nova", "Pike", "Odile", "Jasper", "Mira", "Teo", "Saffi",
  "Arlo", "Indy", "Bram", "Cleo", "Dov", "Esme", "Fen", "Gus", "Hana", "Ivo",
] as const;

/** The first name in the list nobody aboard has, or a numbered one when every name is taken. */
export function freshName(taken: Iterable<string>, seed = 0): string {
  const used = new Set([...taken].map((n) => n.toLowerCase()));
  const start = Math.abs(seed) % CREW_NAMES.length;
  for (let i = 0; i < CREW_NAMES.length; i++) {
    const name = CREW_NAMES[(start + i) % CREW_NAMES.length]!;
    if (!used.has(name.toLowerCase())) return name;
  }
  let n = 2;
  while (used.has(`${CREW_NAMES[start]!.toLowerCase()} ${n}`)) n++;
  return `${CREW_NAMES[start]} ${n}`;
}

/**
 * Computah, the main orchestrator: the ship's computer the captain talks to at the helm or on the
 * phone. In code it is the crew row with role "computer" and its turns are "computer" runs.
 */
export const COMPUTER_NAME = "Computah";
/** How the app introduces it, beside its name, so it reads apart from the crew. */
export const COMPUTER_ROLE = "Main orchestrator";
/** What it is for, in a sentence. */
export const COMPUTER_BLURB = "Helps you manage your crew: plans the work, hands it to whoever's free, hires when everyone's busy, and checks what they land before it goes in.";
/** The handle the crew and the captain mention it by. */
export const COMPUTER_HANDLE = "computah";
/** Its earlier handle, still understood in old threads and messages. */
export const COMPUTER_HANDLE_ALIASES: readonly string[] = ["computer"];

/** Whether a handle (with or without its @) means Computah. */
export function isComputerHandle(handle: string): boolean {
  const h = handle.trim().replace(/^@/, "").toLowerCase();
  return h === COMPUTER_HANDLE || COMPUTER_HANDLE_ALIASES.includes(h);
}
