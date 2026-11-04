// Locations: free list of places a talent is based. Region = the UK / UAE subset only.
export const PLACE_MAP = {
  'united kingdom': 'UK', uk: 'UK', 'great britain': 'UK', gb: 'UK', england: 'UK', scotland: 'UK', wales: 'UK', 'northern ireland': 'UK', london: 'UK',
  'united arab emirates': 'UAE', uae: 'UAE', dubai: 'UAE', 'abu dhabi': 'UAE',
  'united states of america': 'US', 'united states': 'US', usa: 'US', us: 'US', america: 'US',
};
// UK towns, cities and counties count as UK (the Index works in countries); same for the other emirates.
export const UK_PLACES = ["london", "birmingham", "manchester", "liverpool", "leeds", "sheffield", "bristol", "newcastle", "newcastle upon tyne", "nottingham", "leicester", "coventry", "bradford", "brighton", "brighton and hove", "hove", "oxford", "cambridge", "york", "bath", "cardiff", "swansea", "newport", "edinburgh", "glasgow", "aberdeen", "dundee", "inverness", "stirling", "belfast", "derry", "londonderry", "norwich", "ipswich", "exeter", "plymouth", "bournemouth", "poole", "southampton", "portsmouth", "reading", "milton keynes", "luton", "northampton", "peterborough", "stoke", "stoke-on-trent", "wolverhampton", "derby", "hull", "kingston upon hull", "sunderland", "middlesbrough", "durham", "carlisle", "lancaster", "preston", "blackpool", "bolton", "salford", "wigan", "stockport", "warrington", "chester", "worcester", "gloucester", "cheltenham", "hereford", "shrewsbury", "telford", "lincoln", "canterbury", "maidstone", "guildford", "windsor", "slough", "watford", "st albans", "chelmsford", "colchester", "southend", "basildon", "crawley", "wakefield", "huddersfield", "harrogate", "doncaster", "rotherham", "barnsley", "lichfield", "tamworth", "solihull", "walsall", "stafford", "birkenhead", "wrexham", "bangor", "truro", "torquay", "swindon", "salisbury", "winchester", "hackney", "shoreditch", "camden", "brixton", "croydon", "cornwall", "devon", "dorset", "somerset", "wiltshire", "hampshire", "kent", "surrey", "sussex", "east sussex", "west sussex", "essex", "hertfordshire", "bedfordshire", "buckinghamshire", "berkshire", "oxfordshire", "cambridgeshire", "norfolk", "suffolk", "lincolnshire", "nottinghamshire", "derbyshire", "leicestershire", "warwickshire", "staffordshire", "shropshire", "cheshire", "lancashire", "merseyside", "greater manchester", "west midlands", "midlands", "yorkshire", "north yorkshire", "south yorkshire", "west yorkshire", "east yorkshire", "northumberland", "cumbria", "county durham", "tyne and wear", "isle of wight", "jersey", "guernsey", "isle of man", "gloucestershire", "herefordshire", "worcestershire", "northamptonshire", "rutland"];
export const UAE_PLACES = ["sharjah", "ajman", "ras al khaimah", "fujairah", "umm al quwain", "al ain"];
UK_PLACES.forEach((x) => { PLACE_MAP[x] = 'UK'; });
UAE_PLACES.forEach((x) => { PLACE_MAP[x] = 'UAE'; });

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
