// ============================================================
// ErrorLens Edge Rate Limiting (Abuse Shield for Free Tier)
// ============================================================

import type { Env } from '../types';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetSeconds: number;
  reason?: string;
}

/**
 * Computes a SHA-256 hash of the client IP so we never store raw PII/IP addresses.
 */
async function hashIp(ip: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(ip + '_errorlens_salt');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 16);
}

/**
 * Checks sliding-window minute rate limit and daily limit.
 */
export async function checkRateLimit(
  env: Env,
  clientIp: string
): Promise<RateLimitResult> {
  const maxRpm = Number(env.MAX_RPM_PER_IP || 5);
  const maxRpd = Number(env.MAX_RPD_PER_IP || 30);
  const ipHash = await hashIp(clientIp || '127.0.0.1');

  const now = Math.floor(Date.now() / 1000);
  const currentMinute = Math.floor(now / 60);

  // 1. Try KV if bound (fastest, ~5ms)
  if (env.KV) {
    try {
      const minKey = `rl:min:${ipHash}:${currentMinute}`;
      const dayKey = `rl:day:${ipHash}:${Math.floor(now / 86400)}`;

      const [minCountStr, dayCountStr] = await Promise.all([
        env.KV.get(minKey),
        env.KV.get(dayKey),
      ]);

      const minCount = parseInt(minCountStr || '0', 10);
      const dayCount = parseInt(dayCountStr || '0', 10);

      if (minCount >= maxRpm) {
        return {
          allowed: false,
          remaining: 0,
          resetSeconds: 60 - (now % 60),
          reason: `Minute rate limit exceeded (${maxRpm} req/min). Please wait a moment.`,
        };
      }

      if (dayCount >= maxRpd) {
        return {
          allowed: false,
          remaining: 0,
          resetSeconds: 86400 - (now % 86400),
          reason: `Daily quota limit exceeded (${maxRpd} req/day). Please check back tomorrow.`,
        };
      }

      // Increment counters
      await Promise.all([
        env.KV.put(minKey, String(minCount + 1), { expirationTtl: 120 }),
        env.KV.put(dayKey, String(dayCount + 1), { expirationTtl: 90000 }),
      ]);

      return {
        allowed: true,
        remaining: Math.max(0, maxRpm - (minCount + 1)),
        resetSeconds: 60 - (now % 60),
      };
    } catch (err) {
      console.warn('[RateLimit KV] Fallback to D1:', err);
    }
  }

  // 2. Fallback to D1 table
  try {
    const row = await env.DB.prepare(
      'SELECT request_count FROM ip_rate_limits WHERE ip_hash = ? AND window_minute = ?'
    )
      .bind(ipHash, currentMinute)
      .first<{ request_count: number }>();

    const currentCount = row?.request_count ?? 0;

    if (currentCount >= maxRpm) {
      return {
        allowed: false,
        remaining: 0,
        resetSeconds: 60 - (now % 60),
        reason: `Rate limit reached (${maxRpm} req/min). Please wait a few seconds.`,
      };
    }

    // Insert or increment in D1
    await env.DB.prepare(`
      INSERT INTO ip_rate_limits (ip_hash, window_minute, request_count)
      VALUES (?, ?, 1)
      ON CONFLICT(ip_hash, window_minute) DO UPDATE SET request_count = request_count + 1
    `).bind(ipHash, currentMinute).run();

    return {
      allowed: true,
      remaining: Math.max(0, maxRpm - (currentCount + 1)),
      resetSeconds: 60 - (now % 60),
    };
  } catch (d1Err) {
    // If rate limiting fails, fail open to avoid blocking legitimate users
    console.error('[RateLimit D1 Error]', d1Err);
    return {
      allowed: true,
      remaining: 1,
      resetSeconds: 60,
    };
  }
}
