# Cost model

Every allowance below was checked against vendor documentation on 2026-08-26.
The admin panel at `/admin` computes live consumption from these same numbers,
so if one of them is wrong the meter is wrong too — they are not maintained
separately.

## The allowances

| Resource                      |     Free allowance | Window       |
| :---------------------------- | -----------------: | :----------- |
| Worker requests               |            100,000 | day          |
| Worker CPU per invocation     |              10 ms | per request  |
| D1 rows read                  |          5,000,000 | day          |
| D1 rows written               |            100,000 | day          |
| D1 storage                    |               5 GB | total        |
| Workers KV writes             |          **1,000** | day          |
| Workers KV reads              |            100,000 | day          |
| Workers AI                    |     10,000 neurons | day          |
| Vectorize queried dimensions  |         30,000,000 | month        |
| Gemini Flash-Lite (AI Studio) | 15 RPM / 1,000 RPD | minute / day |

## Why there is no KV

This is the decision that shaped the storage layer.

KV looks like the obvious choice for a rate limiter and a response cache:
globally replicated, fast reads at the edge, designed for exactly this. But the
free plan allows **1,000 writes per day**, and every request here writes at
least once.

The first version of this project used KV for both. It issued two writes per
allowed request — a minute counter and a day counter — plus a third on a cache
miss. Against a 1,000/day budget that is a hard ceiling somewhere around 500
requests a day, on a service whose README claimed 10,000.

Worse, the failure mode was silent and badly timed. When KV writes start
failing, the code fell through to a D1 path that only enforced the per-minute
limit. The daily cap — the thing protecting the Gemini quota — disappeared
exactly when traffic was highest.

D1 allows 100 times more writes. So D1 is the only store, and the KV binding is
gone.

## Writes per request

| Path                                                      |               D1 writes |
| :-------------------------------------------------------- | ----------------------: |
| Rate limit check                                          | 2 (minute + day upsert) |
| Request log                                               |                       1 |
| Usage rollup                                              |                       1 |
| Cache fill (miss only, and only for non-degraded answers) |                       1 |
| Runbook hit counter (when something matched)              |                       1 |

So 4 writes on a cached hit, up to 6 on a full miss. Against 100,000 rows/day
that is roughly **16,000–25,000 requests a day** before D1 writes become the
constraint — comfortably above the 100,000 Worker request allowance in practice,
and far above what per-IP limits permit anyway.

The panel's estimate uses `requests × 4 + troubleshoots`, which over-counts
slightly. That is intentional.

## Workers AI neurons

Neuron rates from the Workers AI pricing table:

| Model                            | Neurons / M input tokens | Neurons / M output tokens |
| :------------------------------- | -----------------------: | ------------------------: |
| `@cf/baai/bge-small-en-v1.5`     |                    1,841 |                         — |
| `@cf/meta/llama-3.1-8b-instruct` |                   25,608 |                    75,147 |

**Embeddings are effectively free.** A query is roughly 20 tokens. Ten thousand
of them is 0.2M tokens, about 368 neurons — under 4% of the daily allowance.

**The Llama fallback is not.** A generation call sends roughly 1,650 input
tokens (system prompt plus three runbooks) and produces around 600:

```
input:  1650 / 1e6 × 25,608 ≈ 42 neurons
output:  600 / 1e6 × 75,147 ≈ 45 neurons
                              ─────────────
                              ≈ 87 neurons per call
```

At 10,000 neurons/day that is about **115 fallback generations per day**. Past
that, Workers AI returns errors and tier 3 serves the catalog directly.

This is worth stating plainly because tier 2 fires precisely when tier 1 is
exhausted — the two failure modes are correlated. If Gemini's 1,000 RPD is gone,
Workers AI covers another 115 requests, and everything after that is catalog
answers. That is a deliberate degradation curve, not an accident, but it is a
curve and not a plateau.

## Vectorize

384 dimensions per query. The 30,000,000 monthly allowance covers about
**78,000 queries a month**, or 2,600 a day. Not the binding constraint.

Reindexing writes 384 dimensions per runbook, which at corpus sizes measured in
hundreds is negligible.

## Storage growth

Request logs are the only table that grows without bound in normal operation.
At roughly 200 bytes a row and a 30-day retention window (`LOG_RETENTION_DAYS`),
25,000 requests a day would use about 150 MB — 3% of the 5 GB allowance.

A nightly cron at 03:17 UTC purges expired cache entries, stale rate-limit
buckets and logs past retention. Without it, the 5 GB limit is a countdown
rather than a ceiling.

## What actually limits this deployment

In order:

1. **Gemini's 1,000 requests/day.** First tier to run out.
2. **Per-IP limits (5/min, 30/day).** Caps any single abuser well before any
   platform limit is reached — at 30/day per IP it takes 34 distinct addresses
   to exhaust the Gemini quota.
3. **Workers AI, ~115 fallback calls.** Only reachable after (1).
4. Everything else has at least an order of magnitude of headroom.

The response cache sits in front of all of this with a 7-day TTL, so repeated
queries — which is what a public demo mostly sees — cost nothing beyond a D1
read.
