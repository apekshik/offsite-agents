// Adapted from Beam (github.com/SupraluminalIntelligence/beam, MIT).
/** How long the runner waits for Convex to hear that it is going offline. */
export const BYE_MS = 5_000;

export interface Shutdown {
  /** Interrupt the runs in progress and wait, bounded, for them to land. Resolves with the ones still going. */
  landRuns(): Promise<string[]>;
  /** Tell the ship this runner is going away. */
  bye(): Promise<unknown>;
  exit(code: number): void;
  log?(message: string): void;
}

/**
 * The runner's SIGINT/SIGTERM handler: land every run first, then say goodbye, then exit. A run always ends with a
 * commit, so going offline must never come first. Later signals while it works are ignored; the person at the
 * terminal can still kill the process outright.
 */
export function onShutdown(s: Shutdown, byeMs = BYE_MS): () => Promise<void> {
  let started: Promise<void> | null = null;
  const log = s.log ?? ((m: string) => console.log(m));
  return () => started ??= (async () => {
    log("shutting down: stopping runs and committing their work");
    try {
      const left = await s.landRuns();
      if (left.length) log(`gave up waiting for ${left.length} run(s) to land: ${left.join(", ")}`);
    } catch (e) { log(`landing runs failed: ${(e as Error).message}`); }
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([s.bye().catch(() => {}), new Promise((r) => { timer = setTimeout(r, byeMs); })]);
    clearTimeout(timer);
    s.exit(0);
  })();
}
