# ErrorLens Public-Release Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take ErrorLens from "looks finished, isn't" to a repository that survives a senior engineer opening it from a LinkedIn post — every claim true, every documented command working, the flagship hybrid-RAG feature actually functioning, and a green CI badge.

**Architecture:** Nine phases ordered by blast radius. Phase 0 makes the repo real (git, lockfile, working scripts, green CI). Phases 1–2 fix the two claims that are currently false in a way a reviewer will notice within 60 seconds. Phases 3–5 fix correctness and free-tier survivability. Phases 6–9 add the engineering-quality signals a portfolio repo is actually judged on.

**Tech Stack:** Cloudflare Workers (D1 + FTS5, Vectorize, Workers AI, Workers Static Assets), Google AI Studio Gemini, Preact 10 + Vite 6, TypeScript 5.7, Vitest + `@cloudflare/vitest-pool-workers`.

**Spec:** This plan is its own spec — it is derived from the 2026-08-26 code review of `errorlens/`. Every task below cites the finding it closes.

## Global Constraints

- **Node 20+** — CI pins `node-version: 20`. Do not use APIs newer than Node 20.
- **No new runtime dependencies in `worker/`** without justification. `worker/package.json` currently has `"dependencies": {}` and that is a genuine selling point — keep it. Validation must be hand-rolled or use a dependency small enough to justify in the README.
- **Every claim in `README.md` and `docs/` must be verifiable from the repo.** If a number cannot be reproduced by running a committed script, it does not go in a document.
- **Free-tier ceilings are hard constraints** (verified against Cloudflare docs 2026-08-26):
  - Workers: 100,000 req/day, 10 ms CPU per invocation
  - Workers KV: 100,000 reads/day, **1,000 writes/day**, 1 GB
  - D1: 5,000,000 rows read/day, 100,000 rows written/day, 5 GB
  - Vectorize: 30,000,000 queried vector dimensions/month, 5,000,000 stored
  - Workers AI: 10,000 Neurons/day (bge-small = 1,841 neurons/M input tokens; llama-3.1-8b = 25,608/M in + 75,147/M out)
  - Google AI Studio Gemini Flash-Lite free tier: 15 RPM / **1,000 RPD** / 250,000 TPM
- **Commit after every task.** Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`).

---

## File Structure

**New files:**

| Path | Responsibility |
| :--- | :--- |
| `package-lock.json` | Reproducible installs; required by `npm ci` in CI |
| `worker/.dev.vars.example` | Documented local secret template |
| `worker/src/core/schema.ts` | Runtime validation of LLM JSON output (no dependency) |
| `worker/src/core/embeddings.ts` | Shared `embedText()` used by query path and ingestion |
| `worker/src/storage/vectorize.ts` | `upsertRunbookVectors()` — the missing write path |
| `worker/src/admin/reindex.ts` | Token-protected `POST /api/admin/reindex` that populates Vectorize |
| `worker/src/index.test.ts` | Router, validation, CORS, 404 tests |
| `worker/src/core/rag.test.ts` | RRF fusion + FTS sanitizer tests |
| `worker/src/core/cache.test.ts` | Normalization + hashing + no-cache-on-degraded tests |
| `worker/src/core/schema.test.ts` | LLM output validation tests |
| `worker/src/storage/rate-limit.test.ts` | Minute + daily limit tests, both KV and D1 paths |
| `worker/vitest.config.ts` | Workers-pool test runner config |
| `worker/migrations/0003_cleanup_and_indexes.sql` | TTL purge support + missing index |
| `datasets/scripts/lib/parse-runbook.js` | Extracted, testable markdown→runbook parser |
| `datasets/scripts/validate.js` | CI gate: schema + required fields + slug uniqueness |
| `datasets/scripts/build-migration.js` | Closes the contribution loop: runbooks → real migration |
| `datasets/schema.json` | The contract a contributed runbook must satisfy |
| `bench/latency.mjs` | Real, reproducible latency measurement |
| `bench/retrieval.mjs` | Real, reproducible Top-1/Top-3 retrieval scoring |
| `bench/queries.json` | The evaluation query set, committed |
| `frontend/src/api.ts` | Typed API client; single fetch surface |
| `frontend/src/types.ts` | Re-export of shared response types |
| `frontend/src/components/` | `SearchBar.tsx`, `ResultCard.tsx`, `TriageStep.tsx`, `TelemetryBar.tsx` |
| `shared/types.ts` | Single source of truth for `TroubleshootResponse` |
| `.github/ISSUE_TEMPLATE/runbook.yml` | Structured runbook contribution issue |
| `.github/ISSUE_TEMPLATE/bug.yml` | Bug report |
| `.github/pull_request_template.md` | PR checklist |
| `.github/dependabot.yml` | Weekly npm updates |
| `SECURITY.md` | Vulnerability disclosure |
| `CODE_OF_CONDUCT.md` | Contributor Covenant |
| `.editorconfig`, `eslint.config.js`, `.prettierrc` | Formatting + lint |
| `docs/COST-MODEL.md` | Honest capacity ceiling analysis (replaces cost hand-waving) |

**Heavily modified:**

| Path | Change |
| :--- | :--- |
| `README.md` | Remove false claims, fix demo link, add screenshot, add honest limits |
| `docs/BENCHMARKS.md` | Replace invented numbers with harness output |
| `docs/ARCHITECTURE.md` | Fix "sliding window", "zero 500s", GDPR overclaim |
| `CONTRIBUTING.md` | Fix broken code fences; document the now-working loop |
| `worker/src/storage/rate-limit.ts` | Daily limit in D1 path; atomic counters; secret salt |
| `worker/src/core/ai.ts` | Header auth, timeouts, `responseSchema`, output validation |
| `worker/src/core/cache.ts` | Do not cache degraded answers |
| `worker/src/index.ts` | Input validation, no error leakage, JSON 404 for `/api/*` |
| `frontend/src/App.tsx` | Decompose; validate hrefs; a11y; responsive |
| `frontend/index.html` | OpenGraph + Twitter card meta |
| `frontend/src/index.css` | Media queries, focus rings, reduced motion |
| `worker/migrations/0002_seed_devops_runbooks.sql` | Fix the Error 1101/1102 factual error |
| `.github/workflows/ci.yml` | Add lint, test, dataset validation, bundle-size gate |

---

# PHASE 0 — Make the repository real

*Closes: no git repo, no lockfile, CI red on first push, all three root npm scripts failing.*

### Task 0.1: Initialize git and generate the lockfile

**Files:**
- Create: `package-lock.json`
- Create: `.git/`

**Interfaces:**
- Produces: a committed lockfile that `npm ci` can consume in every later task and in CI.

- [ ] **Step 1: Confirm the current failure**

```bash
cd errorlens
npm ci
```
Expected: FAIL — `npm error ... The `npm ci` command can only install with an existing package-lock.json`. This is the reason the CI badge would be red on the first push.

- [ ] **Step 2: Generate the lockfile**

```bash
npm install
```
Expected: `package-lock.json` created at the repo root covering both workspaces.

- [ ] **Step 3: Verify `npm ci` now works from clean**

```bash
rm -rf node_modules worker/node_modules frontend/node_modules
npm ci
```
Expected: exit 0.

- [ ] **Step 4: Initialize the repository**

```bash
git init -b main
git add -A
git commit -m "chore: initial commit — ErrorLens edge RAG troubleshooting engine"
```

### Task 0.2: Make every documented npm script work

**Files:**
- Modify: `package.json`
- Modify: `worker/package.json`
- Modify: `frontend/package.json`

**Interfaces:**
- Produces: `npm run typecheck`, `npm run build`, `npm test`, `npm run lint` all exit 0 from the repo root. CI and README both depend on these.

- [ ] **Step 1: Confirm the current failures**

```bash
npm run typecheck; echo "typecheck=$?"
npm run build;     echo "build=$?"
npm test;          echo "test=$?"
```
Expected: all three print `=1`. (`frontend` has no `typecheck` script; `worker` has no `build` or `test` script.)

- [ ] **Step 2: Add the missing workspace scripts**

In `frontend/package.json`, add to `scripts`:
```json
"typecheck": "tsc --noEmit"
```

In `worker/package.json`, replace `scripts` with:
```json
"scripts": {
  "dev": "wrangler dev",
  "deploy": "wrangler deploy",
  "build": "tsc --noEmit",
  "typecheck": "tsc --noEmit",
  "test": "vitest run"
}
```

- [ ] **Step 3: Make the root scripts honest**

In `package.json`, replace `scripts` with:
```json
"scripts": {
  "dev": "npm run dev --workspace=worker",
  "dev:frontend": "npm run dev --workspace=frontend",
  "build": "npm run build --workspace=frontend",
  "typecheck": "npm run typecheck --workspaces",
  "test": "npm run test --workspace=worker",
  "lint": "eslint .",
  "format": "prettier --write .",
  "validate:runbooks": "node datasets/scripts/validate.js",
  "bench": "node bench/latency.mjs && node bench/retrieval.mjs"
}
```

Also add:
```json
"engines": { "node": ">=20" }
```

- [ ] **Step 4: Verify**

```bash
npm run typecheck; echo "typecheck=$?"
npm run build;     echo "build=$?"
```
Expected: both `=0`. (`npm test` stays red until Task 6.1 adds the runner — that is expected and is the next task's job.)

- [ ] **Step 5: Commit**

```bash
git add package.json worker/package.json frontend/package.json
git commit -m "fix: make root build/typecheck scripts actually run"
```

### Task 0.3: Replace the placeholder Cloudflare resource IDs

**Files:**
- Modify: `worker/wrangler.jsonc`
- Create: `worker/.dev.vars.example`

**Interfaces:**
- Produces: a `wrangler.jsonc` whose IDs are either real or explicitly marked as needing replacement, and a documented secret template.

- [ ] **Step 1: Note the current state**

`worker/wrangler.jsonc` contains `"database_id": "errorlens-db-placeholder"` and KV `"id": "errorlens-kv-placeholder"`. Neither is a valid Cloudflare resource ID, so `wrangler deploy` fails and the README's deploy section cannot work as written.

- [ ] **Step 2: Create the real resources and capture the IDs**

```bash
cd worker
npx wrangler d1 create errorlens-db
npx wrangler kv namespace create errorlens-cache
npx wrangler vectorize create errorlens-vectors --dimensions=384 --metric=cosine
```
Copy the printed `database_id` and KV `id` into `wrangler.jsonc`, replacing the placeholders.

- [ ] **Step 3: Bump the compatibility date**

In `worker/wrangler.jsonc` change:
```jsonc
"compatibility_date": "2025-02-24",
```
to:
```jsonc
"compatibility_date": "2026-08-01",
```

- [ ] **Step 4: Add the secrets template**

Create `worker/.dev.vars.example`:
```ini
# Copy to worker/.dev.vars and fill in. .dev.vars is gitignored.

# Google AI Studio key — free at https://aistudio.google.com/apikey
GEMINI_API_KEY=AIzaSy...

# Random string used to salt hashed client IPs before storing rate-limit
# counters. Generate with: openssl rand -hex 32
RATE_LIMIT_SALT=

# Bearer token protecting POST /api/admin/reindex.
# Generate with: openssl rand -hex 32
ADMIN_TOKEN=
```

- [ ] **Step 5: Verify the deploy path**

```bash
cd worker && npx wrangler deploy --dry-run
```
Expected: exit 0, no "invalid database_id" error.

- [ ] **Step 6: Commit**

```bash
git add worker/wrangler.jsonc worker/.dev.vars.example
git commit -m "fix: use real Cloudflare resource IDs; add .dev.vars.example"
```

### Task 0.4: Make CI reflect the real quality gates

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: the working root scripts from Task 0.2.
- Produces: a CI run that gates on install, lint, typecheck, test, dataset validation, and build.

- [ ] **Step 1: Replace the workflow**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

permissions:
  contents: read

jobs:
  verify:
    name: Lint, Typecheck, Test, Build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'

      - name: Install
        run: npm ci

      - name: Lint
        run: npm run lint

      - name: Typecheck
        run: npm run typecheck

      - name: Test
        run: npm test

      - name: Validate runbook dataset
        run: npm run validate:runbooks

      - name: Build frontend
        run: npm run build

      - name: Check bundle budget
        run: |
          JS=$(stat -c%s frontend/dist/assets/*.js)
          echo "JS bundle: ${JS} bytes"
          if [ "$JS" -gt 30000 ]; then
            echo "::error::JS bundle ${JS}B exceeds the 30000B budget claimed in README"
            exit 1
          fi
```

- [ ] **Step 2: Verify locally before pushing**

```bash
npm ci && npm run lint && npm run typecheck && npm test && npm run validate:runbooks && npm run build
echo "all gates=$?"
```
Expected: `=0`. (Run this after Phases 3 and 6 land the scripts it calls.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: gate on lint, test, dataset validation and bundle budget"
```

---

# PHASE 1 — Remove every false claim

*Closes: demo link points at a stranger's app; invented benchmarks; Tailwind; "sliding window"; "zero 500 errors"; GDPR overclaim; wrong Gemini RPD; stale model.*

### Task 1.1: Fix the demo link — highest-priority single fix

**Files:**
- Modify: `README.md:17`

**Context:** `https://errorlens.pages.dev` returns HTTP 200 and serves **someone else's project** — "ErrorLens: Your personalized homework helper", a React/Tailwind homework-feedback app. Verify yourself:

```bash
curl -s https://errorlens.pages.dev | grep -i "<title>"
```
Expected: `<title>ErrorLens: Your personalized homework helper</title>`

The README's most prominent call-to-action currently sends every visitor there. The `errorlens` subdomain is taken.

- [ ] **Step 1: Pick an available name and deploy**

```bash
cd worker
# wrangler.jsonc "name" controls the *.workers.dev subdomain
npm run build --workspace=frontend
npx wrangler deploy
```
Suggested names (check availability): `errorlens-dev`, `errorlens-rag`, `errlens`, `runbook-lens`. Use Workers Static Assets (already configured) so the SPA and API ship as one deploy — do not use Pages, which the architecture diagram wrongly implies.

- [ ] **Step 2: Verify the deployed URL is yours**

```bash
curl -s https://<your-worker>.workers.dev/api/health | head -20
```
Expected: JSON containing `"service":"ErrorLens Edge RAG"` and a `bindings` object with `d1`, `vectorize`, `workers_ai`, `kv`, `gemini` all `true`.

- [ ] **Step 3: Update the README link and the architecture diagram**

In `README.md:17` replace `https://errorlens.pages.dev` with the verified URL. In `README.md:58` replace `Cloudflare Pages / Worker Assets` with `Cloudflare Workers Static Assets` and on line 59 replace `Preact 10 + Tailwind CSS (< 20KB JS)` with `Preact 10 + hand-rolled CSS (18.9 KB JS / 7.8 KB gzip)` — Tailwind is not used anywhere in this repo.

- [ ] **Step 4: Verify no stale link remains**

```bash
grep -rn "errorlens.pages.dev\|Tailwind" README.md docs/ CONTRIBUTING.md
```
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "fix(docs): point demo link at the real deployment, drop Tailwind claim"
```

### Task 1.2: Replace invented benchmarks with a real harness

**Files:**
- Create: `bench/queries.json`
- Create: `bench/latency.mjs`
- Create: `bench/retrieval.mjs`
- Modify: `docs/BENCHMARKS.md`

**Context:** `docs/BENCHMARKS.md` §1 claims latency "conducted from Cloudflare US-East edge nodes" and §2 claims accuracy "tested against 50 real-world developer incident queries" with figures like `0%` hallucination and `100%` verification coverage. There is no harness, no query set, no results file, and the project has never been deployed. §3's bundle numbers *are* real and should be kept.

**Interfaces:**
- Produces: `npm run bench` writing `bench/results.json`, consumed by `docs/BENCHMARKS.md`.

- [ ] **Step 1: Commit the query set**

Create `bench/queries.json` with at minimum one entry per seeded runbook plus paraphrases that do *not* copy the runbook title (a query set written to match its own corpus proves nothing):

```json
[
  { "query": "Docker container exited with code 137", "expect_slug": "docker-exit-code-137-oom" },
  { "query": "my pod keeps restarting over and over", "expect_slug": "k8s-crashloopbackoff" },
  { "query": "webpack build fails digital envelope routines unsupported", "expect_slug": "node-err-ossl-evp-unsupported" },
  { "query": "nginx returns 502 upstream refused", "expect_slug": "nginx-502-bad-gateway" },
  { "query": "disk shows free space but writes fail", "expect_slug": "linux-no-space-inodes" },
  { "query": "postgres will not accept new connections", "expect_slug": "postgres-fatal-remaining-connection-slots" },
  { "query": "worker exceeded cpu time on cloudflare", "expect_slug": "cloudflare-worker-error-1102-cpu" },
  { "query": "kubernetes cannot pull image from registry", "expect_slug": "k8s-imagepullbackoff" }
]
```

- [ ] **Step 2: Write the latency harness**

Create `bench/latency.mjs`:
```js
#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';

const BASE = process.env.ERRORLENS_URL;
if (!BASE) { console.error('Set ERRORLENS_URL to the deployed worker origin'); process.exit(1); }

const queries = JSON.parse(readFileSync(new URL('./queries.json', import.meta.url), 'utf8'));
const rows = [];

for (const { query } of queries) {
  const timings = { cold: null, warm: null };
  for (const pass of ['cold', 'warm']) {
    const t0 = performance.now();
    const res = await fetch(`${BASE}/api/troubleshoot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    const body = await res.json();
    timings[pass] = {
      wall_ms: Math.round(performance.now() - t0),
      server_ms: body?.meta?.duration_ms ?? null,
      cache: res.headers.get('X-Cache-Status'),
      model: body?.meta?.model ?? null,
    };
    await new Promise(r => setTimeout(r, 12_000)); // stay under 5 req/min
  }
  rows.push({ query, ...timings });
  console.log(`${query.slice(0, 44).padEnd(44)} cold=${rows.at(-1).cold.wall_ms}ms warm=${rows.at(-1).warm.wall_ms}ms`);
}

const summary = {
  measured_at: new Date().toISOString(),
  origin: BASE,
  client_location: process.env.BENCH_LOCATION ?? 'unspecified',
  n: rows.length,
  median_cold_ms: median(rows.map(r => r.cold.wall_ms)),
  median_warm_ms: median(rows.map(r => r.warm.wall_ms)),
  rows,
};
writeFileSync(new URL('./results.json', import.meta.url), JSON.stringify(summary, null, 2));
console.log(`\nmedian cold=${summary.median_cold_ms}ms  median warm=${summary.median_warm_ms}ms`);

function median(xs) { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; }
```

- [ ] **Step 3: Write the retrieval harness**

Create `bench/retrieval.mjs` that hits `/api/troubleshoot` and scores whether `matched_runbook.id` resolves to `expect_slug`:
```js
#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const BASE = process.env.ERRORLENS_URL;
if (!BASE) { console.error('Set ERRORLENS_URL'); process.exit(1); }

const queries = JSON.parse(readFileSync(new URL('./queries.json', import.meta.url), 'utf8'));
const catalog = await (await fetch(`${BASE}/api/runbooks?limit=100`)).json();
const idToSlug = new Map(catalog.runbooks.map(r => [r.id, r.slug]));

let top1 = 0;
for (const { query, expect_slug } of queries) {
  const res = await fetch(`${BASE}/api/troubleshoot`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const body = await res.json();
  const got = idToSlug.get(body?.matched_runbook?.id) ?? null;
  const hit = got === expect_slug;
  top1 += hit ? 1 : 0;
  console.log(`${hit ? 'HIT ' : 'MISS'} ${query.slice(0, 44).padEnd(44)} got=${got} want=${expect_slug}`);
  await new Promise(r => setTimeout(r, 12_000));
}
console.log(`\nTop-1 = ${top1}/${queries.length} (${Math.round(100 * top1 / queries.length)}%)`);
```

- [ ] **Step 4: Run both and capture real output**

```bash
ERRORLENS_URL=https://<your-worker>.workers.dev BENCH_LOCATION="Toronto, CA (residential)" npm run bench
```

- [ ] **Step 5: Rewrite `docs/BENCHMARKS.md` from the output**

Delete §1 and §2 entirely. Replace with:
- A **Methodology** section: how many queries, where the client ran, that "cold" means a cache miss and "warm" a cache hit, that these are wall-clock times from a single residential client and therefore include client network latency, and that no comparison against ChatGPT or Gemini web UIs was performed.
- A results table generated from `bench/results.json`, with the file committed alongside so a reader can check it.
- A **Retrieval** section reporting the real Top-1 number over the committed query set, stated against the corpus size: *"Top-1 = N/8 over an 8-runbook corpus. This number is not meaningful at this corpus size; it is a regression guard, not an accuracy claim."*
- Keep §3 (bundle sizes) — those numbers are real. Verify them: `stat -c%s frontend/dist/assets/*` gives 18,902 B JS and 6,414 B CSS; `gzip -c | wc -c` gives 7,761 B and 2,030 B.
- Delete the "Lighthouse Performance Score: 100/100" line unless you commit a Lighthouse JSON report to `bench/`.

- [ ] **Step 6: Verify no unsourced number survives**

```bash
grep -nE "ChatGPT|GPT-4o|Gemini 1\.5|[0-9]+%|1,[0-9]{3} ms" docs/BENCHMARKS.md
```
Expected: every remaining hit traceable to `bench/results.json` or a committed report.

- [ ] **Step 7: Commit**

```bash
git add bench/ docs/BENCHMARKS.md
git commit -m "docs: replace invented benchmarks with a reproducible harness"
```

### Task 1.3: Fix the Error 1101/1102 runbook

**Files:**
- Modify: `worker/migrations/0002_seed_devops_runbooks.sql`
- Create: `worker/migrations/0004_fix_cf_error_code.sql`

**Context:** The seeded runbook `cloudflare-worker-error-1101-cpu` claims Error 1101 is returned "when a Worker exceeds its allocated execution CPU time". Cloudflare's docs — the exact `source_url` the runbook cites — say:
- **1101** = "Worker threw a JavaScript exception."
- **1102** = "Worker exceeded CPU time limit."

It also states the limit is "10ms or 50ms"; the Free plan limit is 10 ms and the Paid plan is not 50 ms. This is the anti-hallucination product shipping a hallucination, on one of the seven demo chips.

- [ ] **Step 1: Verify the upstream facts**

```bash
curl -s https://developers.cloudflare.com/workers/observability/errors/ | grep -oE "Error 110[12][^<]{0,60}"
```

- [ ] **Step 2: Correct the seed for fresh installs**

In `worker/migrations/0002_seed_devops_runbooks.sql`, in the `cloudflare-worker-error-1101-cpu` block:
- `slug`: `'cloudflare-worker-error-1101-cpu'` → `'cloudflare-worker-error-1102-cpu'`
- `error_code`: `'Error 1101'` → `'Error 1102'`
- `title`: → `'Cloudflare Worker Error 1102 (Exceeded CPU Time Limit)'`
- `summary`: → `'Cloudflare returns Error 1102 when a Worker exceeds its CPU time limit. Error 1101 is the separate case where the Worker threw an uncaught JavaScript exception.'`
- `root_cause`: replace `'a 10ms or 50ms synchronous CPU limit'` with `'a 10 ms CPU-time limit per invocation on the Workers Free plan. CPU time counts only active computation, not time awaiting I/O.'`
- `tags`: add `"error 1102"`, keep `"error 1101"` so lexical search still finds it.

- [ ] **Step 3: Add a migration so existing databases are corrected too**

Create `worker/migrations/0004_fix_cf_error_code.sql`:
```sql
-- Error 1101 = "Worker threw a JavaScript exception"
-- Error 1102 = "Worker exceeded CPU time limit"
-- The original seed conflated the two. Source:
-- https://developers.cloudflare.com/workers/observability/errors/
UPDATE runbooks SET
  slug        = 'cloudflare-worker-error-1102-cpu',
  error_code  = 'Error 1102',
  title       = 'Cloudflare Worker Error 1102 (Exceeded CPU Time Limit)',
  summary     = 'Cloudflare returns Error 1102 when a Worker exceeds its CPU time limit. Error 1101 is the separate case where the Worker threw an uncaught JavaScript exception.',
  root_cause  = 'The Workers Free plan enforces a 10 ms CPU-time limit per invocation. CPU time counts only active computation, not time awaiting I/O. Heavy JSON parsing, unoptimised regexes, or large cryptographic loops exceed it.',
  tags        = '["cloudflare", "workers", "error 1102", "error 1101", "cpu limit", "wrangler", "edge", "serverless"]',
  updated_at  = CURRENT_TIMESTAMP
WHERE slug = 'cloudflare-worker-error-1101-cpu';
```

- [ ] **Step 4: Update the demo chip**

In `frontend/src/App.tsx:41`, change `'Cloudflare Worker Error 1101 CPU limit exceeded'` to `'Cloudflare Worker Error 1102 CPU limit exceeded'`.

- [ ] **Step 5: Audit the remaining seven runbooks the same way**

For each seeded runbook, open its `source_url` and confirm the `error_code`, the `root_cause` mechanism, and every flag in `solution_steps` still exists upstream. Record the audit date in a new `verified_at` column (add it in Task 3.3). This is the core value claim of the product — budget real time here.

- [ ] **Step 6: Commit**

```bash
git add worker/migrations frontend/src/App.tsx
git commit -m "fix(data): Error 1102 is the CPU-time error, not 1101"
```

### Task 1.4: Correct the remaining documentation overclaims

**Files:**
- Modify: `README.md`
- Modify: `docs/ARCHITECTURE.md`
- Create: `docs/COST-MODEL.md`

- [ ] **Step 1: Fix "sliding window"**

The limiter is a **fixed-window counter** (`window_minute = floor(now/60)`), not a sliding window. In `README.md:67` and `docs/ARCHITECTURE.md:50` replace "Sliding-Window Rate Limiter" / "Sliding-Window IP Rate Limiter" with "Fixed-Window Rate Limiter". Either rename it or implement a real sliding window — do not keep the mismatch.

- [ ] **Step 2: Fix "Zero 500 errors"**

`docs/ARCHITECTURE.md:69` claims "**Zero 500 errors**: The system always delivers actionable troubleshooting steps to the user." `worker/src/index.ts:144-153` returns 500 when retrieval throws. Replace with: "**Generation never hard-fails**: if every LLM tier is unavailable, Tier 3 synthesises the matched runbook directly. Infrastructure failures (D1 unavailable) still return 500."

- [ ] **Step 3: Fix the GDPR claim**

`docs/ARCHITECTURE.md:51` says IPs are "salted and hashed (preserving GDPR/privacy compliance)". A SHA-256 over the ~2^32 IPv4 space with a salt hardcoded in public source is trivially reversible; this is pseudonymisation, not anonymisation, and remains personal data under GDPR. Replace with: "Client IPs are salted (secret salt) and hashed before storage, and counters expire within 25 hours. This is pseudonymisation, not anonymisation — hashed IPs are still personal data under GDPR." Task 5.4 moves the salt to a secret.

- [ ] **Step 4: Fix the Gemini free-tier row**

`README.md:97` says "15 RPM, 1,500 Requests / Day". The current Flash-Lite free tier is **15 RPM / 1,000 RPD / 250,000 TPM**. Correct the number and add the retrieval date.

- [ ] **Step 5: Write the honest cost model**

Create `docs/COST-MODEL.md` replacing the README's hand-wave with arithmetic. The binding constraint is **not** Workers requests — it is **Workers KV writes: 1,000/day on the free plan**. The current design writes 2 KV keys per allowed request (minute + day counter) plus 1 more on a cache miss, so the real ceiling is **≈500 requests/day**, not the "~10,000 requests/day" the README claims. Show the Neuron arithmetic too: `@cf/meta/llama-3.1-8b-instruct` costs ~25,608 neurons/M input + 75,147/M output; at ~1,650 input and ~600 output tokens per call that is **~87 neurons per fallback request**, so the 10,000 neurons/day budget covers **~115 Tier-2 fallback requests/day**. Embeddings are negligible (~1,841 neurons/M input tokens → ~368 neurons/day at 10k queries).

- [ ] **Step 6: Correct the README cost table**

Change the Workers row's "Project Consumption" from `~10,000 requests / day` to `~500 requests / day (KV-write bound — see docs/COST-MODEL.md)` and add a Workers KV row with the real `1,000 writes / day` allowance. Change the `$0.00 / mo` badge caption from "100% Free Forever" to "$0/mo within documented free-tier ceilings" and link to `docs/COST-MODEL.md`.

- [ ] **Step 7: Verify**

```bash
grep -rn "Sliding-Window\|Zero 500\|GDPR/privacy compliance\|1,500 Requests\|100% Free Forever" README.md docs/
```
Expected: no output.

- [ ] **Step 8: Commit**

```bash
git add README.md docs/
git commit -m "docs: correct rate-limiter, availability, GDPR and free-tier claims"
```

---

# PHASE 2 — Make Hybrid RAG actually hybrid

*Closes: the single biggest technical claim in the repo is non-functional.*

**Context:** `worker/src/core/rag.ts` queries `env.VECTOR_INDEX` but **nothing anywhere writes to it**. Verify:

```bash
grep -rn "upsert" worker/src datasets/ ; echo "matches=$?"
```
Expected: no matches. The index is permanently empty, so `matches.matches.length > 0` is never true, `vectorEnabled` is never `true`, and `meta.search_strategy` is always `'fts'`. The README title, the Vectorize badge, the architecture diagram and `docs/ARCHITECTURE.md §1` all describe a dual-engine system; half of it has never run. Every query still pays a wasted BGE embedding call plus a Vectorize round-trip that returns nothing.

### Task 2.1: Extract a shared embedding helper

**Files:**
- Create: `worker/src/core/embeddings.ts`
- Modify: `worker/src/core/rag.ts:24-36`
- Test: `worker/src/core/embeddings.test.ts`

**Interfaces:**
- Produces: `embedText(env: Env, text: string): Promise<number[] | null>` and `runbookEmbeddingText(r: ParsedRunbook): string`, both consumed by Task 2.2 and Task 2.3.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { runbookEmbeddingText } from './embeddings';

describe('runbookEmbeddingText', () => {
  it('concatenates the fields that carry retrieval signal', () => {
    const text = runbookEmbeddingText({
      id: 1, slug: 's', category: 'kubernetes', error_code: 'Exit Code 137',
      title: 'Pod OOMKilled', summary: 'exceeded memory limit',
      root_cause: 'cgroup limit hit, SIGKILL', diagnostic_command: 'kubectl describe pod',
      solution_steps: [], tags: ['oom', '137'], created_at: '', updated_at: '',
    });
    expect(text).toContain('Exit Code 137');
    expect(text).toContain('Pod OOMKilled');
    expect(text).toContain('cgroup limit hit');
    expect(text).toContain('oom');
    expect(text).not.toContain('kubectl describe pod'); // commands are noise for semantic match
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd worker && npx vitest run src/core/embeddings.test.ts
```
Expected: FAIL — cannot resolve `./embeddings`.

- [ ] **Step 3: Implement**

Create `worker/src/core/embeddings.ts`:
```ts
import type { Env, ParsedRunbook } from '../types';

export const EMBEDDING_MODEL = '@cf/baai/bge-small-en-v1.5';
export const EMBEDDING_DIMS = 384;

/** The text that represents a runbook in vector space. Commands are
 *  deliberately excluded — flags and paths add lexical noise that FTS5
 *  already handles better than a dense encoder does. */
export function runbookEmbeddingText(r: ParsedRunbook): string {
  return [r.error_code, r.title, r.summary, r.root_cause, r.category, r.tags.join(' ')]
    .filter(Boolean)
    .join('\n');
}

export async function embedText(env: Env, text: string): Promise<number[] | null> {
  if (!env.AI) return null;
  try {
    const res = await env.AI.run(EMBEDDING_MODEL, { text: [text] });
    const vec = res?.data?.[0];
    return Array.isArray(vec) && vec.length === EMBEDDING_DIMS ? vec : null;
  } catch (err) {
    console.warn('[embed] failed:', err);
    return null;
  }
}
```

- [ ] **Step 4: Run the test**

```bash
cd worker && npx vitest run src/core/embeddings.test.ts
```
Expected: PASS.

- [ ] **Step 5: Use it in `rag.ts`**

Replace `worker/src/core/rag.ts:27-31` with:
```ts
const vector = await embedText(env, query);
if (vector) {
```
and add the import. Delete the now-dead `embeddingRes`/`Array.isArray` handling.

- [ ] **Step 6: Commit**

```bash
git add worker/src/core/embeddings.ts worker/src/core/embeddings.test.ts worker/src/core/rag.ts
git commit -m "refactor: extract shared embedText helper"
```

### Task 2.2: Write the Vectorize upsert path

**Files:**
- Create: `worker/src/storage/vectorize.ts`
- Test: `worker/src/storage/vectorize.test.ts`

**Interfaces:**
- Consumes: `embedText`, `runbookEmbeddingText`, `EMBEDDING_DIMS` from Task 2.1.
- Produces: `upsertRunbookVectors(env: Env, runbooks: ParsedRunbook[]): Promise<{ upserted: number; skipped: number }>` consumed by Task 2.3.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { upsertRunbookVectors } from './vectorize';

function fakeEnv(dims = 384) {
  const upsert = vi.fn().mockResolvedValue({ mutationId: 'm1' });
  return {
    env: {
      AI: { run: vi.fn().mockResolvedValue({ data: [new Array(dims).fill(0.1)] }) },
      VECTOR_INDEX: { upsert },
    } as any,
    upsert,
  };
}
const rb = (id: number) => ({
  id, slug: `s${id}`, category: 'kubernetes', error_code: 'E', title: 'T',
  summary: 'S', root_cause: 'R', diagnostic_command: 'c',
  solution_steps: [], tags: ['t'], created_at: '', updated_at: '',
});

describe('upsertRunbookVectors', () => {
  it('upserts one vector per runbook, keyed by string id', async () => {
    const { env, upsert } = fakeEnv();
    const res = await upsertRunbookVectors(env, [rb(1), rb(2)]);
    expect(res.upserted).toBe(2);
    expect(upsert).toHaveBeenCalledOnce();
    expect(upsert.mock.calls[0][0].map((v: any) => v.id)).toEqual(['1', '2']);
  });

  it('skips runbooks whose embedding has the wrong dimensionality', async () => {
    const { env, upsert } = fakeEnv(128);
    const res = await upsertRunbookVectors(env, [rb(1)]);
    expect(res.upserted).toBe(0);
    expect(res.skipped).toBe(1);
    expect(upsert).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd worker && npx vitest run src/storage/vectorize.test.ts
```
Expected: FAIL — cannot resolve `./vectorize`.

- [ ] **Step 3: Implement**

Create `worker/src/storage/vectorize.ts`:
```ts
import type { Env, ParsedRunbook } from '../types';
import { embedText, runbookEmbeddingText } from '../core/embeddings';

const BATCH = 50;

export async function upsertRunbookVectors(
  env: Env,
  runbooks: ParsedRunbook[]
): Promise<{ upserted: number; skipped: number }> {
  if (!env.VECTOR_INDEX) return { upserted: 0, skipped: runbooks.length };

  let upserted = 0;
  let skipped = 0;

  for (let i = 0; i < runbooks.length; i += BATCH) {
    const slice = runbooks.slice(i, i + BATCH);
    const vectors = [];
    for (const r of slice) {
      const values = await embedText(env, runbookEmbeddingText(r));
      if (!values) { skipped++; continue; }
      vectors.push({
        id: String(r.id),
        values,
        metadata: { slug: r.slug, category: r.category, error_code: r.error_code },
      });
    }
    if (vectors.length > 0) {
      await env.VECTOR_INDEX.upsert(vectors);
      upserted += vectors.length;
    }
  }
  return { upserted, skipped };
}
```

- [ ] **Step 4: Run the test**

```bash
cd worker && npx vitest run src/storage/vectorize.test.ts
```
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add worker/src/storage/vectorize.ts worker/src/storage/vectorize.test.ts
git commit -m "feat: add the missing Vectorize upsert path"
```

### Task 2.3: Expose a protected reindex endpoint and populate the index

**Files:**
- Create: `worker/src/admin/reindex.ts`
- Modify: `worker/src/index.ts` (add route before the `env.ASSETS` catch-all)
- Modify: `worker/src/types.ts` (add `ADMIN_TOKEN?: string`)

**Interfaces:**
- Consumes: `upsertRunbookVectors` (Task 2.2), `listAllRunbooks` (`worker/src/storage/d1.ts`).
- Produces: `POST /api/admin/reindex` returning `{ upserted, skipped, total }`.

- [ ] **Step 1: Implement the handler**

Create `worker/src/admin/reindex.ts`:
```ts
import type { Env } from '../types';
import { listAllRunbooks } from '../storage/d1';
import { upsertRunbookVectors } from '../storage/vectorize';
import { timingSafeEqual } from '../core/security';

export async function handleReindex(request: Request, env: Env): Promise<Response> {
  const auth = request.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!env.ADMIN_TOKEN || !token || !timingSafeEqual(token, env.ADMIN_TOKEN)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }
  const runbooks = await listAllRunbooks(env.DB, undefined, 1000);
  const { upserted, skipped } = await upsertRunbookVectors(env, runbooks);
  return new Response(JSON.stringify({ upserted, skipped, total: runbooks.length }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}
```

Create `worker/src/core/security.ts` with a constant-time comparison:
```ts
export function timingSafeEqual(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}
```

- [ ] **Step 2: Wire the route**

In `worker/src/index.ts`, immediately before the `if (env.ASSETS)` block:
```ts
if (url.pathname === '/api/admin/reindex' && request.method === 'POST') {
  return handleReindex(request, env);
}
```

- [ ] **Step 3: Set the secret and run the reindex**

```bash
cd worker
npx wrangler secret put ADMIN_TOKEN     # paste `openssl rand -hex 32`
npx wrangler deploy
curl -X POST https://<your-worker>.workers.dev/api/admin/reindex \
     -H "Authorization: Bearer $ADMIN_TOKEN"
```
Expected: `{"upserted":8,"skipped":0,"total":8}`.

- [ ] **Step 4: Verify hybrid retrieval is now live**

```bash
curl -s -X POST https://<your-worker>.workers.dev/api/troubleshoot \
  -H 'Content-Type: application/json' \
  -d '{"query":"my container got killed for using too much RAM"}' | grep -o '"search_strategy":"[a-z_]*"'
```
Expected: `"search_strategy":"hybrid"`. Before this task it was always `"fts"`. Use a query with **no lexical overlap** with any runbook title — that is the only way to prove the dense half is contributing.

- [ ] **Step 5: Document it**

Add a "Reindexing the vector store" section to `CONTRIBUTING.md` and step 6 to the README deploy block. Note in `docs/ARCHITECTURE.md` that Vectorize is populated out-of-band by reindex, not on write.

- [ ] **Step 6: Commit**

```bash
git add worker/src/admin worker/src/core/security.ts worker/src/index.ts worker/src/types.ts CONTRIBUTING.md README.md docs/ARCHITECTURE.md
git commit -m "feat: populate Vectorize via protected reindex endpoint — hybrid RAG now actually hybrid"
```

---

# PHASE 3 — Close the contribution loop

*Closes: `datasets/runbooks/*.md` → `ingest.js` → `generated_seed.sql` → nothing. Contributed runbooks can never reach the product.*

**Context:** `README.md:157-163` and `CONTRIBUTING.md:45-50` both tell contributors to add a markdown file, run `node datasets/scripts/ingest.js`, and open a PR. That writes `datasets/generated_seed.sql` — a file **no migration and no code ever reads**. Also verified by running the script: every generated `command` is prose, not a command (`"Check pod status with \`kubectl get pod ...\` (Confirm it says \`OOMKilled\`)."`) and every `expected` is the literal string `"Verified resolution"`.

### Task 3.1: Fix the markdown parser so it produces real commands

**Files:**
- Create: `datasets/scripts/lib/parse-runbook.js`
- Create: `datasets/scripts/lib/parse-runbook.test.js`
- Modify: `datasets/runbooks/k8s-oom-killed.md`
- Modify: `CONTRIBUTING.md`

**Interfaces:**
- Produces: `parseRunbook(markdown: string): Runbook` consumed by Tasks 3.2 and 3.3.

- [ ] **Step 1: Change the authoring format so commands are unambiguous**

The current format (`1. **Action**: prose with inline \`code\``) cannot be parsed into a command reliably. Require an explicit fenced block per step. Update `CONTRIBUTING.md`'s template and `datasets/runbooks/k8s-oom-killed.md` to:

````markdown
## Triage Steps

### 1. Verify OOM status
Confirm the kernel, not the scheduler, terminated the container.

```bash
kubectl get pod <pod-name> -o jsonpath='{.status.containerStatuses[*].lastState.terminated.reason}'
```

**Expected:** Prints `OOMKilled`.
````

- [ ] **Step 2: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { parseRunbook } from './parse-runbook.js';

const md = `---
slug: k8s-pod-oom-killed
category: kubernetes
error_code: OOMKilled
title: Pod OOMKilled
tags: [kubernetes, oom]
source_url: https://kubernetes.io/docs
---

## Summary
Kernel killed the container.

## Root Cause
cgroup memory limit exceeded.

## Diagnostic Command
\`\`\`bash
kubectl describe pod <pod-name>
\`\`\`

## Triage Steps

### 1. Verify OOM status
Confirm the kernel terminated it.

\`\`\`bash
kubectl get pod <pod-name> -o jsonpath='{.status...}'
\`\`\`

**Expected:** Prints \`OOMKilled\`.
`;

describe('parseRunbook', () => {
  it('extracts a runnable command, not prose', () => {
    const rb = parseRunbook(md);
    const steps = JSON.parse(rb.solution_steps);
    expect(steps[0].command).toBe("kubectl get pod <pod-name> -o jsonpath='{.status...}'");
    expect(steps[0].command).not.toContain('Confirm');
    expect(steps[0].command).not.toContain('`');
  });

  it('extracts a real expected outcome, not a placeholder', () => {
    const steps = JSON.parse(parseRunbook(md).solution_steps);
    expect(steps[0].expected).toContain('OOMKilled');
    expect(steps[0].expected).not.toBe('Verified resolution');
  });

  it('throws on missing required frontmatter', () => {
    expect(() => parseRunbook(md.replace('slug: k8s-pod-oom-killed\n', '')))
      .toThrow(/slug/);
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

```bash
npx vitest run datasets/scripts/lib/parse-runbook.test.js
```
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `parseRunbook`**

Move the logic out of `ingest.js`, replacing the step regex with one that reads `### N. Title` headings, the first fenced block beneath each as `command`, and the `**Expected:**` line as `expected`. Throw a descriptive `Error` when `slug`, `category`, `error_code`, `title`, or `source_url` is missing, and when any step has no fenced command.

- [ ] **Step 5: Run the tests**

```bash
npx vitest run datasets/scripts/lib/parse-runbook.test.js
```
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add datasets/scripts/lib CONTRIBUTING.md datasets/runbooks/
git commit -m "fix(datasets): parse real commands instead of prose"
```

### Task 3.2: Add a CI-gating validator

**Files:**
- Create: `datasets/schema.json`
- Create: `datasets/scripts/validate.js`

**Interfaces:**
- Consumes: `parseRunbook` (Task 3.1).
- Produces: `npm run validate:runbooks`, wired into CI by Task 0.4.

- [ ] **Step 1: Write the validator**

`datasets/scripts/validate.js` must, for every `datasets/runbooks/*.md`:
- parse it via `parseRunbook` (throws are failures)
- assert `slug` matches `/^[a-z0-9]+(-[a-z0-9]+)*$/`
- assert `slug` is unique across all files **and** does not collide with a slug in `worker/migrations/0002_seed_devops_runbooks.sql`
- assert `source_url` starts with `https://`
- assert `solution_steps` has ≥ 2 entries, each with a non-empty `command` and `expected`
- assert no `command` contains a backtick (a sign prose leaked in)
- `process.exit(1)` with a per-file report if anything fails

- [ ] **Step 2: Verify it catches a bad file**

```bash
printf -- '---\nslug: BAD SLUG\n---\n' > datasets/runbooks/_tmp.md
node datasets/scripts/validate.js; echo "exit=$?"
rm datasets/runbooks/_tmp.md
```
Expected: `exit=1` with a message naming `_tmp.md`.

- [ ] **Step 3: Verify it passes on the real corpus**

```bash
node datasets/scripts/validate.js; echo "exit=$?"
```
Expected: `exit=0`.

- [ ] **Step 4: Commit**

```bash
git add datasets/schema.json datasets/scripts/validate.js
git commit -m "feat(datasets): validate contributed runbooks in CI"
```

### Task 3.3: Generate a real migration so contributions actually ship

**Files:**
- Create: `datasets/scripts/build-migration.js`
- Delete: `datasets/generated_seed.sql`, `datasets/scripts/ingest.js`
- Create: `worker/migrations/0003_add_verified_at.sql`
- Modify: `.gitignore`
- Modify: `README.md`, `CONTRIBUTING.md`

- [ ] **Step 1: Add the provenance column**

`worker/migrations/0003_add_verified_at.sql`:
```sql
ALTER TABLE runbooks ADD COLUMN verified_at TEXT;
UPDATE runbooks SET verified_at = '2026-08-26' WHERE verified_at IS NULL;
```
Surface `verified_at` in `TroubleshootResponse.matched_runbook` and render it in the UI as "Verified 2026-08-26" — a claim you can actually stand behind, unlike "0% hallucinations".

- [ ] **Step 2: Write the migration builder**

`datasets/scripts/build-migration.js` takes the parsed runbooks and writes a **numbered migration** into `worker/migrations/`, e.g. `00NN_runbooks_<yyyymmdd>.sql`, using `INSERT OR REPLACE` keyed on `slug`. It must:
- refuse to run if `validate.js` fails
- pick the next free migration number by scanning `worker/migrations/`
- be idempotent: re-running with no dataset change produces no new file
- emit `-- generated by datasets/scripts/build-migration.js — do not edit by hand` as the first line

- [ ] **Step 3: Remove the dead artifact**

```bash
git rm datasets/generated_seed.sql datasets/scripts/ingest.js
echo "datasets/generated_seed.sql" >> .gitignore
```

- [ ] **Step 4: Rewrite the contributor flow in both docs**

The loop is now: add markdown → `npm run validate:runbooks` → `node datasets/scripts/build-migration.js` → commit the generated migration → PR → on merge, maintainer runs `wrangler d1 migrations apply errorlens-db --remote` then `POST /api/admin/reindex`. Say this explicitly in `CONTRIBUTING.md` — including the maintainer steps, so contributors know what happens after merge.

- [ ] **Step 5: Fix the broken code fences in `CONTRIBUTING.md`**

`CONTRIBUTING.md:15-43` nests a ```` ```bash ```` block inside a ```` ```markdown ```` block. Per CommonMark the inner closing fence terminates the **outer** block, so everything from `## Triage Steps` onward escapes the code block and the final fence opens an unclosed one — the file renders broken on GitHub. Fix by making the outer fence four backticks:

````markdown
`````markdown
---
slug: ...
---
```bash
aws sts get-caller-identity
```
`````
````

- [ ] **Step 6: Verify end to end**

```bash
npm run validate:runbooks && node datasets/scripts/build-migration.js
ls worker/migrations/ | tail -3
cd worker && npx wrangler d1 migrations apply errorlens-db --local && npx wrangler dev &
sleep 8 && curl -s localhost:8787/api/runbooks | grep -c '"slug"'
```
Expected: the contributed runbook appears in the catalog.

- [ ] **Step 7: Preview the fixed markdown**

```bash
gh markdown-preview CONTRIBUTING.md   # or paste into a GitHub gist and check rendering
```
Expected: the whole template renders inside one code block.

- [ ] **Step 8: Commit**

```bash
git add -A datasets worker/migrations .gitignore README.md CONTRIBUTING.md
git commit -m "feat(datasets): contributions now generate a real migration; fix broken fences"
```

---

# PHASE 4 — Survive the free tier

*Closes: KV write ceiling ≈500 req/day, daily limit missing from the D1 path, degraded answers cached for 7 days, tables that grow forever.*

### Task 4.1: Stop burning the KV write budget

**Files:**
- Modify: `worker/src/storage/rate-limit.ts`
- Test: `worker/src/storage/rate-limit.test.ts`

**Context:** Workers KV free tier allows **1,000 writes/day**. `rate-limit.ts:72-75` issues two `KV.put` calls per allowed request, and `cache.ts:85` adds a third on a miss. The ceiling is ≈500 requests/day — 5% of the "~10,000 requests/day" the README claims. When KV writes start failing, the `catch` at line 82 falls through to the D1 path, which never enforces the daily limit (Task 4.2) — so the protection disappears exactly when traffic peaks.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { checkRateLimit } from './rate-limit';

function kvEnv(store = new Map<string, string>()) {
  const puts: string[] = [];
  return {
    store, puts,
    env: {
      MAX_RPM_PER_IP: '5', MAX_RPD_PER_IP: '30', RATE_LIMIT_SALT: 'test-salt',
      KV: {
        get: vi.fn(async (k: string) => store.get(k) ?? null),
        put: vi.fn(async (k: string, v: string) => { puts.push(k); store.set(k, v); }),
      },
      DB: { prepare: () => { throw new Error('D1 must not be used when KV works'); } },
    } as any,
  };
}

describe('checkRateLimit — KV budget', () => {
  it('performs at most one KV write per allowed request', async () => {
    const { env, puts } = kvEnv();
    await checkRateLimit(env, '1.2.3.4');
    expect(puts.length).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd worker && npx vitest run src/storage/rate-limit.test.ts
```
Expected: FAIL — `expected 2 to be less than or equal to 1`.

- [ ] **Step 3: Collapse to one key**

Store both counters in a single JSON value under one key per IP:
```ts
type Bucket = { minute: number; minCount: number; day: number; dayCount: number };
const key = `rl:${ipHash}`;
const raw = await env.KV.get(key);
const b: Bucket = raw ? JSON.parse(raw) : { minute: currentMinute, minCount: 0, day: currentDay, dayCount: 0 };
if (b.minute !== currentMinute) { b.minute = currentMinute; b.minCount = 0; }
if (b.day !== currentDay)       { b.day = currentDay;       b.dayCount = 0; }
// ...checks...
b.minCount++; b.dayCount++;
await env.KV.put(key, JSON.stringify(b), { expirationTtl: 90_000 });
```
This halves KV writes and makes the two counters consistent with each other.

- [ ] **Step 4: Run the test**

Expected: PASS.

- [ ] **Step 5: Document the honest ceiling**

Add a comment above the function stating the arithmetic: 1 write/request against a 1,000/day free budget ⇒ ~1,000 rate-limited requests/day, and note that `cache.ts` adds one more write per cache **miss**, so the practical ceiling is between 500 and 1,000 depending on cache hit rate. Reference `docs/COST-MODEL.md`.

- [ ] **Step 6: Commit**

```bash
git add worker/src/storage/rate-limit.ts worker/src/storage/rate-limit.test.ts
git commit -m "perf: halve KV writes per request to fit the 1000/day free budget"
```

### Task 4.2: Enforce the daily limit in the D1 fallback path

**Files:**
- Modify: `worker/src/storage/rate-limit.ts:88-117`
- Modify: `worker/migrations/0003_cleanup_and_indexes.sql`
- Test: `worker/src/storage/rate-limit.test.ts`

**Context:** `rate-limit.ts:33` computes `maxRpd` and the D1 branch never reads it. The Gemini free tier is 1,000 RPD; the daily cap is the only thing standing between a scraper and a burned quota.

- [ ] **Step 1: Write the failing test**

```ts
it('rejects once the daily cap is reached, even on the D1 path', async () => {
  const rows = new Map<string, number>();
  const env = {
    MAX_RPM_PER_IP: '5', MAX_RPD_PER_IP: '3', RATE_LIMIT_SALT: 's',
    DB: fakeD1(rows), // increments rows on run(), reads on first()
  } as any;
  for (let i = 0; i < 3; i++) expect((await checkRateLimit(env, '9.9.9.9')).allowed).toBe(true);
  const res = await checkRateLimit(env, '9.9.9.9');
  expect(res.allowed).toBe(false);
  expect(res.reason).toMatch(/dail/i);
});
```

- [ ] **Step 2: Run it and confirm it fails** — currently returns `allowed: true` forever.

- [ ] **Step 3: Add a day column and enforce it**

In `worker/migrations/0003_cleanup_and_indexes.sql`:
```sql
CREATE TABLE IF NOT EXISTS ip_rate_limits_day (
  ip_hash TEXT NOT NULL,
  window_day INTEGER NOT NULL,
  request_count INTEGER DEFAULT 1,
  PRIMARY KEY (ip_hash, window_day)
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_day ON ip_rate_limits_day(window_day);
```
Then in the D1 branch, read and increment both the minute and day rows in one `db.batch([...])`, and return `allowed: false` with `reason` mentioning the daily quota when `dayCount >= maxRpd`.

- [ ] **Step 4: Run the tests** — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/storage/rate-limit.ts worker/src/storage/rate-limit.test.ts worker/migrations/0003_cleanup_and_indexes.sql
git commit -m "fix: enforce the daily rate limit on the D1 fallback path"
```

### Task 4.3: Never cache a degraded answer

**Files:**
- Modify: `worker/src/index.ts:141`
- Modify: `worker/src/core/cache.ts`
- Test: `worker/src/core/cache.test.ts`

**Context:** `index.ts:141` calls `setCachedResponse` unconditionally, including when `modelUsed` is `offline/deterministic-catalog` or `offline/generic-fallback`. TTL is 7 days. One Gemini outage poisons those queries for a week.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { isCacheable } from './cache';

describe('isCacheable', () => {
  it('caches a real model answer', () => {
    expect(isCacheable({ meta: { model: 'google/gemini-3.1-flash-lite' } } as any)).toBe(true);
  });
  it('refuses to cache the offline catalog fallback', () => {
    expect(isCacheable({ meta: { model: 'offline/deterministic-catalog' } } as any)).toBe(false);
  });
  it('refuses to cache the generic no-match fallback', () => {
    expect(isCacheable({ meta: { model: 'offline/generic-fallback' } } as any)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails** — `isCacheable` does not exist.

- [ ] **Step 3: Implement and wire it**

```ts
export function isCacheable(r: TroubleshootResponse): boolean {
  return !r.meta.model.startsWith('offline/');
}
```
In `index.ts:141`:
```ts
if (isCacheable(result)) ctx.waitUntil(setCachedResponse(env, query, result));
```

- [ ] **Step 4: Run the tests** — Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add worker/src/core/cache.ts worker/src/core/cache.test.ts worker/src/index.ts
git commit -m "fix: do not cache degraded offline fallbacks for 7 days"
```

### Task 4.4: Purge expired rows

**Files:**
- Modify: `worker/wrangler.jsonc`
- Modify: `worker/src/index.ts` (add `scheduled` handler)
- Modify: `worker/migrations/0003_cleanup_and_indexes.sql`

**Context:** `query_cache` filters on `expires_at` at read time but nothing ever deletes; `ip_rate_limits` never deletes either. Both grow without bound against a 5 GB D1 cap.

- [ ] **Step 1: Add the cron trigger**

In `worker/wrangler.jsonc`:
```jsonc
"triggers": { "crons": ["0 3 * * *"] }
```

- [ ] **Step 2: Add the scheduled handler**

In `worker/src/index.ts`, alongside `fetch`:
```ts
async scheduled(_c: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
  ctx.waitUntil((async () => {
    const nowMin = Math.floor(Date.now() / 60000);
    const nowDay = Math.floor(Date.now() / 86400000);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM query_cache WHERE expires_at <= datetime('now')"),
      env.DB.prepare('DELETE FROM ip_rate_limits WHERE window_minute < ?').bind(nowMin - 60),
      env.DB.prepare('DELETE FROM ip_rate_limits_day WHERE window_day < ?').bind(nowDay - 2),
    ]);
  })());
},
```

- [ ] **Step 3: Verify locally**

```bash
cd worker && npx wrangler dev --test-scheduled
curl "http://localhost:8787/__scheduled?cron=0+3+*+*+*"
npx wrangler d1 execute errorlens-db --local \
  --command "SELECT COUNT(*) FROM query_cache WHERE expires_at <= datetime('now')"
```
Expected: `0`.

- [ ] **Step 4: Commit**

```bash
git add worker/wrangler.jsonc worker/src/index.ts worker/migrations/0003_cleanup_and_indexes.sql
git commit -m "feat: nightly purge of expired cache and rate-limit rows"
```

---

# PHASE 5 — Security and robustness

### Task 5.1: Move the Gemini key out of the URL and add timeouts

**Files:**
- Modify: `worker/src/core/ai.ts:33-55`

**Context:** `ai.ts:33` puts the API key in the query string (`?key=${env.GEMINI_API_KEY}`), where it lands in request logs, traces and any intermediary. Google supports the `x-goog-api-key` header. No call in this file has a timeout.

- [ ] **Step 1: Switch to header auth and add an abort deadline**

```ts
const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
const ac = new AbortController();
const timer = setTimeout(() => ac.abort(), 15_000);
let resp: Response;
try {
  resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify(payload),
    signal: ac.signal,
  });
} finally {
  clearTimeout(timer);
}
```
Apply the same pattern (via `Promise.race` with a rejecting timer) to `env.AI.run` in `ai.ts:76` and `embeddings.ts`.

- [ ] **Step 2: Log the error body on failure**

Replace `console.warn(\`[Gemini API Error] Status: ${resp.status}\`)` with a version that reads `await resp.text()` — without it, a 400 from a malformed schema is undiagnosable.

- [ ] **Step 3: Verify no key appears in a URL**

```bash
grep -rn "?key=\|&key=" worker/src/
```
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add worker/src/core/ai.ts worker/src/core/embeddings.ts
git commit -m "fix(security): send the Gemini key as a header; bound every upstream call"
```

### Task 5.2: Validate LLM output before it reaches the UI

**Files:**
- Create: `worker/src/core/schema.ts`
- Create: `worker/src/core/schema.test.ts`
- Modify: `worker/src/core/ai.ts:103-144`

**Context:** `parseLLMJsonResponse` accepts `obj.steps` if it is a non-empty array of *anything*. A model returning `["do x","do y"]` produces step cards the frontend renders as blank. Nothing constrains `verified_sources` to be URLs either — see Task 5.3.

**Interfaces:**
- Produces: `validateTriageSteps(v: unknown): TriageStep[]` and `validateSources(v: unknown): string[]`, consumed by `ai.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { validateTriageSteps, validateSources } from './schema';

describe('validateTriageSteps', () => {
  it('keeps well-formed steps', () => {
    const out = validateTriageSteps([{ step: 1, action: 'Check', command: 'ls', expected: 'files' }]);
    expect(out).toHaveLength(1);
    expect(out[0].command).toBe('ls');
  });
  it('drops steps that are bare strings', () => {
    expect(validateTriageSteps(['do the thing'])).toHaveLength(0);
  });
  it('drops steps with no action text', () => {
    expect(validateTriageSteps([{ step: 1, command: 'ls' }])).toHaveLength(0);
  });
  it('renumbers steps sequentially', () => {
    const out = validateTriageSteps([{ step: 9, action: 'a' }, { step: 3, action: 'b' }]);
    expect(out.map(s => s.step)).toEqual([1, 2]);
  });
});

describe('validateSources', () => {
  it('keeps https urls', () => {
    expect(validateSources(['https://kubernetes.io/docs'])).toEqual(['https://kubernetes.io/docs']);
  });
  it('drops javascript: urls', () => {
    expect(validateSources(['javascript:alert(1)'])).toEqual([]);
  });
  it('drops data: urls and non-strings', () => {
    expect(validateSources(['data:text/html,<script>', 42, null])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd worker && npx vitest run src/core/schema.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import type { TriageStep } from '../types';

export function validateTriageSteps(v: unknown): TriageStep[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((s): s is Record<string, unknown> =>
      !!s && typeof s === 'object' && typeof (s as any).action === 'string' && (s as any).action.trim().length > 0)
    .slice(0, 12)
    .map((s, i) => ({
      step: i + 1,
      action: String(s.action).slice(0, 400),
      command: typeof s.command === 'string' && s.command.trim() ? s.command.slice(0, 800) : undefined,
      expected: typeof s.expected === 'string' && s.expected.trim() ? s.expected.slice(0, 400) : undefined,
    }));
}

export function validateSources(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((u): u is string => typeof u === 'string')
    .filter(u => { try { return ['http:', 'https:'].includes(new URL(u).protocol); } catch { return false; } })
    .slice(0, 6);
}
```

- [ ] **Step 4: Run the tests** — Expected: PASS (7 tests).

- [ ] **Step 5: Use them in `ai.ts`**

Replace `ai.ts:128` and `ai.ts:130-132` with `validateTriageSteps(obj.steps)` (falling back to `topMatch?.solution_steps ?? []` when empty) and `validateSources(obj.verified_sources)`.

- [ ] **Step 6: Add a Gemini `responseSchema`**

`ai.ts:52` sets `responseMimeType: 'application/json'` with no schema, which is why the code then strips ```` ```json ```` fences. Add a `responseSchema` to `generationConfig` mirroring `<output_schema>` in `prompts.ts`. This is the single highest-leverage output-quality change in the repo.

- [ ] **Step 7: Commit**

```bash
git add worker/src/core/schema.ts worker/src/core/schema.test.ts worker/src/core/ai.ts
git commit -m "fix: validate LLM output shape and source URLs before returning them"
```

### Task 5.3: Block `javascript:` URLs at the render site too

**Files:**
- Modify: `frontend/src/App.tsx:243`

**Context:** Defence in depth — Task 5.2 filters at the API, but the frontend also consumes cached responses written before that fix.

- [ ] **Step 1: Add a guard**

```tsx
const safeHref = (u: string): string | undefined => {
  try { return ['http:', 'https:'].includes(new URL(u).protocol) ? u : undefined; }
  catch { return undefined; }
};
```
Render the anchor only when `safeHref(src)` is defined.

- [ ] **Step 2: Verify manually**

Temporarily return `verified_sources: ['javascript:alert(1)']` from the worker, load the page, confirm no link renders. Revert.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "fix(security): reject non-http(s) source URLs at render time"
```

### Task 5.4: Harden the remaining input and error surfaces

**Files:**
- Modify: `worker/src/index.ts`
- Modify: `worker/src/storage/rate-limit.ts:19`

- [ ] **Step 1: Stop leaking internal errors**

`index.ts` returns `details: err.message` on three 500 paths (lines 68, 82, 149). Replace with a logged `console.error` plus a stable client-facing message and a request id:
```ts
const rid = crypto.randomUUID();
console.error(`[${rid}]`, err);
return json({ error: 'Internal error', request_id: rid }, 500);
```

- [ ] **Step 2: Fix the `limit` parameter**

`index.ts:62` computes `Math.min(100, parseInt(...))`. `?limit=abc` yields `NaN`, which binds as `NULL`, and `LIMIT NULL` in SQLite means **no limit** — the whole table is returned. Replace with:
```ts
const raw = parseInt(url.searchParams.get('limit') ?? '50', 10);
const limit = Number.isFinite(raw) ? Math.min(100, Math.max(1, raw)) : 50;
```

- [ ] **Step 3: Return JSON 404 for unknown `/api/*` paths**

Because `not_found_handling: "single-page-application"` plus the `env.ASSETS` catch-all at `index.ts:157`, `GET /api/bogus` currently returns the SPA HTML with status 200. Add before the catch-all:
```ts
if (url.pathname.startsWith('/api/')) {
  return json({ error: 'Not Found', path: url.pathname }, 404);
}
```

- [ ] **Step 4: Move the rate-limit salt to a secret**

`rate-limit.ts:19` hardcodes `'_errorlens_salt'` in public source. Use `env.RATE_LIMIT_SALT` and fail loudly at startup if unset in production.

- [ ] **Step 5: Verify**

```bash
curl -s localhost:8787/api/bogus | head -1                       # expect JSON, not <!DOCTYPE
curl -s "localhost:8787/api/runbooks?limit=abc" | grep -c '"id"' # expect <= 50
grep -rn "_errorlens_salt\|details: err.message" worker/src/      # expect no output
```

- [ ] **Step 6: Commit**

```bash
git add worker/src
git commit -m "fix(security): stop leaking errors, clamp limit, JSON 404s, secret salt"
```

---

# PHASE 6 — Tests and quality gates

### Task 6.1: Stand up the test runner

**Files:**
- Create: `worker/vitest.config.ts`
- Modify: `worker/package.json`

**Context:** There is not a single test file in the repo. This is the first thing a reviewer greps for.

- [ ] **Step 1: Install**

```bash
npm i -D -w worker vitest @cloudflare/vitest-pool-workers
```

- [ ] **Step 2: Configure**

```ts
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: { workers: { wrangler: { configPath: './wrangler.jsonc' } } },
  },
});
```

- [ ] **Step 3: Verify the runner starts**

```bash
cd worker && npx vitest run
```
Expected: exit 0 with "no tests" until Phase 2–5 tests land. If it errors with a pool-resolution failure, check that no parent directory hoists a different `@cloudflare/vitest-pool-workers` major version — a version skew there silently prevents *every* test from running.

- [ ] **Step 4: Commit**

```bash
git add worker/vitest.config.ts worker/package.json package-lock.json
git commit -m "test: add vitest with the Workers pool"
```

### Task 6.2: Add router and integration tests

**Files:**
- Create: `worker/src/index.test.ts`

- [ ] **Step 1: Write the tests**

Cover, using `SELF.fetch` from `cloudflare:test`:
- `GET /api/health` returns 200 with all five binding booleans
- `POST /api/troubleshoot` with `{}` returns 400 "Query parameter is required"
- `POST /api/troubleshoot` with a 1,001-character query returns 400
- `POST /api/troubleshoot` with invalid JSON returns 400
- `GET /api/bogus` returns 404 **with `content-type: application/json`** (guards Task 5.4 step 3)
- `GET /api/runbooks?limit=abc` returns at most 50 rows (guards Task 5.4 step 2)
- `OPTIONS /api/troubleshoot` returns 204 with the CORS headers
- a 500 response body contains `request_id` and **not** a stack trace or `err.message`

- [ ] **Step 2: Run** — `cd worker && npx vitest run` — Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add worker/src/index.test.ts
git commit -m "test: cover routing, validation, CORS and error shape"
```

### Task 6.3: Add lint and format

**Files:**
- Create: `eslint.config.js`, `.prettierrc`, `.editorconfig`

- [ ] **Step 1: Install and configure**

```bash
npm i -D eslint typescript-eslint prettier eslint-config-prettier
```
Enable `@typescript-eslint/no-explicit-any` as an **error**. The codebase currently has `any` in `types.ts:9` (`AI?: any`), `index.ts:20`, `index.ts:67/81/144` (`catch (err: any)`), `ai.ts:103/146` (`topMatch?: any`), `d1.ts:8/39`, and `App.tsx:73`. Fix each one rather than suppressing it — `AI` should be typed `Ai`, catches should be `unknown` with narrowing, and `topMatch` should be `ParsedRunbook | undefined`.

- [ ] **Step 2: Enable stricter TypeScript**

Add to both `tsconfig.json` files:
```json
"noUncheckedIndexedAccess": true,
"noImplicitOverride": true,
"forceConsistentCasingInFileNames": true
```
Then fix the resulting errors — this catches the `words[0]` class of bug in `d1.ts:107`.

- [ ] **Step 3: Verify**

```bash
npm run lint && npm run typecheck
```
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add eslint.config.js .prettierrc .editorconfig worker/tsconfig.json frontend/tsconfig.json worker/src frontend/src package.json package-lock.json
git commit -m "chore: add eslint/prettier, ban explicit any, enable stricter tsconfig"
```

---

# PHASE 7 — Retrieval quality

*Context: I loaded the real schema + seed into SQLite and ran the seven demo queries plus one more: **Top-1 = 8/8**. The lexical engine and its FTS5 sanitiser are genuinely solid — injection attempts (`"; DROP TABLE runbooks; --`, `NEAR(a b)`) are neutralised cleanly with no throws. The problems below are about corpus size and tokenisation, not the algorithm.*

### Task 7.1: Fix the stopword list and short-token handling

**Files:**
- Modify: `worker/src/storage/d1.ts:77-91`
- Create: `worker/src/storage/d1.test.ts`

**Context:** Two measured defects:
- `'how to fix'` → the list strips `how` and `fix` but not `to`, leaving `"to"*`, which matches **5 of the 8** runbooks.
- `'C++ compiler error'` → `+` is stripped, leaving `c`, which the `w.length > 1` filter drops. **C++, C#, and any one-character-plus-symbol token are unsearchable** — a real gap for a DevOps error tool.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { buildFtsQuery } from './d1';

describe('buildFtsQuery', () => {
  it('drops generic connectors that carry no signal', () => {
    expect(buildFtsQuery('how to fix this')).toBeNull();
  });
  it('preserves symbolic language tokens', () => {
    expect(buildFtsQuery('C++ compiler error')).toContain('"c++"');
  });
  it('preserves short numeric error codes', () => {
    expect(buildFtsQuery('error 502')).toContain('"502"');
  });
  it('caps the number of terms', () => {
    const q = buildFtsQuery(Array.from({ length: 80 }, (_, i) => `word${i}`).join(' '))!;
    expect(q.split(' OR ')).toHaveLength(24);
  });
});
```

- [ ] **Step 2: Run and confirm it fails** — `buildFtsQuery` is not exported yet.

- [ ] **Step 3: Extract and fix**

Export `buildFtsQuery(query: string): string | null` from `d1.ts`. Changes:
- extend the stopword list with `to in is on at of my the a an it this that with for and or not why how fix what does do i`
- allow a token through if `w.length > 1` **or** `/^[0-9]+$/.test(w)` **or** it is a known symbolic token
- preserve `+` and `#` when adjacent to letters (match `c++`, `c#`, `.net`) before the strip pass
- cap at 24 terms
- return `null` when nothing survives, so `searchRunbooksFTS` returns `[]` instead of building a degenerate query

- [ ] **Step 4: Run the tests** — Expected: PASS (4 tests).

- [ ] **Step 5: Re-run the retrieval benchmark**

```bash
ERRORLENS_URL=... node bench/retrieval.mjs
```
Expected: Top-1 no worse than before; record the number in `docs/BENCHMARKS.md`.

- [ ] **Step 6: Commit**

```bash
git add worker/src/storage/d1.ts worker/src/storage/d1.test.ts docs/BENCHMARKS.md
git commit -m "fix(rag): stopword and symbolic-token handling in the FTS query builder"
```

### Task 7.2: Grow the corpus to 40+ runbooks

**Files:**
- Create: `datasets/runbooks/*.md` (32+ new files)

**Context:** 8 runbooks is a demo, not a product, and it is why the retrieval benchmark is trivially saturated. This is the single highest-value use of your time for the *product*, and it is now unblocked by Phase 3.

- [ ] **Step 1: Pick topics by real search volume**

Target the errors people actually paste into Google. Suggested spread: Kubernetes (ImagePullBackOff variants, Evicted, Pending/unschedulable, ErrImageNeverPull, FailedScheduling, CreateContainerConfigError), Docker (port already allocated, no space left on device, permission denied on socket), Linux (Too many open files, Address already in use, OOM in dmesg), Node (EADDRINUSE, ERR_MODULE_NOT_FOUND, heap out of memory), Python (ModuleNotFoundError vs ImportError, SSL CERTIFICATE_VERIFY_FAILED), Postgres/MySQL (deadlock detected, too many connections, disk full), TLS (certificate has expired, hostname mismatch, unable to get local issuer), Cloud (S3 403, IAM AccessDenied, ECS task stopped reason), Git (LFS quota, non-fast-forward, detached HEAD), CI (exit code 143 in GitHub Actions).

- [ ] **Step 2: For each, verify against upstream docs and record `verified_at`**

This is the product. A wrong runbook is worse than a missing one — see the Error 1101/1102 defect this plan already had to fix.

- [ ] **Step 3: Validate, build the migration, apply, reindex**

```bash
npm run validate:runbooks
node datasets/scripts/build-migration.js
cd worker && npx wrangler d1 migrations apply errorlens-db --remote
curl -X POST https://<worker>/api/admin/reindex -H "Authorization: Bearer $ADMIN_TOKEN"
```

- [ ] **Step 4: Expand `bench/queries.json` to match, then re-benchmark**

Write queries that a person would actually type — never the runbook title. Report the honest Top-1 over the larger corpus.

- [ ] **Step 5: Commit**

```bash
git add datasets/ worker/migrations bench/
git commit -m "feat(datasets): expand the runbook corpus to 40 verified entries"
```

---

# PHASE 8 — Frontend and presentation

### Task 8.1: Add OpenGraph tags and a screenshot — do this before posting

**Files:**
- Modify: `frontend/index.html`
- Modify: `README.md`
- Create: `docs/assets/screenshot.png`, `docs/assets/og-image.png`, `frontend/public/og-image.png`

**Context:** There are currently no OG or Twitter tags, so the LinkedIn link preview will be a bare URL with no image. And the README has no screenshot. For a repo whose purpose is to be *seen*, these two are the highest return per minute of any task in this plan.

- [ ] **Step 1: Add the meta tags**

```html
<meta property="og:type" content="website" />
<meta property="og:url" content="https://<your-worker>.workers.dev/" />
<meta property="og:title" content="ErrorLens — Deterministic DevOps Troubleshooting" />
<meta property="og:description" content="Hybrid RAG over verified runbooks. Diagnostic decision trees and copy-pasteable commands for Kubernetes, Docker, Linux and cloud errors — running entirely on Cloudflare's free tier." />
<meta property="og:image" content="https://<your-worker>.workers.dev/og-image.png" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="theme-color" content="#06b6d4" />
```

- [ ] **Step 2: Produce a 1200×630 OG image**

Screenshot the result view for `Docker container exited with code 137` — the terminal block and the numbered triage steps are the product's whole pitch in one frame.

- [ ] **Step 3: Put a screenshot immediately under the README title**

Above the badges, not below the fold. A reviewer decides in about eight seconds.

- [ ] **Step 4: Verify the preview**

Paste the URL into `https://www.opengraph.xyz/` and LinkedIn's Post Inspector.

- [ ] **Step 5: Commit**

```bash
git add frontend/index.html frontend/public docs/assets README.md
git commit -m "docs: add OpenGraph tags and a README screenshot"
```

### Task 8.2: Make it responsive and accessible

**Files:**
- Modify: `frontend/src/index.css`
- Modify: `frontend/src/App.tsx`

**Context:** `frontend/src/index.css` is 446 lines with **zero `@media` queries** — the layout is not responsive, and a large share of LinkedIn traffic is mobile. It also sets `outline: none` at lines 53 and 129 without a replacement focus ring (WCAG 2.4.7 failure), and there is no `prefers-reduced-motion` despite an animated spinner.

- [ ] **Step 1: Add breakpoints**

At minimum 768px and 480px: stack `.search-wrapper`, allow `.chips-bar` to wrap and scroll, reduce `.hero-title` size, and make `.terminal-block` scroll horizontally rather than overflowing the page.

- [ ] **Step 2: Restore focus visibility**

Replace every `outline: none` with a `:focus-visible` ring:
```css
:where(button, input, a):focus-visible {
  outline: 2px solid var(--border-focus);
  outline-offset: 2px;
}
```

- [ ] **Step 3: Add reduced-motion support**

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; }
}
```

- [ ] **Step 4: Add the missing ARIA**

`aria-label` on the search input; `aria-live="polite"` on the results container; `aria-live="assertive"` on the error banner; `role="status"` plus visually-hidden "Diagnosing…" text on the spinner; `aria-label` on each Copy button naming what it copies ("Copy command for step 2").

- [ ] **Step 5: Verify**

```bash
npm run build --workspace=frontend
npx serve frontend/dist &
npx lighthouse http://localhost:3000 --only-categories=accessibility,performance --output=json --output-path=bench/lighthouse.json
```
Expected: accessibility ≥ 95. Commit `bench/lighthouse.json` — then the README may cite the score, because a reader can check it.

- [ ] **Step 6: Commit**

```bash
git add frontend/src bench/lighthouse.json
git commit -m "fix(ui): responsive layout, focus rings, reduced motion, ARIA"
```

### Task 8.3: Decompose the frontend and share types with the worker

**Files:**
- Create: `shared/types.ts`, `frontend/src/api.ts`, `frontend/src/components/*.tsx`
- Modify: `frontend/src/App.tsx`, `worker/src/types.ts`

**Context:** `TroubleshootResponse` is defined twice — `worker/src/types.ts:57` and `frontend/src/App.tsx:10` — and can drift silently. `App.tsx` is a single 263-line component mixing inline style objects with CSS classes and holding the fetch call inline.

- [ ] **Step 1: Create `shared/types.ts`** holding `TriageStep`, `TroubleshootResponse`, `RunbookSummary`. Import from both sides; delete both duplicates.

- [ ] **Step 2: Extract `frontend/src/api.ts`** exporting `troubleshoot(query: string): Promise<TroubleshootResponse>` with typed error handling — no `catch (err: any)`.

- [ ] **Step 3: Split the components** into `SearchBar`, `SampleChips`, `ResultCard`, `TriageStepCard`, `TelemetryBar`, `ErrorBanner`. Move every inline `style={{…}}` into `index.css`.

- [ ] **Step 4: Handle clipboard failure**

`App.tsx:81` calls `navigator.clipboard.writeText(text)` unawaited — it rejects silently outside a secure context. Await it, catch, and show a "Press ⌘C to copy" fallback.

- [ ] **Step 5: Verify** — `npm run typecheck && npm run build` — Expected: exit 0, bundle still under 30 KB.

- [ ] **Step 6: Commit**

```bash
git add shared frontend/src worker/src/types.ts
git commit -m "refactor(ui): share response types, extract API client and components"
```

---

# PHASE 9 — Open-source hygiene

### Task 9.1: Add the community files GitHub looks for

**Files:**
- Create: `.github/ISSUE_TEMPLATE/runbook.yml`, `.github/ISSUE_TEMPLATE/bug.yml`, `.github/ISSUE_TEMPLATE/config.yml`
- Create: `.github/pull_request_template.md`, `.github/dependabot.yml`
- Create: `SECURITY.md`, `CODE_OF_CONDUCT.md`

- [ ] **Step 1: Write a `runbook.yml` issue form** with required fields mirroring `datasets/schema.json` — error code, category, diagnostic command, triage steps, upstream source URL. This lets people contribute without cloning, which is where most runbook contributions will actually come from.

- [ ] **Step 2: PR template** with a checklist: `npm run validate:runbooks` passes, `npm test` passes, upstream source verified today, migration regenerated.

- [ ] **Step 3: `SECURITY.md`** — a contact address and a note that the deployed instance runs on a free tier with per-IP limits, so please do not load-test it.

- [ ] **Step 4: `dependabot.yml`** — weekly `npm` updates for `/`, `/worker`, `/frontend`, and `github-actions`.

- [ ] **Step 5: Commit**

```bash
git add .github SECURITY.md CODE_OF_CONDUCT.md
git commit -m "chore: add issue/PR templates, security policy, dependabot"
```

### Task 9.2: Detach the repo from the client project and finish the README

**Files:**
- Modify: `LICENSE`, `package.json`, `README.md`

- [ ] **Step 1: Fix attribution**

`LICENSE:3` reads `Copyright (c) 2026 Harshil / Madagascar Project` and `package.json:31` has `"author": "Harshil (Madagascar Project)"`. "Madagascar Project" is an unrelated client workspace. Change both to your own name and GitHub handle — a public portfolio repo should not carry a client's name.

- [ ] **Step 2: Add the sections a reviewer looks for**

- **Limitations** — say plainly: 8 (soon 40) runbooks, English only, no auth, single region for D1, per-IP limits of 5/min and 30/day, and that Tier-2 Workers AI fallback covers roughly 115 requests/day within the Neuron budget. Stating limits honestly reads as *more* senior, not less.
- **How it works** — three paragraphs on why hybrid beats pure-vector for error codes. This is your actual differentiator; make the reasoning visible.
- **Roadmap** — three items you genuinely intend.

- [ ] **Step 3: Add badges that reflect reality**

Replace the `$0.00/mo` "Cloud Bill" badge with a live CI badge and a "Runbooks: N" badge. A green CI badge is worth more than a marketing claim.

- [ ] **Step 4: Final claim sweep**

```bash
grep -rniE "100%|0%|zero |always |never |guaranteed|forever" README.md docs/
```
Review every hit. Keep only what a committed artifact proves.

- [ ] **Step 5: Commit and tag**

```bash
git add LICENSE package.json README.md
git commit -m "docs: honest limitations, fix attribution, real badges"
git tag -a v0.1.0 -m "First public release"
```

Note the version: `1.0.0` on a project with no users signals inexperience. `v0.1.0` with a clear roadmap signals judgement.

---

## Self-Review

**Spec coverage.** Every finding from the 2026-08-26 review maps to a task: demo link → 1.1; benchmarks → 1.2; Error 1101/1102 → 1.3; Tailwind/sliding-window/GDPR/RPD/free-forever → 1.1, 1.4; Vectorize never written → 2.1–2.3; contribution loop → 3.1–3.3; broken fences → 3.3 step 5; KV budget → 4.1; missing daily limit → 4.2; caching degraded answers → 4.3; unbounded tables → 4.4; key in URL and no timeouts → 5.1; unvalidated LLM output → 5.2; `javascript:` href → 5.2, 5.3; leaked errors, `limit=NaN`, SPA-404, hardcoded salt → 5.4; no tests/lint/strict-TS → 6.1–6.3; stopwords and symbolic tokens → 7.1; corpus size → 7.2; OG tags and screenshot → 8.1; responsive and a11y → 8.2; duplicated types and clipboard → 8.3; community files → 9.1; attribution, limitations, version → 9.2.

**Known gap, deliberately deferred.** Prompt injection is only partially addressed. Task 5.2 constrains the *shape* of model output, but nothing prevents a crafted query from steering the *content* of a generated `command` — and the UI puts a one-click Copy button next to it. Treat this as a Phase 10 item: delimit the user query inside the prompt, and have the UI visually distinguish a command that came from a verified runbook (`matched_runbook !== null`) from one the model invented. This matters more here than in most LLM apps, because the output is meant to be pasted into a root shell.

**Type consistency.** `embedText`/`runbookEmbeddingText` (2.1) are consumed by `upsertRunbookVectors` (2.2) and `rag.ts`. `upsertRunbookVectors` is consumed by `handleReindex` (2.3). `timingSafeEqual` is defined in 2.3 and referenced only there. `validateTriageSteps`/`validateSources` (5.2) are consumed by `ai.ts` and mirrored in `App.tsx` (5.3). `isCacheable` (4.3) is consumed by `index.ts`. `buildFtsQuery` (7.1) is consumed by `searchRunbooksFTS`. `parseRunbook` (3.1) is consumed by `validate.js` (3.2) and `build-migration.js` (3.3). Names checked and consistent.

**Ordering constraint.** Task 0.4's CI workflow calls `npm run lint`, `npm test`, and `npm run validate:runbooks`, which do not exist until 6.3, 6.1, and 3.2. Either land Phase 0 with those three CI steps commented out and uncomment them as each lands, or push the branch only after Phase 6. Do not push a workflow that references scripts that do not exist yet — a red badge is the thing this plan exists to prevent.
