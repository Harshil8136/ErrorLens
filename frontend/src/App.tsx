import { useRef, useState } from 'preact/hooks';
import type { TroubleshootResponse } from '../../shared/api';
import { ApiError, troubleshoot } from './api';
import { ResultCard } from './components/ResultCard';
import { useTurnstile } from './useTurnstile';

export function App() {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<TroubleshootResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
      setResult(await troubleshoot(q, turnstile.getToken(), controller.signal));
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setResult(null);
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      turnstile.reset();
      if (inFlight.current === controller) {
        inFlight.current = null;
        setBusy(false);
      }
    }
  };

  return (
    <div class="page">
      <header class="masthead">
        <p class="kicker">⚡ Universal AI Troubleshooting Engine</p>
        <h1>Investigate & fix any technical error</h1>
        <p class="lede">
          Paste any error message, system crash, exit code, or terminal log. Get verified root
          causes, diagnostic checks, and step-by-step resolution.
        </p>
      </header>

      <form
        class="search"
        onSubmit={(e) => {
          e.preventDefault();
          run(query);
        }}
      >
        <label class="visually-hidden" for="q">
          Describe the error you are seeing
        </label>
        <input
          id="q"
          type="text"
          value={query}
          maxLength={1000}
          autocomplete="off"
          placeholder="Paste any error code, stack trace, log, or symptom (e.g. 0x000000EF, CrashLoopBackOff, 502)..."
          onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
        />
        <button type="submit" disabled={busy || query.trim().length === 0}>
          {busy ? 'Analyzing...' : 'Troubleshoot'}
        </button>
      </form>

      {turnstile.siteKey && (
        <div class="turnstile">
          <div ref={turnstile.containerRef} />
          {turnstile.error && <p class="turnstile-error">{turnstile.error}</p>}
        </div>
      )}

      <div aria-live="polite" aria-busy={busy}>
        {busy && (
          <p class="loading" role="status">
            <span class="spinner" aria-hidden="true" />
            Analyzing error and generating troubleshooting steps…
          </p>
        )}

        {error && !busy && (
          <div class="banner" role="alert">
            {error}
          </div>
        )}

        {result && !busy && <ResultCard result={result} />}
      </div>

      <footer class="foot">
        <p>
          Running on Cloudflare Workers and Google Gemini Flash-Lite. Built for fast, reliable
          developer and IT troubleshooting.
        </p>
        <p>
          <a
            href="https://github.com/Harshil8136/ErrorLens"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
          {' · '}
          <a href="/api/health" rel="nofollow">
            Status
          </a>
        </p>
      </footer>
    </div>
  );
}
