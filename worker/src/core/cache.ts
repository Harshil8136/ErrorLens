import type { Env, TroubleshootResponse } from '../types';

/**
 * Collapses cosmetic differences so "Docker exit code 137?" and
 * "docker exit code 137" share a cache entry. Underscores survive because they
 * appear inside real error identifiers like ERR_OSSL_EVP_UNSUPPORTED.
 */
export function normalizeQuery(query: string): string {
  return query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_\s-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function hashQuery(query: string): Promise<string> {
  const data = new TextEncoder().encode(normalizeQuery(query));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}

/**
 * A degraded answer must never be cached.
 *
 * When every model tier is unavailable the pipeline still returns something
 * useful, but caching it would pin that fallback in front of the query for the
 * full TTL -- one upstream outage would keep serving stale generic advice for
 * a week after the outage ended.
 */
export function isCacheable(response: TroubleshootResponse): boolean {
  return !response.meta.model.startsWith('catalog/');
}

export async function readCache(env: Env, query: string): Promise<TroubleshootResponse | null> {
  try {
    const row = await env.DB.prepare(
      `SELECT response_json FROM query_cache
       WHERE query_hash = ? AND expires_at > datetime('now')`
    )
      .bind(await hashQuery(query))
      .first<{ response_json: string }>();

    if (!row?.response_json) return null;

    const parsed = JSON.parse(row.response_json) as TroubleshootResponse;
    parsed.meta.from_cache = true;
    parsed.meta.search_strategy = 'cache';
    return parsed;
  } catch (err) {
    console.warn('[cache] read failed:', err);
    return null;
  }
}

export async function writeCache(
  env: Env,
  query: string,
  response: TroubleshootResponse
): Promise<void> {
  if (!isCacheable(response)) return;

  const ttl = Number.parseInt(env.CACHE_TTL_SECONDS ?? '', 10) || 604_800;

  try {
    await env.DB.prepare(
      `INSERT INTO query_cache (query_hash, normalized_query, response_json, expires_at)
       VALUES (?, ?, ?, datetime('now', '+' || ? || ' seconds'))
       ON CONFLICT(query_hash) DO UPDATE SET
         response_json = excluded.response_json,
         expires_at    = excluded.expires_at,
         hit_count     = hit_count + 1`
    )
      .bind(await hashQuery(query), normalizeQuery(query), JSON.stringify(response), ttl)
      .run();
  } catch (err) {
    console.warn('[cache] write failed:', err);
  }
}

export async function bumpCacheHit(env: Env, query: string): Promise<void> {
  try {
    await env.DB.prepare('UPDATE query_cache SET hit_count = hit_count + 1 WHERE query_hash = ?')
      .bind(await hashQuery(query))
      .run();
  } catch {
    // Popularity stats are not worth failing a served response over.
  }
}

export async function purgeExpiredCache(env: Env): Promise<number> {
  const res = await env.DB.prepare(
    `DELETE FROM query_cache WHERE expires_at <= datetime('now')`
  ).run();
  return res.meta?.changes ?? 0;
}
