ALTER TABLE shared_decks ADD COLUMN IF NOT EXISTS recipient TEXT;
ALTER TABLE shared_decks ADD COLUMN IF NOT EXISTS created_by TEXT;
ALTER TABLE shared_decks ADD COLUMN IF NOT EXISTS view TEXT NOT NULL DEFAULT 'cards';
ALTER TABLE shared_decks ADD COLUMN IF NOT EXISTS group_id TEXT;
ALTER TABLE shared_decks ADD COLUMN IF NOT EXISTS note TEXT;

-- Every open of a shared link (no IP addresses are stored; "visitor" is a one-way hash used only to count unique devices)
CREATE TABLE IF NOT EXISTS deck_views (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  country TEXT,
  city TEXT,
  device TEXT,
  browser TEXT,
  visitor TEXT,
  is_bot BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS deck_views_code_idx ON deck_views (code, viewed_at DESC);

-- Failed login attempts, to slow down password guessing
CREATE TABLE IF NOT EXISTS login_attempts (
  ip_hash TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS login_attempts_idx ON login_attempts (ip_hash, at);
