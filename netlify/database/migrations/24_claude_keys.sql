-- Personal keys that let someone's own Claude read Zodiac OS (and shortlist creators) through the /mcp connector
CREATE TABLE IF NOT EXISTS claude_keys (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  hint TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  uses INTEGER NOT NULL DEFAULT 0,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS claude_keys_user_idx ON claude_keys (user_id);
