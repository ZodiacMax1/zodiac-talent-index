import { fetchItems, cv } from './monday.mjs';
import { pool, bump } from './db.mjs';

const ROSTER = '5092522353';
const OUTREACH = '5092522357';
const INDEX_BOARD = '5106523631';
const DEALS = '5061429895';

// Field -> monday column id, per board
const BOARDS = [
  { // highest priority first
    id: ROSTER, name: 'Talent Roster', exclusivityFrom: 'group',
    cols: { region: 'dropdown_mm28qmrk', niche: 'dropdown_mm121h2d', instagram: 'link_mm12mgkg', ig_followers: 'numeric_mm6kz26b',
      tiktok: 'link_mm12sc8d', tt_followers: 'numeric_mm6kefeh', youtube: 'link_mm12b2gn', yt_followers: 'numeric_mm6kb5hg', rate: 'text_mm12prd0' },
  },
  {
    id: INDEX_BOARD, name: 'Talent Index', exclusivityFrom: null, // Talent Index board = always Non-Exclusive
    cols: { region: 'dropdown_mm8cnnvt', gender: 'dropdown_mm8cse6s', niche: 'dropdown_mm8chs00',
      instagram: 'link_mm8c7eqb', ig_followers: 'numeric_mm8cej72', tiktok: 'link_mm8csmt1', tt_followers: 'numeric_mm8cjq8v',
      youtube: 'link_mm8c9x7m', yt_followers: 'numeric_mm8cx59g', rate: 'text_mm8cfrsz' },
  },
  {
    id: OUTREACH, name: 'Talent Outreach', exclusivityFrom: null,
    cols: { region: 'dropdown_mm285jrb', niche: 'dropdown_mm1ydcwn', instagram: 'text_mm1ysd8q', ig_followers: 'text_mm6ky6b8',
      tiktok: 'text_mm1yrbhb', tt_followers: 'text_mm6kqxgr', youtube: 'text_mm6kqpyr', yt_followers: 'text_mm6k9bc' },
  },
];

const REGION_MAP = {
  'united kingdom': 'UK', uk: 'UK', 'great britain': 'UK', england: 'UK',
  'united arab emirates': 'UAE', uae: 'UAE', dubai: 'UAE',
  'united states of america': 'US', 'united states': 'US', usa: 'US', us: 'US', america: 'US',
};
const NICHE_MAP = { 'food & drink': 'F&B', 'food and drink': 'F&B', 'fashion & style': 'Fashion', 'n/aa': null, 'n/a': null };

export function parseFollowers(v) {
  if (v === null || v === undefined) return null;
  const t = String(v).trim().toLowerCase().replace(/,/g, '').replace(/\s/g, '');
  if (!t) return null;
  const m = t.match(/^(\d+(?:\.\d+)?)([km]?)$/);
  if (!m) return null;
  return Math.round(parseFloat(m[1]) * (m[2] === 'k' ? 1e3 : m[2] === 'm' ? 1e6 : 1));
}

export function handleOf(url) {
  if (!url) return '';
  const m = String(url).toLowerCase().match(/(?:instagram\.com|tiktok\.com|youtube\.com)\/(@?[a-z0-9._-]+)/);
  return m ? m[1].replace(/^@/, '') : '';
}
export const normName = (n) => String(n || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function toUrl(platform, raw) {
  let v = (raw || '').trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (/^(www\.)?(instagram|tiktok|youtube)\.com/i.test(v)) return 'https://' + v;
  v = v.replace(/^@/, '').replace(/\s/g, '');
  if (!v) return null;
  if (platform === 'instagram') return `https://www.instagram.com/${v}/`;
  if (platform === 'tiktok') return `https://www.tiktok.com/@${v}`;
  return `https://www.youtube.com/@${v}`;
}

function linkValue(c) {
  if (!c) return '';
  try { const j = c.value ? JSON.parse(c.value) : null; if (j && j.url) return j.url; } catch {}
  return c.text || '';
}

// Turn a monday item into the fields we care about. Blank fields stay undefined (never overwrite with blank).
export function readItem(board, item) {
  const f = {};
  const get = (field) => cv(item, board.cols[field]);
  const text = (field) => { const c = get(field); const t = c && c.text ? String(c.text).trim() : ''; return t || undefined; };

  const region = text('region');
  if (region) f.region = REGION_MAP[region.toLowerCase()] || region;

  const nicheRaw = text('niche');
  if (nicheRaw) {
    const list = nicheRaw.split(',').map((x) => x.trim()).filter(Boolean)
      .map((x) => (x.toLowerCase() in NICHE_MAP ? NICHE_MAP[x.toLowerCase()] : x)).filter(Boolean);
    const uniq = [...new Set(list)];
    if (uniq.length) f.niche = uniq.join(', ');
  }

  const g = text('gender');
  if (g) { const x = g.toLowerCase(); f.gender = x.startsWith('f') ? 'F' : x.startsWith('m') && x !== 'mixed' ? 'M' : x === 'mixed' ? 'Mixed' : undefined; if (!f.gender) delete f.gender; }

  for (const [p, urlField] of [['instagram', 'instagram'], ['tiktok', 'tiktok'], ['youtube', 'youtube']]) {
    if (!board.cols[urlField]) continue;
    const c = get(urlField);
    const raw = c && c.type === 'link' ? linkValue(c) : (c && c.text) || '';
    const url = toUrl(p, raw);
    if (url) f[urlField] = url;
  }
  for (const k of ['ig_followers', 'tt_followers', 'yt_followers']) {
    if (!board.cols[k]) continue;
    const n = parseFollowers(text(k));
    if (n) f[k] = n;
  }
  const rate = text('rate');
  if (rate) f.rate = rate;

  // Exclusivity
  if (board.exclusivityFrom === 'group') {
    const title = (item.group && item.group.title || '').toLowerCase();
    if (title.includes('non-exclusive') || title.includes('non exclusive')) f.exclusivity = 'Non-Exclusive';
    else if (title.includes('exclusive')) f.exclusivity = 'Exclusive';
  } else if (board.exclusivityFrom === 'column') {
    const e = text('exclusivity');
    if (e) f.exclusivity = e.toLowerCase().startsWith('non') ? 'Non-Exclusive' : 'Exclusive';
  }
  return f;
}

export function missingFields(f) {
  const miss = [];
  if (!f.region) miss.push('region');
  if (!f.niche) miss.push('niche');
  const platforms = [['instagram', 'ig_followers'], ['tiktok', 'tt_followers'], ['youtube', 'yt_followers']];
  if (!platforms.some(([l, n]) => f[l] && f[n])) miss.push('a platform link + following');
  return miss;
}

const FIELDS = ['name', 'exclusivity', 'region', 'niche', 'gender', 'ig_followers', 'tt_followers', 'yt_followers', 'rate', 'instagram', 'tiktok', 'youtube'];

async function withLock(key, fn) {
  const client = await pool().connect();
  try {
    const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [key]);
    if (!rows[0].ok) return { skipped: 'another sync is already running' };
    try { return await fn(); } finally { await client.query('SELECT pg_advisory_unlock($1)', [key]); }
  } finally { client.release(); }
}

async function logRun(kind, ok, summary) {
  await pool().query(
    `INSERT INTO monday_sync_log (kind, ran_at, ok, summary) VALUES ($1, now(), $2, $3::jsonb)
     ON CONFLICT (kind) DO UPDATE SET ran_at = now(), ok = EXCLUDED.ok, summary = EXCLUDED.summary`,
    [kind, ok, JSON.stringify(summary)]
  );
}

export async function syncTalent() {
  return withLock(7001, async () => {
    try {
      const db = pool();
      // 1. Read monday (highest priority board first)
      const monday = [];
      for (const b of BOARDS) {
        const items = await fetchItems(b.id, Object.values(b.cols));
        monday.push({ board: b, items });
      }

      // 2. Load what we already have
      const talents = (await db.query('SELECT * FROM talents')).rows;
      const byId = new Map(talents.map((t) => [t.id, t]));
      const origById = new Map(byId);
      const links = (await db.query('SELECT board_id, item_id, talent_id FROM monday_links')).rows;
      const linkMap = new Map(links.map((l) => [l.board_id + ':' + l.item_id, l.talent_id]));
      const byIg = new Map(), byTt = new Map(), byName = new Map();
      const index = (t) => {
        const i = handleOf(t.instagram), k = handleOf(t.tiktok);
        if (i) byIg.set(i, t.id); if (k) byTt.set(k, t.id); byName.set(normName(t.name), t.id);
      };
      talents.forEach(index);

      const desired = new Map();        // talent_id -> merged monday fields (first non-blank wins)
      const newLinks = [];              // [board, item, talent_id]
      const creates = new Map();        // temp key -> {fields, board, item}
      const pending = [];
      const stats = { seen: 0, created: 0, updated: 0, linked: 0, pending: 0 };

      for (const { board, items } of monday) {
        for (const item of items) {
          stats.seen++;
          const name = (item.name || '').trim();
          if (!name) continue;
          const f = readItem(board, item);
          const key = board.id + ':' + item.id;
          let tid = linkMap.get(key);
          if (!tid) {
            const ig = handleOf(f.instagram), tt = handleOf(f.tiktok);
            tid = (ig && byIg.get(ig)) || (tt && byTt.get(tt)) || byName.get(normName(name));
            if (tid) { newLinks.push([board.id, item.id, tid]); linkMap.set(key, tid); stats.linked++; }
          }
          if (!tid) {
            const miss = missingFields(f);
            if (miss.length) { pending.push([board.id, item.id, name, miss.join(', ')]); stats.pending++; continue; }
            // Complete: create a new talent
            tid = 'm' + item.id;
            if (byId.has(tid)) { // extremely unlikely id clash; treat as existing
              newLinks.push([board.id, item.id, tid]); linkMap.set(key, tid);
            } else {
              const row = { id: tid, name, exclusivity: f.exclusivity || 'Non-Exclusive', ...f };
              creates.set(tid, row);
              const stub = { id: tid, name, instagram: f.instagram, tiktok: f.tiktok };
              byId.set(tid, stub); index(stub);
              newLinks.push([board.id, item.id, tid]); linkMap.set(key, tid);
              stats.created++;
              continue;
            }
          }
          // Existing (or just-created) talent: merge fields, first non-blank wins (priority order)
          const merged = desired.get(tid) || {};
          for (const [k, v] of Object.entries(f)) if (merged[k] === undefined) merged[k] = v;
          desired.set(tid, merged);
        }
      }

      // 3. Write
      const client = await db.connect();
      let changed = false;
      try {
        await client.query('BEGIN');
        for (const row of creates.values()) {
          const cols = FIELDS.filter((c) => row[c] !== undefined && row[c] !== null);
          await client.query(
            `INSERT INTO talents (id, ${cols.join(', ')}) VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')}) ON CONFLICT (id) DO NOTHING`,
            [row.id, ...cols.map((c) => row[c])]
          );
          changed = true;
        }
        for (const [board, item, tid] of newLinks) {
          await client.query('INSERT INTO monday_links (board_id, item_id, talent_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [board, item, tid]);
        }
        for (const [tid, f] of desired) {
          const cur = origById.get(tid);
          if (!cur) continue; // freshly created above already has these values
          const sets = [], vals = [];
          for (const [k, v] of Object.entries(f)) {
            if (!FIELDS.includes(k)) continue;
            const old = cur[k] == null ? null : (typeof v === 'number' ? Number(cur[k]) : cur[k]);
            if (old !== v) { vals.push(v); sets.push(`${k} = $${vals.length + 1}`); }
          }
          if (sets.length) {
            await client.query(`UPDATE talents SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, [tid, ...vals]);
            stats.updated++; changed = true;
          }
        }
        await client.query('DELETE FROM monday_pending');
        for (const p of pending) await client.query('INSERT INTO monday_pending (board_id, item_id, name, missing) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', p);
        if (changed) await bump(client);
        await client.query('COMMIT');
      } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }

      await logRun('talent', true, stats);
      return { ok: true, ...stats };
    } catch (e) {
      await logRun('talent', false, { error: String(e.message || e).slice(0, 300) }).catch(() => {});
      throw e;
    }
  });
}

const DEAL_COLS = ['board_relation_mkxm5h8p', 'deal_account', 'dropdown_mm28tj8', 'deal_value', 'formula_mm1yvjqj', 'color_mm12gdy9', 'date_mkzkzk2e', 'date_mm1yhehr'];

export async function syncDeals() {
  return withLock(7002, async () => {
    try {
      // Deal In Progress (1), Deal Agreed (7), Deal Completed (8), with a talent linked
      const items = await fetchItems(DEALS, DEAL_COLS, {
        operator: 'and',
        rules: [
          { column_id: 'color_mm12gdy9', compare_value: [1, 7, 8], operator: 'any_of' },
          { column_id: 'board_relation_mkxm5h8p', compare_value: [], operator: 'is_not_empty' },
        ],
      });
      const rows = [];
      for (const it of items) {
        const rel = cv(it, 'board_relation_mkxm5h8p');
        const ids = (rel && rel.linked_item_ids) || [];
        const brand = (cv(it, 'deal_account') || {}).display_value || null;
        const num = (id) => { const t = (cv(it, id) || {}).text; const n = t === undefined || t === '' ? null : Number(String(t).replace(/,/g, '')); return Number.isFinite(n) ? n : null; };
        const date = (cv(it, 'date_mkzkzk2e') || {}).text || (cv(it, 'date_mm1yhehr') || {}).text || null;
        for (const rid of ids) {
          rows.push([it.id + ':' + rid, String(rid), it.name, brand, num('deal_value'), (cv(it, 'dropdown_mm28tj8') || {}).text || null, num('formula_mm1yvjqj'), (cv(it, 'color_mm12gdy9') || {}).text || null, date || null]);
        }
      }
      const client = await pool().connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM monday_deals');
        for (const r of rows) {
          await client.query(
            'INSERT INTO monday_deals (item_id, roster_item_id, campaign, brand, value, currency, value_gbp, status, deal_date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (item_id) DO NOTHING', r);
        }
        await bump(client);
        await client.query('COMMIT');
      } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
      await logRun('deals', true, { deals: rows.length });
      return { ok: true, deals: rows.length };
    } catch (e) {
      await logRun('deals', false, { error: String(e.message || e).slice(0, 300) }).catch(() => {});
      throw e;
    }
  });
}
