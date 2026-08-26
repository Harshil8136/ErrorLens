// ============================================================
// ErrorLens Edge Worker API
// 100% Free-Tier DevOps & Cloud Troubleshooting RAG Platform
// ============================================================

import type { Env, TroubleshootRequest } from './types';
import { checkRateLimit } from './storage/rate-limit';
import { getCachedResponse, setCachedResponse } from './core/cache';
import { retrieveRelevantRunbooks } from './core/rag';
import { generateTroubleshootPlan } from './core/ai';
import { listAllRunbooks, getRunbookBySlug } from './storage/d1';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
  'Access-Control-Max-Age': '86400',
};

function json(data: any, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
      ...extraHeaders,
    },
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // 1. Handle CORS Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const clientIp = request.headers.get('CF-Connecting-IP') || '127.0.0.1';

    // 2. Health & Diagnostics Endpoint
    if (url.pathname === '/api/health' && request.method === 'GET') {
      return json({
        status: 'ok',
        service: 'ErrorLens Edge RAG',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        bindings: {
          d1: Boolean(env.DB),
          vectorize: Boolean(env.VECTOR_INDEX),
          workers_ai: Boolean(env.AI),
          kv: Boolean(env.KV),
          gemini: Boolean(env.GEMINI_API_KEY),
        },
      });
    }

    // 3. Catalog: List Runbooks (For Autocomplete & Quick Chips)
    if (url.pathname === '/api/runbooks' && request.method === 'GET') {
      const category = url.searchParams.get('category') || undefined;
      const limit = Math.min(100, parseInt(url.searchParams.get('limit') || '50', 10));

      try {
        const runbooks = await listAllRunbooks(env.DB, category, limit);
        return json({ total: runbooks.length, runbooks });
      } catch (err: any) {
        return json({ error: 'Failed to fetch runbooks', details: err.message }, 500);
      }
    }

    // 4. Catalog: Get Single Runbook by Slug
    if (url.pathname.startsWith('/api/runbooks/') && request.method === 'GET') {
      const slug = url.pathname.replace('/api/runbooks/', '').trim();
      try {
        const runbook = await getRunbookBySlug(env.DB, slug);
        if (!runbook) {
          return json({ error: 'Runbook not found' }, 404);
        }
        return json({ runbook });
      } catch (err: any) {
        return json({ error: 'Failed to fetch runbook', details: err.message }, 500);
      }
    }

    // 5. Main RAG Troubleshooting Endpoint
    if (url.pathname === '/api/troubleshoot' && request.method === 'POST') {
      const startTime = Date.now();

      // Rate Limit Check
      const rateCheck = await checkRateLimit(env, clientIp);
      if (!rateCheck.allowed) {
        return json(
          {
            error: 'Rate Limit Exceeded',
            message: rateCheck.reason,
            retry_after: rateCheck.resetSeconds,
          },
          429,
          { 'Retry-After': String(rateCheck.resetSeconds) }
        );
      }

      let body: TroubleshootRequest;
      try {
        body = await request.json<TroubleshootRequest>();
      } catch {
        return json({ error: 'Invalid JSON payload' }, 400);
      }

      const query = (body.query || '').trim();
      if (!query) {
        return json({ error: 'Query parameter is required' }, 400);
      }

      if (query.length > 1000) {
        return json({ error: 'Query exceeds maximum allowed length of 1000 characters' }, 400);
      }

      // Check Edge Cache First (Sub-20ms instant hit at $0 LLM cost)
      const cached = await getCachedResponse(env, query);
      if (cached) {
        cached.meta.duration_ms = Date.now() - startTime;
        return json(cached, 200, { 'X-Cache-Status': 'HIT' });
      }

      try {
        // Step 1: Hybrid Retrieval (D1 FTS5 + Vectorize + RRF)
        const { matches, strategy } = await retrieveRelevantRunbooks(env, query, 3);

        // Step 2: Multi-Tier Generation (Gemini 2.5 Flash-Lite -> Workers AI -> Catalog)
        const { result, modelUsed } = await generateTroubleshootPlan(env, query, matches);

        const durationMs = Date.now() - startTime;
        result.meta.duration_ms = durationMs;
        result.meta.model = modelUsed;
        result.meta.search_strategy = strategy;
        result.meta.from_cache = false;

        // Step 3: Cache result in background for next users
        ctx.waitUntil(setCachedResponse(env, query, result));

        return json(result, 200, { 'X-Cache-Status': 'MISS' });
      } catch (err: any) {
        console.error('[Troubleshoot Pipeline Error]:', err);
        return json(
          {
            error: 'Troubleshooting pipeline encountered an internal issue',
            details: err.message,
          },
          500
        );
      }
    }

    // 6. Serve Frontend Static Assets (Single Page App)
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return json({ error: 'Not Found', path: url.pathname }, 404);
  },
};
