-- Creator contracts on Campaign Overview: date signed per creator, and contract files linked to a creator
ALTER TABLE campaign_talents ADD COLUMN IF NOT EXISTS contract_signed DATE;
ALTER TABLE campaign_docs ADD COLUMN IF NOT EXISTS ct_id TEXT;
CREATE INDEX IF NOT EXISTS campaign_docs_ct_idx ON campaign_docs (ct_id);
