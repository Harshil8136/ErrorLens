import { useState } from 'preact/hooks';

interface TriageStep {
  step: number;
  action: string;
  command?: string;
  expected?: string;
}

interface ContingencyOption {
  condition: string;
  action: string;
  command?: string;
}

type IncidentDomain =
  | 'cloud_edge'
  | 'networking_dns'
  | 'linux_sysadmin'
  | 'windows_m365'
  | 'containers_k8s'
  | 'database_sql'
  | 'observability_app'
  | 'general_systems';

type IncidentSeverity = 'P1_CRITICAL' | 'P2_HIGH' | 'P3_MEDIUM' | 'P4_LOW';

interface TroubleshootResponse {
  query: string;
  error_code: string;
  title: string;
  domain: IncidentDomain;
  severity: IncidentSeverity;
  matched_runbook: {
    id: number;
    title: string;
    error_code: string;
    category: string;
    source_url?: string;
    verified_at?: string;
  } | null;
  diagnostic_command: string;
  root_cause: string;
  steps: TriageStep[];
  contingencies: ContingencyOption[];
  prevention_sop?: string;
  escalation_ticket?: string;
  detailed_explanation: string;
  verified_sources: string[];
  grounded: boolean;
  meta: {
    from_cache: boolean;
    duration_ms: number;
    model: string;
    search_strategy: string;
  };
}

interface SampleQuery {
  label: string;
  query: string;
  domain: IncidentDomain;
}

const DOMAIN_FILTERS: { key: string; label: string; icon: string }[] = [
  { key: 'all', label: 'All Errors', icon: '🌐' },
  { key: 'cloud_edge', label: 'Cloudflare & Edge', icon: '☁️' },
  { key: 'networking_dns', label: 'Networking & DNS', icon: '🔌' },
  { key: 'linux_sysadmin', label: 'Linux & Servers', icon: '🐧' },
  { key: 'windows_m365', label: 'Windows & Active Directory', icon: '🪟' },
  { key: 'containers_k8s', label: 'Docker & Kubernetes', icon: '🐳' },
  { key: 'database_sql', label: 'Databases', icon: '🗄️' },
  { key: 'observability_app', label: 'Apps & APIs', icon: '📊' },
];

const SAMPLE_QUERIES: SampleQuery[] = [
  { label: 'Cloudflare 522 Connection Timed Out', query: 'Cloudflare Error 522 Connection timed out to origin server', domain: 'cloud_edge' },
  { label: 'Cloudflare Worker Error 1102 (CPU Limit)', query: 'Cloudflare Worker Error 1102 Exceeded CPU Time Limit', domain: 'cloud_edge' },
  { label: 'AWS S3 403 Access Denied', query: 'AWS S3 Access Denied 403 Forbidden with valid credentials', domain: 'cloud_edge' },
  { label: 'DNS SERVFAIL / DNSSEC Failure', query: 'DNS lookup returns SERVFAIL DNSSEC validation failed', domain: 'networking_dns' },
  { label: 'VPN Connected but No Route to Subnet', query: 'VPN client connected successfully but cannot reach internal subnet 10.0.0.0/16', domain: 'networking_dns' },
  { label: 'Active Directory Kerberos Error 0x18', query: 'Active Directory Kerberos pre-authentication failed error 0x18 user logon', domain: 'windows_m365' },
  { label: 'Windows BSOD 0x0000007E', query: 'Windows Blue Screen Stop 0x0000007E SYSTEM_THREAD_EXCEPTION_NOT_HANDLED', domain: 'windows_m365' },
  { label: 'Docker Exit Code 137 (OOMKilled)', query: 'Docker container exited with code 137 OOMKilled', domain: 'containers_k8s' },
  { label: 'Kubernetes CrashLoopBackOff', query: 'Kubernetes Pod stuck in CrashLoopBackOff liveness probe failed', domain: 'containers_k8s' },
  { label: 'Linux Inode Exhaustion (ENOSPC)', query: 'Linux no space left on device but df -h shows free gigabytes', domain: 'linux_sysadmin' },
  { label: 'PostgreSQL 53300 Connection Slots', query: 'Postgres FATAL: remaining connection slots are reserved for non-replication superuser', domain: 'database_sql' },
  { label: 'Sentry Unhandled Rejection Alert', query: 'Sentry alert: UnhandledPromiseRejection in Node.js production service', domain: 'observability_app' },
];

export function App() {
  const [query, setQuery] = useState('');
  const [selectedDomain, setSelectedDomain] = useState('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TroubleshootResponse | null>(null);
  const [copiedText, setCopiedText] = useState<string | null>(null);

  const filteredSamples = selectedDomain === 'all'
    ? SAMPLE_QUERIES
    : SAMPLE_QUERIES.filter(s => s.domain === selectedDomain);

  const runTroubleshoot = async (searchQuery: string) => {
    const q = searchQuery.trim();
    if (!q || loading) return;

    setLoading(true);
    setError(null);
    setQuery(q);

    try {
      const resp = await fetch('/api/troubleshoot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q }),
      });

      const data = await resp.json();

      if (!resp.ok) {
        throw new Error(data.message || data.error || `HTTP ${resp.status}`);
      }

      setResult(data as TroubleshootResponse);
    } catch (err: any) {
      setError(err.message || 'Could not connect to the troubleshooting service.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(text);
    setTimeout(() => setCopiedText(null), 2000);
  };

  const copySummary = () => {
    if (!result) return;
    const summary = result.escalation_ticket || [
      `[ISSUE] ${result.title} (${result.error_code})`,
      `Severity: ${formatSeverity(result.severity)} | Category: ${formatDomainName(result.domain)}`,
      `Diagnostic: ${result.diagnostic_command}`,
      `Root Cause: ${result.root_cause}`,
      `Steps:`,
      ...result.steps.map(s => `  ${s.step}. ${s.action} -> ${s.command || 'N/A'}`),
      `Still Not Working?`,
      ...(result.contingencies || []).map(c => `  - If: ${c.condition} -> Try: ${c.action}`),
      `Prevention: ${result.prevention_sop || 'None specified'}`,
    ].join('\n');

    handleCopy(summary);
  };

  const formatSeverity = (sev?: IncidentSeverity) => {
    switch (sev) {
      case 'P1_CRITICAL': return 'Critical';
      case 'P2_HIGH': return 'High';
      case 'P3_MEDIUM': return 'Medium';
      case 'P4_LOW': return 'Low';
      default: return 'High';
    }
  };

  const getSeverityClass = (sev?: IncidentSeverity) => {
    switch (sev) {
      case 'P1_CRITICAL': return 'badge-sev sev-p1';
      case 'P2_HIGH': return 'badge-sev sev-p2';
      case 'P3_MEDIUM': return 'badge-sev sev-p3';
      case 'P4_LOW': return 'badge-sev sev-p4';
      default: return 'badge-sev sev-p2';
    }
  };

  const formatDomainName = (d?: string) => {
    switch (d) {
      case 'cloud_edge': return 'Cloudflare & Edge';
      case 'networking_dns': return 'Networking & DNS';
      case 'linux_sysadmin': return 'Linux & Servers';
      case 'windows_m365': return 'Windows & AD';
      case 'containers_k8s': return 'Docker & K8s';
      case 'database_sql': return 'Databases';
      case 'observability_app': return 'Apps & APIs';
      default: return 'Systems';
    }
  };

  return (
    <div class="container">
      {/* Header */}
      <header>
        <div class="brand-badge">⚡ ErrorLens • Instant Error Lookup & Fixes</div>
        <h1 class="hero-title">Find the fix for any error, fast.</h1>
        <p class="hero-subtitle">
          Paste any error message, terminal log, or stack trace. Get clear root causes, quick diagnostic checks, step-by-step solutions, and what to try if issues persist.
        </p>
      </header>

      {/* Category Tabs */}
      <div class="domain-bar">
        {DOMAIN_FILTERS.map(f => (
          <button
            key={f.key}
            class={`domain-btn ${selectedDomain === f.key ? 'active' : ''}`}
            onClick={() => setSelectedDomain(f.key)}
          >
            {f.icon} {f.label}
          </button>
        ))}
      </div>

      {/* Search Input */}
      <div class="search-wrapper">
        <input
          type="text"
          class="search-input"
          placeholder="Paste an error message, exit code, log line, or stack trace..."
          value={query}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => e.key === 'Enter' && runTroubleshoot(query)}
        />
        <button
          class="search-btn"
          disabled={loading || !query.trim()}
          onClick={() => runTroubleshoot(query)}
        >
          {loading ? <span class="spinner"></span> : 'Troubleshoot'}
        </button>
      </div>

      {/* Common Issue Chips */}
      <div class="chips-bar">
        <span class="chips-label">Common Issues:</span>
        {filteredSamples.map((sq) => (
          <button key={sq.query} class="chip" onClick={() => runTroubleshoot(sq.query)}>
            {sq.label}
          </button>
        ))}
      </div>

      {/* Error Message */}
      {error && (
        <div
          class="result-card"
          style={{ borderColor: 'var(--rose)', background: 'rgba(244, 63, 94, 0.08)' }}
        >
          <div style={{ color: 'var(--rose)', fontWeight: 600, marginBottom: '6px' }}>
            Notice
          </div>
          <div style={{ color: '#cbd5e1', fontSize: '14px' }}>{error}</div>
        </div>
      )}

      {/* Result Display */}
      {result && (
        <div class="result-card">
          <div class="result-header">
            <div>
              <div class="header-badges">
                <span class={getSeverityClass(result.severity)}>
                  {formatSeverity(result.severity)}
                </span>
                <span class="badge-domain">
                  {formatDomainName(result.domain)}
                </span>
                <span class="error-badge">{result.error_code}</span>
                {result.matched_runbook && (
                  <span
                    class="tag-badge"
                    style={{ background: 'rgba(6, 182, 212, 0.15)', color: 'var(--cyan)' }}
                  >
                    ✓ Verified Runbook
                  </span>
                )}
              </div>
              <h2 class="result-title">{result.title}</h2>
            </div>

            <div class="header-actions">
              <button
                class="escalate-btn"
                onClick={copySummary}
                title="Copy markdown summary of this solution"
              >
                {copiedText && (copiedText.startsWith('[ISSUE') || copiedText.startsWith('[ERROR'))
                  ? '✓ Copied'
                  : '📋 Copy Summary'}
              </button>
            </div>
          </div>

          {/* Root Cause Summary */}
          <div class="section-title">🔍 Why It Happened</div>
          <div class="explanation-box">{result.root_cause}</div>

          {/* Diagnostic Check */}
          <div class="section-title">⚡ Diagnostic Check</div>
          <div class="terminal-block">
            <div class="terminal-header">
              <div class="terminal-dots">
                <div class="terminal-dot"></div>
                <div class="terminal-dot"></div>
                <div class="terminal-dot"></div>
              </div>
              <span>Run this command first to verify:</span>
            </div>
            <div class="terminal-body">
              <code class="terminal-code">{result.diagnostic_command}</code>
              <button
                class={`copy-btn ${copiedText === result.diagnostic_command ? 'copied' : ''}`}
                onClick={() => handleCopy(result.diagnostic_command)}
              >
                {copiedText === result.diagnostic_command ? '✓ Copied' : 'Copy Command'}
              </button>
            </div>
          </div>

          {/* Step-by-Step Fix */}
          <div class="section-title">🛠️ How to Fix It</div>
          <div class="steps-list">
            {result.steps.map((s, idx) => (
              <div key={idx} class="step-card">
                <div class="step-number">{s.step || idx + 1}</div>
                <div class="step-content">
                  <div class="step-action">{s.action}</div>
                  {s.command && (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '8px',
                      }}
                    >
                      <code class="step-command" style={{ flex: 1 }}>
                        {s.command}
                      </code>
                      <button
                        class={`copy-btn ${copiedText === s.command ? 'copied' : ''}`}
                        onClick={() => handleCopy(s.command!)}
                      >
                        {copiedText === s.command ? '✓' : 'Copy'}
                      </button>
                    </div>
                  )}
                  {s.expected && <div class="step-expected">Expected output: {s.expected}</div>}
                </div>
              </div>
            ))}
          </div>

          {/* Still Not Working? */}
          {result.contingencies && result.contingencies.length > 0 && (
            <div class="contingency-container">
              <div class="section-title" style={{ color: '#fbbf24', marginBottom: '14px' }}>
                🔀 Still Not Working? Try These Next
              </div>
              <div class="contingency-list">
                {result.contingencies.map((c, i) => (
                  <div key={i} class="contingency-item">
                    <div class="contingency-condition">If: {c.condition}</div>
                    <div class="contingency-action">Try: {c.action}</div>
                    {c.command && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
                        <code class="step-command" style={{ margin: 0, flex: 1 }}>
                          {c.command}
                        </code>
                        <button
                          class={`copy-btn ${copiedText === c.command ? 'copied' : ''}`}
                          onClick={() => handleCopy(c.command!)}
                        >
                          {copiedText === c.command ? '✓' : 'Copy'}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Prevention & Monitoring */}
          {result.prevention_sop && (
            <>
              <div class="section-title">🛡️ How to Prevent This</div>
              <div class="sop-box">{result.prevention_sop}</div>
            </>
          )}

          {/* Technical Details */}
          {result.detailed_explanation && (
            <>
              <div class="section-title">📚 Technical Details</div>
              <p style={{ color: '#cbd5e1', fontSize: '13.5px', lineHeight: '1.7', marginBottom: '24px' }}>
                {result.detailed_explanation}
              </p>
            </>
          )}

          {/* Telemetry Footer */}
          <div class="telemetry-bar">
            <div class="telemetry-tags">
              <span class={`tag-badge ${result.meta.from_cache ? 'cache-hit' : ''}`}>
                {result.meta.from_cache ? '⚡ Cached' : '🌐 Generated'}
              </span>
              <span class="tag-badge">{result.meta.duration_ms} ms</span>
              <span class="tag-badge">{result.meta.model}</span>
            </div>

            {result.verified_sources && result.verified_sources.length > 0 && (
              <div class="sources-list">
                <span>Docs:</span>
                {result.verified_sources.map((src, i) => (
                  <a key={i} href={src} target="_blank" rel="noopener noreferrer">
                    Reference #{i + 1} &rarr;
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Footer */}
      <footer>
        <p>
          <strong>ErrorLens</strong> &mdash; Instant error troubleshooting and fix playbooks.
          <br />
          Running on Cloudflare Workers (D1, Vectorize, KV) and Google Gemini.
        </p>
      </footer>
    </div>
  );
}
