# ErrorLens

Paste an error code or a stack trace, get back the command that confirms the
cause, the steps that fix it, and what to try when those don't work.

It runs entirely on free tiers — Cloudflare Workers, D1, Vectorize and Workers
AI, plus Gemini Flash-Lite on Google AI Studio — and it is built so that staying
free is a property of the design rather than a hope.

[![CI](https://github.com/harshil/errorlens/actions/workflows/ci.yml/badge.svg)](https://github.com/harshil/errorlens/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

---

## Why not just ask a chatbot

For most questions you should. This exists for a narrower case: the exact
strings that general models handle badly.

`Exit Code 137`, `ERR_OSSL_EVP_UNSUPPORTED`, `0x80070005`, `SQLSTATE[HY000]` —
these are identifiers, not language. A sentence embedding puts "container ran
out of memory" close to "RAM exhaustion", which is genuinely useful, but it has
no particular reason to put `137` close to either. Meanwhile BM25 treats `137`
as a rare, high-value token and nails it.

So ErrorLens runs both and fuses the rankings:

- **BM25 over SQLite FTS5** for the identifiers, exit codes and flag names.
- **Dense vectors over Vectorize** (`bge-small-en-v1.5`, 384 dimensions) for the
  paraphrases — "my container got killed for using too much RAM" finds the OOM
  runbook without sharing a word with it.
- **Reciprocal Rank Fusion** to combine them, because the two engines produce
  incomparable numbers. `bm25()` returns unbounded negatives and cosine returns
  0 to 1; fusing raw scores needs per-engine calibration that drifts as the
  corpus grows. Fusing ranks doesn't.

The retrieved runbooks then ground the model's answer. Where a runbook matched,
the UI says the steps were human-reviewed. Where none did, it says the model
wrote them — which matters, because the whole interface is built around a button
that copies commands into your shell.

## Three tiers, and the last one needs no model at all

1. **Gemini Flash-Lite** via AI Studio's free tier, with a `responseSchema` so
   the output is parseable JSON rather than prose that contains JSON.
2. **Workers AI Llama 3.1 8B** when Gemini is rate limited or down. No schema
   support here, so the output goes through the same validator and gets
   rejected if it doesn't hold up.
3. **The catalog itself.** No model. The matched runbook rendered directly into
   the response shape.

Tier 3 is the interesting one. It means there is no single upstream whose
outage takes the service down, and it is the only tier whose commands were
written by a person and checked against upstream documentation — which is why
it's the only one that reports `grounded: true`.

## How it stays free

The binding constraint is not what people expect. It isn't request count, and
it isn't tokens.

The Workers free plan allows **1,000 KV writes per day** and **100,000 D1 rows
written per day**. Every hot path in this app writes: the rate-limit counter,
the request log, the cache fill. Built on KV, the ceiling would have been
somewhere near 500 requests a day. Built on D1, it's two orders of magnitude
higher.

So there is no KV binding. D1 is the only stateful dependency.

The admin panel at `/admin` shows live consumption against every published
allowance — Worker requests, D1 writes, Workers AI neurons, Gemini calls,
Vectorize dimensions. The D1 and neuron figures are deliberate over-estimates.
A budget meter that flatters you is worse than not having one.

Per-IP limits are 5 requests/minute and 30/day, enforced with a sliding-window
counter that interpolates across the minute boundary. It's an approximation
— two rows per identity instead of one row per request — but it closes the
burst-at-the-boundary hole a plain fixed window leaves open.

Full arithmetic in [docs/COST-MODEL.md](docs/COST-MODEL.md).

## Running it locally

```bash
git clone https://github.com/harshil/errorlens.git
cd errorlens
npm install

cp worker/.dev.vars.example worker/.dev.vars   # add your AI Studio key
npm run dev --workspace=worker                 # API on :8787
npm run dev:frontend                           # UI on :3000
```

Without a `GEMINI_API_KEY` the app still works — it falls through to Workers AI,
and then to the catalog. That's the point of the tiering, and it makes the
project usable offline.

Apply the schema before the first run:

```bash
cd worker
npx wrangler d1 migrations apply errorlens-db --local
```

## Deploying

The IDs in `worker/wrangler.jsonc` point at my account. Create your own:

```bash
npx wrangler d1 create errorlens-db
npx wrangler vectorize create errorlens-vectors --dimensions=384 --metric=cosine
```

Put the returned `database_id` into `wrangler.jsonc`, then:

```bash
npx wrangler d1 migrations apply errorlens-db --remote

npx wrangler secret put GEMINI_API_KEY   # aistudio.google.com/apikey
npx wrangler secret put ADMIN_TOKEN      # openssl rand -hex 32
npx wrangler secret put IP_HASH_SALT     # openssl rand -hex 32

npm run build                 # frontend/dist, served by the Worker
npm run deploy --workspace=worker
```

Then populate the vector index, which is a separate step because embedding the
whole corpus costs far more than the 10ms CPU a single request gets:

```bash
curl -X POST https://<your-worker>/api/admin/reindex \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

If `ADMIN_TOKEN` isn't set, the entire admin surface returns 503 rather than
falling open.

## Layout

```
worker/src/
  index.ts          router, security headers, request logging
  core/             ai, prompts, rag, embeddings, cache, schema, security
  storage/          d1, rate-limit, logs, usage, vectorize
  admin/            admin API and panel
frontend/src/       Preact app, no framework CSS
shared/api.ts       the wire contract, imported by both sides
datasets/           runbook markdown and the pipeline that compiles it
bench/              latency and retrieval harness
```

## Adding a runbook

Runbooks are markdown with frontmatter. The pipeline validates them, then
compiles them into a real numbered D1 migration — the thing that was missing in
the first version of this project, where contributions landed in a generated
file nothing ever read.

```bash
# write datasets/runbooks/your-error.md
npm run runbooks:validate
npm run runbooks:build
```

Format and rules are in [CONTRIBUTING.md](CONTRIBUTING.md). The validator is
strict on purpose: every step needs a real command in its own fenced block and
a stated expected outcome, because the UI puts a copy button next to whatever
ends up in that field.

## What's measured

Bundle, from `npm run build`:

| Asset |      Raw | Gzipped |
| :---- | -------: | ------: |
| JS    | 21.95 kB | 9.07 kB |
| CSS   |  7.59 kB | 2.38 kB |

Tests: 77 in the Worker (router, rate limiter, rank fusion, FTS query builder,
output validators, admin auth) and 17 for the runbook parser. The Worker suite
runs inside `workerd` against a real D1 with the migrations applied, not mocks.

Latency numbers are deliberately absent. There's a harness in `bench/` that
writes `bench/results.json` against a deployed instance; until that has been run
and committed, there's nothing here worth quoting.

## Limitations

- **The corpus is small.** Nine runbooks at the time of writing. Retrieval
  quality scores well against it, but that says more about the size of the test
  than the quality of the engine.
- **English only.** The FTS5 tokenizer is configured for English stemming.
- **No authentication on the public API.** It's rate limited by IP, which is a
  cost control, not a security boundary.
- **The Workers AI tier is small.** At roughly 87 neurons per call against a
  10,000/day allowance, it covers about 115 fallback requests a day before tier
  3 takes over.
- **Hashed IPs are still personal data.** See [docs/PRIVACY.md](docs/PRIVACY.md)
  for what's stored and for how long.
- **Prompt injection is only partly mitigated.** User input is delimited and
  framed as data, and output is schema-validated, but a model can still be
  argued into writing a command you shouldn't run. That's why provenance is
  shown on every answer.

## Reading further

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — retrieval, fusion, caching, the request path
- [docs/COST-MODEL.md](docs/COST-MODEL.md) — where the ceilings actually are
- [docs/PRIVACY.md](docs/PRIVACY.md) — what gets logged
- [SECURITY.md](SECURITY.md) — reporting a vulnerability

## License

MIT. See [LICENSE](LICENSE).
