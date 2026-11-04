-- Per-person switch: may this person's Claude make changes (beyond shortlisting)?
ALTER TABLE users ADD COLUMN IF NOT EXISTS claude_edit BOOLEAN NOT NULL DEFAULT false;
-- A client agreement with a signed date is signed
UPDATE campaigns SET c_status = 'Signed' WHERE c_signed IS NOT NULL AND c_status <> 'Signed';
