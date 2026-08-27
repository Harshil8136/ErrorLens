import { describe, expect, it } from 'vitest';
import { env, SELF } from 'cloudflare:test';

async function troubleshoot(body: Record<string, unknown>, ip = '203.0.113.7'): Promise<Response> {
  return await SELF.fetch('https://errorlens.test/api/troubleshoot', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'CF-Connecting-IP': ip,
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/troubleshoot validation', () => {
  it('rejects a malformed JSON body', async () => {
    const res = await SELF.fetch('https://errorlens.test/api/troubleshoot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'this is not json',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('JSON');
  });

  it('rejects a missing query', async () => {
    const res = await troubleshoot({});
    expect(res.status).toBe(400);
  });

  it('rejects a non-string query', async () => {
    const res = await troubleshoot({ query: 12345 });
    expect(res.status).toBe(400);
  });

  it('rejects an over-length query', async () => {
    expect((await troubleshoot({ query: 'x'.repeat(1001) })).status).toBe(400);
  });
});

describe('POST /api/troubleshoot behaviour', () => {
  it('answers with actionable steps when no model tier is reachable', async () => {
    const res = await troubleshoot({ query: 'docker container exited with code 137' });
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      meta: { model: string };
      steps: unknown[];
      grounded: boolean;
    };
    expect(body.steps.length).toBeGreaterThan(0);
  });

  it('still returns actionable steps when nothing matches', async () => {
    const res = await troubleshoot({ query: 'zzzz unmatchable gibberish qqq' });
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      matched_runbook: unknown;
      grounded: boolean;
      steps: unknown[];
    };
    expect(body.matched_runbook).toBeNull();
    expect(body.grounded).toBe(false);
    expect(body.steps.length).toBeGreaterThan(0);
  });

  it('does not cache a degraded catalog answer', async () => {
    await troubleshoot({ query: 'nginx 502 bad gateway upstream' });
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM query_cache').first<{
      n: number;
    }>();
    expect(row?.n).toBe(0);
  });

  it('logs the request in request_logs', async () => {
    await troubleshoot({ query: 'kubernetes pod crashloopbackoff' }, '203.0.113.88');
    const row = await env.DB.prepare(
      "SELECT status, query_text FROM request_logs WHERE route = '/api/troubleshoot' AND ip_hash != '' ORDER BY id DESC LIMIT 1"
    ).first<{ status: number; query_text: string }>();

    expect(row?.status).toBe(200);
    expect(row?.query_text).toBe('kubernetes pod crashloopbackoff');
  });

  it('never stores a raw IP address', async () => {
    await troubleshoot({ query: 'linux no space left on device' }, '203.0.113.89');
    const row = await env.DB.prepare(
      'SELECT ip_hash FROM request_logs ORDER BY id DESC LIMIT 1'
    ).first<{ ip_hash: string }>();

    expect(row?.ip_hash).toBeTruthy();
    expect(row?.ip_hash).not.toContain('203.0.113.89');
  });
});

describe('rate limiting', () => {
  it('returns 429 with Retry-After once the minute budget is spent', async () => {
    let limited: Response | undefined;
    for (let i = 0; i < 9; i++) {
      const res = await troubleshoot({ query: `probe query number ${i}` }, '203.0.113.99');
      if (res.status === 429) {
        limited = res;
        break;
      }
    }

    expect(limited, 'expected a 429 within 9 requests at 5 rpm').toBeDefined();
    expect(limited?.headers.get('Retry-After')).toBeTruthy();
    expect(((await limited?.json()) as { message: string }).message).toMatch(/rate limit/i);
  });

  it('counts a rejected request in the usage rollup', async () => {
    for (let i = 0; i < 9; i++) await troubleshoot({ query: `flood ${i}` }, '203.0.113.98');
    const row = await env.DB.prepare('SELECT rate_limited FROM usage_daily LIMIT 1').first<{
      rate_limited: number;
    }>();
    expect(row?.rate_limited).toBeGreaterThan(0);
  });
});

describe('routing', () => {
  it('answers unknown /api paths with JSON, not the SPA shell', async () => {
    const res = await SELF.fetch('https://errorlens.test/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });

  it('answers CORS preflight', async () => {
    const res = await SELF.fetch('https://errorlens.test/api/troubleshoot', { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('sets nosniff on JSON responses', async () => {
    const res = await SELF.fetch('https://errorlens.test/api/health');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
});

describe('admin API', () => {
  it('rejects a request with no token', async () => {
    const res = await SELF.fetch('https://errorlens.test/api/admin/overview');
    expect(res.status).toBe(401);
  });

  it('rejects a wrong token', async () => {
    const res = await SELF.fetch('https://errorlens.test/api/admin/overview', {
      headers: { Authorization: 'Bearer not-the-token' },
    });
    expect(res.status).toBe(401);
  });

  it('returns the overview and budget with a valid token', async () => {
    const res = await SELF.fetch('https://errorlens.test/api/admin/overview?days=7', {
      headers: { Authorization: 'Bearer test-admin-token' },
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      totals: unknown;
      budget: Record<string, { limit: number }>;
    };
    expect(body.totals).toBeDefined();
    expect(body.budget.worker_requests!.limit).toBe(100_000);
    expect(body.budget.gemini_requests!.limit).toBe(1_000);
  });

  it('surfaces unmatched queries as knowledge gaps', async () => {
    const query = 'zxqv frobnicator quokka telemetry';
    await troubleshoot({ query }, '203.0.113.77');

    const res = await SELF.fetch('https://errorlens.test/api/admin/gaps', {
      headers: { Authorization: 'Bearer test-admin-token' },
    });

    const body = (await res.json()) as { gaps: { query_text: string }[] };
    expect(body.gaps.some((g) => g.query_text === query)).toBe(true);
  });

  it('serves the admin panel with a restrictive CSP', async () => {
    const res = await SELF.fetch('https://errorlens.test/admin');
    expect(res.status).toBe(200);

    const csp = res.headers.get('Content-Security-Policy') ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
  });
});
