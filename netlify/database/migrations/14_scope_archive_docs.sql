-- What each influencer's quote covers, e.g. [{"item":"IG Reel","qty":2},{"item":"IG Story","qty":5}]
ALTER TABLE campaign_talents ADD COLUMN IF NOT EXISTS scope JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Archiving a whole campaign, with a group to file it under: {reason, note, group, date}
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS arch JSONB;

-- Documents per campaign (full client deck, proposals etc.). Either an uploaded file or a link.
CREATE TABLE IF NOT EXISTS campaign_docs (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'Client deck',
  mime TEXT,
  size INTEGER,
  url TEXT,
  data BYTEA,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS campaign_docs_campaign_idx ON campaign_docs (campaign_id);
