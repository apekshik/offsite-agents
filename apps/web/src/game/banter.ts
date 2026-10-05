// What the crew say to each other off duty: short exchanges of two or three lines, traded in
// speech bubbles while they hang out in a group. Which exchange, who says which line and when
// are all fixed by the group and the clock (rng.ts), so a filmed run says the same things.

import { hash, shuffled } from "./rng.ts";

export type Exchange = readonly string[];

/** Small talk for any group: the bar, a table, the rail, the hot tub. */
export const BANTER: readonly Exchange[] = [
  ["tabs.", "spaces.", "we are not doing this again"],
  ["who approved my PR at 3am", "you did"],
  ["it works on my machine", "then ship your machine"],
  ["I mass-renamed a variable", "how many files", "yes"],
  ["standup's at 9?", "we're on a yacht"],
  ["did you write tests?", "I wrote a test", "singular?"],
  ["I fixed the flaky test", "how?", "deleted it"],
  ["is it DNS?", "it's always DNS"],
  ["I refactored everything", "why", "vibes"],
  ["rebase or merge?", "rebase", "monster"],
  ["how was your sprint?", "more of a jog"],
  ["I left a TODO in 2019", "it's load-bearing now"],
  ["can you review my PR?", "how big?", "4,000 lines"],
  ["the docs say it's simple", "the docs lie"],
  ["I named it final_v2_real", "ship it"],
  ["just one more small change", "famous last words"],
  ["is this a breaking change?", "define breaking"],
  ["my commit message was 'stuff'", "a classic"],
  ["regex fixed it", "now you have two problems"],
  ["we should rewrite it in Rust", "drink your drink"],
  ["I'm not procrastinating", "you're horizontal", "it's async work"],
  ["what a sunset", "like a green CI run"],
  ["why is it slow?", "n+1 queries", "n+1 cocktails"],
  ["nice tan", "monitor glow"],
  ["the captain wants it by Friday", "which Friday?"],
  ["I commented out the error", "bold", "it's quiet now"],
  ["what does this function do?", "nobody knows", "it's been there since launch"],
  ["pair programming later?", "only if I drive", "the captain drives"],
  ["how many tabs do you have open?", "yes"],
  ["I pushed to main", "on purpose?", "with confidence"],
  ["is the bug fixed?", "it's resting"],
  ["should we add more AI?", "we are the AI"],
  ["how's the wifi out here?", "about as stable as prod"],
  ["I love legacy code", "you wrote it", "and I stand by it"],
  ["seasick?", "only from your merge conflicts"],
  ["ever deleted node_modules?", "weekly. for my health."],
  ["estimate?", "two days", "so two weeks"],
  ["plans tonight?", "tailing the logs", "romantic"],
  ["you look relaxed", "my tests pass", "all of them?"],
  ["best thing about this ship?", "no meetings"],
  ["bug or feature?", "depends who's asking"],
  ["I updated one dependency", "and?", "now I have 300"],
  ["I wrote it in one line", "readable?", "to me, once"],
  ["did you sleep?", "I took a cache nap"],
  ["is that a hotfix?", "it's a warm fix"],
  ["any blockers?", "the sun", "and this drink"],
  ["I documented everything", "where?", "in my head"],
  ["what's your stack?", "sunscreen, then more sunscreen"],
] as const;

/** When two who just finished clink glasses. */
export const CHEERS: readonly Exchange[] = [
  ["to green builds", "to green builds!"],
  ["cheers to shipping", "on a Friday, no less"],
  ["to the captain", "who's paying for this?"],
  ["merged!", "merged!", "cheers"],
  ["zero conflicts", "I'll drink to that"],
  ["to clean diffs", "and cleaner drinks"],
] as const;

/** Across the bar, with whoever is playing bartender. */
export const BAR: readonly Exchange[] = [
  ["what'll it be?", "something with no merge conflicts"],
  ["one espresso martini", "coming right up"],
  ["what's good?", "the old fashioned", "like your code"],
  ["make it a double", "rough deploy?", "rough standup"],
  ["anything without semicolons?", "house special"],
] as const;

/** In the hot tub. */
export const TUB: readonly Exchange[] = [
  ["this is nice", "warmer than prod"],
  ["should we get out?", "five more minutes", "you said that an hour ago"],
  ["my laptop's on the lounger", "it's fine, it's waterproof", "it is not"],
] as const;

/** Said on the way back to the desk when the captain hands out work. */
export const SCRAMBLE: readonly string[] = ["on it!", "duty calls", "my turn!", "already?", "coming!", "back to work", "one sec!", "let's go"];

/** The first line of a well-earned drink. */
export const DONE: readonly string[] = ["shipped it", "and it's merged", "that's a wrap", "green across the board"];

export type GroupMood = "chat" | "cheers" | "bar" | "tub" | "dance" | "cards";

export interface Line {
  speaker: string;
  text: string;
  /** When it is said (ms, the shared clock), and for how long it shows. */
  at: number;
  ms: number;
}

export interface Beat {
  /** Which round of talk this is in the group's life (0 first). */
  round: number;
  lines: Line[];
  /** Everyone clinks glasses at this time (cheers rounds), or null. */
  cheersAt: number | null;
  /** Who laughs at the punchline, and when. */
  laughs: { who: string; at: number }[];
  /** When this round started and when the next one starts. */
  from: number;
  until: number;
}

/** How long one line stays up: long enough to read it from across the deck. */
export const lineMs = (text: string) => 1500 + 45 * text.length;

function pool(mood: GroupMood): readonly Exchange[] {
  switch (mood) {
    case "cheers": return CHEERS;
    case "bar": return BAR;
    case "tub": return TUB;
    default: return BANTER;
  }
}

/** A group's own pace: a round every 10–13 s. */
export const roundMs = (groupId: string) => 10_000 + (hash(groupId, "pace") % 3000);

/**
 * What a group is saying around `now`: the current round's lines, who says each, when, and who
 * laughs after. Members take turns starting from someone the round picks. The first round of a
 * cheers group is a toast; bar and hot-tub groups mix in their own lines among the small talk.
 */
export function beatAt(groupId: string, members: readonly string[], formedAt: number, mood: GroupMood, now: number): Beat | null {
  if (members.length < 2 || now < formedAt || mood === "dance") return null;
  const len = roundMs(groupId);
  const round = Math.floor((now - formedAt) / len);
  const from = formedAt + round * len;
  // A toast first; then the group's own lines one round in three, small talk otherwise.
  const special = mood === "cheers" ? round === 0 : (mood === "bar" || mood === "tub") && round % 3 === 1;
  const lib = special ? pool(mood) : BANTER;
  const order = shuffled(lib.map((_, i) => i), hash(groupId, special ? mood : "chat"));
  const ex = lib[order[(special ? Math.floor(round / 3) : round) % order.length]!]!;
  // Across the bar, the bartender (first in the list) opens.
  const first = special && mood === "bar" ? 0 : hash(groupId, round, "first") % members.length;
  const lines: Line[] = [];
  let at = from + 600 + (hash(groupId, round, "lead") % 500);
  ex.forEach((text, i) => {
    const ms = lineMs(text);
    lines.push({ speaker: members[(first + i) % members.length]!, text, at, ms });
    at += ms - 250;
  });
  const last = lines[lines.length - 1]!;
  const laughs: Beat["laughs"] = [];
  if (!(mood === "cheers" && round === 0)) {
    for (const m of members) {
      if (m === last.speaker) continue;
      if (hash(groupId, round, m, "laugh") % 100 < 55) laughs.push({ who: m, at: last.at + 500 + (hash(m, round) % 400) });
    }
  }
  const cheersAt = mood === "cheers" && round === 0 ? from + 400
    : (mood === "bar" || mood === "chat" || mood === "cheers") && hash(groupId, round, "clink") % 5 === 0 ? last.at + last.ms - 200 : null;
  return { round, lines, cheersAt, laughs, from, until: from + len };
}

/** Everything any library holds (for tests and for counting). */
export const ALL_LINES = [...BANTER, ...CHEERS, ...BAR, ...TUB].flat();
