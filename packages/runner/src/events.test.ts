import { expect, it, vi } from "vitest";
import type { RunEvent } from "@offsite/contracts";
import { EventSink } from "./events.ts";

it("joins the deltas of one window, keeps order, and sends at most 200 events a call", async () => {
  const sent: RunEvent[][] = [];
  const sink = new EventSink(async (e) => { sent.push(e); });
  sink.push({ type: "turn.started", turnId: "t1" });
  for (const d of ["Hel", "lo", ", wor", "ld"]) sink.push({ type: "content.delta", delta: d });
  sink.push({ type: "item.started", itemId: "i", kind: "read", summary: "Read a" });
  sink.push({ type: "content.delta", delta: "!" });
  for (let i = 0; i < 250; i++) sink.push({ type: "status", message: `s${i}`, until: null });
  await sink.flush();
  expect(sent.map((b) => b.length)).toEqual([200, 54]);
  expect(sent[0]!.slice(0, 4)).toEqual([
    { type: "turn.started", turnId: "t1" },
    { type: "content.delta", delta: "Hello, world" },
    { type: "item.started", itemId: "i", kind: "read", summary: "Read a" },
    { type: "content.delta", delta: "!" },
  ]);
});

it("flushes on its own after the window", async () => {
  const send = vi.fn(async () => {});
  const sink = new EventSink(send, { windowMs: 10 });
  sink.push({ type: "content.delta", delta: "a" });
  sink.push({ type: "content.delta", delta: "b" });
  await vi.waitFor(() => expect(send).toHaveBeenCalledWith([{ type: "content.delta", delta: "ab" }]));
});

it("retries a failed write, then drops it without stopping later ones", async () => {
  let calls = 0;
  const logs: string[] = [];
  const sink = new EventSink(async (e) => { calls += 1; if (e[0]!.type === "status") throw new Error("offline"); }, { retryMs: [1, 1], log: (m) => logs.push(m) });
  sink.push({ type: "status", message: "x", until: null });
  await sink.flush();
  sink.push({ type: "turn.started", turnId: "t" });
  await sink.flush();
  expect(calls).toBe(4);
  expect(logs).toEqual(["dropped 1 event(s): offline"]);
});
