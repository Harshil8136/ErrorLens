import type { Env } from '../types';
import { json } from '../index';
import { timingSafeEqual } from '../core/security';
import { clamp, listRunbooks } from '../storage/d1';
import { readKnowledgeGaps, readLatency, readLogs } from '../storage/logs';
import { FREE_TIER, getMonthlyVectorizeDims, getToday, getUsageRange } from '../storage/usage';
import { reindexRunbooks } from '../storage/vectorize';

/**
 * Admin surface. Everything here is read-only except /reindex.
 *
 * Auth is a single bearer token compared in constant time. If ADMIN_TOKEN is
 * unset the whole surface returns 503 rather than falling open -- an admin API
 * that is accidentally public is worse than one that is accidentally broken.
 */
export async function handleAdmin(request: Request, env: Env, path: string): Promise<Response> {
  if (!env.ADMIN_TOKEN) {
    return json({ error: 'Admin API is disabled: ADMIN_TOKEN is not configured' }, 503);
  }

  const header = request.headers.get('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token || !timingSafeEqual(token, env.ADMIN_TOKEN)) {
    return json({ error: 'Unauthorized' }, 401, {
      'WWW-Authenticate': 'Bearer realm="errorlens-admin"',
    });
  }

  const url = new URL(request.url);
  const route = path.slice('/api/admin/'.length);

  if (route === 'overview' && request.method === 'GET') {
    const days = clamp(Number.parseInt(url.searchParams.get('days') ?? '7', 10), 1, 90);
    const [usage, latency, today, monthlyDims, runbooks] = await Promise.all([
      getUsageRange(env, days),
      readLatency(env, days),
      getToday(env),
      getMonthlyVectorizeDims(env),
      listRunbooks(env.DB, { limit: 100 }),
    ]);

    const totals = usage.reduce(
      (acc, row) => ({
        requests: acc.requests + row.requests,
        troubleshoots: acc.troubleshoots + row.troubleshoots,
        cache_hits: acc.cache_hits + row.cache_hits,
        rate_limited: acc.rate_limited + row.rate_limited,
        errors: acc.errors + row.errors,
        gemini_calls: acc.gemini_calls + row.gemini_calls,
        workers_ai_calls: acc.workers_ai_calls + row.workers_ai_calls,
        neurons: acc.neurons + row.neurons_estimate,
      }),
      {
        requests: 0,
        troubleshoots: 0,
        cache_hits: 0,
        rate_limited: 0,
        errors: 0,
        gemini_calls: 0,
        workers_ai_calls: 0,
        neurons: 0,
      }
    );

    const cacheRate =
      totals.troubleshoots > 0 ? Math.round((totals.cache_hits / totals.troubleshoots) * 100) : 0;

    return json({
      period_days: days,
      totals: { ...totals, cache_hit_rate_pct: cacheRate },
      today,
      latency,
      daily: usage,
      corpus: {
        runbooks: runbooks.total,
        never_matched: runbooks.runbooks.filter((r) => r.hit_count === 0).length,
      },
      budget: buildBudget(today, monthlyDims),
    });
  }

  if (route === 'budget' && request.method === 'GET') {
    const [today, monthlyDims] = await Promise.all([getToday(env), getMonthlyVectorizeDims(env)]);
    return json(buildBudget(today, monthlyDims));
  }

  if (route === 'logs' && request.method === 'GET') {
    const { rows, total } = await readLogs(env, {
      limit: clamp(Number.parseInt(url.searchParams.get('limit') ?? '50', 10), 1, 200),
      offset: clamp(Number.parseInt(url.searchParams.get('offset') ?? '0', 10), 0, 1_000_000),
      route: url.searchParams.get('route') ?? undefined,
      onlyErrors: url.searchParams.get('errors') === 'true',
      onlyMisses: url.searchParams.get('misses') === 'true',
    });
    return json({ logs: rows, total });
  }

  if (route === 'gaps' && request.method === 'GET') {
    const gaps = await readKnowledgeGaps(
      env,
      clamp(Number.parseInt(url.searchParams.get('limit') ?? '50', 10), 1, 200)
    );
    return json({ gaps });
  }

  if (route === 'runbooks' && request.method === 'GET') {
    const { runbooks, total } = await listRunbooks(env.DB, { limit: 100 });
    return json({
      total,
      runbooks: runbooks
        .map((r) => ({
          id: r.id,
          slug: r.slug,
          category: r.category,
          error_code: r.error_code,
          title: r.title,
          hit_count: r.hit_count,
          verified_at: r.verified_at,
          source_url: r.source_url,
          steps: r.solution_steps.length,
        }))
        .sort((a, b) => b.hit_count - a.hit_count),
    });
  }

  if (route === 'reindex' && request.method === 'POST') {
    if (!env.VECTOR_INDEX || !env.AI) {
      return json({ error: 'Vectorize or Workers AI binding is missing' }, 400);
    }
    const { runbooks } = await listRunbooks(env.DB, { limit: 100 });
    const result = await reindexRunbooks(env, runbooks);
    return json({
      ...result,
      message: `Reindexed ${result.upserted} of ${result.total} runbooks${
        result.skipped > 0 ? ` (${result.skipped} skipped)` : ''
      }`,
    });
  }

  return json({ error: 'Unknown admin route', route }, 404);
}

interface BudgetLine {
  used: number;
  limit: number;
  pct: number;
  window: 'day' | 'month';
  source: string;
}

/**
 * Consumption against the published free-tier allowances. This is the number
 * that decides whether the project stays free, so it is computed from the same
 * constants the README quotes rather than from a hand-maintained copy.
 */
function buildBudget(
  today: Awaited<ReturnType<typeof getToday>>,
  monthlyDims: number
): Record<string, BudgetLine> {
  const line = (
    used: number,
    limit: number,
    window: 'day' | 'month',
    source: string
  ): BudgetLine => ({
    used: Math.round(used * 100) / 100,
    limit,
    pct: limit > 0 ? Math.round((used / limit) * 1000) / 10 : 0,
    window,
    source,
  });

  // Three writes per troubleshoot on a cache miss (rate-limit upsert x2,
  // log row) plus the usage rollup and the cache fill. Deliberately an
  // over-estimate: a budget meter that flatters you is worse than none.
  const estimatedD1Writes = today.requests * 4 + today.troubleshoots;

  return {
    worker_requests: line(today.requests, FREE_TIER.workerRequestsPerDay, 'day', 'Workers'),
    d1_writes: line(estimatedD1Writes, FREE_TIER.d1RowsWrittenPerDay, 'day', 'D1 (estimated)'),
    workers_ai_neurons: line(
      today.neurons_estimate,
      FREE_TIER.workersAiNeuronsPerDay,
      'day',
      'Workers AI (estimated)'
    ),
    gemini_requests: line(
      today.gemini_calls,
      FREE_TIER.geminiRequestsPerDay,
      'day',
      'Google AI Studio'
    ),
    vectorize_dimensions: line(
      monthlyDims,
      FREE_TIER.vectorizeDimsPerMonth,
      'month',
      'Vectorize'
    ),
  };
}
