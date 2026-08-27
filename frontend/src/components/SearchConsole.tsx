import { ArrowRight, Loader2, Search, X } from 'lucide-preact';
import { useRef } from 'preact/hooks';

interface SearchConsoleProps {
  query: string;
  onQueryChange: (q: string) => void;
  onSubmit: (q: string) => void;
  busy: boolean;
}

export function SearchConsole({ query, onQueryChange, onSubmit, busy }: SearchConsoleProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    if (busy || !query.trim()) return;
    onSubmit(query.trim());
  };

  const handleClear = () => {
    onQueryChange('');
    inputRef.current?.focus();
  };

  return (
    <section class="console-hero">
      <div class="console-intro">
        <h1 class="console-title">Find out what broke and how to fix it</h1>
        <p class="console-subtitle">
          Paste an error code, terminal log, or exception to get the diagnostic command that
          confirms the cause, the steps to fix it, and what to try next if it persists.
        </p>
      </div>

      <form class="console-form" onSubmit={handleSubmit}>
        <div class="console-input-bar">
          <div class="console-icon" aria-hidden="true">
            <Search size={18} strokeWidth={2.2} />
          </div>
          <input
            ref={inputRef}
            id="search-input"
            type="text"
            value={query}
            maxLength={1000}
            autocomplete="off"
            placeholder="Paste an error code, stack trace, log, or exit code..."
            class="console-input"
            onInput={(e) => onQueryChange((e.currentTarget as HTMLInputElement).value)}
            disabled={busy}
          />
          {query.length > 0 && !busy && (
            <button
              type="button"
              class="console-clear-btn"
              onClick={handleClear}
              title="Clear search"
              aria-label="Clear search input"
            >
              <X size={15} />
            </button>
          )}
          <button
            type="submit"
            class="console-submit-btn"
            disabled={busy || query.trim().length === 0}
          >
            {busy ? (
              <>
                <Loader2 size={16} class="spin" />
                <span>Diagnosing...</span>
              </>
            ) : (
              <>
                <span>Diagnose</span>
                <ArrowRight size={15} strokeWidth={2.2} />
              </>
            )}
          </button>
        </div>
      </form>
    </section>
  );
}
