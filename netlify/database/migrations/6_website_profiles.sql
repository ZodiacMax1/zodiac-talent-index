-- Photos and bios copied from the Zodiac website. We keep our own copy, so they stay if someone is removed from the site.
CREATE TABLE IF NOT EXISTS talent_photos (
  talent_id TEXT PRIMARY KEY REFERENCES talents(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL,
  data BYTEA NOT NULL,
  source_url TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS website_profiles (
  slug TEXT PRIMARY KEY,
  name TEXT,
  bio TEXT,
  photo_src TEXT,
  instagram TEXT,
  talent_id TEXT,
  on_site BOOLEAN NOT NULL DEFAULT true,
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now()
);
