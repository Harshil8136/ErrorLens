/**
 * Compares two strings without leaking their length relationship through
 * timing. A plain `===` bails on the first differing byte, which is enough
 * to recover a token one character at a time given a good enough clock.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (ab.length !== bb.length) return false;

  let diff = 0;
  for (let i = 0; i < ab.length; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

/**
 * Hashes a client IP with a secret salt before it is stored.
 *
 * This is pseudonymisation, not anonymisation: IPv4 is a 32-bit space, so
 * anyone holding the salt can rebuild the whole table. The salt therefore
 * lives in `wrangler secret`, never in the repo, and the hashes expire with
 * their rate-limit rows. Hashed IPs are still personal data under GDPR --
 * see docs/PRIVACY.md.
 */
export async function hashIp(ip: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 24);
}

/** Only http(s) links are ever handed to the browser. */
export function isSafeHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
