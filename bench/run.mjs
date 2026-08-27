#!/usr/bin/env node
/**
 * Measures a deployed ErrorLens instance and writes bench/results.json.
 *
 * Everything reported in the docs comes out of this file. If a number is not
 * in results.json, it does not go in the README -- the previous version of this
 * project shipped a benchmark table with no harness behind it, and that is a
 * worse look than having no numbers at all.
 *
 * Usage:
 *   ERRORLENS_URL=https://your-worker.workers.dev node bench/run.mjs
 *
 * The public instance is rate limited to 5 requests/minute, so this paces
 * itself. A full run over 12 queries takes roughly five minutes.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const BASE = process.env.ERRORLENS_URL?.replace(/\/$/, '');
if (!BASE) {
  console.error('Set ERRORLENS_URL to the deployed origin, e.g.');
  console.error('  ERRORLENS_URL=https://errorlens-rag.workers.dev node bench/run.mjs');
  process.exit(1);
}

const PACE_MS = Number.parseInt(process.env.BENCH_PACE_MS ?? '13000', 10);
const queries = JSON.parse(readFileSync(new URL('./queries.json', import.meta.url), 'utf8'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return null;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};

async function ask(query) {
  const started = performance.now();
  const res = await fetch(`${BASE}/api/troubleshoot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const wallMs = Math.round(performance.now() - started);
  const body = await res.json().catch(() => ({}));

  if (res.status === 429) {
    return { rateLimited: true, wallMs, retryAfter: Number(res.headers.get('Retry-After') ?? 60) };
  }

  return {
    rateLimited: false,
    status: res.status,
    wallMs,
    serverMs: body?.meta?.duration_ms ?? null,
    cache: res.headers.get('X-Cache'),
    model: body?.meta?.model ?? null,
    strategy: body?.meta?.search_strategy ?? null,
    matched: body?.matched_runbook?.slug ?? null,
    grounded: body?.grounded ?? null,
  };
}

async function askWithBackoff(query) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const result = await ask(query);
    if (!result.rateLimited) return result;
    const wait = (result.retryAfter + 2) * 1000;
    console.log(`    rate limited, waiting ${Math.round(wait / 1000)}s`);
    await sleep(wait);
  }
  throw new Error(`Still rate limited after 4 attempts on: ${query}`);
}

const rows = [];
let hits = 0;

console.log(`Benchmarking ${BASE}`);
console.log(`${queries.length} queries, cold then warm, paced at ${PACE_MS}ms\n`);

for (const [i, { query, expect_slug }] of queries.entries()) {
  process.stdout.write(`[${i + 1}/${queries.length}] ${query.slice(0, 52).padEnd(52)}`);

  const cold = await askWithBackoff(query);
  await sleep(PACE_MS);
  const warm = await askWithBackoff(query);
  await sleep(PACE_MS);

  const hit = cold.matched === expect_slug;
  if (hit) hits++;

  rows.push({ query, expect_slug, hit, cold, warm });
  console.log(
    ` ${hit ? 'hit ' : 'MISS'}  cold=${String(cold.wallMs).padStart(5)}ms  warm=${String(warm.wallMs).padStart(5)}ms  ${warm.cache ?? '-'}`
  );
}

const coldTimes = rows.map((r) => r.cold.wallMs);
const warmTimes = rows.map((r) => r.warm.wallMs);
const warmCached = rows.filter((r) => r.warm.cache === 'HIT').length;

const results = {
  measured_at: new Date().toISOString(),
  origin: BASE,
  client_location: process.env.BENCH_LOCATION ?? 'unspecified',
  note: 'Wall-clock times from a single client, so they include client network latency. Not a comparison against any other product.',
  queries: queries.length,
  retrieval: {
    top1_hits: hits,
    top1_total: queries.length,
    top1_pct: Math.round((hits / queries.length) * 100),
  },
  latency_ms: {
    cold_median: median(coldTimes),
    cold_min: Math.min(...coldTimes),
    cold_max: Math.max(...coldTimes),
    warm_median: median(warmTimes),
    warm_cache_hits: warmCached,
  },
  rows,
};

writeFileSync(new URL('./results.json', import.meta.url), JSON.stringify(results, null, 2));

console.log(`\nTop-1 retrieval  ${hits}/${queries.length} (${results.retrieval.top1_pct}%)`);
console.log(`Cold median      ${results.latency_ms.cold_median} ms`);
console.log(
  `Warm median      ${results.latency_ms.warm_median} ms (${warmCached} served from cache)`
);
console.log('\nWrote bench/results.json');
console.log(
  'Note: Top-1 over a small corpus is a regression guard, not an accuracy claim. ' +
    'It saturates trivially and should be read alongside the corpus size.'
);
