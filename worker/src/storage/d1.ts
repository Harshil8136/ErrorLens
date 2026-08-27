import type { Runbook, RunbookRow, TriageStep } from '../types';

export function parseRunbook(row: RunbookRow): Runbook {
  return {
    ...row,
    solution_steps: safeJson<TriageStep[]>(row.solution_steps, []),
    tags: safeJson<string[]>(row.tags, []),
  };
}

function safeJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

/**
 * Words that carry no retrieval signal. The original list dropped `how`, `fix`
 * and `what` but kept `to`, so "how to fix" collapsed to the single term `to`
 * -- which matched most of the corpus. Connectors have to go too or the ranker
 * is handed pure noise.
 */
const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'but',
  'by',
  'can',
  'do',
  'does',
  'for',
  'from',
  'get',
  'getting',
  'got',
  'has',
  'have',
  'how',
  'i',
  'if',
  'in',
  'is',
  'it',
  'its',
  'me',
  'my',
  'not',
  'of',
  'on',
  'or',
  'the',
  'their',
  'then',
  'there',
  'this',
  'to',
  'was',
  'what',
  'when',
  'why',
  'with',
  'you',
  'your',
  'fix',
  'fixing',
  'help',
  'issue',
  'problem',
  'error',
  'errors',
]);

/**
 * Tokens that survive the punctuation strip because the symbols are part of
 * the name. Without this, `C++` loses its `+` characters and then the leftover
 * single `c` is filtered out, so C++ build failures are unsearchable.
 */
const SYMBOLIC_TOKENS: Record<string, string> = {
  'c++': 'cpp',
  'c#': 'csharp',
  '.net': 'dotnet',
  'f#': 'fsharp',
  'objective-c': 'objectivec',
};

const MAX_TERMS = 24;

/**
 * Turns free text into an FTS5 MATCH expression, or null when nothing useful
 * survives. Everything is quoted so FTS5 operators in user input are treated
 * as literals rather than syntax -- `NEAR(a b)` and `"; DROP TABLE` both come
 * through as ordinary terms.
 */
export function buildFtsQuery(input: string): string | null {
  let text = input.toLowerCase();

  // Fold symbolic language names to searchable aliases before punctuation goes.
  for (const [symbol, alias] of Object.entries(SYMBOLIC_TOKENS)) {
    if (text.includes(symbol)) {
      text = text.split(symbol).join(` ${alias} `);
    }
  }

  const terms = text
    .replace(/[^\p{L}\p{N}_]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !STOPWORDS.has(w))
    // Keep short tokens when they are numeric -- "137", "502" and "1102" are
    // the most precise signal in the whole query.
    .filter((w) => w.length > 1 || /^\d+$/.test(w))
    .slice(0, MAX_TERMS);

  const unique = [...new Set(terms)];
  if (unique.length === 0) return null;

  return unique.map((w) => `"${w.replace(/"/g, '""')}"*`).join(' OR ');
}

/**
 * Lexical search over the FTS5 index.
 *
 * bm25() returns a more negative number for a better match, so ASC is correct
 * here -- sorting DESC would return the worst matches first.
 */
export async function searchRunbooks(db: D1Database, query: string, limit = 5): Promise<Runbook[]> {
  const match = buildFtsQuery(query);
  if (!match) return [];

  try {
    const { results } = await db
      .prepare(
        `SELECT r.* FROM runbooks_fts
         JOIN runbooks r ON r.id = runbooks_fts.rowid
         WHERE runbooks_fts MATCH ?
         ORDER BY bm25(runbooks_fts) ASC
         LIMIT ?`
      )
      .bind(match, limit)
      .all<RunbookRow>();

    return (results ?? []).map(parseRunbook);
  } catch (err) {
    console.error('[d1] FTS query failed:', err);
    return [];
  }
}

export async function getRunbooksByIds(db: D1Database, ids: number[]): Promise<Runbook[]> {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  const { results } = await db
    .prepare(`SELECT * FROM runbooks WHERE id IN (${placeholders})`)
    .bind(...ids)
    .all<RunbookRow>();
  return (results ?? []).map(parseRunbook);
}

export async function listRunbooks(
  db: D1Database,
  opts: { category?: string; limit?: number; offset?: number } = {}
): Promise<{ runbooks: Runbook[]; total: number }> {
  const limit = clamp(opts.limit ?? 50, 1, 100);
  const offset = clamp(opts.offset ?? 0, 0, 100_000);
  const where = opts.category ? 'WHERE category = ?' : '';
  const params = opts.category ? [opts.category] : [];

  const countRow = await db
    .prepare(`SELECT COUNT(*) AS n FROM runbooks ${where}`)
    .bind(...params)
    .first<{ n: number }>();

  const { results } = await db
    .prepare(`SELECT * FROM runbooks ${where} ORDER BY category, error_code LIMIT ? OFFSET ?`)
    .bind(...params, limit, offset)
    .all<RunbookRow>();

  return { runbooks: (results ?? []).map(parseRunbook), total: countRow?.n ?? 0 };
}

export async function getRunbookBySlug(db: D1Database, slug: string): Promise<Runbook | null> {
  const row = await db
    .prepare('SELECT * FROM runbooks WHERE slug = ?')
    .bind(slug)
    .first<RunbookRow>();
  return row ? parseRunbook(row) : null;
}

/** Fire-and-forget popularity counter, used by the admin panel. */
export async function incrementHitCount(db: D1Database, id: number): Promise<void> {
  try {
    await db.prepare('UPDATE runbooks SET hit_count = hit_count + 1 WHERE id = ?').bind(id).run();
  } catch (err) {
    console.error('[d1] hit_count update failed:', err);
  }
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
