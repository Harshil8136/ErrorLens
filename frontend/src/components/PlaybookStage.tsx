import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  HelpCircle,
  Info,
  ListOrdered,
  Search,
  Shield,
} from 'lucide-preact';
import { useState } from 'preact/hooks';
import { DOMAIN_LABELS, type TroubleshootResponse } from '../../../shared/api';
import { CommandBlock } from './CommandBlock';

interface PlaybookStageProps {
  result: TroubleshootResponse;
}

export function PlaybookStage({ result }: PlaybookStageProps) {
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);

  return (
    <div class="playbook-stage">
      {/* 1. Incident Briefing Header */}
      <div class="playbook-briefing-card">
        <div class="briefing-top-row">
          <div class="subsystem-breadcrumbs">
            <span class="breadcrumb-item">{DOMAIN_LABELS[result.domain] || result.domain}</span>
            <span class="breadcrumb-divider">/</span>
            <span class="breadcrumb-item code-item">{result.error_code}</span>
          </div>

          <div class="provenance-badge-group">
            {result.grounded ? (
              <div class="badge-status-verified">
                <CheckCircle2 size={13} strokeWidth={2.5} />
                <span>Verified Runbook</span>
              </div>
            ) : (
              <div class="badge-status-synthesis">
                <span>AI Generated</span>
              </div>
            )}
          </div>
        </div>

        <h2 class="playbook-main-title">{result.title}</h2>

        <div class="root-cause-callout">
          <div class="callout-icon" aria-hidden="true">
            <Info size={16} strokeWidth={2.5} />
          </div>
          <div class="callout-content">
            <span class="callout-label">Why It Happened</span>
            <p class="callout-text">{result.root_cause}</p>
          </div>
        </div>
      </div>

      {/* 2. Diagnostic Check */}
      {result.diagnostic_command && (
        <section class="stage-section diagnostic-card">
          <div class="section-header">
            <div class="section-title-wrap">
              <div class="section-icon-box diagnostic-icon">
                <Search size={16} strokeWidth={2.5} />
              </div>
              <div>
                <h3 class="section-heading-text">Confirm it first</h3>
                <p class="section-subtext">
                  Run this command first to verify the issue before changing anything.
                </p>
              </div>
            </div>
          </div>

          <div class="section-body">
            <CommandBlock command={result.diagnostic_command} label="Diagnostic Check" />
          </div>
        </section>
      )}

      {/* 3. Steps to Fix */}
      {result.steps.length > 0 && (
        <section class="stage-section remediation-card">
          <div class="section-header">
            <div class="section-title-wrap">
              <div class="section-icon-box remediation-icon">
                <ListOrdered size={16} strokeWidth={2.5} />
              </div>
              <div>
                <h3 class="section-heading-text">How to fix it</h3>
                <p class="section-subtext">Run these steps in order to resolve the issue.</p>
              </div>
            </div>
          </div>

          <div class="section-body">
            <div class="remediation-timeline">
              {result.steps.map((step) => (
                <div key={step.step} class="timeline-step">
                  <div class="timeline-marker">
                    <div class="step-num-circle">{step.step}</div>
                    <div class="timeline-line" />
                  </div>

                  <div class="step-detail-card">
                    <h4 class="step-title">{step.action}</h4>
                    {step.command && <CommandBlock command={step.command} compact />}
                    {step.expected && (
                      <div class="step-expected-card">
                        <CheckCircle2 size={14} class="expected-icon" />
                        <div class="expected-content">
                          <span class="expected-tag">Expected:</span>
                          <span class="expected-message">{step.expected}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* 4. Still Not Working? */}
      {result.contingencies && result.contingencies.length > 0 && (
        <section class="stage-section contingency-card-section">
          <div class="section-header">
            <div class="section-title-wrap">
              <div class="section-icon-box contingency-icon">
                <HelpCircle size={16} strokeWidth={2.5} />
              </div>
              <div>
                <h3 class="section-heading-text">Still not working? Try these next</h3>
                <p class="section-subtext">
                  If the primary fix does not resolve the problem, check these alternatives.
                </p>
              </div>
            </div>
          </div>

          <div class="section-body">
            <div class="contingency-cards-container">
              {result.contingencies.map((item, idx) => (
                <div key={idx} class="decision-branch-card">
                  <div class="branch-condition-row">
                    <AlertTriangle size={15} class="branch-warning-icon" />
                    <div class="branch-text-wrap">
                      <span class="branch-if-label">If this happens:</span>
                      <p class="branch-condition-text">{item.condition}</p>
                    </div>
                  </div>

                  <div class="branch-action-row">
                    <div class="branch-text-wrap">
                      <span class="branch-then-label">Try this:</span>
                      <p class="branch-action-text">{item.action}</p>
                    </div>
                  </div>

                  {item.command && <CommandBlock command={item.command} compact />}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* 5. How to Prevent This */}
      {result.prevention_sop && (
        <section class="stage-section prevention-card-section">
          <div class="section-header">
            <div class="section-title-wrap">
              <div class="section-icon-box prevention-icon">
                <Shield size={16} strokeWidth={2.5} />
              </div>
              <div>
                <h3 class="section-heading-text">How to prevent this</h3>
                <p class="section-subtext">
                  Recommended alerts and monitoring to catch repeat failures.
                </p>
              </div>
            </div>
          </div>

          <div class="section-body">
            <div class="prevention-alert-box">
              <p class="prevention-desc">{result.prevention_sop}</p>
            </div>
          </div>
        </section>
      )}

      {/* 6. Technical Details (Collapsible) */}
      {result.detailed_explanation && (
        <section class="stage-section technical-accordion-section">
          <button
            type="button"
            class="technical-collapse-trigger"
            onClick={() => setShowTechnicalDetails(!showTechnicalDetails)}
            aria-expanded={showTechnicalDetails}
          >
            <div class="trigger-label-group">
              <span>Technical details</span>
            </div>
            {showTechnicalDetails ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>

          {showTechnicalDetails && (
            <div class="technical-drawer-body">
              <p class="technical-explanation-prose">{result.detailed_explanation}</p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
