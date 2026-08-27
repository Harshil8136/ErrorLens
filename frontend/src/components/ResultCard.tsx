import { DOMAIN_LABELS, SEVERITY_LABELS, type TroubleshootResponse } from '../../../shared/api';
import { hostOf, safeHref } from '../api';
import { CommandBlock } from './CommandBlock';

const SEVERITY_CLASS: Record<string, string> = {
  P1_CRITICAL: 'sev sev-p1',
  P2_HIGH: 'sev sev-p2',
  P3_MEDIUM: 'sev sev-p3',
  P4_LOW: 'sev sev-p4',
};

export function ResultCard({ result }: { result: TroubleshootResponse }) {
  const sources = result.verified_sources
    .map((url) => ({ url, href: safeHref(url) }))
    .filter((s): s is { url: string; href: string } => s.href !== null);

  return (
    <article class="card" aria-labelledby="result-title">
      <header class="card-head">
        <div class="badges">
          <span class="code">{result.error_code}</span>
          <span class={SEVERITY_CLASS[result.severity] ?? 'sev'}>
            {SEVERITY_LABELS[result.severity] ?? result.severity}
          </span>
          <span class="tag">{DOMAIN_LABELS[result.domain] ?? result.domain}</span>
        </div>
        <h2 id="result-title">{result.title}</h2>

        {result.grounded && result.matched_runbook ? (
          <p class="provenance is-verified">
            Steps come from a reviewed runbook
            {result.matched_runbook.verified_at
              ? `, last checked against its source on ${result.matched_runbook.verified_at}`
              : ''}
            .
          </p>
        ) : (
          <p class="provenance is-generated">
            These steps were written by a language model
            {result.matched_runbook ? ' using a matched runbook as context' : ''}. Read each command
            before running it.
          </p>
        )}
      </header>

      <section>
        <h3>Root cause</h3>
        <p class="prose">{result.root_cause}</p>
      </section>

      {result.diagnostic_command && (
        <section>
          <h3>Confirm it first</h3>
          <p class="prose subtle">
            Run this before changing anything, so you are fixing the problem you actually have.
          </p>
          <CommandBlock command={result.diagnostic_command} label="Diagnostic" />
        </section>
      )}

      {result.steps.length > 0 && (
        <section>
          <h3>Remediation</h3>
          <ol class="steps">
            {result.steps.map((step) => (
              <li key={step.step} class="step">
                <span class="step-n" aria-hidden="true">
                  {step.step}
                </span>
                <div class="step-body">
                  <p class="step-action">{step.action}</p>
                  {step.command && <CommandBlock command={step.command} compact />}
                  {step.expected && (
                    <p class="step-expected">
                      <span>Expected</span> {step.expected}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {result.contingencies.length > 0 && (
        <section>
          <h3>Still not working?</h3>
          <ul class="contingencies">
            {result.contingencies.map((c, i) => (
              <li key={i}>
                <p class="cond">{c.condition}</p>
                <p class="prose">{c.action}</p>
                {c.command && <CommandBlock command={c.command} compact />}
              </li>
            ))}
          </ul>
        </section>
      )}

      {result.detailed_explanation && (
        <section>
          <h3>What is actually happening</h3>
          <p class="prose">{result.detailed_explanation}</p>
        </section>
      )}

      {result.prevention_sop && (
        <section>
          <h3>Stop it recurring</h3>
          <p class="prose">{result.prevention_sop}</p>
        </section>
      )}

      {result.escalation_ticket && (
        <section>
          <h3>Hand it off</h3>
          <p class="prose subtle">Paste this into a ticket or an incident channel.</p>
          <CommandBlock command={result.escalation_ticket} label="Summary" />
        </section>
      )}

      <footer class="telemetry">
        <span class="chip">{result.meta.from_cache ? 'Cached' : 'Computed'}</span>
        <span class="chip">{result.meta.duration_ms} ms</span>
        <span class="chip">{result.meta.search_strategy} retrieval</span>
        <span class="chip">{result.meta.model}</span>

        {sources.length > 0 && (
          <span class="sources">
            Sources:{' '}
            {sources.map((s, i) => (
              <a key={s.href} href={s.href} target="_blank" rel="noopener noreferrer nofollow">
                {hostOf(s.url)}
                {i < sources.length - 1 ? ', ' : ''}
              </a>
            ))}
          </span>
        )}
      </footer>
    </article>
  );
}
