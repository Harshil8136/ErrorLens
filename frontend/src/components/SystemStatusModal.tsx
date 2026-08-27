import {
  Activity,
  CheckCircle2,
  Cpu,
  Database,
  ExternalLink,
  Layers,
  Radio,
  RefreshCw,
  Server,
  ShieldCheck,
  X,
  Zap,
} from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';

interface HealthData {
  status: string;
  version: string;
  environment: string;
  time: string;
  bindings?: {
    d1: boolean;
    vectorize: boolean;
    workers_ai: boolean;
    gemini_key: boolean;
    admin_token: boolean;
  };
}

interface SystemStatusModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SystemStatusModal({ isOpen, onClose }: SystemStatusModalProps) {
  const [data, setData] = useState<HealthData | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = async () => {
    setLoading(true);
    setError(null);
    const start = performance.now();
    try {
      const res = await fetch('/api/health');
      const roundtrip = Math.round(performance.now() - start);
      setLatency(roundtrip);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not query edge health endpoint');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchHealth();
      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') onClose();
      };
      window.addEventListener('keydown', onKeyDown);
      return () => window.removeEventListener('keydown', onKeyDown);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div class="modal-backdrop" onClick={onClose}>
      <div
        class="status-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div class="modal-header">
          <div class="modal-title-group">
            <div class="modal-icon-badge">
              <Radio size={16} class="pulse-icon" />
            </div>
            <div>
              <h3 class="modal-title">System Health & Edge Diagnostics</h3>
              <p class="modal-subtitle">
                Real-time status of Cloudflare Workers and AI inference pipelines
              </p>
            </div>
          </div>
          <button
            type="button"
            class="modal-close-btn"
            onClick={onClose}
            aria-label="Close status dialog"
          >
            <X size={18} />
          </button>
        </div>

        <div class="modal-body">
          {/* Status summary banner */}
          <div class="health-summary-banner">
            <div class="summary-status">
              <span class="live-dot" />
              <span class="summary-status-text">
                {data?.status === 'ok'
                  ? 'All Edge Systems Operational'
                  : loading
                    ? 'Pinging Edge...'
                    : 'Status Check Failed'}
              </span>
            </div>
            {latency !== null && (
              <div class="summary-latency">
                <Activity size={13} />
                <span>{latency} ms roundtrip</span>
              </div>
            )}
          </div>

          {/* Bindings & Services Grid */}
          <div class="services-grid">
            <div class="service-item">
              <div class="service-icon-box">
                <Server size={16} />
              </div>
              <div class="service-info">
                <span class="service-name">Cloudflare Worker</span>
                <span class="service-status active">
                  v{data?.version || '0.1.0'} • {data?.environment || 'edge'}
                </span>
              </div>
              <CheckCircle2 size={16} class="service-check" />
            </div>

            <div class="service-item">
              <div class="service-icon-box">
                <Database size={16} />
              </div>
              <div class="service-info">
                <span class="service-name">Cloudflare D1 Database</span>
                <span class="service-status active">
                  {data?.bindings?.d1 ? 'Connected (errorlens-db)' : 'Pending'}
                </span>
              </div>
              <CheckCircle2 size={16} class="service-check" />
            </div>

            <div class="service-item">
              <div class="service-icon-box">
                <Layers size={16} />
              </div>
              <div class="service-info">
                <span class="service-name">Response Cache (D1 SQLite)</span>
                <span class="service-status active">
                  {data?.bindings?.d1 ? '7-Day TTL Cache Active' : 'Offline'}
                </span>
              </div>
              <CheckCircle2 size={16} class="service-check" />
            </div>

            <div class="service-item">
              <div class="service-icon-box">
                <Zap size={16} />
              </div>
              <div class="service-info">
                <span class="service-name">Google Gemini 3.5 Flash-Lite</span>
                <span class="service-status active">
                  {data?.bindings?.gemini_key ? 'Tier-1 Key Active (AI Studio)' : 'Offline'}
                </span>
              </div>
              <CheckCircle2 size={16} class="service-check" />
            </div>

            <div class="service-item">
              <div class="service-icon-box">
                <Cpu size={16} />
              </div>
              <div class="service-info">
                <span class="service-name">Workers AI (Llama 3.1 Edge)</span>
                <span class="service-status active">
                  {data?.bindings?.workers_ai ? 'Tier-2 Edge GPUs Active' : 'Fallback only'}
                </span>
              </div>
              <CheckCircle2 size={16} class="service-check" />
            </div>

            <div class="service-item">
              <div class="service-icon-box">
                <ShieldCheck size={16} />
              </div>
              <div class="service-info">
                <span class="service-name">Admin Telemetry & Auth</span>
                <span class="service-status active">
                  {data?.bindings?.admin_token ? 'Admin Route Protected' : 'Ready'}
                </span>
              </div>
              <CheckCircle2 size={16} class="service-check" />
            </div>
          </div>

          {error && <p class="modal-error-text">{error}</p>}

          {data?.time && (
            <p class="modal-timestamp">
              Last validated: <code>{new Date(data.time).toUTCString()}</code>
            </p>
          )}
        </div>

        <div class="modal-footer">
          <a href="/admin" target="_blank" rel="noopener noreferrer" class="modal-admin-link">
            <span>Open Telemetry Admin</span>
            <ExternalLink size={12} />
          </a>

          <button type="button" class="modal-refresh-btn" onClick={fetchHealth} disabled={loading}>
            <RefreshCw size={14} class={loading ? 'spin' : ''} />
            <span>{loading ? 'Validating...' : 'Re-Check Status'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
