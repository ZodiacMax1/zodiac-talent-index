-- Locations: a talent can be based in several places. `region` now only ever holds UK and/or UAE.
ALTER TABLE talents ADD COLUMN IF NOT EXISTS location TEXT;
UPDATE talents SET location = region WHERE location IS NULL AND region IS NOT NULL;
UPDATE talents SET region = CASE
  WHEN location ~* '(^|,\s*)UK(\s*,|$)' AND location ~* '(^|,\s*)UAE(\s*,|$)' THEN 'UK, UAE'
  WHEN location ~* '(^|,\s*)UK(\s*,|$)' THEN 'UK'
  WHEN location ~* '(^|,\s*)UAE(\s*,|$)' THEN 'UAE'
  ELSE NULL END;

-- Internal notes on each talent (never sent to brands, never in decks)
CREATE TABLE IF NOT EXISTS talent_notes (
  id BIGSERIAL PRIMARY KEY,
  talent_id TEXT NOT NULL REFERENCES talents(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  author TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS talent_notes_talent_idx ON talent_notes (talent_id, created_at DESC);
