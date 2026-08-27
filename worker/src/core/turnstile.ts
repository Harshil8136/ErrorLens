import type { Env } from '../types';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** The action stamped on the widget in the frontend. Verified server-side so a
 *  token minted for some other surface cannot be replayed against this one. */
export const TURNSTILE_ACTION = 'diagnose';

const MAX_TOKEN_CHARS = 2048;
const TIMEOUT_MS = 10_000;

export type TurnstileOutcome =
  { ok: true; skipped: boolean } | { ok: false; reason: 'missing' | 'invalid' };

interface SiteverifyResponse {
  success?: boolean;
  action?: string;
  hostname?: string;
  'error-codes'?: string[];
}

/**
 * Verifies a Turnstile token against Cloudflare's siteverify endpoint.
 *
 * Enforcement is opt-in: with TURNSTILE_SECRET_KEY unset the check is skipped
 * entirely, so local development and forks work without anyone provisioning a
 * widget. Once the secret exists the check is mandatory and fails closed —
 * a network error, a non-2xx, or an unparseable body all reject.
 *
 * Three things are checked, not one. `success` alone would accept a token
 * minted for a different action or issued to a different site, so the action
 * and the frontend hostname are compared too.
 */
export async function verifyTurnstile(
  env: Env,
  token: unknown,
  clientIp: string
): Promise<TurnstileOutcome> {
  const secret = env.TURNSTILE_SECRET_KEY;
  if (!secret) return { ok: true, skipped: true };

  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_CHARS) {
    return { ok: false, reason: 'missing' };
  }

  const allowedHosts = new Set(
    (env.TURNSTILE_HOSTNAMES ?? '')
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean)
  );

  // An empty allowlist would make the hostname check vacuous, which is the
  // failure mode where a token from any site the widget covers is accepted.
  if (allowedHosts.size === 0) {
    console.error('[turnstile] TURNSTILE_SECRET_KEY is set but TURNSTILE_HOSTNAMES is empty');
    return { ok: false, reason: 'invalid' };
  }

  let result: SiteverifyResponse;
  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: new URLSearchParams({ secret, response: token, remoteip: clientIp }),
    });
    if (!res.ok) throw new Error(`siteverify returned ${res.status}`);
    result = (await res.json()) as SiteverifyResponse;
  } catch (err) {
    console.error('[turnstile] siteverify unreachable, rejecting:', err);
    return { ok: false, reason: 'invalid' };
  }

  if (
    result.success !== true ||
    result.action !== TURNSTILE_ACTION ||
    !result.hostname ||
    !allowedHosts.has(result.hostname)
  ) {
    console.warn(
      `[turnstile] rejected: success=${result.success} action=${result.action} host=${result.hostname} codes=${(result['error-codes'] ?? []).join(',')}`
    );
    return { ok: false, reason: 'invalid' };
  }

  return { ok: true, skipped: false };
}
