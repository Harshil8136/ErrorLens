import { useCallback, useEffect, useRef, useState } from 'preact/hooks';

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const ACTION = 'diagnose';

interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  getResponse(id: string): string | undefined;
  reset(id: string): void;
  remove(id: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Could not load the verification widget.'));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export interface Turnstile {
  /** Null until /api/config responds, and stays null when Turnstile is off. */
  siteKey: string | null;
  /** Attach to the element the widget should render into. */
  containerRef: { current: HTMLDivElement | null };
  /** Current token, or null. Empty when the visitor has not solved it yet. */
  getToken: () => string | null;
  /** Tokens are single-use, so this runs after every request. */
  reset: () => void;
  error: string | null;
}

/**
 * Renders a Turnstile widget explicitly and hands back its token.
 *
 * Explicit rendering rather than the automatic `cf-turnstile` class, because
 * this page stays mounted after a submission. A Turnstile token is redeemed
 * exactly once at siteverify, so the widget has to be reset between requests —
 * which needs the widget ID that only explicit rendering returns.
 */
export function useTurnstile(): Turnstile {
  const [siteKey, setSiteKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetId = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch('/api/config')
      .then((res) => res.json() as Promise<{ turnstile_site_key: string | null }>)
      .then((cfg) => {
        if (!cancelled) setSiteKey(cfg.turnstile_site_key);
      })
      .catch(() => {
        // Config is advisory. If it fails, the app still works; the request
        // will be rejected server-side if verification is actually required.
        if (!cancelled) setSiteKey(null);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!siteKey || !containerRef.current || widgetId.current) return;
    let cancelled = false;

    loadScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return;
        widgetId.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          action: ACTION,
          theme: 'dark',
          'error-callback': () => setError('Verification could not load. Refresh to retry.'),
          'expired-callback': () => {
            if (widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current);
          },
        });
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });

    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) {
        window.turnstile.remove(widgetId.current);
        widgetId.current = null;
      }
    };
  }, [siteKey]);

  const getToken = useCallback(() => {
    if (!widgetId.current || !window.turnstile) return null;
    return window.turnstile.getResponse(widgetId.current) || null;
  }, []);

  const reset = useCallback(() => {
    if (widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current);
  }, []);

  return { siteKey, containerRef, getToken, reset, error };
}
