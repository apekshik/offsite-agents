// Adapted from Beam (github.com/SupraluminalIntelligence/beam, MIT).
import { afterEach, expect, it } from "vitest";
import { JsonRpcChild } from "./rpc.ts";

const children: JsonRpcChild[] = [];
afterEach(() => { for (const child of children.splice(0)) child.kill(); });
function child(script: string) {
  const rpc = new JsonRpcChild(process.execPath, ["-e", script], process.env);
  children.push(rpc); return rpc;
}

it("drains stderr, ignores noise and correlates responses", async () => {
  const rpc = child(`
    process.stderr.write('x'.repeat(1024 * 1024));
    const rl = require('node:readline').createInterface({input:process.stdin});
    rl.on('line', line => { const m = JSON.parse(line); console.log('noise'); console.log(JSON.stringify({id:m.id,result:m.params})); });
  `);
  expect(await Promise.all([rpc.request("a", { n: 1 }), rpc.request("b", { n: 2 })])).toEqual([{ n: 1 }, { n: 2 }]);
});

it("rejects pending and future calls after spawn failure", async () => {
  const rpc = new JsonRpcChild("/nonexistent/offsite-codex", [], process.env);
  children.push(rpc);
  await expect(rpc.request("initialize")).rejects.toThrow();
  await expect(rpc.request("initialize")).rejects.toThrow();
  await expect(rpc.exited).resolves.toBeNull();
});

it("times out a hung request and rejects pending calls when stopped", async () => {
  const rpc = child("process.stdin.resume()");
  await expect(rpc.request("hung", {}, 20)).rejects.toThrow("hung timed out");
  const pending = rpc.request("pending");
  rpc.kill();
  await expect(pending).rejects.toThrow("session closed");
});
