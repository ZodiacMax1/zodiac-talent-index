ALTER TABLE shared_decks ADD COLUMN IF NOT EXISTS deck_id TEXT;
CREATE INDEX IF NOT EXISTS shared_decks_deck_idx ON shared_decks (deck_id);
