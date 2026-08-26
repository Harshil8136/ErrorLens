// ============================================================
// ErrorLens Zero-Cost Edge Query Cache
// ============================================================

import type { Env, TroubleshootResponse } from '../types';

export function normalizeQuery(query: string): string {
  return query
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function hashQuery(query: string): Promise<string> {
  const normalized = normalizeQuery(query);
  const data = new TextEncoder().encode(normalized);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .substring(0, 32);
}

export async function getCachedResponse(
  env: Env,
  query: string
): Promise<TroubleshootResponse | null> {
  const queryHash = await hashQuery(query);

  // 1. Check KV if bound
  if (env.KV) {
    try {
      const cachedStr = await env.KV.get(`cache:${queryHash}`);
      if (cachedStr) {
        const parsed = JSON.parse(cachedStr) as TroubleshootResponse;
        parsed.meta.from_cache = true;
        parsed.meta.search_strategy = 'cache';
        return parsed;
      }
    } catch (err) {
      console.warn('[Cache KV Read Error]', err);
    }
  }

  // 2. Check D1 query_cache table
  try {
    const row = await env.DB.prepare(`
      SELECT response_json, expires_at
      FROM query_cache
      WHERE query_hash = ? AND expires_at > datetime('now')
    `).bind(queryHash).first<{ response_json: string; expires_at: string }>();

    if (row?.response_json) {
      // Increment hit count asynchronously in background
      env.DB.prepare(`
        UPDATE query_cache SET hit_count = hit_count + 1 WHERE query_hash = ?
      `).bind(queryHash).run().catch(() => {});

      const parsed = JSON.parse(row.response_json) as TroubleshootResponse;
      parsed.meta.from_cache = true;
      parsed.meta.search_strategy = 'cache';
      return parsed;
    }
  } catch (err) {
    console.warn('[Cache D1 Read Error]', err);
  }

  return null;
}

export async function setCachedResponse(
  env: Env,
  query: string,
  response: TroubleshootResponse
): Promise<void> {
  const queryHash = await hashQuery(query);
  const normalized = normalizeQuery(query);
  const ttlSeconds = Number(env.CACHE_TTL_SECONDS || 604800); // 7 days default
  const responseJson = JSON.stringify(response);

  // 1. Write to KV if bound
  if (env.KV) {
    try {
      await env.KV.put(`cache:${queryHash}`, responseJson, {
        expirationTtl: ttlSeconds,
      });
    } catch (err) {
      console.warn('[Cache KV Write Error]', err);
    }
  }

  // 2. Write to D1
  try {
    await env.DB.prepare(`
      INSERT INTO query_cache (query_hash, normalized_query, response_json, expires_at)
      VALUES (?, ?, ?, datetime('now', '+' || ? || ' seconds'))
      ON CONFLICT(query_hash) DO UPDATE SET
        response_json = excluded.response_json,
        expires_at = excluded.expires_at,
        hit_count = hit_count + 1
    `).bind(queryHash, normalized, responseJson, ttlSeconds).run();
  } catch (err) {
    console.warn('[Cache D1 Write Error]', err);
  }
}
