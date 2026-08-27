import type { Env, TroubleshootResponse } from './types';
import { checkRateLimit, purgeRateLimitBuckets } from './storage/rate-limit';
import { readCache, writeCache, bumpCacheHit, purgeExpiredCache } from './core/cache';
import { generate } from './core/ai';
import { purgeLogs, writeLog, type LogEntry } from './storage/logs';
import { recordUsage } from './storage/usage';
import { hashIp } from './core/security';
import { verifyTurnstile } from './core/turnstile';
import { handleAdmin } from './admin/api';
import { renderAdminPanel } from './admin/panel';

const MAX_QUERY_CHARS = 1000;
const MAX_BODY_BYTES = 8 * 1024;

const VERSION = '0.1.0';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const started = Date.now();

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const log = (entry: Omit<LogEntry, 'route' | 'method'>) => {
      ctx.waitUntil(
        Promise.all([
          writeLog(env, { route: path, method: request.method, ...entry }),
          recordUsage(env, {
            requests: 1,
            troubleshoots: path === '/api/troubleshoot' ? 1 : 0,
            cache_hits: entry.cacheHit ? 1 : 0,
            rate_limited: entry.rateLimited ? 1 : 0,
            errors: entry.status >= 500 ? 1 : 0,
          }),
        ]).then(() => undefined)
      );
    };

    try {
      if (path === '/api/health' && request.method === 'GET') {
        return json({
          status: 'ok',
          version: VERSION,
          environment: env.ENVIRONMENT ?? 'unknown',
          time: new Date().toISOString(),
          bindings: {
            d1: Boolean(env.DB),
            workers_ai: Boolean(env.AI),
            gemini_key: Boolean(env.GEMINI_API_KEY),
            admin_token: Boolean(env.ADMIN_TOKEN),
          },
        });
      }

      // Lets the frontend discover the site key at runtime
      if (path === '/api/config' && request.method === 'GET') {
        return json({ turnstile_site_key: env.TURNSTILE_SITE_KEY || null }, 200, {
          'Cache-Control': 'public, max-age=300',
        });
      }

      if (path === '/api/troubleshoot' && request.method === 'POST') {
        return await handleTroubleshoot(request, env, ctx, started, log);
      }

      // Admin panel and API
      if (path === '/admin' || path === '/admin/') {
        return html(renderAdminPanel());
      }

      if (path.startsWith('/api/admin/')) {
        return await handleAdmin(request, env, path);
      }

      // 404 for anything else under /api
      if (path.startsWith('/api/')) {
        return json({ error: 'Not found', path }, 404);
      }

      if (env.ASSETS) {
        const res = await env.ASSETS.fetch(request);
        return withSecurityHeaders(res);
      }

      return json({ error: 'Not found', path }, 404);
    } catch (err) {
      const ref = crypto.randomUUID().slice(0, 8);
      console.error(`[${ref}] unhandled:`, err);
      log({ status: 500, durationMs: Date.now() - started, errorKind: 'unhandled' });
      return json({ error: 'Internal error', reference: ref }, 500);
    }
  },

  /**
   * Nightly housekeeping: cache expiry, stale rate-limit buckets, and logs.
   */
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      (async () => {
        const retention = Number.parseInt(env.LOG_RETENTION_DAYS ?? '', 10) || 30;
        const [cache, buckets, logs] = await Promise.all([
          purgeExpiredCache(env),
          purgeRateLimitBuckets(env),
          purgeLogs(env, retention),
        ]);
        console.log(
          `[cron] purged cache=${cache} rate_buckets=${buckets} logs=${logs} (retention ${retention}d)`
        );
      })()
    );
  },
} satisfies ExportedHandler<Env>;

type LogFn = (entry: Omit<LogEntry, 'route' | 'method'>) => void;

async function handleTroubleshoot(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  started: number,
  log: LogFn
): Promise<Response> {
  const clientIp = request.headers.get('CF-Connecting-IP') ?? '0.0.0.0';
  const country = request.headers.get('CF-IPCountry') ?? undefined;
  const salt = env.IP_HASH_SALT ?? 'errorlens-dev-salt';
  const ipHash = await hashIp(clientIp, salt);

  const verdict = await checkRateLimit(env, ipHash);
  if (!verdict.allowed) {
    log({ status: 429, durationMs: Date.now() - started, ipHash, country, rateLimited: true });
    return json(
      { error: 'Rate limited', message: verdict.reason, retry_after: verdict.retryAfter },
      429,
      {
        'Retry-After': String(verdict.retryAfter),
        'X-RateLimit-Remaining': '0',
      }
    );
  }

  const contentLength = Number.parseInt(request.headers.get('Content-Length') ?? '0', 10);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    log({ status: 413, durationMs: Date.now() - started, ipHash, country });
    return json({ error: 'Request body too large' }, 413);
  }

  let body: { query?: unknown; 'cf-turnstile-response'?: unknown };
  try {
    body = (await request.json()) as { query?: unknown; 'cf-turnstile-response'?: unknown };
  } catch {
    log({ status: 400, durationMs: Date.now() - started, ipHash, country, errorKind: 'bad_json' });
    return json({ error: 'Request body must be valid JSON' }, 400);
  }

  const query = typeof body.query === 'string' ? body.query.trim() : '';
  if (!query) {
    log({ status: 400, durationMs: Date.now() - started, ipHash, country, errorKind: 'no_query' });
    return json({ error: 'A "query" string is required' }, 400);
  }
  if (query.length > MAX_QUERY_CHARS) {
    log({
      status: 400,
      durationMs: Date.now() - started,
      ipHash,
      country,
      errorKind: 'query_too_long',
    });
    return json({ error: `Query must be ${MAX_QUERY_CHARS} characters or fewer` }, 400);
  }

  const challenge = await verifyTurnstile(env, body['cf-turnstile-response'], clientIp);
  if (!challenge.ok) {
    log({
      status: 403,
      durationMs: Date.now() - started,
      ipHash,
      country,
      errorKind: `turnstile_${challenge.reason}`,
    });
    return json(
      {
        error: 'Verification required',
        message:
          challenge.reason === 'missing'
            ? 'Complete the verification check and try again.'
            : 'Verification failed. Refresh the page and try again.',
      },
      403
    );
  }

  // 1. Check zero-cost D1 response cache
  const cached = await readCache(env, query);
  if (cached) {
    cached.meta.duration_ms = Date.now() - started;
    ctx.waitUntil(bumpCacheHit(env, query));
    log({
      status: 200,
      durationMs: cached.meta.duration_ms,
      ipHash,
      country,
      queryText: query,
      searchStrategy: 'cache',
      model: cached.meta.model,
      cacheHit: true,
    });
    return json(cached, 200, {
      'X-Cache': 'HIT',
      'X-RateLimit-Remaining': String(verdict.remaining),
    });
  }

  // 2. Direct Universal Diagnostic Inference (Gemini / Workers AI fallback)
  const generated = await generate(env, query, []);

  const response: TroubleshootResponse = generated.response;
  response.meta.model = generated.model;
  response.meta.search_strategy = 'none';
  response.meta.from_cache = false;
  response.meta.duration_ms = Date.now() - started;

  ctx.waitUntil(
    Promise.all([
      writeCache(env, query, response),
      recordUsage(env, {
        gemini_calls: generated.provider === 'gemini' ? 1 : 0,
        workers_ai_calls: generated.provider === 'workers-ai' ? 1 : 0,
        neurons_estimate: generated.neurons,
        vectorize_dims: 0,
      }),
    ]).then(() => undefined)
  );

  log({
    status: 200,
    durationMs: response.meta.duration_ms,
    ipHash,
    country,
    queryText: query,
    searchStrategy: 'none',
    model: generated.model,
  });

  return json(response, 200, {
    'X-Cache': 'MISS',
    'X-RateLimit-Remaining': String(verdict.remaining),
  });
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

export function json(
  data: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      ...corsHeaders(),
      ...extraHeaders,
    },
  });
}

function html(content: string, status = 200): Response {
  return new Response(content, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy':
        "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    },
  });
}

function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
