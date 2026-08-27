import type { Env, RagMatch, RagResult, Runbook } from '../types';
import { getRunbooksByIds, searchRunbooks } from '../storage/d1';
import { EMBEDDING_DIMS, embedText } from './embeddings';

/**
 * Reciprocal Rank Fusion smoothing constant. 60 is the value from Cormack et
 * al. (2009) and is what most hybrid-search implementations use; it flattens
 * the contribution of the top few ranks so one engine cannot dominate purely
 * by being confident.
 */
const RRF_K = 60;

const FTS_DEPTH = 5;
const VECTOR_DEPTH = 5;

/**
 * Hybrid retrieval: lexical BM25 over FTS5, dense cosine over Vectorize, fused
 * by rank rather than by score.
 *
 * Rank fusion matters here because the two engines produce incomparable
 * numbers -- bm25() returns unbounded negatives, cosine returns 0..1. Fusing
 * raw scores would need per-engine calibration that drifts as the corpus
 * grows; fusing ranks does not.
 *
 * Lexical is the important half for this domain. Error identifiers like
 * `Exit Code 137` and `ERR_OSSL_EVP_UNSUPPORTED` are close to meaningless to a
 * sentence encoder but are exactly what BM25 is good at. The dense half earns
 * its place on the paraphrases -- "my container got killed for using too much
 * RAM" retrieves the OOM runbook without sharing a single term with it.
 */
export async function retrieve(env: Env, query: string, limit = 3): Promise<RagResult> {
  const lexical = await searchRunbooks(env.DB, query, FTS_DEPTH);

  let dense: Runbook[] = [];
  let dimsQueried = 0;

  if (env.AI && env.VECTOR_INDEX) {
    const embedded = await embedText(env, query);
    if (embedded) {
      try {
        const hits = await env.VECTOR_INDEX.query(embedded.vector, { topK: VECTOR_DEPTH });
        dimsQueried = EMBEDDING_DIMS;

        const ids = (hits?.matches ?? [])
          .map((m) => Number.parseInt(m.id, 10))
          .filter((n) => Number.isFinite(n));

        if (ids.length > 0) {
          const byId = new Map(
            (await getRunbooksByIds(env.DB, ids)).map((r) => [r.id, r] as const)
          );
          // Preserve Vectorize's ordering -- the SQL IN clause does not.
          dense = ids.map((id) => byId.get(id)).filter((r): r is Runbook => Boolean(r));
        }
      } catch (err) {
        console.warn('[rag] vector search failed, using lexical only:', err);
      }
    }
  }

  const fused = fuse(lexical, dense);
  const relevant = fused.filter((m) => isRelevantMatch(query, m.runbook));
  const matches = relevant.slice(0, limit);
  const strategy = matches.length > 0 ? strategyFor(lexical, dense) : 'none';

  return { matches, strategy, dimsQueried };
}

/**
 * Ensures a runbook is only treated as a match if the query actually targets it.
 * This prevents common words like "code", "error", or "process" from dragging in
 * completely unrelated runbooks (e.g. matching Docker OOM for Windows BSOD).
 */
export function isRelevantMatch(query: string, runbook: Runbook): boolean {
  const q = query.toLowerCase();
  const code = runbook.error_code.toLowerCase().trim();
  const slug = runbook.slug.toLowerCase().trim();

  // If query contains the exact error code (e.g. "137", "502", "1102", "crashloopbackoff", "53300")
  if (code && q.includes(code)) return true;
  if (slug && q.includes(slug)) return true;

  // Check if at least 3 distinct meaningful words from the title are present in query
  const titleWords = runbook.title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !['with', 'from', 'this', 'that', 'error', 'code'].includes(w));

  const hits = titleWords.filter((w) => q.includes(w));
  return hits.length >= 3;
}

/** Exported for tests: the fusion step is pure and worth pinning down. */
export function fuse(lexical: Runbook[], dense: Runbook[]): RagMatch[] {
  const scores = new Map<number, RagMatch>();

  lexical.forEach((runbook, rank) => {
    scores.set(runbook.id, {
      runbook,
      score: 1 / (RRF_K + rank + 1),
      matchType: 'fts',
    });
  });

  dense.forEach((runbook, rank) => {
    const contribution = 1 / (RRF_K + rank + 1);
    const existing = scores.get(runbook.id);
    if (existing) {
      existing.score += contribution;
      existing.matchType = 'hybrid';
    } else {
      scores.set(runbook.id, { runbook, score: contribution, matchType: 'vector' });
    }
  });

  return [...scores.values()].sort((a, b) => b.score - a.score);
}

function strategyFor(lexical: Runbook[], dense: Runbook[]) {
  if (lexical.length > 0 && dense.length > 0) return 'hybrid' as const;
  if (dense.length > 0) return 'vector' as const;
  if (lexical.length > 0) return 'fts' as const;
  return 'none' as const;
}
