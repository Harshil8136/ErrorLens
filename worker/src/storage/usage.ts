import type { Env } from '../types';

/**
 * Published free-tier allowances, retrieved 2026-08-26. These drive the budget
 * meter in the admin panel: if a number here is wrong, the meter lies, so the
 * source for each one is recorded next to it.
 */
export const FREE_TIER = {
  workerRequestsPerDay: 100_000, // developers.cloudflare.com/workers/platform/pricing
  d1RowsWrittenPerDay: 100_000, // developers.cloudflare.com/d1/platform/pricing
  d1RowsReadPerDay: 5_000_000, // developers.cloudflare.com/d1/platform/pricing
  workersAiNeuronsPerDay: 10_000, // developers.cloudflare.com/workers-ai/platform/pricing
  vectorizeDimsPerMonth: 30_000_000, // developers.cloudflare.com/vectorize/platform/pricing
  geminiRequestsPerDay: 1_000, // AI Studio free tier, Flash-Lite: 15 RPM / 1000 RPD
  geminiRequestsPerMinute: 15,
} as const;

/**
 * Neuron cost per million tokens, from the Workers AI pricing table.
 * Used to estimate spend against the 10k/day allowance; Cloudflare's own
 * accounting is authoritative, this is a guardrail not a bill.
 */
export const NEURON_RATES = {
  '@cf/baai/bge-small-en-v1.5': { input: 1_841, output: 0 },
  '@cf/meta/llama-3.1-8b-instruct': { input: 25_608, output: 75_147 },
} as const;

export type UsageDelta = Partial<{
  requests: number;
  troubleshoots: number;
  cache_hits: number;
  rate_limited: number;
  errors: number;
  gemini_calls: number;
  workers_ai_calls: number;
  neurons_estimate: number;
  vectorize_dims: number;
}>;

export interface UsageRow {
  day: string;
  requests: number;
  troubleshoots: number;
  cache_hits: number;
  rate_limited: number;
  errors: number;
  gemini_calls: number;
  workers_ai_calls: number;
  neurons_estimate: number;
  vectorize_dims: number;
}

const COLUMNS = [
  'requests',
  'troubleshoots',
  'cache_hits',
  'rate_limited',
  'errors',
  'gemini_calls',
  'workers_ai_calls',
  'neurons_estimate',
  'vectorize_dims',
] as const;

export function utcDay(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * Folds a set of counter increments into today's rollup with one upsert.
 * Column names come from a fixed allowlist, never from a caller, because they
 * are interpolated into the statement -- only the values are bound.
 */
export async function recordUsage(
  env: Env,
  delta: UsageDelta,
  now: number = Date.now()
): Promise<void> {
  const fields = COLUMNS.filter((c) => typeof delta[c] === 'number' && delta[c] !== 0);
  if (fields.length === 0) return;

  const values = fields.map((f) => delta[f] as number);
  const insertCols = fields.join(', ');
  const placeholders = fields.map(() => '?').join(', ');
  const updates = fields.map((f) => `${f} = ${f} + excluded.${f}`).join(', ');

  await env.DB.prepare(
    `INSERT INTO usage_daily (day, ${insertCols}) VALUES (?, ${placeholders})
     ON CONFLICT(day) DO UPDATE SET ${updates}`
  )
    .bind(utcDay(now), ...values)
    .run();
}

export function estimateNeurons(
  model: keyof typeof NEURON_RATES,
  inputChars: number,
  outputChars: number
): number {
  const rate = NEURON_RATES[model];
  if (!rate) return 0;
  // ~4 characters per token is the usual rough conversion for English prose.
  const inputTokens = inputChars / 4;
  const outputTokens = outputChars / 4;
  return (inputTokens / 1e6) * rate.input + (outputTokens / 1e6) * rate.output;
}

export async function getUsageRange(env: Env, days: number): Promise<UsageRow[]> {
  const { results } = await env.DB.prepare(`SELECT * FROM usage_daily ORDER BY day DESC LIMIT ?`)
    .bind(Math.max(1, Math.min(365, days)))
    .all<UsageRow>();
  return (results ?? []).reverse();
}

export async function getToday(env: Env, now: number = Date.now()): Promise<UsageRow> {
  const row = await env.DB.prepare(`SELECT * FROM usage_daily WHERE day = ?`)
    .bind(utcDay(now))
    .first<UsageRow>();

  return (
    row ?? {
      day: utcDay(now),
      requests: 0,
      troubleshoots: 0,
      cache_hits: 0,
      rate_limited: 0,
      errors: 0,
      gemini_calls: 0,
      workers_ai_calls: 0,
      neurons_estimate: 0,
      vectorize_dims: 0,
    }
  );
}

/** Vectorize bills per queried dimension per month, so this rolls up 30 days. */
export async function getMonthlyVectorizeDims(env: Env): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COALESCE(SUM(vectorize_dims), 0) AS dims FROM usage_daily
     WHERE day >= date('now', '-30 days')`
  ).first<{ dims: number }>();
  return row?.dims ?? 0;
}
