import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyTurnstile } from './turnstile';
import type { Env } from '../types';

function envWith(overrides: Partial<Env> = {}): Env {
  return {
    TURNSTILE_SECRET_KEY: 'test-secret',
    TURNSTILE_HOSTNAMES: 'errorlens.example',
    ...overrides,
  } as Env;
}

function mockSiteverify(body: unknown, ok = true) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status: ok ? 200 : 500 }))
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('verifyTurnstile', () => {
  it('is skipped entirely when no secret is configured', async () => {
    // Local development and forks have to work without provisioning a widget.
    const result = await verifyTurnstile({} as Env, undefined, '1.2.3.4');
    expect(result).toEqual({ ok: true, skipped: true });
  });

  it('rejects a missing token once a secret is configured', async () => {
    const result = await verifyTurnstile(envWith(), undefined, '1.2.3.4');
    expect(result).toEqual({ ok: false, reason: 'missing' });
  });

  it('rejects an empty or non-string token', async () => {
    expect(await verifyTurnstile(envWith(), '', '1.2.3.4')).toMatchObject({ reason: 'missing' });
    expect(await verifyTurnstile(envWith(), 12345, '1.2.3.4')).toMatchObject({ reason: 'missing' });
  });

  it('rejects an oversized token without calling siteverify', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    const result = await verifyTurnstile(envWith(), 'x'.repeat(3000), '1.2.3.4');
    expect(result).toMatchObject({ reason: 'missing' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('refuses when the hostname allowlist is empty', async () => {
    // An empty allowlist would make the hostname check vacuous, which accepts
    // tokens issued to any site the widget covers.
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    const result = await verifyTurnstile(envWith({ TURNSTILE_HOSTNAMES: '' }), 'token', '1.2.3.4');
    expect(result).toEqual({ ok: false, reason: 'invalid' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('accepts a token that passes all three checks', async () => {
    mockSiteverify({ success: true, action: 'diagnose', hostname: 'errorlens.example' });
    const result = await verifyTurnstile(envWith(), 'good-token', '1.2.3.4');
    expect(result).toEqual({ ok: true, skipped: false });
  });

  it('rejects a token minted for a different action', async () => {
    mockSiteverify({ success: true, action: 'signup', hostname: 'errorlens.example' });
    expect(await verifyTurnstile(envWith(), 'tok', '1.2.3.4')).toMatchObject({ ok: false });
  });

  it('rejects a token issued to a different hostname', async () => {
    mockSiteverify({ success: true, action: 'diagnose', hostname: 'attacker.example' });
    expect(await verifyTurnstile(envWith(), 'tok', '1.2.3.4')).toMatchObject({ ok: false });
  });

  it('rejects when siteverify says success is false', async () => {
    mockSiteverify({ success: false, 'error-codes': ['timeout-or-duplicate'] });
    expect(await verifyTurnstile(envWith(), 'tok', '1.2.3.4')).toMatchObject({ ok: false });
  });

  it('fails closed when siteverify returns a non-2xx', async () => {
    mockSiteverify({ success: true, action: 'diagnose', hostname: 'errorlens.example' }, false);
    expect(await verifyTurnstile(envWith(), 'tok', '1.2.3.4')).toMatchObject({ ok: false });
  });

  it('fails closed when siteverify is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      })
    );
    expect(await verifyTurnstile(envWith(), 'tok', '1.2.3.4')).toMatchObject({ ok: false });
  });

  it('fails closed on an unparseable body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not json', { status: 200 }))
    );
    expect(await verifyTurnstile(envWith(), 'tok', '1.2.3.4')).toMatchObject({ ok: false });
  });
});
