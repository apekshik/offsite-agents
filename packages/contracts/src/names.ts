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

/** The ship's computer's name, shown on the helm and in threads. */
export const COMPUTER_NAME = "Computer";
