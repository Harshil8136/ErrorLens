import type { Env } from '../types';

export interface RateLimitVerdict {
  allowed: boolean;
  /** Requests left in the current minute. */
  remaining: number;
  /** Seconds the caller should wait, for the Retry-After header. */
  retryAfter: number;
  reason?: string;
  /** Weighted count the minute decision was made on. Surfaced in the admin panel. */
  minuteRate: number;
  dayCount: number;
}

const MINUTE = 60;

/**
 * Sliding-window rate limiter backed by D1.
 *
 * Storing a row per request would give an exact sliding window but costs a
 * write per request and a scan per check. Instead we keep one counter per
 * (identity, minute) and interpolate across the boundary:
 *
 *   rate = previous_minute_hits * (fraction of the window still covered)
 *        + current_minute_hits
 *
 * At 20s into a minute the previous window still covers 2/3 of the trailing
 * 60s, so it contributes 2/3 of its count. That is the standard sliding-window
 * counter approximation -- it costs two rows instead of N, and it removes the
 * burst-at-the-boundary hole that a plain fixed window leaves open.
 *
 * The counter is incremented before the verdict is computed, using a single
 * atomic upsert with RETURNING. Reading and then writing would let concurrent
 * requests all observe the same pre-increment value and all pass.
 */
export async function checkRateLimit(
  env: Env,
  ipHash: string,
  now: number = Date.now()
): Promise<RateLimitVerdict> {
  const maxRpm = toPositiveInt(env.MAX_RPM_PER_IP, 5);
  const maxRpd = toPositiveInt(env.MAX_RPD_PER_IP, 30);

  const epochSeconds = Math.floor(now / 1000);
  const minuteId = Math.floor(epochSeconds / MINUTE);
  const dayId = Math.floor(epochSeconds / 86400);
  const elapsedInMinute = epochSeconds % MINUTE;

  try {
    const [prevRow, currRow, dayRow] = await env.DB.batch<{ hits: number }>([
      env.DB.prepare(
        `SELECT hits FROM rate_limits WHERE ip_hash = ? AND bucket_kind = 'min' AND bucket_id = ?`
      ).bind(ipHash, minuteId - 1),
      env.DB.prepare(
        `INSERT INTO rate_limits (ip_hash, bucket_kind, bucket_id, hits)
         VALUES (?, 'min', ?, 1)
         ON CONFLICT(ip_hash, bucket_kind, bucket_id) DO UPDATE SET hits = hits + 1
         RETURNING hits`
      ).bind(ipHash, minuteId),
      env.DB.prepare(
        `INSERT INTO rate_limits (ip_hash, bucket_kind, bucket_id, hits)
         VALUES (?, 'day', ?, 1)
         ON CONFLICT(ip_hash, bucket_kind, bucket_id) DO UPDATE SET hits = hits + 1
         RETURNING hits`
      ).bind(ipHash, dayId),
    ]);

    const prevHits = prevRow.results?.[0]?.hits ?? 0;
    const currHits = currRow.results?.[0]?.hits ?? 1;
    const dayCount = dayRow.results?.[0]?.hits ?? 1;

    const carryOver = prevHits * ((MINUTE - elapsedInMinute) / MINUTE);
    const minuteRate = carryOver + currHits;

    if (dayCount > maxRpd) {
      return {
        allowed: false,
        remaining: 0,
        retryAfter: 86400 - (epochSeconds % 86400),
        reason: `Daily limit of ${maxRpd} requests reached. This is a free-tier demo -- the cap keeps it free. Resets at 00:00 UTC.`,
        minuteRate,
        dayCount,
      };
    }

    if (minuteRate > maxRpm) {
      return {
        allowed: false,
        remaining: 0,
        retryAfter: MINUTE - elapsedInMinute,
        reason: `Rate limit of ${maxRpm} requests/minute reached. Try again in a few seconds.`,
        minuteRate,
        dayCount,
      };
    }

    return {
      allowed: true,
      remaining: Math.max(0, Math.floor(maxRpm - minuteRate)),
      retryAfter: 0,
      minuteRate,
      dayCount,
    };
  } catch (err) {
    // D1 is the only store here, so if it is unavailable the request was going
    // to fail at retrieval anyway. Fail closed: an open limiter on a free tier
    // is how you wake up to an exhausted quota.
    console.error('[rate-limit] D1 unavailable, failing closed:', err);
    return {
      allowed: false,
      remaining: 0,
      retryAfter: 30,
      reason: 'Rate limiter is temporarily unavailable. Please retry shortly.',
      minuteRate: 0,
      dayCount: 0,
    };
  }
}

/** Drops buckets that can no longer influence a decision. Called from cron. */
export async function purgeRateLimitBuckets(env: Env, now: number = Date.now()): Promise<number> {
  const epochSeconds = Math.floor(now / 1000);
  const minuteCutoff = Math.floor(epochSeconds / MINUTE) - 5;
  const dayCutoff = Math.floor(epochSeconds / 86400) - 2;

  const res = await env.DB.batch([
    env.DB.prepare(`DELETE FROM rate_limits WHERE bucket_kind = 'min' AND bucket_id < ?`).bind(
      minuteCutoff
    ),
    env.DB.prepare(`DELETE FROM rate_limits WHERE bucket_kind = 'day' AND bucket_id < ?`).bind(
      dayCutoff
    ),
  ]);

  return res.reduce((sum, r) => sum + (r.meta?.changes ?? 0), 0);
}

function toPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
