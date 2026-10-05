import { FakeConvexClient, type Args } from "../fake/client.ts";
import { DemoShip, type DemoSetup } from "./ship.ts";

// Demo mode's Convex: the fake client (src/fake/client.ts) answering from a DemoShip, in real time. A few times a
// second it asks every watched query again, so streaming replies, crew steps and landings move on by themselves;
// after each mutation it asks at once.

export class DemoBackend extends FakeConvexClient {
  readonly ship: DemoShip;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(setup: DemoSetup, clock?: () => number) {
    super();
    this.ship = new DemoShip(setup, clock);
  }

  /** Moves with the clock: re-asks every watched query every `ms`. */
  start(ms = 250) {
    this.timer ??= setInterval(() => this.refresh(), ms);
    return this;
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  protected answer(name: string, args: Args): unknown {
    return this.ship.query(name, args);
  }

  protected run(name: string, args: Args): unknown {
    const out = this.ship.mutate(name, args);
    // After the caller's await, like a real round trip.
    setTimeout(() => this.refresh(), 0);
    return out;
  }

  override get url() { return "demo://ship"; }
}
