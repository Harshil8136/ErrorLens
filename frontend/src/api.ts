import type { TroubleshootResponse } from '../../shared/api';

export class ApiError extends Error {
  readonly status: number;
  readonly retryAfter?: number;

  constructor(message: string, status: number, retryAfter?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

interface ErrorBody {
  error?: string;
  message?: string;
  retry_after?: number;
}

export async function troubleshoot(
  query: string,
  turnstileToken: string | null,
  signal?: AbortSignal
): Promise<TroubleshootResponse> {
  let res: Response;
  try {
    res = await fetch('/api/troubleshoot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        // Named to match Turnstile's own convention so the field is
        // recognisable to anyone who has wired this up before.
        ...(turnstileToken ? { 'cf-turnstile-response': turnstileToken } : {}),
      }),
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError('Could not reach the diagnostic service. Check your connection.', 0);
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ApiError(
      `The service returned an unreadable response (HTTP ${res.status}).`,
      res.status
    );
  }

  if (!res.ok) {
    const e = body as ErrorBody;
    // The 429 body carries a human-readable explanation of which budget was
    // hit; prefer it over the generic error field.
    throw new ApiError(
      e.message ?? e.error ?? `Request failed (HTTP ${res.status}).`,
      res.status,
      e.retry_after
    );
  }

  return body as TroubleshootResponse;
}

/**
 * Only http(s) links are ever rendered. The worker already filters these, but
 * cached responses written before that filter existed also flow through here,
 * and a `javascript:` href is a live XSS rather than a broken link.
 */
export function safeHref(url: string): string | null {
  try {
    return ['http:', 'https:'].includes(new URL(url).protocol) ? url : null;
  } catch {
    return null;
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
