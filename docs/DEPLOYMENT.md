# Deployment

Everything you need to run this in production, in order. Roughly 30 minutes,
most of it waiting on dashboards.

Nothing here costs money. Every service used has a free tier that this project
is designed to stay inside, and the code enforces that rather than trusting it.

---

## Before you start

You need:

- A Cloudflare account (free plan is fine)
- A Google account for AI Studio
- Node 20 or newer
- `git`, and `openssl` for generating secrets (Git Bash on Windows has it)

Check your tooling:

```bash
node --version          # v20 or higher
npx wrangler --version  # 4.x
npx wrangler whoami     # should show your account
```

If `whoami` says you are not authenticated:

```bash
npx wrangler login
```

---

## 1. Create the Cloudflare resources

Run these from the `worker/` directory. Each prints an ID you will need.

```bash
cd worker

npx wrangler d1 create errorlens-db
npx wrangler vectorize create errorlens-vectors --dimensions=384 --metric=cosine
```

**The 384 matters.** It has to match `@cf/baai/bge-small-en-v1.5`. Create the
index at any other width and every upsert fails.

Open `worker/wrangler.jsonc` and replace two values with what the commands
printed:

```jsonc
"account_id": "<your account id>",          // from `wrangler whoami`
"d1_databases": [{ "database_id": "<from the d1 create output>" }]
```

Also change `"name"` from `errorlens-worker` to something available — it becomes
your `*.workers.dev` subdomain. Check it is free by visiting
`https://<name>.workers.dev` first; if something loads, pick another.

> This is worth doing carefully. The previous version of this project shipped a
> README linking to `errorlens.pages.dev`, which turned out to belong to a
> stranger's homework app.

---

## 2. Get a Google AI Studio key

1. Go to <https://aistudio.google.com/apikey>
2. **Create API key**, and pick a project when asked
3. Copy it. It looks like `AIza...`

The free tier for Gemini Flash-Lite is **15 requests/minute and 1,000/day**.
No card required, and no billing can be enabled by accident.

**Do not paste this key into a file in the repo.** Step 4 puts it in Cloudflare's
secret store, which is the only place it should live.

---

## 3. Generate two secrets

```bash
openssl rand -hex 32   # this is your ADMIN_TOKEN
openssl rand -hex 32   # this is your IP_HASH_SALT
```

Keep both somewhere safe — a password manager, not a text file in the project.

- `ADMIN_TOKEN` is the only thing standing between the internet and your logs.
- `IP_HASH_SALT` is what makes stored IP hashes useless to anyone who gets a
  database dump. Changing it later invalidates existing rate-limit buckets,
  which is harmless but resets everyone's counters.

---

## 4. Load the secrets into Cloudflare

Each command prompts for the value and does not echo it.

```bash
cd worker

npx wrangler secret put GEMINI_API_KEY   # paste the AIza... key
npx wrangler secret put ADMIN_TOKEN      # paste the first openssl output
npx wrangler secret put IP_HASH_SALT     # paste the second openssl output
```

Confirm all three landed:

```bash
npx wrangler secret list
```

You should see exactly those three names. The values are never retrievable
again, which is the point.

---

## 5. Apply the database schema

```bash
npx wrangler d1 migrations apply errorlens-db --remote
```

You should see six migrations applied. Verify the runbooks loaded:

```bash
npx wrangler d1 execute errorlens-db --remote \
  --command "SELECT COUNT(*) AS n FROM runbooks"
```

Expect 13.

---

## 6. Build and deploy

```bash
cd ..
npm run build                        # produces frontend/dist
npm run deploy --workspace=worker
```

Wrangler prints your URL. Check it:

```bash
curl https://<your-worker>.workers.dev/api/health
```

Every binding should read `true` except `admin_token` — which reads `true` too,
since you set it in step 4.

---

## 7. Populate the vector index

The hybrid search has two halves. The lexical half works the moment migrations
are applied. The dense half needs the runbooks embedded, and that runs
out of band because embedding the whole corpus costs far more than the 10 ms of
CPU a single request gets.

```bash
export ADMIN_TOKEN='<the token from step 3>'

curl -X POST https://<your-worker>.workers.dev/api/admin/reindex \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

Expect `{"upserted":13,"skipped":0,"total":13,"message":"Reindexed 13 of 13 runbooks"}`.

Now prove the dense half is actually contributing, using a query that shares no
words with any runbook title:

```bash
curl -s -X POST https://<your-worker>.workers.dev/api/troubleshoot \
  -H 'Content-Type: application/json' \
  -d '{"query":"my container got killed for using too much RAM"}' \
  | grep -o '"search_strategy":"[a-z]*"'
```

`"hybrid"` means both engines ran. `"fts"` means the reindex did not take —
re-run step 7 and check the response.

**Re-run this reindex every time you add runbooks.** It is the one step that is
easy to forget, and forgetting it means new runbooks are findable by exact
keyword but not by description.

---

## 8. Turn on bot protection

Skip this and the service still works — per-IP limits and the daily budget
ceiling already stop it from costing money. But per-IP limits do not stop a
distributed scraper, and this step does.

**Create the widget:**

```bash
cd worker
npx wrangler turnstile widget create "ErrorLens" \
  --domain <your-worker>.workers.dev \
  --mode managed
```

It prints a **sitekey** (public) and a **secret** (private).

**Wire the public half.** In `worker/wrangler.jsonc`:

```jsonc
"TURNSTILE_SITE_KEY": "0x4AAA...",              // the sitekey
"TURNSTILE_HOSTNAMES": "<your-worker>.workers.dev"
```

`TURNSTILE_HOSTNAMES` is the allowlist the server checks a verified token
against. **Do not put `localhost` in a production value** — that would let a
token minted on a local page be replayed against production.

**Wire the private half:**

```bash
npx wrangler secret put TURNSTILE_SECRET_KEY   # paste the secret
```

**Redeploy and confirm it is enforcing:**

```bash
cd .. && npm run deploy --workspace=worker

# No token -> must be refused
curl -s -X POST https://<your-worker>.workers.dev/api/troubleshoot \
  -H 'Content-Type: application/json' -d '{"query":"exit code 137"}'
```

Expect a 403 with `"Complete the verification check and try again."` Then open
the site in a browser — the widget appears, solves itself, and the search works.

If you see the 403 in the browser too, `TURNSTILE_HOSTNAMES` does not match the
hostname you are loading the page from.

---

## 9. Push to GitHub

The repository has no remote yet.

```bash
# Create an empty repo on github.com first (no README, no .gitignore)
git remote add origin https://github.com/<you>/errorlens.git
git push -u origin main
```

Before you push, confirm nothing sensitive is tracked:

```bash
git ls-files | grep -iE '\.dev\.vars$|\.env$'     # must print nothing
git log -p | grep -icE 'AIza[0-9A-Za-z_-]{30}'    # must print 0
```

Then, in the repository settings:

- **Settings → Branches → Add branch protection rule** for `main`: require the
  `Verify` status check to pass. This is what makes the CI badge meaningful.
- **Settings → Code security → Enable Dependabot alerts and security updates.**
  `.github/dependabot.yml` is already committed.
- **Settings → Actions → General →** set workflow permissions to read-only.

Update the three placeholder URLs, which currently say `harshil`:

- `README.md` — the CI badge and the Source link
- `frontend/index.html` — the `og:url` and `og:image` tags
- `frontend/src/App.tsx` — the Source link in the footer
- `SECURITY.md` and `CODE_OF_CONDUCT.md` — the advisory links

---

## 10. Confirm the whole thing works

```bash
# Health
curl -s https://<your-worker>.workers.dev/api/health | jq .

# A real diagnosis
curl -s -X POST https://<your-worker>.workers.dev/api/troubleshoot \
  -H 'Content-Type: application/json' \
  -d '{"query":"pod stuck in CrashLoopBackOff"}' | jq '.title, .meta'

# Admin, with your token
curl -s https://<your-worker>.workers.dev/api/admin/overview \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq '.budget'
```

Then open `https://<your-worker>.workers.dev/admin` in a browser, paste your
`ADMIN_TOKEN`, and you should see live traffic, the free-tier budget meter, and
the knowledge-gap report.

Finally, record real numbers so the docs can quote them:

```bash
ERRORLENS_URL=https://<your-worker>.workers.dev \
BENCH_LOCATION="<your city>" \
  node bench/run.mjs
```

That writes `bench/results.json`. It takes about five minutes because it paces
itself under the rate limit.

---

## What to watch after launch

Check `/admin` for the first few days.

| Signal                   | Meaning                                                        |
| :----------------------- | :------------------------------------------------------------- |
| Budget bars above 70%    | Tighten `MAX_RPD_PER_IP`, or Turnstile is off and should be on |
| Rising `rate_limited`    | Someone is scripting it; check the log's country column        |
| Knowledge gaps repeating | Write those runbooks — that list is your backlog               |
| `never_matched` runbooks | Either the tags are wrong or nobody has that problem           |
| Errors above zero        | Check `wrangler tail` for the reference ID in the response     |

Live logs:

```bash
npx wrangler tail --status error
```

---

## If something is wrong

**`Bindings not found` on deploy.** `wrangler.jsonc` still has a placeholder ID.
Re-check `database_id` and `account_id`.

**`search_strategy` is always `fts`.** The reindex in step 7 did not run, or
Vectorize was created at the wrong dimension. Delete and recreate the index with
`--dimensions=384`.

**Everything answers with `catalog/runbook`.** Either `GEMINI_API_KEY` is not
set, or a budget ceiling has been hit. Check `/api/admin/budget`.

**403 on every request after step 8.** `TURNSTILE_HOSTNAMES` does not match the
hostname serving the page.

**429 immediately.** Expected at more than 5 requests/minute from one IP. Raise
`MAX_RPM_PER_IP` in `wrangler.jsonc` if you are demoing to a room of people
behind one NAT.

**Admin returns 503.** `ADMIN_TOKEN` is not set. Re-run step 4.

---

## Rotating a secret

Any of them, at any time:

```bash
npx wrangler secret put <NAME>
npm run deploy --workspace=worker
```

Rotating `IP_HASH_SALT` resets rate-limit counters. Rotating `ADMIN_TOKEN`
locks out any browser session holding the old one. Neither loses data.
