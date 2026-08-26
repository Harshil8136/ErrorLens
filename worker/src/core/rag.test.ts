import { describe, expect, it } from 'vitest';
import { fuse } from './rag';
import type { Runbook } from '../types';

function rb(id: number, slug = `rb-${id}`): Runbook {
  return {
    id, slug, category: 'linux', error_code: `E${id}`, title: `Runbook ${id}`,
    summary: '', root_cause: '', diagnostic_command: '', solution_steps: [], tags: [],
    source_url: null, hit_count: 0, verified_at: null, created_at: '', updated_at: '',
  };
}

describe('fuse (reciprocal rank fusion)', () => {
  it('scores a rank-1 lexical hit as 1/(60+1)', () => {
    const top = fuse([rb(1)], [])[0]!;
    expect(top.score).toBeCloseTo(1 / 61, 10);
    expect(top.matchType).toBe('fts');
  });

  it('sums both engines when they agree, and marks the result hybrid', () => {
    const top = fuse([rb(1)], [rb(1)])[0]!;
    expect(top.score).toBeCloseTo(2 / 61, 10);
    expect(top.matchType).toBe('hybrid');
  });

  it('ranks a document both engines found above one only a single engine found', () => {
    // This is the whole point of fusion: agreement beats a single confident list.
    const fused = fuse([rb(1), rb(2)], [rb(2), rb(3)]);
    expect(fused[0]!.runbook.id).toBe(2);
  });

  it('labels vector-only matches', () => {
    const fused = fuse([], [rb(7)]);
    expect(fused[0]!.matchType).toBe('vector');
  });

  it('returns an empty list when neither engine matched', () => {
    expect(fuse([], [])).toEqual([]);
  });

  it('sorts descending by score', () => {
    const fused = fuse([rb(1), rb(2), rb(3)], []);
    expect(fused.map((f) => f.runbook.id)).toEqual([1, 2, 3]);
    expect(fused[0]!.score).toBeGreaterThan(fused[2]!.score);
  });
});
