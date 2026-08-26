// ============================================================
// ErrorLens Worker Types & Bindings
// ============================================================

export interface Env {
  // Cloudflare Bindings
  DB: D1Database;
  VECTOR_INDEX?: VectorizeIndex;
  AI?: any; // Cloudflare Workers AI
  KV?: KVNamespace;
  ASSETS?: Fetcher;

  // Environment Secrets & Config
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;       // Default: 'gemini-2.5-flash-lite'
  FALLBACK_MODEL?: string;     // Default: '@cf/meta/llama-3.1-8b-instruct'
  MAX_RPM_PER_IP?: string | number;
  MAX_RPD_PER_IP?: string | number;
  CACHE_TTL_SECONDS?: string | number;
  ENVIRONMENT?: string;
}

export interface TriageStep {
  step: number;
  action: string;
  command?: string;
  expected?: string;
}

export interface Runbook {
  id: number;
  slug: string;
  category: string;
  error_code: string;
  title: string;
  summary: string;
  root_cause: string;
  diagnostic_command: string;
  solution_steps: string; // JSON string in DB
  tags: string;           // JSON string in DB
  source_url?: string;
  created_at: string;
  updated_at: string;
}

export interface ParsedRunbook extends Omit<Runbook, 'solution_steps' | 'tags'> {
  solution_steps: TriageStep[];
  tags: string[];
}

export interface TroubleshootRequest {
  query: string;
  category?: string;
  stream?: boolean;
}

export interface TroubleshootResponse {
  query: string;
  error_code: string;
  title: string;
  matched_runbook: {
    id: number;
    title: string;
    error_code: string;
    category: string;
    source_url?: string;
  } | null;
  diagnostic_command: string;
  root_cause: string;
  steps: TriageStep[];
  detailed_explanation: string;
  verified_sources: string[];
  meta: {
    from_cache: boolean;
    duration_ms: number;
    model: string;
    search_strategy: 'fts' | 'vector' | 'hybrid' | 'cache' | 'generative_fallback';
  };
}

export interface RAGMatch {
  runbook: ParsedRunbook;
  score: number;
  match_type: 'fts' | 'vector' | 'hybrid';
}
