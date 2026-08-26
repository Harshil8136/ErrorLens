import { describe, expect, it } from 'vitest';
import { hashIp, isSafeHttpUrl, timingSafeEqual } from './security';

describe('timingSafeEqual', () => {
  it('matches identical strings', () => {
    expect(timingSafeEqual('token', 'token')).toBe(true);
    expect(timingSafeEqual('', '')).toBe(true);
  });

  it('rejects same-length differences', () => {
    expect(timingSafeEqual('token', 'tokeN')).toBe(false);
  });

  it('rejects different lengths without throwing', () => {
    expect(timingSafeEqual('short', 'much longer value')).toBe(false);
  });

  it('handles multi-byte characters by comparing encoded bytes', () => {
    expect(timingSafeEqual('café', 'café')).toBe(true);
    expect(timingSafeEqual('café', 'cafe')).toBe(false);
  });
});

describe('hashIp', () => {
  it('is deterministic for the same ip and salt', async () => {
    expect(await hashIp('1.2.3.4', 's')).toBe(await hashIp('1.2.3.4', 's'));
  });

  it('changes when the salt changes', async () => {
    expect(await hashIp('1.2.3.4', 'a')).not.toBe(await hashIp('1.2.3.4', 'b'));
  });

  it('does not contain the original address', async () => {
    expect(await hashIp('203.0.113.9', 'salt')).not.toContain('203');
  });
});

describe('isSafeHttpUrl', () => {
  it('accepts http and https', () => {
    expect(isSafeHttpUrl('https://example.com')).toBe(true);
    expect(isSafeHttpUrl('http://example.com')).toBe(true);
  });

  it('rejects script-bearing and non-network schemes', () => {
    expect(isSafeHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeHttpUrl('data:text/html,<script>')).toBe(false);
    expect(isSafeHttpUrl('file:///etc/passwd')).toBe(false);
  });

  it('rejects malformed values', () => {
    expect(isSafeHttpUrl('not a url')).toBe(false);
    expect(isSafeHttpUrl(null)).toBe(false);
    expect(isSafeHttpUrl(42)).toBe(false);
  });
});
