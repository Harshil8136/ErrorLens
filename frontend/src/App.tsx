import { useRef, useState } from 'preact/hooks';
import type { TroubleshootResponse } from '../../shared/api';
import { ApiError, troubleshoot } from './api';
import { ResultCard } from './components/ResultCard';
import { useTurnstile } from './useTurnstile';

const EXAMPLES = [
  'Docker container exited with code 137',
  'Pod stuck in CrashLoopBackOff',
  'error:0308010C digital envelope routines unsupported',
  'nginx 502 bad gateway upstream connection refused',
  'df shows free space but writes fail with ENOSPC',
  'psql FATAL remaining connection slots are reserved',
  'Cloudflare Worker error 1102',
];

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

    // Clicking a second example while the first is still running should not
    // leave two responses racing to set state.
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
      // Turnstile tokens are redeemed exactly once, so the widget has to be
      // reset before the next attempt regardless of how this one ended.
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
        <p class="kicker">Hybrid retrieval over reviewed runbooks</p>
        <h1>Work out what broke, then fix it</h1>
        <p class="lede">
          Paste an error code, a stack trace or a symptom. You get the command that confirms the
          cause, the steps that fix it, and what to try when those do not work.
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
          placeholder="Exit code 137, CrashLoopBackOff, ECONNREFUSED..."
          onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
        />
        <button type="submit" disabled={busy || query.trim().length === 0}>
          {busy ? 'Diagnosing' : 'Diagnose'}
        </button>
      </form>

      {turnstile.siteKey && (
        <div class="turnstile">
          <div ref={turnstile.containerRef} />
          {turnstile.error && <p class="turnstile-error">{turnstile.error}</p>}
        </div>
      )}

      <div class="examples">
        <span class="examples-label">Try:</span>
        <div class="examples-list">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              class="example"
              disabled={busy}
              onClick={() => run(example)}
            >
              {example}
            </button>
          ))}
        </div>
      </div>

      <div aria-live="polite" aria-busy={busy}>
        {busy && (
          <p class="loading" role="status">
            <span class="spinner" aria-hidden="true" />
            Searching runbooks and building a plan…
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
          Runs entirely on Cloudflare's free tier — Workers, D1 with FTS5, Vectorize and Workers AI
          — with Gemini Flash-Lite on Google AI Studio's free tier for generation. Rate limited to
          keep it that way.
        </p>
        <p>
          <a href="https://github.com/harshil/errorlens" rel="noopener noreferrer">
            Source
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
