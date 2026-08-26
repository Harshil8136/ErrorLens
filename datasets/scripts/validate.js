#!/usr/bin/env node
/**
 * Validates every runbook in datasets/runbooks and exits non-zero on the first
 * problem. Wired into CI, so a malformed contribution fails the PR rather than
 * silently producing a broken row.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RunbookError, parseRunbook } from './lib/parse-runbook.js';

const runbooksDir = fileURLToPath(new URL('../runbooks', import.meta.url));
const seedPath = fileURLToPath(new URL('../../worker/migrations', import.meta.url));

/** Slugs already shipped in a migration, so a contribution cannot shadow one. */
function existingSlugs() {
  const slugs = new Set();
  for (const file of readdirSync(seedPath).filter((f) => f.endsWith('.sql'))) {
    if (file.includes('runbooks_')) continue; // generated files are ours
    const sql = readFileSync(join(seedPath, file), 'utf8');
    for (const match of sql.matchAll(/'([a-z0-9]+(?:-[a-z0-9]+)*)',\s*\r?\n\s*'/g)) {
      slugs.add(match[1]);
    }
  }
  return slugs;
}

function main() {
  let files;
  try {
    files = readdirSync(runbooksDir).filter((f) => f.endsWith('.md'));
  } catch {
    console.log('No datasets/runbooks directory; nothing to validate.');
    return 0;
  }

  if (files.length === 0) {
    console.log('No runbooks to validate.');
    return 0;
  }

  const reserved = existingSlugs();
  const seen = new Map();
  const problems = [];

  for (const file of files) {
    try {
      const runbook = parseRunbook(readFileSync(join(runbooksDir, file), 'utf8'));

      if (seen.has(runbook.slug)) {
        problems.push(`${file}: slug "${runbook.slug}" already used by ${seen.get(runbook.slug)}`);
        continue;
      }
      if (reserved.has(runbook.slug)) {
        problems.push(
          `${file}: slug "${runbook.slug}" collides with a runbook already seeded in worker/migrations`
        );
        continue;
      }

      seen.set(runbook.slug, file);
      const steps = JSON.parse(runbook.solution_steps);
      console.log(`  ok  ${file.padEnd(38)} ${runbook.error_code} (${steps.length} steps)`);
    } catch (err) {
      const message = err instanceof RunbookError ? err.message : String(err);
      problems.push(`${file}: ${message}`);
    }
  }

  if (problems.length > 0) {
    console.error(`\n${problems.length} problem(s):\n`);
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error('\nSee CONTRIBUTING.md for the runbook format.');
    return 1;
  }

  console.log(`\n${files.length} runbook(s) valid.`);
  return 0;
}

process.exit(main());
