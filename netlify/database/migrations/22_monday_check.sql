-- Last comparison of a Closed Won campaign against its monday deal: {at, diffs:[...], monday:{...}}
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS monday_check JSONB;
