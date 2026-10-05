import { LIMITS, type RunEvent } from "@offsite/contracts";

/**
 * A run's events on their way to the ship. Content deltas that arrive within one window (100 ms) are joined into
 * one, so a streaming reply is a handful of writes rather than one per token; everything goes in order, at most 200
 * events per call, one call at a time. A failed write is retried a few times, then dropped with a log line: an
 * agent never stops because the network hiccupped.
 */
export class EventSink {
  private pending: RunEvent[] = [];
  private timer: NodeJS.Timeout | null = null;
  private chain: Promise<void> = Promise.resolve();
  private readonly send: (events: RunEvent[]) => Promise<void>;
  private readonly windowMs: number;
  private readonly log: (m: string) => void;
  private readonly retryMs: number[];

  constructor(send: (events: RunEvent[]) => Promise<void>, opts: { windowMs?: number; log?: (m: string) => void; retryMs?: number[] } = {}) {
    this.send = send;
    this.windowMs = opts.windowMs ?? 100;
    this.log = opts.log ?? (() => {});
    this.retryMs = opts.retryMs ?? [250, 1000, 3000];
  }

  push(e: RunEvent): void {
    const last = this.pending.at(-1);
    if (e.type === "content.delta" && last?.type === "content.delta") last.delta += e.delta;
    else this.pending.push(e.type === "content.delta" ? { ...e } : e);
    this.timer ??= setTimeout(() => { this.timer = null; void this.flush(); }, this.windowMs);
  }

  /** Send everything pushed so far; resolves when it has been written (or given up on). */
  flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const batch = this.pending.splice(0);
    for (let i = 0; i < batch.length; i += LIMITS.eventsPerBatch) {
      const chunk = batch.slice(i, i + LIMITS.eventsPerBatch);
      this.chain = this.chain.then(() => this.write(chunk));
    }
    return this.chain;
  }

  private async write(chunk: RunEvent[]): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try { await this.send(chunk); return; }
      catch (e) {
        if (attempt >= this.retryMs.length) { this.log(`dropped ${chunk.length} event(s): ${(e as Error).message}`); return; }
        await new Promise((r) => setTimeout(r, this.retryMs[attempt]));
      }
    }
  }
}
