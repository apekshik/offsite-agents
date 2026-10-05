import { FakeConvexClient, type Args } from "../fake/client.ts";
import { at, diffAt, eventsAt, OFFICE, shipAt, type ShipState } from "./story.ts";

// The film's backend: a fake Convex client (src/fake/client.ts) that answers from the scripted ship (story.ts)
// instead of a deployment, so the real Game, phone, helm and HUD run on it.
//
// Time comes from the film: update(storySeconds) once a frame.

export class FilmBackend extends FakeConvexClient {
  readonly epoch: number;
  private s = 0;
  private state: ShipState;
  /** Tasks the captain has opened (their packages leave the counter). */
  readonly seen = new Set<string>();
  /** Every mutation the interface sent, for the film's log. */
  readonly sent: { name: string; args: Args; s: number }[] = [];

  constructor(epoch: number, s: number) {
    super();
    this.epoch = epoch;
    this.s = s;
    this.state = shipAt(epoch, s, this.seen);
  }

  /** Story time now (seconds). */
  get story() { return this.s; }
  get ship() { return this.state; }

  /** Moves the ship to story second s; tells the hooks if any answer changed. */
  update(s: number) {
    this.s = s;
    this.state = shipAt(this.epoch, s, this.seen);
    this.refresh();
  }

  protected answer(name: string, args: Args): unknown {
    const st = this.state, s = this.s;
    switch (name) {
      case "world:snapshot": return st.snapshot;
      case "threads:list": return st.threads;
      case "threads:get": return st.threads.find((t) => t._id === args["threadId"]) ?? null;
      case "messages:list": return st.messages.get(String(args["threadId"])) ?? [];
      case "tasks:list": return st.tasks.get(String(args["threadId"])) ?? [];
      case "diffs:deliveries": return st.deliveries;
      case "diffs:get": return diffAt(this.epoch, s, String(args["threadId"]).replace(/^thread_/, ""), args["taskId"] ? String(args["taskId"]).replace(/^task_/, "") : null);
      case "diffs:editorRequest": return { doneAt: at(this.epoch, s), ok: true, result: "Opened in Cursor" };
      case "runs:events": return eventsAt(this.epoch, s, String(args["runId"]));
      case "users:me": return st.me;
      case "offices:get": return st.office;
      case "offices:mine": return [{ ...st.office, repoCount: st.office.repos.length }];
      case "machines:mine": return st.machines;
      case "machines:pending": return null;
      case "crew:list": return st.snapshot.crew;
      case "repos:list": return st.office.repos;
      default:
        console.warn(`[film] no scripted answer for ${name}`);
        return null;
    }
  }

  protected run(name: string, args: Args): unknown {
    this.sent.push({ name, args, s: this.s });
    switch (name) {
      // The story already has the thread the captain is about to start.
      case "threads:create": return "thread_dark";
      case "diffs:seen": {
        if (args["taskId"]) this.seen.add(String(args["taskId"]).replace(/^task_/, ""));
        this.update(this.s);
        return null;
      }
      case "diffs:openEditor": return "editor_1";
      default: return null;
    }
  }

  override get url() { return "film://ship"; }

  static readonly office = OFFICE;
}
