import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RunbookError, parseRunbook } from './parse-runbook.js';

const VALID = `---
slug: example-error
category: linux
error_code: ENOSPC
title: No space left on device
tags: [linux, disk]
source_url: https://man7.org/linux/man-pages/man2/write.2.html
verified_at: 2026-08-26
---

# No space left on device

## Summary
Writes fail even though df reports free space.

## Root Cause
The filesystem ran out of inodes rather than blocks.

## Diagnostic Command
\`\`\`bash
df -i /
\`\`\`

## Triage Steps

### 1. Check inode usage
Blocks and inodes are exhausted independently.

\`\`\`bash
df -i /
\`\`\`

**Expected:** IUse% at or near 100 while Use% is low.

### 2. Find the directory holding the small files
Narrows it to one tree instead of guessing.

\`\`\`bash
find / -xdev -printf '%h\\n' | sort | uniq -c | sort -rn | head
\`\`\`

**Expected:** A directory with a count in the hundreds of thousands.
`;

function without(field) {
  return VALID.replace(new RegExp(`^${field}:.*\\n`, 'm'), '');
}

describe('parseRunbook', () => {
  it('parses a well-formed runbook', () => {
    const rb = parseRunbook(VALID);
    assert.equal(rb.slug, 'example-error');
    assert.equal(rb.error_code, 'ENOSPC');
    assert.equal(rb.category, 'linux');
    assert.equal(rb.verified_at, '2026-08-26');
    assert.deepEqual(JSON.parse(rb.tags), ['linux', 'disk']);
  });

  it('extracts the diagnostic command without its fence', () => {
    assert.equal(parseRunbook(VALID).diagnostic_command, 'df -i /');
  });

  it('extracts a runnable command per step, not the prose around it', () => {
    // The previous parser swallowed the whole line, so `command` came out as a
    // sentence with backticks in it -- next to a "Copy command" button.
    const steps = JSON.parse(parseRunbook(VALID).solution_steps);
    assert.equal(steps.length, 2);
    assert.equal(steps[0].command, 'df -i /');
    assert.ok(!steps[0].command.includes('`'));
    assert.ok(!steps[0].command.includes('Blocks and inodes'));
  });

  it('captures a real expected outcome per step', () => {
    const steps = JSON.parse(parseRunbook(VALID).solution_steps);
    assert.match(steps[0].expected, /IUse%/);
    assert.notEqual(steps[1].expected, 'Verified resolution');
  });

  it('numbers steps sequentially', () => {
    const steps = JSON.parse(parseRunbook(VALID).solution_steps);
    assert.deepEqual(
      steps.map((s) => s.step),
      [1, 2]
    );
  });

  it('parses the last section in the file', () => {
    // Triage Steps is last and has no following heading. An earlier version
    // used a `\\Z` anchor, which JavaScript treats as a literal "Z", so this
    // section silently came back empty.
    assert.ok(JSON.parse(parseRunbook(VALID).solution_steps).length > 0);
  });

  for (const field of ['slug', 'category', 'error_code', 'title', 'source_url']) {
    it(`rejects a missing ${field}`, () => {
      assert.throws(() => parseRunbook(without(field)), RunbookError);
    });
  }

  it('rejects frontmatter that is missing entirely', () => {
    assert.throws(() => parseRunbook('# Just a heading\n'), RunbookError);
  });

  it('rejects a malformed slug', () => {
    const bad = VALID.replace('slug: example-error', 'slug: Example Error');
    assert.throws(() => parseRunbook(bad), /Invalid slug/);
  });

  it('rejects a non-https source_url', () => {
    const bad = VALID.replace('https://man7.org', 'http://man7.org');
    assert.throws(() => parseRunbook(bad), /https/);
  });

  it('rejects a step with no fenced command', () => {
    const bad = VALID.replace('```bash\ndf -i /\n```\n\n**Expected:** IUse%', '**Expected:** IUse%');
    assert.throws(() => parseRunbook(bad), /fenced command block/);
  });

  it('rejects a step with no expected outcome', () => {
    const bad = VALID.replace('**Expected:** IUse% at or near 100 while Use% is low.\n', '');
    assert.throws(() => parseRunbook(bad), /Expected/);
  });

  it('rejects a runbook with fewer than two steps', () => {
    const single = VALID.slice(0, VALID.indexOf('### 2.'));
    assert.throws(() => parseRunbook(single), /at least 2 triage steps/);
  });
});
