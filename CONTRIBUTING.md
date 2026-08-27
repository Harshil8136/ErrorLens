# Contributing

The most useful contribution is a runbook. The engine is fine; the corpus is
small, and that is what limits how often ErrorLens is actually useful.

Bug reports and fixes are welcome too.

## Before you start

```bash
npm install
npm run verify    # lint, typecheck, tests, runbook validation, build
```

`npm run verify` is exactly what CI runs. If it passes locally it will pass
there.

## Adding a runbook

A runbook is a markdown file in `datasets/runbooks/`. The parser is strict —
every step needs a real command in its own fenced block, and a stated expected
outcome. That is not bureaucracy: the UI puts a copy button next to whatever
lands in the `command` field, so prose in there becomes a button that copies a
sentence into someone's terminal.

### The format

````markdown
---
slug: aws-s3-403-access-denied
category: cloud
error_code: AccessDenied
title: S3 returns 403 AccessDenied on a bucket you own
tags: [aws, s3, iam, permissions, 403]
source_url: https://docs.aws.amazon.com/AmazonS3/latest/userguide/troubleshoot-403-errors.html
verified_at: 2026-08-26
---

# S3 returns 403 AccessDenied on a bucket you own

## Summary

One sentence on what the user is seeing.

## Root Cause

What is actually happening. Mechanism, not restatement of the symptom.

## Diagnostic Command

```bash
aws sts get-caller-identity
```

## Triage Steps

### 1. Confirm which identity is making the request

Short explanation of what this step establishes.

```bash
aws sts get-caller-identity
```

**Expected:** The ARN you think is calling. A different ARN means the credential chain picked something else up.

### 2. Check for an explicit Deny in the bucket policy

An explicit Deny overrides every Allow, in every layer.

```bash
aws s3api get-bucket-policy --bucket <bucket-name> --output text
```

**Expected:** No statement with "Effect": "Deny" matching your principal.
````

### Rules the validator enforces

- `slug`, `category`, `error_code`, `title` and `source_url` are required.
- `slug` is lowercase words separated by hyphens, unique, and must not collide
  with a runbook already in `worker/migrations/`.
- `source_url` must be `https` and should point at vendor documentation, not a
  blog post that might disappear.
- At least two triage steps.
- Every step needs a fenced command block and an `**Expected:**` line.
- Commands cannot contain backticks — that almost always means prose leaked in.

### Then

```bash
npm run runbooks:validate    # tells you exactly what is wrong, per file
npm run runbooks:build       # compiles to worker/migrations/NNNN_runbooks_*.sql
```

Commit both the markdown and the generated migration. The build step is
idempotent, so re-running it with no changes produces no new file.

After a maintainer merges it, they run:

```bash
npx wrangler d1 migrations apply errorlens-db --remote
curl -X POST https://<worker>/api/admin/reindex -H "Authorization: Bearer $ADMIN_TOKEN"
```

The reindex is what puts the new runbook into the vector index. Without it, the
runbook is findable lexically but not semantically.

## What makes a good runbook

Accuracy is the whole product. A wrong runbook is worse than a missing one,
because it looks authoritative.

- **Check every flag against current documentation.** Not memory. Flags get
  deprecated. This project has already shipped one runbook that confused
  Cloudflare's error 1101 with 1102 while citing the page that distinguishes
  them.
- **Step 1 should confirm the diagnosis**, not start fixing. Half of
  troubleshooting is finding out you have a different problem.
- **Use `<angle-bracket>` placeholders** for anything you cannot know.
- **Write the expected output**, so someone can tell whether the step worked.
- **Set `verified_at`** to the date you checked it.
- Prefer errors people actually hit. If it is not something you would search
  for at 2am, it probably is not worth an entry.

## Code changes

- `npm run verify` must pass.
- New behaviour needs a test. Worker tests run inside `workerd` against a real
  D1 with migrations applied — look at `worker/src/index.test.ts` for the shape.
- `any` is a lint error. If a type is genuinely unknown, use `unknown` and
  narrow it.
- Comments should explain why, not what. The best ones in this codebase record
  a decision or a bug that is not obvious from the code.

## Commits and PRs

No strict convention. Write a subject line that says what changed, and a body
explaining why if it is not obvious. Small PRs get reviewed faster.

## Reporting a bug

Open an issue with the query you ran, what you expected, and what you got. If
it is a retrieval problem, the query text alone is usually enough — the
knowledge-gap report will already have recorded it.

For anything security-related, see [SECURITY.md](SECURITY.md) instead.
