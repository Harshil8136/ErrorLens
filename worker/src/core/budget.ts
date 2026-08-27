import type { Env } from '../types';
import { FREE_TIER, getToday, utcDay } from '../storage/usage';

/**
 * Hard ceilings on paid-if-exceeded resources.
 *
 * Per-IP rate limiting caps any single caller, but it cannot stop a
 * distributed one: 34 addresses at 30 requests/day each is enough to exhaust
 * Gemini's 1,000/day free quota. This is the backstop that makes "stays free"
 * a property of the code rather than a hope.
 *
 * Defaults sit deliberately below the published free limits. The gap absorbs
 * the race between an isolate reading a cached counter and the rollup landing,
 * and leaves room for the admin panel's own requests.
 */
export interface BudgetState {
  geminiCalls: number;
  neurons: number;
  day: string;
  geminiAllowed: boolean;
  workersAiAllowed: boolean;
}

const CACHE_TTL_MS = 30_000;

let cached: { state: BudgetState; expiresAt: number } | null = null;

function limits(env: Env) {
  return {
    gemini: toInt(env.MAX_GEMINI_CALLS_PER_DAY, Math.floor(FREE_TIER.geminiRequestsPerDay * 0.9)),
    neurons: toInt(env.MAX_NEURONS_PER_DAY, Math.floor(FREE_TIER.workersAiNeuronsPerDay * 0.9)),
  };
}

/**
 * Reads today's consumption, memoised per isolate for 30 seconds.
 *
 * Without the memo this is a D1 read on every request. With it, a burst is
 * bounded by however many isolates are warm -- each can overshoot by at most
 * one window's traffic, which is what the 10% headroom above is for.
 */
export async function getBudget(env: Env, now: number = Date.now()): Promise<BudgetState> {
  const today = utcDay(now);

  if (cached && cached.expiresAt > now && cached.state.day === today) {
    return cached.state;
  }

  const { gemini, neurons } = limits(env);

  try {
    const usage = await getToday(env, now);
    const state: BudgetState = {
      day: today,
      geminiCalls: usage.gemini_calls,
      neurons: usage.neurons_estimate,
      geminiAllowed: usage.gemini_calls < gemini,
      workersAiAllowed: usage.neurons_estimate < neurons,
    };
    cached = { state, expiresAt: now + CACHE_TTL_MS };
    return state;
  } catch (err) {
    // If the counter is unreadable we cannot prove we are inside the budget.
    // Fall back to the catalog rather than risk a bill.
    console.error('[budget] unreadable, refusing paid tiers:', err);
    return {
      day: today,
      geminiCalls: 0,
      neurons: 0,
      geminiAllowed: false,
      workersAiAllowed: false,
    };
  }
}

/** Called after a generation so the next request sees it without a re-read. */
export function recordSpend(provider: 'gemini' | 'workers-ai', neurons: number): void {
  if (!cached) return;
  if (provider === 'gemini') cached.state.geminiCalls += 1;
  if (provider === 'workers-ai') cached.state.neurons += neurons;
}

/** Test hook: the memo is module state and outlives a single test. */
export function resetBudgetCache(): void {
  cached = null;
}

function toInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
