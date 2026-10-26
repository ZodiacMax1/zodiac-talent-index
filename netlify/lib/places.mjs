// Locations: free list of places a talent is based. Region = the UK / UAE subset only.
export const PLACE_MAP = {
  'united kingdom': 'UK', uk: 'UK', 'great britain': 'UK', gb: 'UK', england: 'UK', scotland: 'UK', wales: 'UK', 'northern ireland': 'UK', london: 'UK',
  'united arab emirates': 'UAE', uae: 'UAE', dubai: 'UAE', 'abu dhabi': 'UAE',
  'united states of america': 'US', 'united states': 'US', usa: 'US', us: 'US', america: 'US',
};

export function normLocation(input) {
  if (input === null || input === undefined) return { location: null, region: null };
  const seen = new Set();
  const list = [];
  for (const raw of String(input).split(/[,;/&|\n]+/)) {
    const t = raw.trim().replace(/\s+/g, ' ');
    if (!t) continue;
    const v = PLACE_MAP[t.toLowerCase()] || t;
    if (!seen.has(v.toLowerCase())) { seen.add(v.toLowerCase()); list.push(v); }
  }
  if (!list.length) return { location: null, region: null };
  const has = (x) => list.includes(x);
  const region = has('UK') && has('UAE') ? 'UK, UAE' : has('UK') ? 'UK' : has('UAE') ? 'UAE' : null;
  return { location: list.join(', '), region };
}
