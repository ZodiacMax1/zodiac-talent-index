-- Free-text note under the Year view of the content calendar (e.g. no posting during Ramadan)
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS cal_note TEXT;
