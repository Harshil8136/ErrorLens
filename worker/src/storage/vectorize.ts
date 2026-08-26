import type { Env, Runbook } from '../types';
import { embedText, runbookEmbeddingText } from '../core/embeddings';

/** Vectorize accepts up to 1000 vectors per upsert; 50 keeps each call well
 *  inside the Worker CPU budget while the embeddings are generated. */
const BATCH_SIZE = 50;

export interface ReindexResult {
  upserted: number;
  skipped: number;
  total: number;
}

/**
 * Pushes runbook embeddings into Vectorize.
 *
 * This is the write half of the hybrid search. It runs out of band -- from the
 * admin reindex endpoint after a migration -- rather than on the request path,
 * because embedding the whole corpus costs far more than the 10ms CPU budget a
 * single request gets on the free plan.
 */
export async function reindexRunbooks(env: Env, runbooks: Runbook[]): Promise<ReindexResult> {
  if (!env.VECTOR_INDEX || !env.AI) {
    return { upserted: 0, skipped: runbooks.length, total: runbooks.length };
  }

  let upserted = 0;
  let skipped = 0;

  for (let i = 0; i < runbooks.length; i += BATCH_SIZE) {
    const batch = runbooks.slice(i, i + BATCH_SIZE);
    const vectors: VectorizeVector[] = [];

    for (const runbook of batch) {
      const embedded = await embedText(env, runbookEmbeddingText(runbook));
      if (!embedded) {
        skipped++;
        continue;
      }
      vectors.push({
        id: String(runbook.id),
        values: embedded.vector,
        metadata: {
          slug: runbook.slug,
          category: runbook.category,
          error_code: runbook.error_code,
        },
      });
    }

    if (vectors.length > 0) {
      await env.VECTOR_INDEX.upsert(vectors);
      upserted += vectors.length;
    }
  }

  return { upserted, skipped, total: runbooks.length };
}
