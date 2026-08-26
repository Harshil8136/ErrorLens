import type { Env, SearchStrategy } from '../types';

export interface LogEntry {
  route: string;
  method: string;
  status: number;
  durationMs?: number;
  ipHash?: string;
  country?: string;
  /** Only set for /api/troubleshoot. Truncated before storage. */
  queryText?: string;
  matchedSlug?: string;
  searchStrategy?: SearchStrategy;
  model?: string;
  cacheHit?: boolean;
  rateLimited?: boolean;
  errorKind?: string;
}

export interface LogRow {
  id: number;
  ts: string;
  route: string;
  method: string;
  status: number;
  duration_ms: number | null;
  ip_hash: string | null;
  country: string | null;
  query_text: string | null;
  matched_slug: string | null;
  search_strategy: string | null;
  model: string | null;
  cache_hit: number;
  rate_limited: number;
  error_kind: string | null;
}

/** Queries are technical error strings, but they are still user input -- cap
 *  what we keep so a pasted stack trace does not become a storage problem. */
const MAX_QUERY_CHARS = 300;

/**
 * Writes one row per request. Always called from `ctx.waitUntil`, and always
 * swallows its own errors: losing a log line must never turn a 200 into a 500.
 */
export async function writeLog(env: Env, entry: LogEntry): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO request_logs
         (route, method, status, duration_ms, ip_hash, country, query_text,
          matched_slug, search_strategy, model, cache_hit, rate_limited, error_kind)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        entry.route,
        entry.method,
        entry.status,
        entry.durationMs ?? null,
        entry.ipHash ?? null,
        entry.country ?? null,
        entry.queryText ? entry.queryText.slice(0, MAX_QUERY_CHARS) : null,
        entry.matchedSlug ?? null,
        entry.searchStrategy ?? null,
        entry.model ?? null,
        entry.cacheHit ? 1 : 0,
        entry.rateLimited ? 1 : 0,
        entry.errorKind ?? null
      )
      .run();
  } catch (err) {
    console.error('[logs] write failed:', err);
  }
}

export interface LogFilter {
  limit: number;
  offset: number;
  route?: string;
  status?: number;
  onlyErrors?: boolean;
  onlyMisses?: boolean;
}

export async function readLogs(
  env: Env,
  filter: LogFilter
): Promise<{ rows: LogRow[]; total: number }> {
  const where: string[] = [];
  const params: (string | number)[] = [];

  if (filter.route) {
    where.push('route = ?');
    params.push(filter.route);
  }
  if (typeof filter.status === 'number') {
    where.push('status = ?');
    params.push(filter.status);
  }
  if (filter.onlyErrors) {
    where.push('status >= 400');
  }
  if (filter.onlyMisses) {
    where.push("route = '/api/troubleshoot' AND matched_slug IS NULL");
  }

  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const countRow = await env.DB.prepare(`SELECT COUNT(*) AS n FROM request_logs ${clause}`)
    .bind(...params)
    .first<{ n: number }>();

  const { results } = await env.DB.prepare(
    `SELECT * FROM request_logs ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`
  )
    .bind(...params, filter.limit, filter.offset)
    .all<LogRow>();

  return { rows: results ?? [], total: countRow?.n ?? 0 };
}

export interface KnowledgeGap {
  query_text: string;
  count: number;
  first_seen: string;
  last_seen: string;
}

/**
 * Queries that reached the pipeline but matched no runbook. This is the most
 * useful thing in the panel: it is a ranked list of the runbooks worth writing
 * next, derived from what people actually asked for.
 */
export async function readKnowledgeGaps(env: Env, limit: number): Promise<KnowledgeGap[]> {
  const { results } = await env.DB.prepare(
    `SELECT query_text,
            COUNT(*) AS count,
            MIN(ts)  AS first_seen,
            MAX(ts)  AS last_seen
     FROM request_logs
     WHERE route = '/api/troubleshoot'
       AND matched_slug IS NULL
       AND query_text IS NOT NULL
       AND status = 200
     GROUP BY lower(query_text)
     ORDER BY count DESC, last_seen DESC
     LIMIT ?`
  )
    .bind(Math.max(1, Math.min(200, limit)))
    .all<KnowledgeGap>();

  return results ?? [];
}

export interface LatencyBuckets {
  avg_ms: number | null;
  p50_ms: number | null;
  p95_ms: number | null;
  p99_ms: number | null;
  samples: number;
}

/**
 * Percentiles computed in SQL over the recent window. NTILE would need a
 * window function over a potentially large scan; ordering and offsetting by a
 * computed rank is cheaper and D1 handles it fine at this table size.
 */
export async function readLatency(env: Env, days: number): Promise<LatencyBuckets> {
  const row = await env.DB.prepare(
    `WITH recent AS (
       SELECT duration_ms FROM request_logs
       WHERE route = '/api/troubleshoot'
         AND duration_ms IS NOT NULL
         AND ts >= datetime('now', ?)
       ORDER BY duration_ms
     ), counted AS (SELECT COUNT(*) AS n FROM recent)
     SELECT
       (SELECT n FROM counted) AS samples,
       (SELECT CAST(ROUND(AVG(duration_ms)) AS INTEGER) FROM recent) AS avg_ms,
       (SELECT duration_ms FROM recent LIMIT 1 OFFSET MAX(0, CAST((SELECT n FROM counted) * 0.50 AS INTEGER) - 1)) AS p50_ms,
       (SELECT duration_ms FROM recent LIMIT 1 OFFSET MAX(0, CAST((SELECT n FROM counted) * 0.95 AS INTEGER) - 1)) AS p95_ms,
       (SELECT duration_ms FROM recent LIMIT 1 OFFSET MAX(0, CAST((SELECT n FROM counted) * 0.99 AS INTEGER) - 1)) AS p99_ms`
  )
    .bind(`-${Math.max(1, Math.min(90, days))} days`)
    .first<LatencyBuckets>();

  return row ?? { avg_ms: null, p50_ms: null, p95_ms: null, p99_ms: null, samples: 0 };
}

/** Drops log rows past the retention window. Called from cron. */
export async function purgeLogs(env: Env, retentionDays: number): Promise<number> {
  const days = Math.max(1, Math.min(365, retentionDays));
  const res = await env.DB.prepare(`DELETE FROM request_logs WHERE ts < datetime('now', ?)`)
    .bind(`-${days} days`)
    .run();
  return res.meta?.changes ?? 0;
}
