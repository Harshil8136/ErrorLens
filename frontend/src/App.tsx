import { AlertCircle, Loader2 } from 'lucide-preact';
import { useRef, useState } from 'preact/hooks';
import type { TroubleshootResponse } from '../../shared/api';
import { ApiError, troubleshoot } from './api';
import { HeaderNav } from './components/HeaderNav';
import { ResultCard } from './components/ResultCard';
import { SearchConsole } from './components/SearchConsole';
import { SystemStatusModal } from './components/SystemStatusModal';
import { useTurnstile } from './useTurnstile';

export function App() {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<TroubleshootResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const inFlight = useRef<AbortController | null>(null);
  const turnstile = useTurnstile();

  const run = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;

    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    setQuery(q);
    setBusy(true);
    setError(null);

    try {
      const res = await troubleshoot(q, turnstile.getToken(), controller.signal);
      setResult(res);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setResult(null);
      setError(
        err instanceof ApiError ? err.message : 'Diagnostic execution failed. Please retry.'
      );
    } finally {
      turnstile.reset();
      if (inFlight.current === controller) {
        inFlight.current = null;
        setBusy(false);
      }
    }
  };

  return (
    <div class="app-root">
      <HeaderNav onOpenStatus={() => setShowStatusModal(true)} />

      <main class="main-container">
        <SearchConsole query={query} onQueryChange={setQuery} onSubmit={run} busy={busy} />

        {turnstile.siteKey && (
          <div class="turnstile-zone">
            <div ref={turnstile.containerRef} />
            {turnstile.error && <p class="turnstile-error">{turnstile.error}</p>}
          </div>
        )}

        <div aria-live="polite" aria-busy={busy} class="results-area">
          {busy && (
            <div class="status-loading-card" role="status">
              <Loader2 size={20} class="spin status-loading-icon" />
              <span class="loading-primary">Diagnosing error and finding fixes...</span>
            </div>
          )}

          {error && !busy && (
            <div class="incident-error-banner" role="alert">
              <AlertCircle size={18} class="error-banner-icon" />
              <div class="error-banner-text">
                <span class="error-banner-title">Diagnostic Request Failed</span>
                <p class="error-banner-detail">{error}</p>
              </div>
            </div>
          )}

          {result && !busy && <ResultCard result={result} />}
        </div>
      </main>

      <footer class="app-footer">
        <div class="footer-inner">
          <p class="footer-copy">
            ErrorLens Engine • High-availability incident response running on Cloudflare Workers
            edge architecture and Google Gemini.
          </p>
          <div class="footer-links">
            <a
              href="https://github.com/Harshil8136/ErrorLens"
              target="_blank"
              rel="noopener noreferrer"
              class="footer-link"
            >
              GitHub Repository
            </a>
            <span class="footer-divider">·</span>
            <button
              type="button"
              class="footer-btn-link"
              onClick={() => setShowStatusModal(true)}
              title="View live Edge Health & Diagnostics"
            >
              Edge Status & Diagnostics
            </button>
            <span class="footer-divider">·</span>
            <a href="/admin" target="_blank" rel="noopener noreferrer" class="footer-link">
              Telemetry Admin
            </a>
          </div>
        </div>
      </footer>

      <SystemStatusModal isOpen={showStatusModal} onClose={() => setShowStatusModal(false)} />
    </div>
  );
}
