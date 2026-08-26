import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

// Each test starts from a clean limiter so one test's requests cannot exhaust
// the budget for the next.
beforeEach(async () => {
  await env.DB.exec('DELETE FROM rate_limits');
  await env.DB.exec('DELETE FROM request_logs');
  await env.DB.exec('DELETE FROM usage_daily');
  await env.DB.exec('DELETE FROM query_cache');
});

function troubleshoot(body: unknown, headers: Record<string, string> = {}) {
  return SELF.fetch('https://errorlens.test/api/troubleshoot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.7', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('GET /api/health', () => {
  it('reports status and which bindings are present', async () => {
    const res = await SELF.fetch('https://errorlens.test/api/health');
    expect(res.status).toBe(200);

    const body = (await res.json()) as { status: string; bindings: Record<string, boolean> };
    expect(body.status).toBe('ok');
    expect(body.bindings.d1).toBe(true);
    // AI and Vectorize are unbound in tests. Health has to say so, not assume.
    expect(body.bindings.workers_ai).toBe(false);
  });
});

describe('POST /api/troubleshoot validation', () => {
  it('rejects a malformed JSON body', async () => {
    const res = await troubleshoot('{not json');
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/valid JSON/i);
  });

  it('rejects a missing query', async () => {
    expect((await troubleshoot({})).status).toBe(400);
  });

  it('rejects a non-string query', async () => {
    expect((await troubleshoot({ query: { evil: true } })).status).toBe(400);
  });

  it('rejects an over-length query', async () => {
    expect((await troubleshoot({ query: 'x'.repeat(1001) })).status).toBe(400);
  });
});

describe('POST /api/troubleshoot behaviour', () => {
  it('answers from the catalog when no model tier is reachable', async () => {
    // No GEMINI_API_KEY and no AI binding here, so this exercises tier 3 --
    // the reason the service has no hard dependency on an LLM being up.
    const res = await troubleshoot({ query: 'docker container exited with code 137' });
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      meta: { model: string };
      steps: unknown[];
      grounded: boolean;
      matched_runbook: { slug: string } | null;
    };
    expect(body.meta.model).toMatch(/^catalog\//);
    expect(body.steps.length).toBeGreaterThan(0);
    expect(body.grounded).toBe(true);
    expect(body.matched_runbook?.slug).toBe('docker-exit-code-137-oom');
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
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM query_cache').first<{ n: number }>();
    expect(row?.n).toBe(0);
  });

  it('logs the request with its matched runbook', async () => {
    await troubleshoot({ query: 'kubernetes pod crashloopbackoff' });
    const row = await env.DB.prepare(
      "SELECT status, matched_slug, query_text FROM request_logs WHERE route = '/api/troubleshoot' ORDER BY id DESC LIMIT 1"
    ).first<{ status: number; matched_slug: string; query_text: string }>();

    expect(row?.status).toBe(200);
    expect(row?.matched_slug).toBe('k8s-crashloopbackoff');
    expect(row?.query_text).toBe('kubernetes pod crashloopbackoff');
  });

  it('never stores a raw IP address', async () => {
    await troubleshoot({ query: 'linux no space left on device' });
    const row = await env.DB.prepare(
      'SELECT ip_hash FROM request_logs ORDER BY id DESC LIMIT 1'
    ).first<{ ip_hash: string }>();

    expect(row?.ip_hash).toBeTruthy();
    expect(row?.ip_hash).not.toContain('203.0.113.7');
  });
});

describe('rate limiting', () => {
  it('returns 429 with Retry-After once the minute budget is spent', async () => {
    let limited: Response | undefined;
    for (let i = 0; i < 9; i++) {
      const res = await troubleshoot({ query: `probe query number ${i}` });
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
    for (let i = 0; i < 9; i++) await troubleshoot({ query: `flood ${i}` });
    const row = await env.DB.prepare('SELECT rate_limited FROM usage_daily LIMIT 1').first<{
      rate_limited: number;
    }>();
    expect(row?.rate_limited).toBeGreaterThan(0);
  });
});

describe('routing', () => {
  it('answers unknown /api paths with JSON, not the SPA shell', async () => {
    // With not_found_handling=single-page-application the asset handler would
    // otherwise return index.html and a 200 for a typo'd endpoint.
    const res = await SELF.fetch('https://errorlens.test/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });

  it('serves the runbook catalog', async () => {
    const res = await SELF.fetch('https://errorlens.test/api/runbooks?limit=3');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { runbooks: unknown[]; total: number };
    expect(body.runbooks).toHaveLength(3);
    expect(body.total).toBeGreaterThan(3);
  });

  it('clamps a non-numeric limit instead of returning the whole table', async () => {
    const res = await SELF.fetch('https://errorlens.test/api/runbooks?limit=abc');
    const body = (await res.json()) as { runbooks: unknown[] };
    expect(body.runbooks.length).toBeLessThanOrEqual(50);
  });

  it('404s an unknown runbook slug', async () => {
    expect((await SELF.fetch('https://errorlens.test/api/runbooks/nope-not-real')).status).toBe(404);
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
    expect((await SELF.fetch('https://errorlens.test/api/admin/overview')).status).toBe(401);
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
    // Budget limits come from the same constants the README quotes.
    expect(body.budget.worker_requests!.limit).toBe(100_000);
    expect(body.budget.gemini_requests!.limit).toBe(1_000);
  });

  it('surfaces unmatched queries as knowledge gaps', async () => {
    await troubleshoot({ query: 'some totally unknown failure mode' });
    const res = await SELF.fetch('https://errorlens.test/api/admin/gaps', {
      headers: { Authorization: 'Bearer test-admin-token' },
    });

    const body = (await res.json()) as { gaps: { query_text: string }[] };
    expect(body.gaps.some((g) => g.query_text === 'some totally unknown failure mode')).toBe(true);
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
