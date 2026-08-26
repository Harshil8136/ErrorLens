export type {
  TriageStep,
  ContingencyOption,
  IncidentDomain,
  IncidentSeverity,
  SearchStrategy,
  MatchedRunbook,
  TroubleshootResponse,
} from '../../shared/api';

import type { TriageStep, SearchStrategy, TroubleshootResponse } from '../../shared/api';

export interface Env {
  DB: D1Database;
  AI?: Ai;
  VECTOR_INDEX?: VectorizeIndex;
  ASSETS?: Fetcher;

  ENVIRONMENT?: string;
  GEMINI_MODEL?: string;
  FALLBACK_MODEL?: string;
  EMBEDDING_MODEL?: string;
  MAX_RPM_PER_IP?: string;
  MAX_RPD_PER_IP?: string;
  CACHE_TTL_SECONDS?: string;
  LOG_RETENTION_DAYS?: string;

  // Secrets. All three are set with `wrangler secret put`.
  GEMINI_API_KEY?: string;
  ADMIN_TOKEN?: string;
  IP_HASH_SALT?: string;
}

/** A runbook row exactly as D1 stores it: JSON columns are still strings. */
export interface RunbookRow {
  id: number;
  slug: string;
  category: string;
  error_code: string;
  title: string;
  summary: string;
  root_cause: string;
  diagnostic_command: string;
  solution_steps: string;
  tags: string;
  source_url: string | null;
  hit_count: number;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Runbook extends Omit<RunbookRow, 'solution_steps' | 'tags'> {
  solution_steps: TriageStep[];
  tags: string[];
}

export interface RagMatch {
  runbook: Runbook;
  score: number;
  matchType: 'fts' | 'vector' | 'hybrid';
}

export interface RagResult {
  matches: RagMatch[];
  strategy: SearchStrategy;
  /** Vector dimensions queried, for the free-tier budget meter. 0 when the
   *  dense half did not run. */
  dimsQueried: number;
}

export interface GenerationResult {
  response: TroubleshootResponse;
  model: string;
  /** Rough Workers AI neuron cost, for the budget meter. 0 for Gemini. */
  neurons: number;
  provider: 'gemini' | 'workers-ai' | 'catalog';
}
