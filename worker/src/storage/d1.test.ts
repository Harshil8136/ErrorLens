import { describe, expect, it } from 'vitest';
import { buildFtsQuery, clamp } from './d1';

describe('buildFtsQuery', () => {
  it('quotes every term so FTS5 operators in user input stay literal', () => {
    const q = buildFtsQuery('NEAR(a b)');
    expect(q).not.toBeNull();
    expect(q).not.toContain('NEAR(');
  });

  it('neutralises a SQL injection attempt', () => {
    const q = buildFtsQuery('"; DROP TABLE runbooks; --');
    expect(q).toBe('"drop"* OR "table"* OR "runbooks"*');
  });

  it('returns null when only connectors remain', () => {
    // The old stopword list dropped "how" and "fix" but kept "to", so
    // "how to fix" searched for `to` and matched most of the corpus.
    expect(buildFtsQuery('how to fix this')).toBeNull();
    expect(buildFtsQuery('???')).toBeNull();
    expect(buildFtsQuery('')).toBeNull();
  });

  it('keeps short numeric error codes', () => {
    expect(buildFtsQuery('error 502')).toContain('"502"');
    expect(buildFtsQuery('exit 137')).toContain('"137"');
  });

  it('preserves symbolic language names', () => {
    // Stripping punctuation turns C++ into "c", which the length filter then
    // drops -- making every C++ build failure unsearchable.
    expect(buildFtsQuery('C++ compiler crash')).toContain('"cpp"');
    expect(buildFtsQuery('C# nullreference')).toContain('"csharp"');
    expect(buildFtsQuery('.NET runtime error')).toContain('"dotnet"');
  });

  it('de-duplicates repeated terms', () => {
    expect(buildFtsQuery('docker docker docker')).toBe('"docker"*');
  });

  it('caps the term count so a pasted stack trace cannot build a huge query', () => {
    const long = Array.from({ length: 120 }, (_, i) => `token${i}`).join(' ');
    expect(buildFtsQuery(long)!.split(' OR ')).toHaveLength(24);
  });

  it('escapes embedded double quotes rather than breaking the expression', () => {
    expect(buildFtsQuery('say "hello" now')).not.toContain('""hello""*');
  });
});

describe('clamp', () => {
  it('bounds values', () => {
    expect(clamp(500, 1, 100)).toBe(100);
    expect(clamp(-5, 1, 100)).toBe(1);
    expect(clamp(50, 1, 100)).toBe(50);
  });

  it('returns the minimum for NaN, which is what ?limit=abc produces', () => {
    // Left unclamped this became LIMIT NULL, and SQLite treats that as no
    // limit at all -- ?limit=abc returned the whole table.
    expect(clamp(Number.NaN, 1, 100)).toBe(1);
  });
});
