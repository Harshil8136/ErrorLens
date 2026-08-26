-- ============================================================
-- ErrorLens D1 Schema: 0001_init_schema.sql
-- Edge-Native Runbooks, FTS5 Search & Zero-Cost Response Cache
-- ============================================================

-- 1. Main Runbooks Catalog
CREATE TABLE IF NOT EXISTS runbooks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  category TEXT NOT NULL,          -- e.g. 'kubernetes', 'docker', 'linux', 'networking', 'node'
  error_code TEXT NOT NULL,        -- e.g. 'Exit Code 137', 'CrashLoopBackOff', 'ECONNREFUSED'
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  root_cause TEXT NOT NULL,
  diagnostic_command TEXT NOT NULL,-- e.g. 'kubectl describe pod <pod-name> | grep -A 5 -B 5 "State:"'
  solution_steps TEXT NOT NULL,    -- JSON array of structured triage steps
  tags TEXT NOT NULL,              -- JSON array of keywords, exit codes, library names
  source_url TEXT,                 -- Upstream verified link (Kubernetes docs, Docker specs, etc.)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_runbooks_category ON runbooks(category);
CREATE INDEX IF NOT EXISTS idx_runbooks_error_code ON runbooks(error_code);

-- 2. FTS5 Virtual Table for Instant Lexical Matching (BM25)
CREATE VIRTUAL TABLE IF NOT EXISTS runbooks_fts USING fts5(
  title,
  error_code,
  summary,
  root_cause,
  tags,
  content='runbooks',
  content_rowid='id',
  tokenize='porter unicode61'
);

-- Triggers to keep FTS5 in sync with runbooks table
CREATE TRIGGER IF NOT EXISTS runbooks_ai AFTER INSERT ON runbooks BEGIN
  INSERT INTO runbooks_fts(rowid, title, error_code, summary, root_cause, tags)
  VALUES (new.id, new.title, new.error_code, new.summary, new.root_cause, new.tags);
END;

CREATE TRIGGER IF NOT EXISTS runbooks_ad AFTER DELETE ON runbooks BEGIN
  INSERT INTO runbooks_fts(runbooks_fts, rowid, title, error_code, summary, root_cause, tags)
  VALUES('delete', old.id, old.title, old.error_code, old.summary, old.root_cause, old.tags);
END;

CREATE TRIGGER IF NOT EXISTS runbooks_au AFTER UPDATE ON runbooks BEGIN
  INSERT INTO runbooks_fts(runbooks_fts, rowid, title, error_code, summary, root_cause, tags)
  VALUES('delete', old.id, old.title, old.error_code, old.summary, old.root_cause, old.tags);
  INSERT INTO runbooks_fts(rowid, title, error_code, summary, root_cause, tags)
  VALUES (new.id, new.title, new.error_code, new.summary, new.root_cause, new.tags);
END;

-- 3. Zero-Cost Query Cache (D1 fallback if KV not provisioned)
CREATE TABLE IF NOT EXISTS query_cache (
  query_hash TEXT PRIMARY KEY,
  normalized_query TEXT NOT NULL,
  response_json TEXT NOT NULL,
  hit_count INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_query_cache_expires ON query_cache(expires_at);

-- 4. Edge Sliding-Window Rate Limiting Table
CREATE TABLE IF NOT EXISTS ip_rate_limits (
  ip_hash TEXT NOT NULL,
  window_minute INTEGER NOT NULL,  -- timestamp / 60
  request_count INTEGER DEFAULT 1,
  PRIMARY KEY (ip_hash, window_minute)
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON ip_rate_limits(window_minute);
