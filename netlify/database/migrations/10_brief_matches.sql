CREATE TABLE IF NOT EXISTS brief_matches (
  id TEXT PRIMARY KEY,
  created_by TEXT,
  brief TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS brief_matches_created_idx ON brief_matches (created_by, created_at DESC);
