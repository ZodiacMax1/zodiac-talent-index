-- Filming or attendance days: a deliverable that needs a date but no posting (e.g. a TV advert shoot)
ALTER TABLE campaign_deliverables ADD COLUMN IF NOT EXISTS no_post BOOLEAN NOT NULL DEFAULT false;
