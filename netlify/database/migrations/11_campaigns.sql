-- Campaign Management: manage each influencer inside a campaign (monday stays the main CRM)

-- Manager details live on the talent profile so they are saved once and reused
ALTER TABLE talents ADD COLUMN IF NOT EXISTS manager_name TEXT;
ALTER TABLE talents ADD COLUMN IF NOT EXISTS manager_email TEXT;
ALTER TABLE talents ADD COLUMN IF NOT EXISTS manager_phone TEXT;

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  client TEXT,
  owner TEXT,
  start_date DATE,
  end_date DATE,
  cur TEXT NOT NULL DEFAULT 'GBP' CHECK (cur IN ('GBP','USD','AED')),
  fx NUMERIC NOT NULL DEFAULT 1,          -- GBP per 1 unit of the campaign currency
  budget NUMERIC NOT NULL DEFAULT 0,      -- total client budget, in the campaign currency
  target_margin NUMERIC NOT NULL DEFAULT 30,
  markets TEXT,
  platforms TEXT,
  brief TEXT,
  deck_name TEXT,
  monday_item_id TEXT,
  monday_stage TEXT NOT NULL DEFAULT '3 - Proposal Sent',
  contact_name TEXT, contact_role TEXT, contact_email TEXT, contact_phone TEXT,
  c_status TEXT NOT NULL DEFAULT 'Not started',
  c_value NUMERIC NOT NULL DEFAULT 0,
  c_signed DATE,
  c_terms TEXT NOT NULL DEFAULT 'Net 30',
  c_usage TEXT,
  c_file_name TEXT, c_file_size INTEGER, c_file_type TEXT, c_file_at TIMESTAMPTZ,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS campaign_files (
  campaign_id TEXT PRIMARY KEY REFERENCES campaigns(id) ON DELETE CASCADE,
  data BYTEA NOT NULL
);

CREATE TABLE IF NOT EXISTS campaign_talents (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  talent_id TEXT NOT NULL,
  approved TEXT NOT NULL DEFAULT 'Not yet',   -- Yes / Maybe / Not yet / Declined
  stage TEXT NOT NULL DEFAULT 'Shortlisted',  -- Shortlisted / Outreach / Negotiating / Confirmed
  initial NUMERIC NOT NULL DEFAULT 0,
  neg NUMERIC,
  margin NUMERIC NOT NULL DEFAULT 30,
  client_rate NUMERIC NOT NULL DEFAULT 0,
  contract TEXT NOT NULL DEFAULT '–',
  invoice TEXT NOT NULL DEFAULT 'Not invoiced',
  next_action TEXT,
  feedback TEXT,
  archived JSONB,                              -- {reason, note, date} once archived after Closed Won
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, talent_id)
);
CREATE INDEX IF NOT EXISTS campaign_talents_campaign_idx ON campaign_talents (campaign_id);
CREATE INDEX IF NOT EXISTS campaign_talents_talent_idx ON campaign_talents (talent_id);

CREATE TABLE IF NOT EXISTS campaign_deliverables (
  id TEXT PRIMARY KEY,
  ct_id TEXT NOT NULL REFERENCES campaign_talents(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  platform TEXT,
  stage TEXT NOT NULL DEFAULT 'Brief sent',
  recv_by DATE, recv_at DATE,
  live_by DATE, live_at DATE,
  links JSONB NOT NULL DEFAULT '[]'::jsonb,
  insights JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS campaign_deliverables_ct_idx ON campaign_deliverables (ct_id);

-- One comment thread per influencer; a comment can be tagged to a deliverable
CREATE TABLE IF NOT EXISTS campaign_comments (
  id BIGSERIAL PRIMARY KEY,
  ct_id TEXT NOT NULL REFERENCES campaign_talents(id) ON DELETE CASCADE,
  author TEXT NOT NULL,
  body TEXT NOT NULL,
  link TEXT,
  tag TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS campaign_comments_ct_idx ON campaign_comments (ct_id, created_at);

CREATE TABLE IF NOT EXISTS campaign_quotes (
  id BIGSERIAL PRIMARY KEY,
  ct_id TEXT NOT NULL REFERENCES campaign_talents(id) ON DELETE CASCADE,
  amount TEXT NOT NULL,
  note TEXT,
  author TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Shared client links can be tied to a campaign
ALTER TABLE shared_decks ADD COLUMN IF NOT EXISTS campaign_id TEXT;
CREATE INDEX IF NOT EXISTS shared_decks_campaign_idx ON shared_decks (campaign_id);
