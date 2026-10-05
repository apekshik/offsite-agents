// Adapted from Beam (github.com/SupraluminalIntelligence/beam, MIT).
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { z } from "zod";

import { cliInvocation } from "../path.ts";

// zod 4: a z.unknown() key must be marked optional to be allowed missing; responses carry result or error, never both.
const Frame = z.object({ id: z.union([z.number(), z.string()]).optional(), method: z.string().optional(), params: z.unknown().optional(), result: z.unknown().optional(), error: z.object({ message: z.string() }).passthrough().optional() });

/** Minimal JSON-RPC over newline-delimited JSON on a child's stdio. Enough for the app-server. */
export class JsonRpcChild {
  private next = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private closed: Error | null = null;
  readonly notifications: ((method: string, params: unknown) => void)[] = [];
  readonly requests: ((id: number | string, method: string, params: unknown) => void)[] = [];
  readonly child: ChildProcess;
  readonly exited: Promise<number | null>;

  constructor(bin: string, args: string[], env: NodeJS.ProcessEnv, cwd?: string) {
    const command = cliInvocation(bin, args, env);
    this.child = spawn(command.bin, command.args, { env: command.env, cwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    this.exited = new Promise((res) => {
      this.child.once("error", (error) => { this.fail(error); res(null); });
      this.child.once("exit", (code) => { this.fail(new Error(`Codex process exited (${code})`)); res(code); });
    });
    // Drain stderr: otherwise a verbose app-server can fill the pipe and stall.
    this.child.stderr!.resume();
    this.child.stdin!.on("error", (error) => this.fail(error));
    const rl = createInterface({ input: this.child.stdout! });
    rl.on("line", (line) => {
      let msg: z.infer<typeof Frame>;
      try { msg = Frame.parse(JSON.parse(line)); } catch { return; }
      if (msg.id !== undefined && !msg.method) {
        const p = this.pending.get(Number(msg.id));
        if (!p) return;
        this.pending.delete(Number(msg.id));
        clearTimeout(p.timer);
        if (msg.error) p.reject(new Error(msg.error.message ?? JSON.stringify(msg.error)));
        else p.resolve(msg.result);
      } else if (msg.method && msg.id !== undefined) {
        for (const h of this.requests) h(msg.id, msg.method, msg.params);
      } else if (msg.method) {
        for (const h of this.notifications) h(msg.method, msg.params);
      }
    });
  }
  private fail(error: Error) {
    this.closed = error;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
    this.pending.clear();
  }
  private write(frame: unknown) {
    if (this.closed) throw this.closed;
    this.child.stdin!.write(JSON.stringify(frame) + "\n");
  }
  request<T = unknown>(method: string, params: unknown = {}, timeoutMs = 30_000): Promise<T> {
    if (this.closed) return Promise.reject(this.closed);
    const id = this.next++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out after ${timeoutMs}ms`)); }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      try { this.write({ id, method, params }); } catch (e) { clearTimeout(timer); this.pending.delete(id); reject(e); }
    });
  }
  notify(method: string, params: unknown = {}) { this.write({ method, params }); }
  respond(id: number | string, result: unknown) { this.write({ id, result }); }
  reject(id: number | string, message: string, code = -32601) { this.write({ id, error: { code, message } }); }
  kill() {
    this.fail(new Error("Codex session closed"));
    try { this.child.kill(); } catch {}
    const timer = setTimeout(() => { try { this.child.kill("SIGKILL"); } catch {} }, 2000);
    timer.unref();
    void this.exited.then(() => clearTimeout(timer));
  }
}
