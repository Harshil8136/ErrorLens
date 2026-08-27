# What gets logged

The public instance keeps request logs so the admin panel can show what is
being asked and which queries find nothing. This is what's in them.

## Stored per request

| Field                        | Example                                  | Why                                            |
| :--------------------------- | :--------------------------------------- | :--------------------------------------------- |
| Timestamp                    | `2026-08-26 19:41:02`                    | ordering, retention                            |
| Route and method             | `POST /api/troubleshoot`                 | traffic shape                                  |
| Status and duration          | `200`, `284`                             | error rate, latency percentiles                |
| Country                      | `CA`                                     | from Cloudflare's `CF-IPCountry` header        |
| Salted IP hash               | `a3f9c2...` (24 hex chars)               | rate limiting, abuse investigation             |
| Query text                   | `docker exit code 137`                   | knowledge-gap analysis, truncated to 300 chars |
| Matched runbook              | `docker-exit-code-137-oom`               | retrieval quality                              |
| Retrieval strategy and model | `hybrid`, `google/gemini-3.5-flash-lite` | cost and behaviour tracking                    |

## Not stored

- Raw IP addresses. Never written anywhere.
- User agents, referrers, cookies, or any browser fingerprint.
- Anything correlating one session's queries to another's. There is no session
  identifier.

## About the IP hash

Client IPs are hashed with SHA-256 and a secret salt (`IP_HASH_SALT`, set as a
Worker secret and never in the repository) before storage.

**This is pseudonymisation, not anonymisation.** IPv4 is a 32-bit space —
anyone holding the salt can rebuild the entire mapping in seconds. Under GDPR a
hashed IP is still personal data. The salt keeps the hashes useless to someone
who obtains a database dump without it; it does not make the data anonymous, and
this project does not claim it does.

An earlier version of the code hashed IPs with a salt hardcoded in public source,
which provided no protection at all while describing itself as GDPR compliant.
That has been fixed and the claim removed.

## Retention

Request logs are deleted after `LOG_RETENTION_DAYS` (default 30) by a nightly
cron. Rate-limit buckets are dropped within hours of becoming irrelevant.
Cached responses expire after `CACHE_TTL_SECONDS` (default 7 days).

Nothing is retained indefinitely, and nothing is exported anywhere.

## Query text

Queries are error strings, so they are usually not personal — but people paste
whole stack traces, and stack traces contain hostnames, file paths, usernames
and occasionally tokens.

If you run your own instance and this matters to you, either set
`LOG_RETENTION_DAYS` low or stop storing `query_text` entirely: it is a single
field in `writeLog` (`worker/src/storage/logs.ts`), and dropping it costs you
the knowledge-gap report and nothing else.

Please don't paste secrets into the public instance.

## Third parties

Query text and retrieved runbook context are sent to whichever model tier
handles the request:

- **Google AI Studio** (Gemini), under Google's API terms. Free-tier usage may
  be used to improve their products — check their current policy before sending
  anything sensitive.
- **Cloudflare Workers AI**, which runs on Cloudflare's infrastructure.

Tier 3 sends nothing anywhere; it answers from the local catalog.

The frontend loads one font stylesheet from Google Fonts. If you would rather it
didn't, self-host Fira Code and drop the two `<link>` tags in
`frontend/index.html` — the CSS falls back to the system monospace stack.
