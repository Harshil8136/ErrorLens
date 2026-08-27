import { Check, Copy, Terminal } from 'lucide-preact';
import { useState } from 'preact/hooks';

interface Props {
  command: string;
  label?: string;
  compact?: boolean;
}

type CopyState = 'idle' | 'copied' | 'failed';

export function CommandBlock({ command, label = 'Terminal', compact = false }: Props) {
  const [state, setState] = useState<CopyState>('idle');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setState('copied');
    } catch {
      setState('failed');
    }
    setTimeout(() => setState('idle'), 2200);
  };

  return (
    <div class={compact ? 'cmd-wrapper cmd-compact' : 'cmd-wrapper'}>
      {!compact && (
        <div class="cmd-header">
          <div class="cmd-tag">
            <Terminal size={12} strokeWidth={2.5} />
            <span class="cmd-label">{label}</span>
          </div>
          <span class="cmd-shortcut-hint">Non-destructive command</span>
        </div>
      )}
      <div class="cmd-container">
        <div class="cmd-prompt-sign" aria-hidden="true">
          $
        </div>
        <pre class="cmd-code">
          <code>{command}</code>
        </pre>
        <button
          type="button"
          class={`cmd-copy-btn ${state === 'copied' ? 'copied' : ''}`}
          onClick={copy}
          aria-label={`Copy command: ${command.slice(0, 50)}`}
          title="Copy command to clipboard"
        >
          {state === 'copied' ? (
            <>
              <Check size={13} strokeWidth={2.5} />
              <span>Copied</span>
            </>
          ) : (
            <>
              <Copy size={13} strokeWidth={2} />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      {state === 'failed' && (
        <p class="cmd-hint" role="status">
          Could not access clipboard. Please select text manually.
        </p>
      )}
    </div>
  );
}
