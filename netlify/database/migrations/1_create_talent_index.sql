-- Talent Index: shared live data

CREATE TABLE IF NOT EXISTS talents (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  exclusivity   TEXT NOT NULL DEFAULT 'Non-Exclusive' CHECK (exclusivity IN ('Exclusive','Non-Exclusive')),
  region        TEXT,
  niche         TEXT,
  gender        TEXT CHECK (gender IN ('F','M','Mixed') OR gender IS NULL),
  ig_followers  BIGINT,
  tt_followers  BIGINT,
  yt_followers  BIGINT,
  rate          TEXT,
  instagram     TEXT,
  tiktok        TEXT,
  youtube       TEXT,
  photo         TEXT,
  public_bio    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS talents_name_idx ON talents (lower(name));

-- Brand lists shared across the team
CREATE TABLE IF NOT EXISTS lists (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Saved decks shared across the team
CREATE TABLE IF NOT EXISTS decks (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Single-row change counter. Every write bumps it; open pages poll it to know when to refresh.
CREATE TABLE IF NOT EXISTS sync_state (
  id       INT PRIMARY KEY CHECK (id = 1),
  version  BIGINT NOT NULL DEFAULT 0
);
INSERT INTO sync_state (id, version) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;
