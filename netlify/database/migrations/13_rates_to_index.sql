-- Fill blank Talent Index rates from rates already entered on campaigns (latest campaign wins)
UPDATE talents t SET rate = x.txt, updated_at = now()
FROM (
  SELECT DISTINCT ON (ct.talent_id) ct.talent_id,
    CASE c.cur WHEN 'GBP' THEN '£' || to_char(round(COALESCE(NULLIF(ct.neg,0), ct.initial)), 'FM999,999,999')
               WHEN 'USD' THEN '$' || to_char(round(COALESCE(NULLIF(ct.neg,0), ct.initial)), 'FM999,999,999')
               ELSE to_char(round(COALESCE(NULLIF(ct.neg,0), ct.initial)), 'FM999,999,999') || ' ' || c.cur END AS txt
  FROM campaign_talents ct JOIN campaigns c ON c.id = ct.campaign_id
  WHERE COALESCE(NULLIF(ct.neg,0), ct.initial) > 0
  ORDER BY ct.talent_id, c.created_at DESC
) x
WHERE t.id = x.talent_id AND t.deleted_at IS NULL AND (t.rate IS NULL OR btrim(t.rate) = '');
