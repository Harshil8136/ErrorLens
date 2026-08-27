# Security

## Reporting

Open a [private security advisory](https://github.com/harshil/errorlens/security/advisories/new)
on this repository. Please don't open a public issue for anything exploitable.

I'll acknowledge within a few days. This is a personal project, not a product
with an on-call rotation, so please set expectations accordingly.

## The public instance

It runs on free tiers with per-IP limits of 5 requests/minute and 30/day. Those
are cost controls, not a security boundary. Please don't load-test it — you'll
exhaust the daily quota for everyone else and learn nothing that isn't already
in [docs/COST-MODEL.md](docs/COST-MODEL.md).

If you want to test against a real instance, deploy your own. It takes about
five minutes and costs nothing.

## Threat model

What this project actively defends against:

- **Model output reaching the DOM or a shell.** Everything a model produces is
  schema-validated server-side. Source URLs are restricted to `http`/`https` on
  both ends, because a `javascript:` URL rendered as an anchor is a live XSS.
- **Stored XSS via the admin panel.** Request logs contain verbatim user queries.
  The panel builds every cell with `textContent` and is served under
  `default-src 'none'`, because the admin token lives in `sessionStorage` on
  that origin.
- **FTS5 and SQL injection.** All values are bound. FTS5 operators in user input
  are quoted into literals.
- **Timing attacks on the admin token.** Compared byte-wise in constant time.
- **Quota exhaustion.** Sliding-window limiter that increments atomically before
  deciding, and fails closed if D1 is unreachable.
- **Credential leakage.** The Gemini key is sent as a header, never a query
  parameter, so it doesn't end up in request logs or referrers.

What it does not defend against:

- **Prompt injection steering generated content.** User input is delimited and
  framed as data, and output shape is validated — but a model can still be
  argued into writing a plausible command you shouldn't run. The mitigation is
  editorial rather than technical: every answer states whether its steps came
  from a reviewed runbook or from a model. Read commands before running them.
- **Denial of service beyond per-IP limits.** A distributed source can exhaust
  the daily quota. The service degrades to catalog answers rather than failing,
  which is the intended behaviour.
- **Anything about the anonymity of logged data.** Hashed IPs are
  pseudonymous, not anonymous. See [docs/PRIVACY.md](docs/PRIVACY.md).

## If you fork this

Set all three secrets. `ADMIN_TOKEN` in particular: if it's unset the admin API
returns 503 rather than falling open, but an empty or guessable value gives away
your logs and your reindex endpoint.

```bash
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put ADMIN_TOKEN     # openssl rand -hex 32
npx wrangler secret put IP_HASH_SALT    # openssl rand -hex 32
```
