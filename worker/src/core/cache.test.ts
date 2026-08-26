import { describe, expect, it } from 'vitest';
import { hashQuery, isCacheable, normalizeQuery } from './cache';
import type { TroubleshootResponse } from '../types';

function response(model: string): TroubleshootResponse {
  return { meta: { model } } as TroubleshootResponse;
}

describe('normalizeQuery', () => {
  it('collapses casing, punctuation and whitespace', () => {
    expect(normalizeQuery('  Docker  EXIT code 137?? ')).toBe('docker exit code 137');
  });

  it('keeps underscores, which appear inside real error identifiers', () => {
    expect(normalizeQuery('ERR_OSSL_EVP_UNSUPPORTED')).toBe('err_ossl_evp_unsupported');
  });

  it('maps cosmetically different queries onto the same key', async () => {
    expect(await hashQuery('Docker exit code 137?')).toBe(await hashQuery('docker exit code 137'));
  });

  it('keeps genuinely different queries apart', async () => {
    expect(await hashQuery('exit code 137')).not.toBe(await hashQuery('exit code 139'));
  });
});

describe('isCacheable', () => {
  it('caches a real model answer', () => {
    expect(isCacheable(response('google/gemini-3.5-flash-lite'))).toBe(true);
    expect(isCacheable(response('cloudflare/@cf/meta/llama-3.1-8b-instruct'))).toBe(true);
  });

  it('refuses to cache degraded catalog answers', () => {
    // Caching these pins a fallback in front of the query for the full TTL,
    // so one upstream outage keeps serving stale advice for a week.
    expect(isCacheable(response('catalog/runbook'))).toBe(false);
    expect(isCacheable(response('catalog/generic'))).toBe(false);
  });
});
