import { useState } from 'preact/hooks';

interface Props {
  command: string;
  label?: string;
  /** Rendered smaller and without the terminal chrome, for step-level commands. */
  compact?: boolean;
}

type CopyState = 'idle' | 'copied' | 'failed';

/**
 * A copyable command.
 *
 * Copy state is held per-block rather than in a shared "last copied text"
 * value, which used to light up every block whose command happened to match.
 */
export function CommandBlock({ command, label = 'Terminal', compact = false }: Props) {
  const [state, setState] = useState<CopyState>('idle');

  const copy = async () => {
    try {
      // Rejects outside a secure context, and is absent entirely in a few
      // mobile in-app browsers. Unawaited, that surfaces as nothing happening.
      await navigator.clipboard.writeText(command);
      setState('copied');
    } catch {
      setState('failed');
    }
    setTimeout(() => setState('idle'), 2500);
  };

  const buttonText =
    state === 'copied' ? 'Copied' : state === 'failed' ? 'Select and copy' : 'Copy';

  return (
    <div class={compact ? 'cmd cmd-compact' : 'cmd'}>
      {!compact && (
        <div class="cmd-bar">
          <span class="cmd-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span class="cmd-label">{label}</span>
        </div>
      )}
      <div class="cmd-body">
        <code class="cmd-text">{command}</code>
        <button
          type="button"
          class={`copy${state === 'copied' ? ' is-copied' : ''}`}
          onClick={copy}
          aria-label={`Copy command: ${command.slice(0, 60)}`}
        >
          {buttonText}
        </button>
      </div>
      {state === 'failed' && (
        <p class="cmd-hint" role="status">
          Clipboard access was blocked. Select the text above and copy manually.
        </p>
      )}
    </div>
  );
}
