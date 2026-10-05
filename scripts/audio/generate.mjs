// Generate Offsite's sounds and music on fal.ai (scripts/audio/jobs.mjs), each once.
//
//   node scripts/audio/generate.mjs              everything not yet in the cache
//   node scripts/audio/generate.mjs gull-1 typing only these (still skipping cached ones)
//   node scripts/audio/generate.mjs --redo gull-1  generate again (it costs again)
//   node scripts/audio/generate.mjs --dry        list what would run and what it would cost
//
// Results land in scripts/audio/.cache (git-ignored): <id>.wav and <id>.json (model, input,
// request id, estimated cost), and spend.jsonl, one line per paid call. Then run
// scripts/audio/build.mjs. Needs FAL_KEY (see fal.mjs).

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { REPO, run, audioUrl, download } from "./fal.mjs";
import { ALL, estimate } from "./jobs.mjs";

const CACHE = resolve(REPO, "scripts/audio/.cache");
mkdirSync(CACHE, { recursive: true });

const args = process.argv.slice(2);
const redo = args.includes("--redo");
const dry = args.includes("--dry");
const only = args.filter((a) => !a.startsWith("--"));
const unknown = only.filter((id) => !ALL.some((j) => j.id === id));
if (unknown.length) { console.error(`unknown ids: ${unknown.join(", ")}`); process.exit(1); }

const cached = (id) => existsSync(resolve(CACHE, `${id}.json`));
const todo = ALL.filter((j) => (only.length === 0 || only.includes(j.id)) && (redo || !cached(j.id)));
const planned = todo.reduce((n, j) => n + estimate(j, 0), 0);
console.log(`${todo.length} to generate, about $${planned.toFixed(3)}`);
if (dry) { for (const j of todo) console.log(`  ${j.id.padEnd(26)} ${j.endpoint.padEnd(38)} $${estimate(j, 0).toFixed(3)}`); process.exit(0); }

const ext = (contentType, url) => {
  if (/wav|l16|pcm/i.test(contentType) || /\.wav$/i.test(url)) return "wav";
  if (/mpeg|mp3/i.test(contentType) || /\.mp3$/i.test(url)) return "mp3";
  if (/ogg|opus/i.test(contentType)) return "ogg";
  return "bin";
};

let spent = 0;
const failures = [];
async function one(job) {
  const t0 = Date.now();
  try {
    const { requestId, result } = await run(job.endpoint, job.input);
    const url = audioUrl(result);
    const { bytes, contentType } = await download(url);
    const e = ext(result.audio?.content_type ?? contentType, url);
    // A previous take with another extension would confuse build.mjs.
    for (const f of readdirSync(CACHE)) if (f.startsWith(`${job.id}.`) && f !== `${job.id}.json`) unlinkSync(resolve(CACHE, f));
    writeFileSync(resolve(CACHE, `${job.id}.${e}`), bytes);
    const cost = estimate(job, 0);
    spent += cost;
    appendFileSync(resolve(CACHE, "spend.jsonl"), JSON.stringify({ id: job.id, endpoint: job.endpoint, requestId, costUsd: cost, at: new Date().toISOString() }) + "\n");
    writeFileSync(resolve(CACHE, `${job.id}.json`), JSON.stringify({
      id: job.id, endpoint: job.endpoint, input: job.input, requestId, file: `${job.id}.${e}`,
      bytes: bytes.length, costUsd: cost, generatedAt: new Date().toISOString(),
    }, null, 2));
    console.log(`ok   ${job.id} (${((Date.now() - t0) / 1000).toFixed(1)}s, ${(bytes.length / 1024).toFixed(0)} KB, ~$${cost.toFixed(3)})`);
  } catch (err) {
    failures.push(job.id);
    console.log(`FAIL ${job.id}: ${String(err.message ?? err).slice(0, 400)}`);
  }
}

// A few at a time: fal queues them, and this keeps the output readable.
const queue = [...todo];
await Promise.all(Array.from({ length: 4 }, async () => { for (let j; (j = queue.shift()); ) await one(j); }));

// Every paid call so far, retakes included.
const log = existsSync(resolve(CACHE, "spend.jsonl")) ? readFileSync(resolve(CACHE, "spend.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const total = log.reduce((n, m) => n + (m.costUsd ?? 0), 0);
console.log(`this run ~$${spent.toFixed(3)}; all calls so far (${log.length}) ~$${total.toFixed(3)}${failures.length ? `; failed: ${failures.join(", ")}` : ""}`);
if (failures.length) process.exit(1);
