import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { getBudget, recordSpend, resetBudgetCache } from './budget';
import { recordUsage, utcDay } from '../storage/usage';

beforeEach(async () => {
  await env.DB.exec('DELETE FROM usage_daily');
  resetBudgetCache();
});

describe('getBudget', () => {
  it('allows both paid tiers when nothing has been spent', async () => {
    const budget = await getBudget(env);
    expect(budget.geminiAllowed).toBe(true);
    expect(budget.workersAiAllowed).toBe(true);
    expect(budget.day).toBe(utcDay());
  });

  it('closes the Gemini tier once the daily ceiling is reached', async () => {
    // Default ceiling is 90% of the 1000/day free limit.
    await recordUsage(env, { gemini_calls: 950 });
    resetBudgetCache();

    const budget = await getBudget(env);
    expect(budget.geminiAllowed).toBe(false);
    // Workers AI has its own budget and is unaffected.
    expect(budget.workersAiAllowed).toBe(true);
  });

  it('closes the Workers AI tier once neurons run out', async () => {
    await recordUsage(env, { neurons_estimate: 9500 });
    resetBudgetCache();

    const budget = await getBudget(env);
    expect(budget.workersAiAllowed).toBe(false);
    expect(budget.geminiAllowed).toBe(true);
  });

  it('respects an explicit override', async () => {
    await recordUsage(env, { gemini_calls: 5 });
    resetBudgetCache();

    const budget = await getBudget({ ...env, MAX_GEMINI_CALLS_PER_DAY: '3' });
    expect(budget.geminiAllowed).toBe(false);
  });

  it('defaults to allowing free tier when the counter cannot be read', async () => {
    // Gemini is on Google AI Studio's 100% free tier and will not incur bills,
    // so we keep it available even if D1 counter reads fail.
    const broken = {
      ...env,
      DB: {
        prepare() {
          throw new Error('D1 unavailable');
        },
      },
    } as unknown as typeof env;

    const budget = await getBudget(broken);
    expect(budget.geminiAllowed).toBe(true);
    expect(budget.workersAiAllowed).toBe(true);
  });

  it('memoises within the cache window so every request is not a D1 read', async () => {
    const first = await getBudget(env);
    await recordUsage(env, { gemini_calls: 999 });

    // Same isolate, inside the 30s window: still the cached view.
    const second = await getBudget(env);
    expect(second.geminiCalls).toBe(first.geminiCalls);

    resetBudgetCache();
    const third = await getBudget(env);
    expect(third.geminiCalls).toBe(999);
  });
});

describe('recordSpend', () => {
  it('advances the cached counters so a burst inside one window still closes', async () => {
    await getBudget({ ...env, MAX_GEMINI_CALLS_PER_DAY: '2' });
    recordSpend('gemini', 0);
    recordSpend('gemini', 0);

    const budget = await getBudget({ ...env, MAX_GEMINI_CALLS_PER_DAY: '2' });
    expect(budget.geminiCalls).toBe(2);
  });

  it('accumulates neuron spend', async () => {
    await getBudget(env);
    recordSpend('workers-ai', 87);
    recordSpend('workers-ai', 87);

    const budget = await getBudget(env);
    expect(budget.neurons).toBe(174);
  });
});
