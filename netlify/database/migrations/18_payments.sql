-- Rates per deliverable, client invoices per campaign, creator invoices per influencer.
-- Rule: a creator can only be paid for a deliverable once the client has paid for it.

-- How the client is invoiced: completion (one invoice at the end), quarterly, monthly or custom
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS billing TEXT NOT NULL DEFAULT 'completion';

-- Creator side of each deliverable. cr_rate NULL = worked out from the influencer's rate card (scope rates)
ALTER TABLE campaign_deliverables ADD COLUMN IF NOT EXISTS cr_rate NUMERIC;
ALTER TABLE campaign_deliverables ADD COLUMN IF NOT EXISTS cr_status TEXT NOT NULL DEFAULT 'Not due';
ALTER TABLE campaign_deliverables ADD COLUMN IF NOT EXISTS cr_invoice TEXT;
ALTER TABLE campaign_deliverables ADD COLUMN IF NOT EXISTS cr_paid_at DATE;

-- Invoices Zodiac raises to the client. A period covers every deliverable going live inside it; no period = covers everything.
CREATE TABLE IF NOT EXISTS client_invoices (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  period_start DATE,
  period_end DATE,
  amount NUMERIC NOT NULL DEFAULT 0,
  invoiced_at DATE,
  paid_at DATE,
  file_name TEXT, file_type TEXT, file_size INTEGER,
  data BYTEA,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS client_invoices_campaign_idx ON client_invoices (campaign_id);

-- Invoices a creator sends Zodiac, covering one or more deliverables (campaign_deliverables.cr_invoice points here)
CREATE TABLE IF NOT EXISTS creator_invoices (
  id TEXT PRIMARY KEY,
  ct_id TEXT NOT NULL REFERENCES campaign_talents(id) ON DELETE CASCADE,
  number TEXT,
  inv_date DATE,
  amount NUMERIC NOT NULL DEFAULT 0,
  paid_at DATE,
  file_name TEXT, file_type TEXT, file_size INTEGER,
  data BYTEA,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS creator_invoices_ct_idx ON creator_invoices (ct_id);
