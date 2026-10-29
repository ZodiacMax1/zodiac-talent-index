-- One-line update per deal, shown on the forecast report
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS fnote TEXT;
