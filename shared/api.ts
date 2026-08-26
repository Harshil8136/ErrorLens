/**
 * The wire contract between the Worker and the browser.
 *
 * Both sides import from here. Previously each kept its own copy of
 * `TroubleshootResponse`, which is fine right up until one of them changes.
 */

export interface TriageStep {
  step: number;
  action: string;
  command?: string;
  expected?: string;
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

export type SearchStrategy = 'fts' | 'vector' | 'hybrid' | 'cache' | 'none';

export interface MatchedRunbook {
  id: number;
  slug: string;
  title: string;
  error_code: string;
  category: string;
  source_url: string | null;
  verified_at: string | null;
}

export interface TroubleshootResponse {
  query: string;
  error_code: string;
  title: string;
  domain: IncidentDomain;
  severity: IncidentSeverity;
  matched_runbook: MatchedRunbook | null;
  diagnostic_command: string;
  root_cause: string;
  steps: TriageStep[];
  contingencies: ContingencyOption[];
  prevention_sop?: string;
  escalation_ticket?: string;
  detailed_explanation: string;
  verified_sources: string[];
  /**
   * True when the steps came verbatim from a stored, human-verified runbook.
   * False means a model wrote them, and the UI says so -- these are commands
   * people paste into a shell.
   */
  grounded: boolean;
  meta: {
    from_cache: boolean;
    duration_ms: number;
    model: string;
    search_strategy: SearchStrategy;
  };
}

export const DOMAIN_LABELS: Record<IncidentDomain, string> = {
  cloud_edge: 'Cloud & edge',
  networking_dns: 'Networking & DNS',
  linux_sysadmin: 'Linux',
  windows_m365: 'Windows & M365',
  containers_k8s: 'Containers & K8s',
  database_sql: 'Databases',
  observability_app: 'Observability',
  general_systems: 'General',
};

export const SEVERITY_LABELS: Record<IncidentSeverity, string> = {
  P1_CRITICAL: 'P1 critical',
  P2_HIGH: 'P2 high',
  P3_MEDIUM: 'P3 medium',
  P4_LOW: 'P4 low',
};
