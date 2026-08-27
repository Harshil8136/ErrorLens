import {
  AlertOctagon,
  AlertTriangle,
  BookOpen,
  Check,
  Clock,
  Copy,
  ExternalLink,
  Layers,
  Share2,
  ShieldCheck,
} from 'lucide-preact';
import { useState } from 'preact/hooks';
import { DOMAIN_LABELS, SEVERITY_LABELS, type TroubleshootResponse } from '../../../shared/api';
import { safeHref } from '../api';

interface IncidentRailProps {
  result: TroubleshootResponse;
}

export function IncidentRail({ result }: IncidentRailProps) {
  const [copiedFormat, setCopiedFormat] = useState<string | null>(null);

  const sources = result.verified_sources
    .map((url) => ({ url, href: safeHref(url) }))
    .filter((s): s is { url: string; href: string } => s.href !== null);

  const copyText = async (text: string, formatName: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedFormat(formatName);
      setTimeout(() => setCopiedFormat(null), 2000);
    } catch {
      // ignore
    }
  };

  const getSeverityConfig = (sev: string) => {
    switch (sev) {
      case 'P1_CRITICAL':
        return {
          cardClass: 'sev-card-p1',
          badgeClass: 'sev-badge-p1',
          icon: AlertOctagon,
          title: 'P1 Critical',
          desc: 'High operational or system impact',
        };
      case 'P2_HIGH':
        return {
          cardClass: 'sev-card-p2',
          badgeClass: 'sev-badge-p2',
          icon: AlertTriangle,
          title: 'P2 High',
          desc: 'Service degradation or failure',
        };
      case 'P3_MEDIUM':
        return {
          cardClass: 'sev-card-p3',
          badgeClass: 'sev-badge-p3',
          icon: Clock,
          title: 'P3 Medium',
          desc: 'Non-critical warning or error',
        };
      default:
        return {
          cardClass: 'sev-card-p4',
          badgeClass: 'sev-badge-p4',
          icon: Clock,
          title: 'P4 Low',
          desc: 'Informational or minor issue',
        };
    }
  };

  const sev = getSeverityConfig(result.severity);
  const SevIcon = sev.icon;

  const slackFormat = `*Error Summary:* ${result.title}
*Severity:* ${SEVERITY_LABELS[result.severity] || result.severity} | *Category:* ${DOMAIN_LABELS[result.domain] || result.domain}
*Error Code:* \`${result.error_code}\`
*Why It Happened:* ${result.root_cause}
*Diagnostic Command:* \`${result.diagnostic_command || 'N/A'}\``;

  return (
    <aside class="incident-rail">
      {/* 1. Severity */}
      <div class={`rail-card ${sev.cardClass}`}>
        <div class="rail-header">
          <span class="rail-title-label">Severity</span>
          <div class={`severity-pill ${sev.badgeClass}`}>
            <SevIcon size={13} strokeWidth={2.5} />
            <span>{sev.title}</span>
          </div>
        </div>
        <p class="severity-desc">{sev.desc}</p>
      </div>

      {/* 2. Overview */}
      <div class="rail-card">
        <div class="rail-header">
          <span class="rail-title-label">Overview</span>
          <Layers size={14} class="rail-header-icon" />
        </div>

        <div class="profile-field">
          <span class="field-label">Error Code</span>
          <div class="field-token-box">
            <code>{result.error_code}</code>
          </div>
        </div>

        <div class="profile-stats-grid">
          <div class="stat-box">
            <span class="stat-label">Category</span>
            <span class="stat-value">{DOMAIN_LABELS[result.domain] || result.domain}</span>
          </div>

          <div class="stat-box">
            <span class="stat-label">Source</span>
            <div class="stat-provenance">
              {result.grounded ? (
                <span class="provenance-chip verified">
                  <ShieldCheck size={12} strokeWidth={2.5} />
                  <span>Verified Runbook</span>
                </span>
              ) : (
                <span class="provenance-chip dynamic">
                  <span>AI Generated</span>
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 3. Export Summary */}
      <div class="rail-card">
        <div class="rail-header">
          <span class="rail-title-label">Export Summary</span>
          <Share2 size={14} class="rail-header-icon" />
        </div>
        <p class="rail-card-subtext">Copy formatted text to share in tickets or channels.</p>

        <div class="handoff-buttons">
          <button
            type="button"
            class={`handoff-btn ${copiedFormat === 'jira' ? 'is-copied' : ''}`}
            onClick={() => copyText(result.escalation_ticket || result.title, 'jira')}
          >
            {copiedFormat === 'jira' ? <Check size={13} strokeWidth={2.5} /> : <Copy size={13} />}
            <span>Copy Markdown</span>
          </button>

          <button
            type="button"
            class={`handoff-btn ${copiedFormat === 'slack' ? 'is-copied' : ''}`}
            onClick={() => copyText(slackFormat, 'slack')}
          >
            {copiedFormat === 'slack' ? <Check size={13} strokeWidth={2.5} /> : <Copy size={13} />}
            <span>Copy for Slack</span>
          </button>

          <button
            type="button"
            class={`handoff-btn ${copiedFormat === 'json' ? 'is-copied' : ''}`}
            onClick={() => copyText(JSON.stringify(result, null, 2), 'json')}
          >
            {copiedFormat === 'json' ? <Check size={13} strokeWidth={2.5} /> : <Copy size={13} />}
            <span>Copy JSON</span>
          </button>
        </div>
      </div>

      {/* 4. Documentation */}
      {sources.length > 0 && (
        <div class="rail-card">
          <div class="rail-header">
            <span class="rail-title-label">Documentation</span>
            <BookOpen size={14} class="rail-header-icon" />
          </div>
          <div class="vendor-sources-list">
            {sources.map((s, idx) => {
              let domainName = 'Docs';
              try {
                domainName = new URL(s.href).hostname.replace(/^www\./, '');
              } catch {
                // ignore
              }
              return (
                <a
                  key={idx}
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="vendor-source-link"
                  title={s.url}
                >
                  <span>{domainName}</span>
                  <ExternalLink size={12} strokeWidth={2} />
                </a>
              );
            })}
          </div>
        </div>
      )}

      {/* 5. Details */}
      <div class="rail-card telemetry-card">
        <div class="rail-header">
          <span class="rail-title-label">Details</span>
        </div>
        <div class="telemetry-grid">
          <div class="telemetry-stat">
            <span class="t-label">Response Time</span>
            <span class="t-value">{result.meta?.duration_ms || 0} ms</span>
          </div>
          <div class="telemetry-stat">
            <span class="t-label">Cache</span>
            <span class="t-value">{result.meta?.from_cache ? 'Hit' : 'Direct'}</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
