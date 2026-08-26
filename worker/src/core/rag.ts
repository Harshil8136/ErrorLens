// ============================================================
// ErrorLens Hybrid RAG Retrieval Engine
// Combines D1 FTS5 (Lexical BM25) + Vectorize (Dense Semantic)
// with Reciprocal Rank Fusion (RRF)
// ============================================================

import type { Env, ParsedRunbook, RAGMatch } from '../types';
import { searchRunbooksFTS } from '../storage/d1';

const RRF_K = 60; // Standard RRF smoothing constant

export async function retrieveRelevantRunbooks(
  env: Env,
  query: string,
  limit = 3
): Promise<{ matches: RAGMatch[]; strategy: 'fts' | 'vector' | 'hybrid' }> {
  // 1. Lexical BM25 Search via D1 FTS5
  const ftsResults = await searchRunbooksFTS(env.DB, query, 5);

  // 2. Semantic Vector Search via Cloudflare Vectorize (if bindings are active)
  let vectorResults: ParsedRunbook[] = [];
  let vectorEnabled = false;

  if (env.AI && env.VECTOR_INDEX) {
    try {
      // Generate 384-dimensional dense embedding via Workers AI BGE-small
      const embeddingRes = await env.AI.run('@cf/baai/bge-small-en-v1.5', {
        text: [query],
      });

      const vector = embeddingRes?.data?.[0];

      if (vector && Array.isArray(vector)) {
        const matches = await env.VECTOR_INDEX.query(vector, {
          topK: 5,
          returnMetadata: 'indexed',
        });

        if (matches?.matches && matches.matches.length > 0) {
          vectorEnabled = true;
          const ids = matches.matches.map(m => parseInt(m.id, 10)).filter(n => !isNaN(n));

          if (ids.length > 0) {
            const placeholders = ids.map(() => '?').join(',');
            const { results } = await env.DB.prepare(
              `SELECT * FROM runbooks WHERE id IN (${placeholders})`
            ).bind(...ids).all<any>();

            const idMap = new Map((results || []).map(r => [r.id, r]));
            vectorResults = ids
              .map(id => idMap.get(id))
              .filter(Boolean)
              .map(r => ({
                ...r,
                solution_steps: JSON.parse(r.solution_steps || '[]'),
                tags: JSON.parse(r.tags || '[]'),
              }));
          }
        }
      }
    } catch (vectorErr) {
      console.warn('[Vector Search Warning, falling back to FTS5]:', vectorErr);
    }
  }

  // 3. Reciprocal Rank Fusion (RRF)
  const scores = new Map<number, { runbook: ParsedRunbook; score: number; matchType: 'fts' | 'vector' | 'hybrid' }>();

  // Add FTS ranks
  ftsResults.forEach((runbook, rank) => {
    const rrf = 1 / (RRF_K + rank + 1);
    scores.set(runbook.id, {
      runbook,
      score: rrf,
      matchType: 'fts',
    });
  });

  // Merge Vector ranks
  vectorResults.forEach((runbook, rank) => {
    const rrf = 1 / (RRF_K + rank + 1);
    const existing = scores.get(runbook.id);
    if (existing) {
      existing.score += rrf;
      existing.matchType = 'hybrid';
    } else {
      scores.set(runbook.id, {
        runbook,
        score: rrf,
        matchType: 'vector',
      });
    }
  });

  // Sort by combined RRF score descending
  const sorted = Array.from(scores.values()).sort((a, b) => b.score - a.score);
  const topMatches: RAGMatch[] = sorted.slice(0, limit).map(m => ({
    runbook: m.runbook,
    score: m.score,
    match_type: m.matchType,
  }));

  const strategy = vectorEnabled && ftsResults.length > 0
    ? 'hybrid'
    : vectorEnabled
    ? 'vector'
    : 'fts';

  return { matches: topMatches, strategy };
}
