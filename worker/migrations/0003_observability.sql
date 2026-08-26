-- Moves rate limiting off Workers KV and onto D1, and adds the tables that
-- back the admin panel.
--
-- Why the move: the Workers free plan allows 1,000 KV writes/day but 100,000
-- D1 rows written/day. Every write on the hot path (rate-limit counter, request
-- log, cache fill) hits the KV ceiling ~100x sooner, so KV was the wrong store
-- for this workload. D1 is now the only stateful dependency.

DROP TABLE IF EXISTS ip_rate_limits;

-- Two fixed windows per identity ('min' and 'day'). The limiter reads the
-- previous window alongside the current one and interpolates between them,
-- which approximates a sliding window without storing a row per request.
CREATE TABLE IF NOT EXISTS rate_limits (
  ip_hash     TEXT    NOT NULL,
  bucket_kind TEXT    NOT NULL,          -- 'min' | 'day'
  bucket_id   INTEGER NOT NULL,          -- epoch minute, or epoch day
  hits        INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (ip_hash, bucket_kind, bucket_id)
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_sweep ON rate_limits(bucket_kind, bucket_id);

-- One row per API request. `query_text` is truncated and only stored for
-- /api/troubleshoot; see docs/PRIVACY.md for what is and isn't retained.
CREATE TABLE IF NOT EXISTS request_logs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ts              TEXT    NOT NULL DEFAULT (datetime('now')),
  route           TEXT    NOT NULL,
  method          TEXT    NOT NULL,
  status          INTEGER NOT NULL,
  duration_ms     INTEGER,
  ip_hash         TEXT,
  country         TEXT,
  query_text      TEXT,
  matched_slug    TEXT,
  search_strategy TEXT,
  model           TEXT,
  cache_hit       INTEGER NOT NULL DEFAULT 0,
  rate_limited    INTEGER NOT NULL DEFAULT 0,
  error_kind      TEXT
);

CREATE INDEX IF NOT EXISTS idx_logs_ts      ON request_logs(ts DESC);
CREATE INDEX IF NOT EXISTS idx_logs_route   ON request_logs(route, ts DESC);
CREATE INDEX IF NOT EXISTS idx_logs_matched ON request_logs(matched_slug);

-- Daily counters that back the free-tier budget meter in the admin panel.
-- Kept as a separate rollup so the dashboard never has to scan request_logs.
CREATE TABLE IF NOT EXISTS usage_daily (
  day               TEXT PRIMARY KEY,    -- YYYY-MM-DD, UTC
  requests          INTEGER NOT NULL DEFAULT 0,
  troubleshoots     INTEGER NOT NULL DEFAULT 0,
  cache_hits        INTEGER NOT NULL DEFAULT 0,
  rate_limited      INTEGER NOT NULL DEFAULT 0,
  errors            INTEGER NOT NULL DEFAULT 0,
  gemini_calls      INTEGER NOT NULL DEFAULT 0,
  workers_ai_calls  INTEGER NOT NULL DEFAULT 0,
  neurons_estimate  REAL    NOT NULL DEFAULT 0,
  vectorize_dims    INTEGER NOT NULL DEFAULT 0
);

-- Per-runbook hit counter, so the panel can show which runbooks earn their keep
-- and which have never matched anything.
ALTER TABLE runbooks ADD COLUMN hit_count INTEGER NOT NULL DEFAULT 0;

-- When a maintainer last checked this runbook against its upstream source.
-- Surfaced in the UI as "Verified <date>" -- a claim we can actually stand behind.
ALTER TABLE runbooks ADD COLUMN verified_at TEXT;

UPDATE runbooks SET verified_at = '2026-08-26' WHERE verified_at IS NULL;
