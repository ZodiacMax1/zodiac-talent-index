import { pool, bump } from './db.mjs';
import { handleOf, normName } from './sync.mjs';

const SITE = 'https://zodiacglobal.com';
const UA = { 'user-agent': 'ZodiacTalentIndex/1.0 (+internal sync)' };
// Image storage can reject unknown clients, so image requests look like an ordinary browser visiting zodiacglobal.com
const IMG_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
  referer: 'https://zodiacglobal.com/',
};

const decode = (s) => String(s || '')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function meta(html, name) {
  for (const re of [
    new RegExp(`<meta[^>]+(?:property|name)="${name}"[^>]*?content="([^"]*)"`, 'i'),
    new RegExp(`<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="${name}"`, 'i'),
  ]) { const m = html.match(re); if (m) return decode(m[1]).trim(); }
  return '';
}

export function parseListing(html) {
  return [...new Set([...html.matchAll(/href="\/talent-roster\/([a-z0-9-]+)"/g)].map((m) => m[1]))];
}

export function parseProfile(html) {
  const h1 = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1];
  const name = decode((h1 || '').replace(/<[^>]+>/g, '')).trim() || decode((html.match(/<title>([^<]*)<\/title>/) || [])[1] || '').split('|')[0].trim();
  const social = (host) => [...html.matchAll(new RegExp(`href="(https://(?:www\\.)?${host}[^"]+)"`, 'g'))].map((m) => decode(m[1]))
    .find((u) => !/zodiacglobal/i.test(u)) || null;
  return {
    name,
    bio: meta(html, 'og:description') || meta(html, 'description') || null,
    photo: meta(html, 'og:image') || null,
    instagram: social('instagram\\.com'), tiktok: social('tiktok\\.com'), youtube: social('youtube\\.com'),
  };
}

async function getText(url) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.text();
}

async function pooled(items, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]).catch((e) => ({ error: String(e.message || e) })); } }));
  return out;
}

const isWebsitePhoto = (p) => !p || p.startsWith('/api/img/') || /zodiacglobal\.com/i.test(p);

export async function syncWebsite() {
  const db = pool();
  const lock = await db.query('SELECT pg_try_advisory_lock(7003) AS ok');
  if (!lock.rows[0].ok) return { skipped: 'already running' };
  try {
    const slugs = parseListing(await getText(`${SITE}/talent-roster`));
    if (slugs.length < 5) throw new Error('Website roster looked empty — leaving everything as it is');

    const profiles = await pooled(slugs, 5, async (slug) => ({ slug, ...parseProfile(await getText(`${SITE}/talent-roster/${slug}`)) }));
    const ok = profiles.filter((p) => p && !p.error && p.name);

    const talents = (await db.query('SELECT id, name, instagram, tiktok, photo, public_bio FROM talents')).rows;
    const byIg = new Map(), byTt = new Map(), byName = new Map();
    for (const t of talents) {
      const i = handleOf(t.instagram), k = handleOf(t.tiktok);
      if (i) byIg.set(i, t); if (k) byTt.set(k, t); byName.set(normName(t.name), t);
    }
    const prev = new Map((await db.query('SELECT slug, bio, photo_src, talent_id FROM website_profiles')).rows.map((r) => [r.slug, r]));
    const have = new Map((await db.query('SELECT talent_id, source_url FROM talent_photos')).rows.map((r) => [r.talent_id, r.source_url]));

    const stats = { onSite: ok.length, matched: 0, photosSaved: 0, photosFailed: 0, photoErrors: [], biosFilled: 0, notInIndex: [], failed: profiles.length - ok.length };
    let changed = false;

    for (const p of ok) {
      const old = prev.get(p.slug);
      const t = (old && old.talent_id && talents.find((x) => x.id === old.talent_id))
        || byIg.get(handleOf(p.instagram)) || byTt.get(handleOf(p.tiktok)) || byName.get(normName(p.name));
      await db.query(
        `INSERT INTO website_profiles (slug, name, bio, photo_src, instagram, talent_id, on_site, last_seen)
         VALUES ($1,$2,$3,$4,$5,$6,true,now())
         ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name, bio=EXCLUDED.bio, photo_src=EXCLUDED.photo_src, instagram=EXCLUDED.instagram,
           talent_id=COALESCE(EXCLUDED.talent_id, website_profiles.talent_id), on_site=true, last_seen=now()`,
        [p.slug, p.name, p.bio, p.photo, p.instagram, t ? t.id : null]
      );
      if (!t) { stats.notInIndex.push(p.name); continue; }
      stats.matched++;

      // Photo: download our own copy (only when the website image is new to us)
      if (p.photo && have.get(t.id) !== p.photo && isWebsitePhoto(t.photo)) {
        try {
          const r = await fetch(p.photo, { headers: IMG_HEADERS });
          const type = (r.headers.get('content-type') || '').split(';')[0];
          const buf = Buffer.from(await r.arrayBuffer());
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          if (!/^image\//.test(type)) throw new Error(`not an image (${type || 'no type'})`);
          if (buf.length < 500 || buf.length >= 8e6) throw new Error(`unexpected size ${buf.length}`);
          await db.query(
            `INSERT INTO talent_photos (talent_id, content_type, data, source_url, updated_at) VALUES ($1,$2,$3,$4,now())
             ON CONFLICT (talent_id) DO UPDATE SET content_type=EXCLUDED.content_type, data=EXCLUDED.data, source_url=EXCLUDED.source_url, updated_at=now()`,
            [t.id, type, buf, p.photo]
          );
          await db.query('UPDATE talents SET photo = $2, updated_at = now() WHERE id = $1', [t.id, `/api/img/${encodeURIComponent(t.id)}?v=${Date.now().toString(36)}`]);
          stats.photosSaved++; changed = true;
        } catch (e) {
          stats.photosFailed++;
          const why = String(e.message || e).slice(0, 80);
          if (stats.photoErrors.length < 3 && !stats.photoErrors.includes(why)) stats.photoErrors.push(why);
        }
      }

      // Bio: fill when blank, or refresh when the Index still holds the old website text (never overwrite hand-written bios)
      if (p.bio && p.bio !== t.public_bio && (!t.public_bio || (old && old.bio && old.bio === t.public_bio))) {
        await db.query('UPDATE talents SET public_bio = $2, updated_at = now() WHERE id = $1', [t.id, p.bio]);
        stats.biosFilled++; changed = true;
      }
    }

    // Anyone no longer listed is only flagged; their photo and bio stay in the Index.
    const seen = ok.map((p) => p.slug);
    await db.query('UPDATE website_profiles SET on_site = false WHERE NOT (slug = ANY($1::text[]))', [seen]);
    if (changed) await bump();
    await db.query(
      `INSERT INTO monday_sync_log (kind, ran_at, ok, summary) VALUES ('website', now(), true, $1::jsonb)
       ON CONFLICT (kind) DO UPDATE SET ran_at=now(), ok=true, summary=EXCLUDED.summary`,
      [JSON.stringify({ ...stats, notInIndex: stats.notInIndex.slice(0, 40) })]
    );
    return { ok: true, ...stats };
  } catch (e) {
    await db.query(
      `INSERT INTO monday_sync_log (kind, ran_at, ok, summary) VALUES ('website', now(), false, $1::jsonb)
       ON CONFLICT (kind) DO UPDATE SET ran_at=now(), ok=false, summary=EXCLUDED.summary`,
      [JSON.stringify({ error: String(e.message || e).slice(0, 300) })]
    ).catch(() => {});
    throw e;
  } finally {
    await db.query('SELECT pg_advisory_unlock(7003)').catch(() => {});
  }
}
