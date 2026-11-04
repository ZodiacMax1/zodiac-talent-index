-- Wording for the monthly forecast report, per monday deal: a short tag, a line of text, and where the card shows
CREATE TABLE IF NOT EXISTS report_notes (
  deal_id    TEXT PRIMARY KEY,
  tag        TEXT,
  note       TEXT,
  place      TEXT NOT NULL DEFAULT 'auto',   -- auto | key (Key Updates) | conv (Active Conversations) | hide
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
