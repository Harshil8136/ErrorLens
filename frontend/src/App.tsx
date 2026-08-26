import { useState } from 'preact/hooks';

interface TriageStep {
  step: number;
  action: string;
  command?: string;
  expected?: string;
}

interface TroubleshootResponse {
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
    search_strategy: string;
  };
}

const SAMPLE_QUERIES = [
  'Docker container exited with code 137',
  'Kubernetes Pod stuck in CrashLoopBackOff',
  'Node.js error:0308010C:digital envelope routines::unsupported',
  'Nginx 502 Bad Gateway upstream connection refused',
  'Linux no space left on device but df -h has free GBs',
  'Postgres FATAL: remaining connection slots are reserved',
  'Cloudflare Worker Error 1101 CPU limit exceeded',
];

export function App() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TroubleshootResponse | null>(null);
  const [copiedText, setCopiedText] = useState<string | null>(null);

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
      setError(err.message || 'Failed to connect to troubleshooting engine.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(text);
    setTimeout(() => setCopiedText(null), 2000);
  };

  return (
    <div class="container">
      {/* Header */}
      <header>
        <div class="brand-badge">⚡ 100% Free Edge RAG &bull; Cloudflare + Gemini</div>
        <h1 class="hero-title">Deterministic DevOps Troubleshooting</h1>
        <p class="hero-subtitle">
          Instant root cause analysis, diagnostic commands, and verified remediation steps.
          Grounded in battle-tested runbooks &mdash; no conversational fluff or hallucinated flags.
        </p>
      </header>

      {/* Search Bar */}
      <div class="search-wrapper">
        <input
          type="text"
          class="search-input"
          placeholder="Paste error string, stack trace, or incident symptoms (e.g. Exit code 137, CrashLoopBackOff)..."
          value={query}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => e.key === 'Enter' && runTroubleshoot(query)}
        />
        <button
          class="search-btn"
          disabled={loading || !query.trim()}
          onClick={() => runTroubleshoot(query)}
        >
          {loading ? <span class="spinner"></span> : 'Diagnose'}
        </button>
      </div>

      {/* Sample Error Chips */}
      <div class="chips-bar">
        <span class="chips-label">Try Common Errors:</span>
        {SAMPLE_QUERIES.map((sq) => (
          <button key={sq} class="chip" onClick={() => runTroubleshoot(sq)}>
            {sq}
          </button>
        ))}
      </div>

      {/* Error Banner */}
      {error && (
        <div
          class="result-card"
          style={{ borderColor: 'var(--rose)', background: 'rgba(244, 63, 94, 0.08)' }}
        >
          <div style={{ color: 'var(--rose)', fontWeight: 600, marginBottom: '6px' }}>
            ⚠️ Diagnostic Request Notice
          </div>
          <div style={{ color: '#cbd5e1', fontSize: '14px' }}>{error}</div>
        </div>
      )}

      {/* Result Display */}
      {result && (
        <div class="result-card">
          <div class="result-header">
            <div>
              <span class="error-badge">{result.error_code}</span>
              <h2 class="result-title">{result.title}</h2>
            </div>
            {result.matched_runbook && (
              <span
                class="tag-badge"
                style={{ background: 'rgba(6, 182, 212, 0.15)', color: 'var(--cyan)' }}
              >
                Verified Runbook Match
              </span>
            )}
          </div>

          {/* Root Cause Summary */}
          <div class="section-title">Root Cause Analysis</div>
          <div class="explanation-box">{result.root_cause}</div>

          {/* Primary Terminal Diagnostic */}
          <div class="section-title">Step 1: Verification Diagnostic Command</div>
          <div class="terminal-block">
            <div class="terminal-header">
              <div class="terminal-dots">
                <div class="terminal-dot"></div>
                <div class="terminal-dot"></div>
                <div class="terminal-dot"></div>
              </div>
              <span>Terminal Verification</span>
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

          {/* Step-by-step Triage Tree */}
          <div class="section-title">Step-by-Step Remediation Plan</div>
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
                  {s.expected && <div class="step-expected">Expected outcome: {s.expected}</div>}
                </div>
              </div>
            ))}
          </div>

          {/* Deep Architectural Context */}
          {result.detailed_explanation && (
            <>
              <div class="section-title">Deep Architectural Context</div>
              <p style={{ color: '#cbd5e1', fontSize: '14px', lineHeight: '1.7', marginBottom: '24px' }}>
                {result.detailed_explanation}
              </p>
            </>
          )}

          {/* Telemetry & Upstream Links */}
          <div class="telemetry-bar">
            <div class="telemetry-tags">
              <span class={`tag-badge ${result.meta.from_cache ? 'cache-hit' : ''}`}>
                {result.meta.from_cache ? '⚡ Edge Cache Hit' : '🌐 Edge Compute'}
              </span>
              <span class="tag-badge">Latency: {result.meta.duration_ms} ms</span>
              <span class="tag-badge">Search: {result.meta.search_strategy}</span>
              <span class="tag-badge">Model: {result.meta.model}</span>
            </div>

            {result.verified_sources && result.verified_sources.length > 0 && (
              <div class="sources-list">
                <span>Upstream Sources:</span>
                {result.verified_sources.map((src, i) => (
                  <a key={i} href={src} target="_blank" rel="noopener noreferrer">
                    Docs #{i + 1} &rarr;
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
          <strong>ErrorLens</strong> &mdash; Built with Cloudflare Workers (D1 FTS5, Vectorize, Workers AI) + Google AI Studio Gemini.
          <br />
          Open source under MIT License. 100% Free Tier Architecture.
        </p>
      </footer>
    </div>
  );
}
