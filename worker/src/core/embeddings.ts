import type { Env, Runbook } from '../types';

export const DEFAULT_EMBEDDING_MODEL = '@cf/baai/bge-small-en-v1.5';
export const EMBEDDING_DIMS = 384;

/**
 * The text used to represent a runbook in vector space.
 *
 * Commands are deliberately left out. Flags and paths are high-value *lexical*
 * signal, which FTS5 already indexes precisely, but they add noise to a dense
 * encoder trained on prose -- two runbooks that both mention `kubectl describe`
 * end up closer than they should be.
 */
export function runbookEmbeddingText(runbook: Runbook): string {
  return [
    runbook.error_code,
    runbook.title,
    runbook.summary,
    runbook.root_cause,
    runbook.category,
    runbook.tags.join(' '),
  ]
    .filter(Boolean)
    .join('\n');
}

export interface EmbedResult {
  vector: number[];
  /** Character count sent, so the caller can estimate neuron spend. */
  chars: number;
}

export async function embedText(env: Env, text: string): Promise<EmbedResult | null> {
  if (!env.AI) return null;

  const model = env.EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL;
  try {
    const res = (await env.AI.run(model as Parameters<Ai['run']>[0], {
      text: [text],
    })) as { data?: number[][] };

    const vector = res?.data?.[0];
    if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMS) {
      console.warn(`[embeddings] unexpected shape from ${model}`);
      return null;
    }
    return { vector, chars: text.length };
  } catch (err) {
    console.warn('[embeddings] failed, falling back to lexical only:', err);
    return null;
  }
}
