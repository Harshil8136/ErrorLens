/**
 * Parses a runbook markdown file into the shape the `runbooks` table expects.
 *
 * The step format is deliberately strict. An earlier version matched
 * `1. **Action**: prose with inline \`code\`` and pulled the whole remainder of
 * the line into the `command` field, which meant the UI showed a "Copy command"
 * button next to a sentence. Commands now have to live in their own fenced
 * block, so there is no ambiguity about what is runnable.
 */

const REQUIRED_FRONTMATTER = ['slug', 'category', 'error_code', 'title', 'source_url'];
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class RunbookError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RunbookError';
  }
}

function parseFrontmatter(raw) {
  const meta = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separator = trimmed.indexOf(':');
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();

    if (value.startsWith('[') && value.endsWith(']')) {
      meta[key] = value
        .slice(1, -1)
        .split(',')
        .map((item) => item.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
    } else {
      meta[key] = value.replace(/^["']|["']$/g, '');
    }
  }
  return meta;
}

/**
 * Splits the body into `## Heading` sections.
 *
 * Done as a single pass rather than one regex per heading: a lookahead like
 * `(?=^##\s|\Z)` looks right but `\Z` is not a JavaScript anchor -- it matches
 * a literal "Z" -- so the last section in a file silently failed to parse.
 */
function splitSections(body) {
  const sections = new Map();
  const lines = body.split(/\r?\n/);

  let current = null;
  let buffer = [];

  const flush = () => {
    if (current !== null) sections.set(current.toLowerCase(), buffer.join('\n').trim());
  };

  for (const line of lines) {
    // `## Heading` but not `### Step`.
    const heading = line.match(/^##\s+(?!#)(.+?)\s*$/);
    if (heading) {
      flush();
      current = heading[1];
      buffer = [];
    } else if (current !== null) {
      buffer.push(line);
    }
  }
  flush();

  return sections;
}

/** First fenced code block inside a chunk, with the fence and language removed. */
function firstFencedBlock(chunk) {
  const match = chunk.match(/```[a-zA-Z0-9]*\r?\n([\s\S]*?)```/);
  return match ? match[1].trim() : '';
}

function parseSteps(triageSection, slug) {
  // Each step opens with `### 1. Title`; split on that and keep the remainder.
  const chunks = triageSection.split(/^###\s+\d+\.\s*/m).slice(1);
  if (chunks.length === 0) {
    throw new RunbookError(
      `${slug}: no steps found. Each step must start with "### 1. Title" on its own line.`
    );
  }

  return chunks.map((chunk, index) => {
    const lines = chunk.split(/\r?\n/);
    const action = (lines.shift() ?? '').trim();
    if (!action) {
      throw new RunbookError(`${slug}: step ${index + 1} has no title.`);
    }

    const command = firstFencedBlock(chunk);
    if (!command) {
      throw new RunbookError(
        `${slug}: step ${index + 1} ("${action}") has no fenced command block.`
      );
    }
    if (command.includes('`')) {
      throw new RunbookError(
        `${slug}: step ${index + 1} command contains a backtick, which usually means prose leaked into the code block.`
      );
    }

    const expectedMatch = chunk.match(/\*\*Expected:\*\*\s*(.+)/);
    const expected = expectedMatch ? expectedMatch[1].trim().replace(/`/g, '') : '';
    if (!expected) {
      throw new RunbookError(
        `${slug}: step ${index + 1} ("${action}") has no "**Expected:**" line.`
      );
    }

    return { step: index + 1, action, command, expected };
  });
}

export function parseRunbook(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    throw new RunbookError('Missing YAML frontmatter delimited by --- lines.');
  }

  const [, frontmatterRaw, body] = match;
  const meta = parseFrontmatter(frontmatterRaw);

  for (const field of REQUIRED_FRONTMATTER) {
    if (!meta[field]) {
      throw new RunbookError(`Missing required frontmatter field: ${field}`);
    }
  }

  const slug = meta.slug;
  if (!SLUG_PATTERN.test(slug)) {
    throw new RunbookError(`Invalid slug "${slug}": use lowercase words separated by hyphens.`);
  }
  if (!/^https:\/\//.test(meta.source_url)) {
    throw new RunbookError(`${slug}: source_url must be an https URL.`);
  }

  const sections = splitSections(body);
  const summary = sections.get('summary') ?? '';
  const rootCause = sections.get('root cause') ?? '';
  const diagnostic = firstFencedBlock(sections.get('diagnostic command') ?? '');
  const steps = parseSteps(sections.get('triage steps') ?? '', slug);

  if (!summary) throw new RunbookError(`${slug}: missing "## Summary" section.`);
  if (!rootCause) throw new RunbookError(`${slug}: missing "## Root Cause" section.`);
  if (!diagnostic) {
    throw new RunbookError(`${slug}: "## Diagnostic Command" needs a fenced command block.`);
  }
  if (steps.length < 2) {
    throw new RunbookError(`${slug}: needs at least 2 triage steps, found ${steps.length}.`);
  }

  return {
    slug,
    category: meta.category,
    error_code: meta.error_code,
    title: meta.title,
    summary,
    root_cause: rootCause,
    diagnostic_command: diagnostic,
    solution_steps: JSON.stringify(steps),
    tags: JSON.stringify(Array.isArray(meta.tags) ? meta.tags : []),
    source_url: meta.source_url,
    verified_at: meta.verified_at ?? null,
  };
}
