-- monday.com sync support

-- Which monday item each talent came from (so nothing is ever added twice)
CREATE TABLE IF NOT EXISTS monday_links (
  board_id   TEXT NOT NULL,
  item_id    TEXT NOT NULL,
  talent_id  TEXT NOT NULL REFERENCES talents(id) ON DELETE CASCADE,
  PRIMARY KEY (board_id, item_id)
);
CREATE INDEX IF NOT EXISTS monday_links_talent_idx ON monday_links (talent_id);

-- Link the original 335 talent to their monday items (their ids embed the monday item id)
INSERT INTO monday_links (board_id, item_id, talent_id)
  SELECT '5092522353', substring(id from 2), id FROM talents WHERE id ~ '^r[0-9]+$'
  ON CONFLICT DO NOTHING;
INSERT INTO monday_links (board_id, item_id, talent_id)
  SELECT '5092522357', substring(id from 2), id FROM talents WHERE id ~ '^o[0-9]+$'
  ON CONFLICT DO NOTHING;

-- Rows on monday that are not yet complete enough to import
CREATE TABLE IF NOT EXISTS monday_pending (
  board_id  TEXT NOT NULL,
  item_id   TEXT NOT NULL,
  name      TEXT NOT NULL,
  missing   TEXT NOT NULL,
  PRIMARY KEY (board_id, item_id)
);

-- Previous deals, copied from the Talent Deals board
CREATE TABLE IF NOT EXISTS monday_deals (
  item_id         TEXT PRIMARY KEY,
  roster_item_id  TEXT NOT NULL,
  campaign        TEXT,
  brand           TEXT,
  value           NUMERIC,
  currency        TEXT,
  value_gbp       NUMERIC,
  status          TEXT,
  deal_date       DATE
);
CREATE INDEX IF NOT EXISTS monday_deals_roster_idx ON monday_deals (roster_item_id);

-- Last run of each sync
CREATE TABLE IF NOT EXISTS monday_sync_log (
  kind     TEXT PRIMARY KEY,
  ran_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ok       BOOLEAN NOT NULL,
  summary  JSONB NOT NULL DEFAULT '{}'::jsonb
);
