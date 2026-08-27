# Architecture

One Worker serves both the API and the static frontend. D1 holds everything
stateful. There is no origin server and no second region.

## Request path

```
POST /api/troubleshoot
      │
      ├─ hash client IP (SHA-256 + secret salt)
      ├─ rate limit          D1, sliding-window counter, atomic upsert
      ├─ validate body       ≤ 1000 chars, JSON, string query
      │
      ├─ cache lookup        D1 query_cache, SHA-256 of normalised query
      │     └─ hit → return, bump hit_count, log
      │
      ├─ retrieve            FTS5 BM25  ┐
      │                      Vectorize  ┘→ reciprocal rank fusion → top 3
      │
      ├─ generate            Gemini → Workers AI → catalog
      │
      └─ respond, then in waitUntil:
             cache write (unless degraded), usage rollup,
             runbook hit counter, request log
```

Everything after the response goes through `ctx.waitUntil`, so logging and
accounting never sit in the user's latency path.

## Retrieval

Two engines, fused by rank.

**Lexical.** SQLite FTS5 with the `porter unicode61` tokenizer over title,
error code, summary, root cause and tags. The query builder strips punctuation,
drops stopwords, caps at 24 terms, and quotes every term so FTS5 operators in
user input are treated as literals — `NEAR(a b)` and `"; DROP TABLE` both arrive
as ordinary words.

Two details worth calling out:

- `ORDER BY bm25(...) ASC` is correct. SQLite's `bm25()` returns _more negative_
  values for better matches, so descending would return the worst results first.
- Symbolic language names are folded before punctuation is stripped. Without
  that, `C++` loses its `+` characters and the remaining single `c` is filtered
  out by the length rule, making every C++ error unsearchable.

**Dense.** `@cf/baai/bge-small-en-v1.5`, 384 dimensions, cosine. The embedded
text for a runbook deliberately excludes its commands: flags and paths are
high-value lexical signal that FTS5 already indexes precisely, but they add
noise to a sentence encoder — two runbooks that both mention `kubectl describe`
end up closer than they should.

**Fusion.**

```
score(d) = Σ  1 / (k + rank_m(d))       k = 60
          m
```

Rank fusion rather than score fusion, because `bm25()` returns unbounded
negatives and cosine returns 0–1. Combining raw scores would need per-engine
calibration that drifts as the corpus grows; combining ranks doesn't. A document
both engines return outranks one that only a single engine found, which is the
behaviour you want.

The vector index is populated out of band by `POST /api/admin/reindex`, not on
write. Embedding the corpus costs far more than the 10 ms CPU a request gets on
the free plan.

## Generation

Three tiers, described in the README. Two implementation notes:

**Gemini gets a `responseSchema`.** Without it, `responseMimeType:
application/json` alone produces JSON _most_ of the time, and the code ends up
stripping markdown fences and hoping. With it, the response is parseable
directly.

**Everything is validated anyway.** Workers AI has no schema parameter, and
cached responses may predate a validator change. So `core/schema.ts` re-checks
every field before it leaves the Worker:

- steps must be objects with a non-empty `action`; bare strings are dropped
- step numbers are reassigned sequentially, because models skip and repeat them
- source URLs must parse as `http:` or `https:` — a model emitting
  `javascript:...` would otherwise become a live XSS, since those render as
  anchors
- domain and severity must be members of their enums
- everything is length-capped

## Caching

The key is SHA-256 of the query after lowercasing, stripping punctuation and
collapsing whitespace, so `Docker exit code 137?` and `docker exit code 137`
share an entry. Underscores survive normalisation because they appear inside
real identifiers like `ERR_OSSL_EVP_UNSUPPORTED`.

**Degraded answers are never cached.** If every model tier is unavailable, tier 3
still returns something useful — but caching it would pin that fallback in front
of the query for the full seven-day TTL, so a single upstream outage would keep
serving stale generic advice long after it ended. `isCacheable()` refuses
anything whose model starts with `catalog/`.

## Rate limiting

One counter per (identity, minute) and one per (identity, day), in D1.

The verdict interpolates across the minute boundary:

```
rate = previous_minute_hits × (fraction of window still covered)
     + current_minute_hits
```

Twenty seconds into a minute, the previous window still covers two thirds of the
trailing sixty seconds, so it contributes two thirds of its count. That is the
standard sliding-window-counter approximation: two rows per identity instead of
one row per request, and it closes the burst-at-the-boundary hole a plain fixed
window leaves open.

The counter is incremented _before_ the verdict is computed, in a single
`INSERT ... ON CONFLICT DO UPDATE ... RETURNING`. Reading and then writing would
let concurrent requests all observe the same pre-increment value and all pass —
which is what the previous KV-based implementation did.

It **fails closed**. If D1 is unreachable the request is rejected. An open
limiter on a free tier is how you wake up to an exhausted quota.

## Observability

Three tables:

- `request_logs` — one row per request, retention-bounded
- `usage_daily` — rollups so the dashboard never scans the log table
- `rate_limits` — the counters above

The panel at `/admin` reads all three plus the runbook catalog. Auth is a single
bearer token compared in constant time; if `ADMIN_TOKEN` is unset the whole
surface returns 503 rather than falling open.

The panel builds every table cell with `textContent`, never string-concatenated
HTML. Log rows contain `query_text`, which is verbatim user input — someone can
search for `<img src=x onerror=...>` and it lands in that table. Since the admin
token lives in `sessionStorage` on the same origin, an injection there is a token
theft. The page is also served under `default-src 'none'` with
`frame-ancestors 'none'`.

## Frontend

Preact with hand-written CSS, ~22 kB of JS. Served as static assets by the same
Worker (`not_found_handling: single-page-application`), which is why the router
returns an explicit JSON 404 for unknown `/api/*` paths — otherwise the asset
handler answers a typo'd endpoint with `index.html` and a 200.

The wire contract lives in `shared/api.ts` and is imported by both sides, so the
response shape cannot drift between them.

## Housekeeping

A cron at 03:17 UTC purges expired cache rows, stale rate-limit buckets and logs
past `LOG_RETENTION_DAYS`. Every table on the write path has a retention rule;
without one, D1's 5 GB allowance is a countdown rather than a limit.
