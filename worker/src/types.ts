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

export interface TriageStep {
  step: number;
  action: string;
  command?: string;
  expected?: string;
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

export type SearchStrategy = 'fts' | 'vector' | 'hybrid' | 'cache' | 'none';

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

export interface ContingencyOption {
  condition: string;
  action: string;
  command?: string;
}

export type IncidentDomain =
  | 'cloud_edge'
  | 'networking_dns'
  | 'linux_sysadmin'
  | 'windows_m365'
  | 'containers_k8s'
  | 'database_sql'
  | 'observability_app'
  | 'general_systems';

export type IncidentSeverity = 'P1_CRITICAL' | 'P2_HIGH' | 'P3_MEDIUM' | 'P4_LOW';

export interface TroubleshootResponse {
  query: string;
  error_code: string;
  title: string;
  domain: IncidentDomain;
  severity: IncidentSeverity;
  matched_runbook: {
    id: number;
    slug: string;
    title: string;
    error_code: string;
    category: string;
    source_url: string | null;
    verified_at: string | null;
  } | null;
  diagnostic_command: string;
  root_cause: string;
  steps: TriageStep[];
  contingencies: ContingencyOption[];
  prevention_sop?: string;
  escalation_ticket?: string;
  detailed_explanation: string;
  verified_sources: string[];
  /** True when the steps came from a stored runbook rather than being written
   *  by a model. The UI uses this to mark generated commands as unverified. */
  grounded: boolean;
  meta: {
    from_cache: boolean;
    duration_ms: number;
    model: string;
    search_strategy: SearchStrategy;
  };
}

export interface GenerationResult {
  response: TroubleshootResponse;
  model: string;
  /** Rough Workers AI neuron cost, for the budget meter. 0 for Gemini. */
  neurons: number;
  provider: 'gemini' | 'workers-ai' | 'catalog';
}
