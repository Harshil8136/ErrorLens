// ============================================================
// ErrorLens D1 Database Operations
// ============================================================

import type { Runbook, ParsedRunbook } from '../types';

export function parseRunbookRow(row: Runbook): ParsedRunbook {
  let solutionSteps: any[] = [];
  let tags: string[] = [];

  try {
    solutionSteps = JSON.parse(row.solution_steps || '[]');
  } catch {
    solutionSteps = [];
  }

  try {
    tags = JSON.parse(row.tags || '[]');
  } catch {
    tags = [];
  }

  return {
    ...row,
    solution_steps: solutionSteps,
    tags,
  };
}

/**
 * List all available runbooks (for browsing or autocomplete chips)
 */
export async function listAllRunbooks(
  db: D1Database,
  category?: string,
  limit = 50
): Promise<ParsedRunbook[]> {
  let sql = 'SELECT * FROM runbooks';
  const params: any[] = [];

  if (category) {
    sql += ' WHERE category = ?';
    params.push(category);
  }

  sql += ' ORDER BY id ASC LIMIT ?';
  params.push(limit);

  const stmt = db.prepare(sql).bind(...params);
  const { results } = await stmt.all<Runbook>();

  return (results || []).map(parseRunbookRow);
}

/**
 * Get runbook by unique URL slug
 */
export async function getRunbookBySlug(
  db: D1Database,
  slug: string
): Promise<ParsedRunbook | null> {
  const stmt = db.prepare('SELECT * FROM runbooks WHERE slug = ?').bind(slug);
  const row = await stmt.first<Runbook>();
  return row ? parseRunbookRow(row) : null;
}

/**
 * Safe FTS5 Full-Text Search
 * Sanitizes input to prevent FTS5 syntax errors (quotes, parentheses, wildcards)
 */
export async function searchRunbooksFTS(
  db: D1Database,
  query: string,
  limit = 5
): Promise<ParsedRunbook[]> {
  // Sanitize: strip quotes, brackets, and boolean operators that crash SQLite FTS5
  const sanitized = query
    .toLowerCase()
    .replace(/[¿?¡!.,;:'"()\[\]{}^~*+\-]/g, ' ')
    .trim();

  const words = sanitized
    .split(/\s+/)
    .filter(w => w.length > 1 && !['and', 'or', 'not', 'the', 'how', 'fix', 'why', 'what'].includes(w));

  if (words.length === 0) {
    return [];
  }

  // Use prefix token match for FTS5 (e.g. "crash*" OR "exit*" OR "137*")
  const ftsQuery = words.map(w => `"${w}"*`).join(' OR ');

  try {
    const sql = `
      SELECT r.*
      FROM runbooks_fts fts
      JOIN runbooks r ON r.id = fts.rowid
      WHERE runbooks_fts MATCH ?
      ORDER BY bm25(runbooks_fts) ASC
      LIMIT ?
    `;
    const { results } = await db.prepare(sql).bind(ftsQuery, limit).all<Runbook>();
    return (results || []).map(parseRunbookRow);
  } catch (err) {
    console.warn('[FTS5 Search] Warning, falling back to LIKE query:', err);
    // Graceful fallback to LIKE if FTS fails
    const likePattern = `%${words[0]}%`;
    const { results } = await db
      .prepare('SELECT * FROM runbooks WHERE title LIKE ? OR error_code LIKE ? OR summary LIKE ? LIMIT ?')
      .bind(likePattern, likePattern, likePattern, limit)
      .all<Runbook>();
    return (results || []).map(parseRunbookRow);
  }
}
