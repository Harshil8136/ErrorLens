// ============================================================
// ErrorLens Multi-Tier AI Provider (100% Free Tier)
// Primary: Google AI Studio Gemini 2.5 Flash-Lite
// Fallback: Cloudflare Workers AI (Llama 3.1 8B)
// ============================================================

import type { Env, RAGMatch, TroubleshootResponse } from '../types';
import { buildSystemPrompt, buildUserPrompt } from './prompts';

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
    finishReason?: string;
  }>;
}

export async function generateTroubleshootPlan(
  env: Env,
  query: string,
  matches: RAGMatch[]
): Promise<{ result: TroubleshootResponse; modelUsed: string }> {
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(query, matches);
  const topMatch = matches[0]?.runbook;

  // 1. Attempt Primary: Google AI Studio Gemini
  if (env.GEMINI_API_KEY) {
    const model = env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: systemPrompt }],
          },
          contents: [
            {
              role: 'user',
              parts: [{ text: userPrompt }],
            },
          ],
          generationConfig: {
            temperature: 0.2, // Low temperature for deterministic troubleshooting
            maxOutputTokens: 2048,
            responseMimeType: 'application/json',
          },
        }),
      });

      if (resp.ok) {
        const data = (await resp.json()) as GeminiResponse;
        const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (rawText) {
          const parsed = parseLLMJsonResponse(rawText, query, topMatch);
          return { result: parsed, modelUsed: `google/${model}` };
        }
      } else {
        console.warn(`[Gemini API Error] Status: ${resp.status}, falling back to Workers AI.`);
      }
    } catch (geminiErr) {
      console.warn('[Gemini Call Failed, falling back to Workers AI]:', geminiErr);
    }
  }

  // 2. Attempt Fallback: Cloudflare Workers AI
  if (env.AI) {
    const cfModel = env.FALLBACK_MODEL || '@cf/meta/llama-3.1-8b-instruct';
    try {
      const aiResponse = await env.AI.run(cfModel, {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.2,
        max_tokens: 1500,
      });

      const responseText = aiResponse?.response || '';
      if (responseText) {
        const parsed = parseLLMJsonResponse(responseText, query, topMatch);
        return { result: parsed, modelUsed: `cloudflare/${cfModel}` };
      }
    } catch (cfAiErr) {
      console.warn('[Workers AI Failed, falling back to deterministic catalog]:', cfAiErr);
    }
  }

  // 3. Fallback to Grounded Catalog Directly (Zero-LLM Offline Mode)
  // Guarantees 100% uptime even if all external APIs are exhausted!
  return {
    result: createDeterministicFallback(query, topMatch),
    modelUsed: 'offline/deterministic-catalog',
  };
}

function parseLLMJsonResponse(raw: string, query: string, topMatch?: any): TroubleshootResponse {
  let cleaned = raw.trim();
  // Strip code fences if present
  if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
  if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
  if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
  cleaned = cleaned.trim();

  try {
    const obj = JSON.parse(cleaned);
    return {
      query,
      matched_runbook: topMatch
        ? {
            id: topMatch.id,
            title: topMatch.title,
            error_code: topMatch.error_code,
            category: topMatch.category,
            source_url: topMatch.source_url,
          }
        : null,
      error_code: obj.error_code || topMatch?.error_code || 'General Error',
      title: obj.title || topMatch?.title || 'Troubleshooting Diagnosis',
      root_cause: obj.root_cause || topMatch?.root_cause || 'Root cause under investigation.',
      diagnostic_command: obj.diagnostic_command || topMatch?.diagnostic_command || 'echo "Inspect logs"',
      steps: Array.isArray(obj.steps) && obj.steps.length > 0 ? obj.steps : topMatch?.solution_steps || [],
      detailed_explanation: obj.detailed_explanation || topMatch?.summary || '',
      verified_sources: Array.isArray(obj.verified_sources) && obj.verified_sources.length > 0
        ? obj.verified_sources
        : topMatch?.source_url ? [topMatch.source_url] : [],
      meta: {
        from_cache: false,
        duration_ms: 0,
        model: 'unknown',
        search_strategy: 'hybrid',
      },
    };
  } catch (err) {
    console.error('[JSON Parse Error in AI output]:', err, raw);
    return createDeterministicFallback(query, topMatch);
  }
}

function createDeterministicFallback(query: string, topMatch?: any): TroubleshootResponse {
  if (topMatch) {
    return {
      query,
      matched_runbook: {
        id: topMatch.id,
        title: topMatch.title,
        error_code: topMatch.error_code,
        category: topMatch.category,
        source_url: topMatch.source_url,
      },
      error_code: topMatch.error_code,
      title: topMatch.title,
      root_cause: topMatch.root_cause,
      diagnostic_command: topMatch.diagnostic_command,
      steps: topMatch.solution_steps,
      detailed_explanation: topMatch.summary,
      verified_sources: topMatch.source_url ? [topMatch.source_url] : [],
      meta: {
        from_cache: false,
        duration_ms: 0,
        model: 'deterministic-catalog',
        search_strategy: 'fts',
      },
    };
  }

  return {
    query,
    matched_runbook: null,
    error_code: 'UNKNOWN_INCIDENT',
    title: 'Incident Diagnosis Needed',
    root_cause: 'No verified runbook was found for this specific query, and external AI providers are offline.',
    diagnostic_command: 'journalctl -xe --no-pager | tail -n 50',
    steps: [
      {
        step: 1,
        action: 'Inspect system logs for recent error events',
        command: 'journalctl -xe --no-pager | tail -n 50',
        expected: 'Displays recent service crashes or stack traces.',
      },
      {
        step: 2,
        action: 'Check running service status',
        command: 'systemctl status <your-service-name>',
        expected: 'Identifies if process terminated or failed liveness check.',
      },
    ],
    detailed_explanation: 'Please provide exact error codes (e.g. Exit 137, CrashLoopBackOff, 502 Bad Gateway) for instant deterministic matching.',
    verified_sources: [],
    meta: {
      from_cache: false,
      duration_ms: 0,
      model: 'offline/generic-fallback',
      search_strategy: 'generative_fallback',
    },
  };
}
