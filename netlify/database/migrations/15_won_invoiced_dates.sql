-- When a deal was won, and when each influencer was invoiced (for the weekly sales report)
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS won_at DATE;
ALTER TABLE campaign_talents ADD COLUMN IF NOT EXISTS invoiced_at DATE;
UPDATE campaigns SET won_at = COALESCE(start_date, created_at::date) WHERE monday_stage = '7 - Won' AND won_at IS NULL;
UPDATE campaign_talents ct SET invoiced_at = COALESCE(c.won_at, c.start_date, c.created_at::date)
  FROM campaigns c WHERE c.id = ct.campaign_id AND ct.invoice <> 'Not invoiced' AND ct.invoiced_at IS NULL;
