-- A deliverable is one piece of content (or a group, e.g. 3 x IG Story): what it is and how many it covers, for rates
ALTER TABLE campaign_deliverables ADD COLUMN IF NOT EXISTS item TEXT;
ALTER TABLE campaign_deliverables ADD COLUMN IF NOT EXISTS qty INTEGER NOT NULL DEFAULT 1;
