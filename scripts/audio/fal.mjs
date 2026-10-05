// A small client for fal.ai's queue REST API, for generating Offsite's sounds and music from a
// script on your own machine. Never imported by the app: the key stays in Node.
//
// The key is FAL_KEY, from the environment or the repo root's .env.local (git-ignored). It is
// never printed, logged or written anywhere.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");

let cached = null;
function falKey() {
  if (cached) return cached;
  let key = process.env.FAL_KEY ?? "";
  if (!key) {
    try {
      const env = readFileSync(resolve(REPO, ".env.local"), "utf8");
      const m = env.match(/^\s*FAL_KEY\s*=\s*(.*)\s*$/m);
      if (m) key = m[1].trim().replace(/^["']|["']$/g, "");
    } catch { /* no .env.local */ }
  }
  if (!key) throw new Error("No FAL_KEY: set it in the environment or in .env.local at the repo root");
  cached = key;
  return key;
}

const auth = () => ({ Authorization: `Key ${falKey()}` });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Live unit prices for endpoints: { [endpointId]: { unit_price, unit } }. */
export async function prices(endpointIds) {
  const qs = endpointIds.map((i) => `endpoint_id=${encodeURIComponent(i)}`).join("&");
  const r = await fetch(`https://api.fal.ai/v1/models/pricing?${qs}`, { headers: auth() });
  if (!r.ok) throw new Error(`pricing: HTTP ${r.status}`);
  const body = await r.json();
  return Object.fromEntries(body.prices.map((p) => [p.endpoint_id, { unit_price: p.unit_price, unit: p.unit }]));
}

/**
 * Submit to the queue, wait for it, return the result JSON. Throws with fal's error body (never
 * the key) when the request fails.
 */
export async function run(endpointId, input, { timeoutMs = 300_000, log = () => {} } = {}) {
  const submit = await fetch(`https://queue.fal.run/${endpointId}`, {
    method: "POST",
    headers: { ...auth(), "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!submit.ok) throw new Error(`${endpointId}: submit HTTP ${submit.status}: ${(await submit.text()).slice(0, 600)}`);
  const { request_id, status_url, response_url } = await submit.json();
  log(`queued ${request_id}`);
  const start = Date.now();
  for (;;) {
    await sleep(1500);
    const s = await fetch(status_url, { headers: auth() });
    if (!s.ok) throw new Error(`${endpointId}: status HTTP ${s.status}: ${(await s.text()).slice(0, 300)}`);
    const st = await s.json();
    if (st.status === "COMPLETED") break;
    if (Date.now() - start > timeoutMs) throw new Error(`${endpointId}: timed out (${request_id})`);
  }
  const res = await fetch(response_url, { headers: auth() });
  const text = await res.text();
  if (!res.ok) throw new Error(`${endpointId}: result HTTP ${res.status}: ${text.slice(0, 600)}`);
  return { requestId: request_id, result: JSON.parse(text) };
}

/** The first audio file URL in a result, whichever shape the model returns. */
export function audioUrl(result) {
  const a = result.audio ?? result.audio_file ?? result.output ?? result;
  if (typeof a === "string") return a;
  if (a && typeof a.url === "string") return a.url;
  throw new Error(`no audio url in result: ${JSON.stringify(result).slice(0, 300)}`);
}

/** Download a file fal returned (its media URLs need no key). */
export async function download(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download HTTP ${r.status}`);
  return { bytes: Buffer.from(await r.arrayBuffer()), contentType: r.headers.get("content-type") ?? "" };
}
