-- Public, read-only snapshots of a deck that can be sent to a brand (no login needed to view)
CREATE TABLE IF NOT EXISTS shared_decks (
  code TEXT PRIMARY KEY,
  name TEXT,
  brand TEXT,
  snapshot JSONB NOT NULL,
  talent_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  revoked BOOLEAN NOT NULL DEFAULT false,
  views INTEGER NOT NULL DEFAULT 0,
  last_viewed_at TIMESTAMPTZ
);
