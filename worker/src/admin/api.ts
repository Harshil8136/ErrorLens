import type { Env } from '../types';
import { json } from '../index';
import { timingSafeEqual } from '../core/security';
import { readKnowledgeGaps, readLatency, readLogs } from '../storage/logs';
import {
  FREE_TIER,
  getMonthlyVectorizeDims,
  getToday,
  getUsageRange,
  type UsageRow,
} from '../storage/usage';

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/**
 * Admin surface. Read-only telemetry and log inspector.
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
    const [usage, latency, today, monthlyDims] = await Promise.all([
      getUsageRange(env, days),
      readLatency(env, days),
      getToday(env),
      getMonthlyVectorizeDims(env),
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
        runbooks: 0,
        never_matched: 0,
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
    return json({ total: 0, runbooks: [] });
  }

  if (route === 'reindex' && request.method === 'POST') {
    return json({ message: 'Vectorize is disabled in universal engine mode' });
  }

  return json({ error: 'Not found', route }, 404);
}

function buildBudget(today: UsageRow, monthlyDims: number) {
  const line = (used: number, limit: number, period: 'day' | 'month', note?: string) => {
    const pct = limit > 0 ? Math.round((used / limit) * 1000) / 10 : 0;
    return { used, limit, pct, period, note };
  };

  return {
    as_of: new Date().toISOString(),
    worker_requests: line(
      today.requests,
      FREE_TIER.workerRequestsPerDay,
      'day',
      'Worker edge requests'
    ),
    gemini_requests: line(
      today.gemini_calls,
      FREE_TIER.geminiRequestsPerDay,
      'day',
      'Tier-1 Flash-Lite'
    ),
    gemini: line(today.gemini_calls, FREE_TIER.geminiRequestsPerDay, 'day', 'Tier-1 Flash-Lite'),
    d1_rows_written: line(0, FREE_TIER.d1RowsWrittenPerDay, 'day', 'D1 write limit'),
    d1_rows_read: line(0, FREE_TIER.d1RowsReadPerDay, 'day', 'D1 read limit'),
    workers_ai_neurons: line(
      Math.round(today.neurons_estimate),
      FREE_TIER.workersAiNeuronsPerDay,
      'day',
      'Workers AI fallback'
    ),
    vectorize_dimensions: line(monthlyDims, FREE_TIER.vectorizeDimsPerMonth, 'month', 'Disabled'),
  };
}
