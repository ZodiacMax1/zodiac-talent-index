import { roleForPassword, issueToken, identityFromRequest, hashPassword, verifyPassword, tempPassword } from '../lib/auth.mjs';
import { pool, query, bump, currentVersion } from '../lib/db.mjs';
import { syncTalent } from '../lib/sync.mjs';
import { normLocation } from '../lib/places.mjs';
import { handleCampaigns } from '../lib/campaigns.mjs';
import { randomBytes, createHash } from 'node:crypto';

export const config = { path: '/api/*' };

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

const TALENT_FIELDS = [
  'name', 'exclusivity', 'region', 'location', 'niche', 'gender',
  'ig_followers', 'tt_followers', 'yt_followers',
  'rate', 'instagram', 'tiktok', 'youtube', 'photo', 'public_bio',
];
const NUMERIC = ['ig_followers', 'tt_followers', 'yt_followers'];

function clean(input) {
  const out = {};
  for (const k of TALENT_FIELDS) {
    if (!(k in input)) continue;
    let v = input[k];
    if (typeof v === 'string') v = v.trim();
    if (v === '' || v === undefined) v = null;
    if (NUMERIC.includes(k)) {
      if (v === null) { out[k] = null; continue; }
      const n = Number(String(v).replace(/,/g, ''));
      if (!Number.isFinite(n) || n < 0) throw new Error(`${k} must be a number`);
      v = Math.round(n);
    }
    if (k === 'exclusivity' && v !== 'Exclusive' && v !== 'Non-Exclusive') throw new Error('Invalid exclusivity');
    if (k === 'gender' && v !== null && !['F', 'M', 'Mixed'].includes(v)) throw new Error('Invalid gender');
    if (k === 'name' && !v) throw new Error('Name is required');
    out[k] = v;
  }
  // Location is the master; region (UK / UAE only) is always derived from it
  if ('location' in out || 'region' in out) {
    const { location, region } = normLocation('location' in out ? out.location : out.region);
    out.location = location; out.region = region;
  }
  return out;
}

const newId = (p) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

function shapeTalent(r) {
  const ig = r.ig_followers == null ? null : Number(r.ig_followers);
  const tt = r.tt_followers == null ? null : Number(r.tt_followers);
  const yt = r.yt_followers == null ? null : Number(r.yt_followers);
  return {
    id: r.id, name: r.name, exclusivity: r.exclusivity, region: r.region, location: r.location, niche: r.niche,
    gender: r.gender, ig_followers: ig, tt_followers: tt, yt_followers: yt,
    total_followers: (ig || 0) + (tt || 0) + (yt || 0),
    rate: r.rate, instagram: r.instagram, tiktok: r.tiktok, youtube: r.youtube,
    photo: r.photo, public_bio: r.public_bio,
    deal_count: Number(r.deal_count || 0), monday_linked: !!r.monday_linked, note_count: Number(r.note_count || 0),
  };
}

const BOT_RE = /bot|crawl|spider|preview|slack|whatsapp|facebookexternalhit|telegram|linkedin|skype|outlook|safelinks|google-safety|headless|curl|wget|python|node-fetch|axios|monitor|uptime/i;
function describeUA(ua) {
  ua = String(ua || '');
  const device = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Macintosh|Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows PC' : /Linux/.test(ua) ? 'Linux' : 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\/|CriOS/.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Unknown browser';
  return { device, browser, bot: !ua || BOT_RE.test(ua) };
}
const hash = (x) => createHash('sha256').update(`${process.env.AUTH_SECRET || ''}|${x}`).digest('hex').slice(0, 16);

export default async (req, context) => {
  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  const method = req.method;
  const route = parts[0] || '';
  const clientIp = (context && context.ip) || req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-forwarded-for') || '';

  // The brand-facing domain (DECKS_HOST) only ever serves shared decks and their photos, never the Index or its API.
  const decksHost = (process.env.DECKS_HOST || '').toLowerCase();
  if (decksHost && url.host.toLowerCase() === decksHost && !(route === 'public' || route === 'img')) return json({ error: 'Not found' }, 404);

  try {
    // ---- Login (no token needed)
    if (route === 'login' && method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const { password } = body;
      const email = String(body.email || '').trim().toLowerCase();
      const ipH = hash(clientIp || 'unknown');
      const [{ n }] = await query(`SELECT count(*)::int AS n FROM login_attempts WHERE ip_hash = $1 AND at > now() - interval '15 minutes'`, [ipH]);
      if (n >= 15) return json({ error: 'Too many attempts. Please wait 15 minutes and try again.' }, 429);
      const fail = async () => {
        await query('INSERT INTO login_attempts (ip_hash) VALUES ($1)', [ipH]);
        await query(`DELETE FROM login_attempts WHERE at < now() - interval '1 day'`);
        return json({ error: 'Incorrect email or password' }, 401);
      };
      if (email) {
        const [u] = await query('SELECT * FROM users WHERE email = $1', [email]);
        if (!u || !u.active || !verifyPassword(password, u.password_hash)) return fail();
        await query('UPDATE users SET last_login_at = now() WHERE id = $1', [u.id]);
        const r = u.role === 'viewer' ? 'view' : 'edit';
        return json({ token: issueToken(r, { uid: Number(u.id), name: u.name }), role: r, me: { name: u.name, admin: u.role === 'admin', mustChange: u.must_change } });
      }
      const [st] = await query(`SELECT value FROM app_settings WHERE key = 'legacy_passwords'`);
      if (st && st.value === 'off') return json({ error: 'Shared passwords are switched off. Sign in with your email and password.' }, 401);
      const role = roleForPassword(password);
      if (!role) return fail();
      return json({ token: issueToken(role), role, me: null });
    }

    // ---- PUBLIC: which sign-in options to show
    if (route === 'public' && parts[1] === 'auth-config' && method === 'GET') {
      const [st] = await query(`SELECT value FROM app_settings WHERE key = 'legacy_passwords'`);
      return json({ shared: !(st && st.value === 'off') });
    }

    // ---- PUBLIC: a stored talent photo (these are the same photos shown on the public website)
    if (route === 'img' && method === 'GET') {
      const rows = await query('SELECT content_type, data FROM talent_photos WHERE talent_id = $1', [decodeURIComponent(parts[1] || '')]);
      if (!rows.length) return json({ error: 'Not found' }, 404);
      return new Response(rows[0].data, { headers: { 'content-type': rows[0].content_type, 'cache-control': 'public, max-age=31536000, immutable' } });
    }

    // ---- PUBLIC: a shared deck snapshot (no login). Only ever returns the snapshot, never anything else.
    if (route === 'public' && parts[1] === 'deck' && method === 'GET') {
      const code = String(parts[2] || '');
      if (!/^[A-Za-z0-9]{10,40}$/.test(code)) return json({ error: 'Not found' }, 404);
      const ua = describeUA(req.headers.get('user-agent'));
      const rows = await query(
        `SELECT snapshot FROM shared_decks WHERE code = $1 AND NOT revoked AND (expires_at IS NULL OR expires_at > now())`,
        [code]
      );
      if (rows.length) {
        const geo = (context && context.geo) || {};
        await query(
          `INSERT INTO deck_views (code, country, city, device, browser, visitor, is_bot) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [code, (geo.country && (geo.country.name || geo.country.code)) || null, geo.city || null, ua.device, ua.browser, hash(clientIp + '|' + (req.headers.get('user-agent') || '')), ua.bot]
        );
        if (!ua.bot) await query('UPDATE shared_decks SET views = views + 1, last_viewed_at = now() WHERE code = $1', [code]);
      }
      if (!rows.length) return json({ error: 'This link is no longer available' }, 404);
      return new Response(JSON.stringify(rows[0].snapshot), {
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' },
      });
    }

    const ident = identityFromRequest(req);
    if (!ident) return json({ error: 'Unauthorised' }, 401);
    let role = ident.role;
    let me = { name: null, admin: false, uid: null, mustChange: false };
    if (ident.uid) {
      const [u] = await query('SELECT id, name, role, active, must_change FROM users WHERE id = $1', [ident.uid]);
      if (!u || !u.active) return json({ error: 'Unauthorised' }, 401);
      role = u.role === 'viewer' ? 'view' : 'edit';
      me = { name: u.name, admin: u.role === 'admin', uid: Number(u.id), mustChange: u.must_change };
    } else {
      const [st] = await query(`SELECT value FROM app_settings WHERE key = 'legacy_passwords'`);
      if (st && st.value === 'off') return json({ error: 'Unauthorised' }, 401);
    }
    const canEdit = role === 'edit';
    const actor = me.name || (role === 'edit' ? 'Shared edit password' : 'Shared view password');
    const needEdit = () => (canEdit ? null : json({ error: 'You have view-only access' }, 403));
    // monday / website syncs: admins only (or the shared edit password until accounts exist)
    const needSync = () => (me.admin || (!ident.uid && role === 'edit') ? null : json({ error: 'Only an admin can run syncs' }, 403));
    const needAdmin = () => (me.admin ? null : json({ error: 'Admin access required' }, 403));
    const logAct = (action, entityId, entityName, detail) =>
      query('INSERT INTO activity_log (actor, action, entity_id, entity_name, detail) VALUES ($1,$2,$3,$4,$5::jsonb)', [actor, action, entityId || null, entityName || null, detail ? JSON.stringify(detail) : null]);

    // ---- Lightweight poll
    if (route === 'version' && method === 'GET') {
      return json({ version: await currentVersion(), role });
    }

    // ---- Full state
    if (route === 'state' && method === 'GET') {
      const [talents, lists, decks, version] = await Promise.all([
        query(`SELECT t.*,
          (SELECT count(*) FROM monday_deals d JOIN monday_links l ON l.item_id = d.roster_item_id AND l.board_id = '5092522353' WHERE l.talent_id = t.id) AS deal_count,
          EXISTS (SELECT 1 FROM monday_links l WHERE l.talent_id = t.id) AS monday_linked,
          (SELECT count(*) FROM talent_notes n WHERE n.talent_id = t.id) AS note_count
        FROM talents t WHERE t.deleted_at IS NULL ORDER BY lower(t.name)`),
        query('SELECT id, name, data, updated_at FROM lists ORDER BY updated_at DESC'),
        query('SELECT id, name, data, updated_at FROM decks ORDER BY updated_at DESC'),
        currentVersion(),
      ]);
      const [uc] = await query('SELECT count(*)::int AS n FROM users');
      return json({ version, role, me: ident.uid ? me : null, usersExist: uc.n > 0, talents: talents.map(shapeTalent), lists, decks });
    }

    // ---- Previous deals for a talent (any signed-in user)
    if (route === 'talents' && parts[2] === 'deals' && method === 'GET') {
      const rows = await query(
        `SELECT d.campaign, d.brand, d.value, d.currency, d.value_gbp, d.status, to_char(d.deal_date, 'YYYY-MM-DD') AS deal_date
           FROM monday_deals d JOIN monday_links l ON l.item_id = d.roster_item_id AND l.board_id = '5092522353'
          WHERE l.talent_id = $1 ORDER BY d.deal_date DESC NULLS LAST, d.campaign`,
        [parts[1]]
      );
      return json({
        deals: rows.map((r) => ({
          campaign: r.campaign, brand: r.brand, status: r.status, date: r.deal_date || null,
          value: r.value == null ? null : Number(r.value), currency: r.currency, value_gbp: r.value_gbp == null ? null : Number(r.value_gbp),
        })),
      });
    }

    // ---- Notes on a talent (any signed-in user can read and add; edit role can delete)
    if (route === 'talents' && parts[2] === 'notes') {
      const tid = parts[1];
      if (method === 'GET') {
        const rows = await query('SELECT id, body, author, created_at FROM talent_notes WHERE talent_id = $1 ORDER BY created_at DESC, id DESC', [tid]);
        return json({ notes: rows });
      }
      if (method === 'POST') {
        const b = await req.json().catch(() => ({}));
        const body = String(b.body || '').trim().slice(0, 4000);
        if (!body) return json({ error: 'Note is required' }, 400);
        const author = me.name || String(b.author || '').trim().slice(0, 60) || null;
        const ex = await query('SELECT 1 FROM talents WHERE id = $1', [tid]);
        if (!ex.length) return json({ error: 'Talent not found' }, 404);
        const rows = await query('INSERT INTO talent_notes (talent_id, body, author) VALUES ($1,$2,$3) RETURNING id, body, author, created_at', [tid, body, author]);
        return json({ note: rows[0], version: await bump() }, 201);
      }
      if (method === 'DELETE' && parts[3]) {
        const denied = needEdit();
        if (denied) return denied;
        await query('DELETE FROM talent_notes WHERE id = $1 AND talent_id = $2', [parts[3], tid]);
        return json({ ok: true, version: await bump() });
      }
    }

    // ---- Shared deck links (any signed-in user)
    if (route === 'shares') {
      if (method !== 'GET') { const d = needEdit(); if (d) return d; }
      // Editors can only change links they sent themselves; admins (and the shared edit login) can change any
      const mine = (by) => me.admin || !ident.uid || (by && by === me.name);
      const ownsCode = async (code) => { const [r] = await query('SELECT created_by FROM shared_decks WHERE code = $1', [code]); return !r || mine(r.created_by); };
      const notYours = () => json({ error: 'Only the person who sent this link, or an admin, can change it' }, 403);
      const base = process.env.DECKS_HOST ? `https://${process.env.DECKS_HOST}` : url.origin;
      if (method === 'GET' && !parts[1]) {
        const rows = await query(`SELECT s.code, s.name, s.brand, s.recipient, s.created_by, s.view, s.group_id, s.deck_id, s.talent_count, s.created_at, s.expires_at, s.revoked, s.views, s.last_viewed_at,
            (SELECT count(DISTINCT v.visitor) FROM deck_views v WHERE v.code = s.code AND NOT v.is_bot)::int AS visitors,
            (SELECT min(v.viewed_at) FROM deck_views v WHERE v.code = s.code AND NOT v.is_bot) AS first_viewed_at
          FROM shared_decks s ORDER BY s.created_at DESC LIMIT 500`);
        return json({ shares: rows, base });
      }
      if (method === 'GET' && parts[1]) {
        const [row] = await query(`SELECT code, name, brand, recipient, created_by, view, note, talent_count, created_at, expires_at, revoked, views, last_viewed_at,
            snapshot->'talents' AS talents FROM shared_decks WHERE code = $1`, [parts[1]]);
        if (!row) return json({ error: 'Not found' }, 404);
        const log = await query(`SELECT viewed_at, country, city, device, browser, visitor, is_bot FROM deck_views WHERE code = $1 ORDER BY viewed_at DESC LIMIT 200`, [parts[1]]);
        const names = (row.talents || []).map((t) => t.name);
        delete row.talents;
        return json({ share: row, names, views: log, url: `${base}/d/${row.code}` });
      }
      if (method === 'POST' && !parts[1]) {
        const b = await req.json().catch(() => ({}));
        const ids = Array.isArray(b.ids) ? [...new Set(b.ids.map(String))].slice(0, 300) : [];
        if (!ids.length) return json({ error: 'Deck is empty' }, 400);
        const found = await query('SELECT * FROM talents WHERE id = ANY($1::text[])', [ids]);
        const byId = new Map(found.map((r) => [r.id, r]));
        const plats = Array.isArray(b.platforms) ? b.platforms.filter((x) => ['ig', 'tt', 'yt'].includes(x)) : ['ig', 'tt', 'yt'];
        const talents = ids.map((i) => byId.get(i)).filter(Boolean).map((r) => ({
          name: r.name, photo: r.photo || null, bio: r.public_bio || null,
          ig: plats.includes('ig') ? { n: r.ig_followers == null ? null : Number(r.ig_followers), url: r.instagram || null } : null,
          tt: plats.includes('tt') ? { n: r.tt_followers == null ? null : Number(r.tt_followers), url: r.tiktok || null } : null,
          yt: plats.includes('yt') ? { n: r.yt_followers == null ? null : Number(r.yt_followers), url: r.youtube || null } : null,
        }));
        talents.sort((a, c) => (c.ig?.n || 0) + (c.tt?.n || 0) + (c.yt?.n || 0) - ((a.ig?.n || 0) + (a.tt?.n || 0) + (a.yt?.n || 0)));
        const brand = String(b.brand || '').trim().slice(0, 80) || null;
        const domain = String(b.domain || '').trim().slice(0, 80) || null;
        const days = Number(b.expiresInDays);
        const expires = Number.isFinite(days) && days > 0 ? new Date(Date.now() + Math.min(days, 730) * 864e5) : null;
        const view = b.view === 'list' ? 'list' : 'cards';
        const createdBy = me.name || String(b.createdBy || '').trim().slice(0, 60) || null;
        const note = String(b.note || '').trim().slice(0, 300) || null;
        const recips = (Array.isArray(b.recipients) ? b.recipients : []).map((x) => String(x).trim().slice(0, 80)).filter(Boolean).slice(0, 25);
        const targets = recips.length ? recips : [null];
        const groupId = randomBytes(5).toString('hex');
        let senderEmail = null;
        if (me.uid) { const [ue] = await query('SELECT email FROM users WHERE id = $1', [me.uid]); senderEmail = ue ? ue.email : null; }
        const created = [];
        for (const recipient of targets) {
          const code = randomBytes(9).toString('base64url').replace(/[-_]/g, 'x').slice(0, 12);
          const snapshot = { brand, domain, listName: String(b.listName || '').slice(0, 80) || null, platforms: plats, view, talents, createdAt: new Date().toISOString(), sender: createdBy ? { name: createdBy, email: senderEmail } : null };
          await query(
            'INSERT INTO shared_decks (code, name, brand, snapshot, talent_count, expires_at, recipient, created_by, view, group_id, note, deck_id) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12)',
            [code, String(b.name || brand || b.listName || 'Deck').slice(0, 120), brand, JSON.stringify(snapshot), talents.length, expires, recipient, createdBy, view, groupId, note, b.deckId ? String(b.deckId).slice(0, 80) : null]
          );
          created.push({ code, recipient, url: `${base}/d/${code}` });
        }
        return json({ links: created, talent_count: talents.length, expires_at: expires }, 201);
      }
      if (method === 'PATCH' && parts[1] === 'deck' && parts[2]) {
        const b = await req.json().catch(() => ({}));
        const name = String(b.name || '').trim().slice(0, 120);
        if (!name) return json({ error: 'Name is required' }, 400);
        await query(me.admin || !ident.uid ? 'UPDATE shared_decks SET name = $2 WHERE deck_id = $1' : 'UPDATE shared_decks SET name = $2 WHERE deck_id = $1 AND created_by = $3', me.admin || !ident.uid ? [parts[2], name] : [parts[2], name, me.name]);
        return json({ ok: true });
      }
      if (method === 'PATCH' && parts[1]) {
        if (!(await ownsCode(parts[1]))) return notYours();
        const b = await req.json().catch(() => ({}));
        if (typeof b.name === 'string' && b.name.trim()) await query('UPDATE shared_decks SET name = $2 WHERE code = $1', [parts[1], b.name.trim().slice(0, 120)]);
        if (b.revoked === false) await query('UPDATE shared_decks SET revoked = false WHERE code = $1', [parts[1]]);
        if (b.extendDays !== undefined) {
          const d = Math.min(Math.max(Number(b.extendDays) || 0, 0), 730);
          if (d === 0) await query('UPDATE shared_decks SET expires_at = NULL WHERE code = $1', [parts[1]]);
          else await query(`UPDATE shared_decks SET expires_at = greatest(coalesce(expires_at, now()), now()) + ($2 || ' days')::interval WHERE code = $1`, [parts[1], String(d)]);
        }
        return json({ ok: true });
      }
      if (method === 'POST' && parts[1] === 'purge') {
        const all = me.admin || !ident.uid;
        const gone = await query(`DELETE FROM shared_decks WHERE revoked ${all ? '' : 'AND created_by = $1'} RETURNING code`, all ? [] : [me.name]);
        if (gone.length) await query('DELETE FROM deck_views WHERE code = ANY($1::text[])', [gone.map((g) => g.code)]);
        return json({ deleted: gone.length });
      }
      if (method === 'DELETE' && parts[1] && url.searchParams.get('permanent') === '1') {
        const [row] = await query('SELECT revoked, expires_at, created_by FROM shared_decks WHERE code = $1', [parts[1]]);
        if (!row) return json({ error: 'Not found' }, 404);
        if (!mine(row.created_by)) return notYours();
        if (!row.revoked && !(row.expires_at && new Date(row.expires_at) < new Date())) return json({ error: 'Revoke the link first, then you can delete it' }, 400);
        await query('DELETE FROM deck_views WHERE code = $1', [parts[1]]);
        await query('DELETE FROM shared_decks WHERE code = $1', [parts[1]]);
        return json({ ok: true });
      }
      if (method === 'DELETE' && parts[1]) {
        if (!(await ownsCode(parts[1]))) return notYours();
        await query('UPDATE shared_decks SET revoked = true WHERE code = $1', [parts[1]]);
        return json({ ok: true });
      }
    }

    // ---- monday sync status / run
    if (route === 'sync' && parts[1] === 'status' && method === 'GET') {
      const [log, pending] = await Promise.all([
        query('SELECT kind, ran_at, ok, summary FROM monday_sync_log'),
        query(`SELECT board_id, name, missing FROM monday_pending ORDER BY name`),
      ]);
      return json({ log, pending });
    }
    if (route === 'sync' && parts[1] === 'run' && method === 'POST') {
      const denied = needSync();
      if (denied) return denied;
      try {
        return json(await syncTalent());
      } catch (e) {
        return json({ error: String(e.message || e).slice(0, 200) }, 500);
      }
    }

    if (route === 'sync' && parts[1] === 'website' && method === 'POST') {
      const denied = needSync();
      if (denied) return denied;
      try {
        const res = await fetch(`${url.origin}/.netlify/functions/sync-website-background`, { method: 'POST', headers: { 'x-sync-key': process.env.AUTH_SECRET || '' } });
        return json({ started: res.status === 202 || res.ok });
      } catch (e) { return json({ error: 'Could not start the website sync' }, 500); }
    }

    if (route === 'sync' && parts[1] === 'deals' && method === 'POST') {
      const denied = needSync();
      if (denied) return denied;
      try {
        const res = await fetch(`${url.origin}/.netlify/functions/sync-deals-background`, {
          method: 'POST',
          headers: { 'x-sync-key': process.env.AUTH_SECRET || '' },
        });
        return json({ started: res.status === 202 || res.ok });
      } catch (e) {
        return json({ error: 'Could not start the deals sync' }, 500);
      }
    }

    // ---- Brief matcher (any signed-in user): paste a brief, get ranked talent with reasons
    if (route === 'matcher') {
      if (method === 'POST' && !parts[1]) {
        const b = await req.json().catch(() => ({}));
        const brief = String(b.brief || '').trim();
        if (brief.length < 20) return json({ error: 'Paste the brief (at least a couple of sentences)' }, 400);
        if (brief.length > 8000) return json({ error: 'That brief is too long. Paste the key details (under 8,000 characters).' }, 400);
        if (!process.env.ANTHROPIC_API_KEY) return json({ error: 'The brief matcher is not switched on yet. Add ANTHROPIC_API_KEY in Netlify.' }, 400);
        const [{ n }] = await query(`SELECT count(*)::int AS n FROM brief_matches WHERE created_by = $1 AND created_at > now() - interval '1 day'`, [actor]);
        if (n >= 40) return json({ error: 'Daily limit reached (40 briefs per person). Try again tomorrow.' }, 429);
        const id = newId('m');
        await query('INSERT INTO brief_matches (id, created_by, brief) VALUES ($1,$2,$3)', [id, actor, brief]);
        try {
          await fetch(`${url.origin}/.netlify/functions/match-brief-background`, {
            method: 'POST',
            headers: { 'x-sync-key': process.env.AUTH_SECRET || '', 'content-type': 'application/json' },
            body: JSON.stringify({ id }),
          });
        } catch (e) {
          await query(`UPDATE brief_matches SET status = 'failed', error = 'Could not start the matcher' WHERE id = $1`, [id]);
          return json({ error: 'Could not start the matcher' }, 500);
        }
        return json({ id }, 202);
      }
      if (method === 'GET' && parts[1]) {
        const [r] = await query('SELECT status, result, error, created_at FROM brief_matches WHERE id = $1', [parts[1]]);
        if (!r) return json({ error: 'Not found' }, 404);
        if (r.status === 'running' && Date.now() - new Date(r.created_at).getTime() > 4 * 60 * 1000) {
          await query(`UPDATE brief_matches SET status = 'failed', error = 'Timed out. Try again.' WHERE id = $1`, [parts[1]]);
          return json({ status: 'failed', error: 'Timed out. Try again.' });
        }
        return json({ status: r.status, result: r.result, error: r.error });
      }
    }

    // ---- Account: change own password
    if (route === 'me' && parts[1] === 'password' && method === 'POST') {
      if (!me.uid) return json({ error: 'Shared logins have no personal password' }, 400);
      const b = await req.json().catch(() => ({}));
      const np = String(b.newPassword || '');
      if (np.length < 8) return json({ error: 'Password must be at least 8 characters' }, 400);
      const [u] = await query('SELECT password_hash FROM users WHERE id = $1', [me.uid]);
      if (!verifyPassword(b.currentPassword, u.password_hash)) return json({ error: 'Current password is incorrect' }, 400);
      await query('UPDATE users SET password_hash = $2, must_change = false WHERE id = $1', [me.uid, hashPassword(np)]);
      await logAct('user.password', String(me.uid), me.name);
      return json({ ok: true });
    }

    // ---- Team management (admin only), plus first-admin bootstrap
    if (route === 'users') {
      const userOut = (u) => ({ id: Number(u.id), name: u.name, email: u.email, role: u.role, active: u.active, mustChange: u.must_change, lastLoginAt: u.last_login_at, createdAt: u.created_at });
      if (method === 'POST' && parts[1] === 'bootstrap') {
        const [{ n }] = await query('SELECT count(*)::int AS n FROM users');
        if (n > 0) return json({ error: 'Accounts already exist' }, 400);
        if (ident.uid || role !== 'edit') return json({ error: 'Sign in with the shared edit password to create the first admin' }, 403);
        const b = await req.json().catch(() => ({}));
        const name = String(b.name || '').trim().slice(0, 80);
        const email = String(b.email || '').trim().toLowerCase();
        const pw = String(b.password || '');
        if (!name || !/^\S+@\S+\.\S+$/.test(email)) return json({ error: 'Name and a valid email are required' }, 400);
        if (pw.length < 8) return json({ error: 'Password must be at least 8 characters' }, 400);
        const [u] = await query(`INSERT INTO users (name, email, role, password_hash, must_change) VALUES ($1,$2,'admin',$3,false) RETURNING *`, [name, email, hashPassword(pw)]);
        await logAct('user.add', String(u.id), name, { role: 'admin' });
        return json({ user: userOut(u), token: issueToken('edit', { uid: Number(u.id), name }), me: { name, admin: true, mustChange: false } }, 201);
      }
      const denied = needAdmin();
      if (denied) return denied;
      if (method === 'GET') {
        const rows = await query('SELECT * FROM users ORDER BY lower(name)');
        const [st] = await query(`SELECT value FROM app_settings WHERE key = 'legacy_passwords'`);
        return json({ users: rows.map(userOut), sharedPasswords: !(st && st.value === 'off') });
      }
      if (method === 'POST' && !parts[1]) {
        const b = await req.json().catch(() => ({}));
        const name = String(b.name || '').trim().slice(0, 80);
        const email = String(b.email || '').trim().toLowerCase();
        const r = ['admin', 'editor', 'viewer'].includes(b.role) ? b.role : null;
        if (!name || !/^\S+@\S+\.\S+$/.test(email) || !r) return json({ error: 'Name, valid email and role are required' }, 400);
        const [dup] = await query('SELECT 1 AS x FROM users WHERE email = $1', [email]);
        if (dup) return json({ error: 'That email already has an account' }, 400);
        const temp = tempPassword();
        const [u] = await query(`INSERT INTO users (name, email, role, password_hash, must_change) VALUES ($1,$2,$3,$4,true) RETURNING *`, [name, email, r, hashPassword(temp)]);
        await logAct('user.add', String(u.id), name, { role: r });
        return json({ user: userOut(u), tempPassword: temp }, 201);
      }
      if (method === 'POST' && parts[1] === 'settings') {
        const b = await req.json().catch(() => ({}));
        const [{ n }] = await query(`SELECT count(*)::int AS n FROM users WHERE active AND role = 'admin'`);
        if (!n) return json({ error: 'Create an admin first' }, 400);
        await query(`INSERT INTO app_settings (key, value) VALUES ('legacy_passwords', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [b.sharedPasswords ? 'on' : 'off']);
        await logAct('settings.shared', null, b.sharedPasswords ? 'Shared passwords switched on' : 'Shared passwords switched off');
        return json({ ok: true, sharedPasswords: !!b.sharedPasswords });
      }
      const uid = parts[1];
      if (uid && method === 'POST' && parts[2] === 'reset') {
        const temp = tempPassword();
        const rows = await query('UPDATE users SET password_hash = $2, must_change = true WHERE id = $1 RETURNING name', [uid, hashPassword(temp)]);
        if (!rows.length) return json({ error: 'User not found' }, 404);
        await logAct('user.reset', uid, rows[0].name);
        return json({ tempPassword: temp });
      }
      if (uid && method === 'PATCH') {
        const b = await req.json().catch(() => ({}));
        const [cur] = await query('SELECT * FROM users WHERE id = $1', [uid]);
        if (!cur) return json({ error: 'User not found' }, 404);
        const nextRole = b.role !== undefined ? b.role : cur.role;
        const nextActive = b.active !== undefined ? !!b.active : cur.active;
        if (!['admin', 'editor', 'viewer'].includes(nextRole)) return json({ error: 'Invalid role' }, 400);
        if (cur.role === 'admin' && cur.active && (nextRole !== 'admin' || !nextActive)) {
          const [{ n }] = await query(`SELECT count(*)::int AS n FROM users WHERE active AND role = 'admin' AND id <> $1`, [uid]);
          if (!n) return json({ error: 'There must always be at least one active admin' }, 400);
        }
        const name = b.name !== undefined ? String(b.name).trim().slice(0, 80) || cur.name : cur.name;
        const [u] = await query('UPDATE users SET name = $2, role = $3, active = $4 WHERE id = $1 RETURNING *', [uid, name, nextRole, nextActive]);
        await logAct('user.edit', uid, u.name, { role: nextRole, active: nextActive });
        return json({ user: userOut(u) });
      }
    }

    // ---- Activity log + undo (edit role and above)
    if (route === 'activity') {
      const denied = needEdit();
      if (denied) return denied;
      if (method === 'GET') {
        const rows = await query('SELECT id, at, actor, action, entity_id, entity_name, detail, undone_at FROM activity_log ORDER BY id DESC LIMIT 300');
        return json({ activity: rows.map((r) => ({ ...r, id: Number(r.id), undoable: !r.undone_at && (r.action === 'talent.delete' || r.action === 'talent.edit') })) });
      }
      if (method === 'POST' && parts[2] === 'undo') {
        const [a] = await query('SELECT * FROM activity_log WHERE id = $1', [parts[1]]);
        if (!a || a.undone_at) return json({ error: 'Nothing to undo' }, 400);
        if (a.action === 'talent.delete') {
          const r = await query('UPDATE talents SET deleted_at = NULL, updated_at = now() WHERE id = $1 RETURNING id', [a.entity_id]);
          if (!r.length) return json({ error: 'Talent no longer exists' }, 404);
        } else if (a.action === 'talent.edit') {
          const before = (a.detail && a.detail.before) || {};
          const cols = Object.keys(before).filter((c) => TALENT_FIELDS.includes(c));
          if (!cols.length) return json({ error: 'Nothing to undo' }, 400);
          await query(`UPDATE talents SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1 AND deleted_at IS NULL`, [a.entity_id, ...cols.map((c) => before[c])]);
        } else return json({ error: 'This action cannot be undone' }, 400);
        await query('UPDATE activity_log SET undone_at = now() WHERE id = $1', [a.id]);
        await logAct('undo', a.entity_id, a.entity_name, { of: a.action });
        return json({ ok: true, version: await bump() });
      }
    }

    // ---- Talents
    if (route === 'talents') {
      const denied = needEdit();
      if (denied) return denied;

      if (method === 'POST' && parts[1] === 'bulk') {
        const { rows } = await req.json();
        if (!Array.isArray(rows) || !rows.length) return json({ error: 'No rows' }, 400);
        if (rows.length > 5000) return json({ error: 'Max 5000 rows per upload' }, 400);
        const client = await pool().connect();
        try {
          await client.query('BEGIN');
          const ids = [];
          for (const raw of rows) {
            const t = clean(raw.id ? raw : { exclusivity: 'Non-Exclusive', ...raw });
            if (!t.name) continue;
            const id = raw.id || newId('t');
            const cols = Object.keys(t);
            await client.query(
              `INSERT INTO talents (id, ${cols.join(', ')}) VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')})
               ON CONFLICT (id) DO UPDATE SET ${cols.map((c) => `${c} = EXCLUDED.${c}`).join(', ')}, updated_at = now()`,
              [id, ...cols.map((c) => t[c])]
            );
            ids.push(id);
          }
          const version = await bump(client);
          await client.query('COMMIT');
          await logAct('talent.import', null, `${ids.length} talent`, { count: ids.length });
          return json({ added: ids.length, version });
        } catch (e) {
          await client.query('ROLLBACK');
          throw e;
        } finally {
          client.release();
        }
      }

      if (method === 'POST') {
        const t = clean({ exclusivity: 'Non-Exclusive', ...(await req.json()) });
        if (!t.name) return json({ error: 'Name is required' }, 400);
        const id = newId('t');
        const cols = Object.keys(t);
        await pool().query(
          `INSERT INTO talents (id, ${cols.join(', ')}) VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')})`,
          [id, ...cols.map((c) => t[c])]
        );
        const version = await bump();
        const [row] = await query('SELECT * FROM talents WHERE id = $1', [id]);
        await logAct('talent.add', id, t.name);
        return json({ talent: shapeTalent(row), version }, 201);
      }

      const id = parts[1];
      if (!id) return json({ error: 'Not found' }, 404);

      if (method === 'PATCH') {
        const t = clean(await req.json());
        const cols = Object.keys(t);
        if (!cols.length) return json({ error: 'Nothing to update' }, 400);
        const [old] = await query('SELECT * FROM talents WHERE id = $1 AND deleted_at IS NULL', [id]);
        if (!old) return json({ error: 'Talent not found' }, 404);
        const rows = await query(
          `UPDATE talents SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`,
          [id, ...cols.map((c) => t[c])]
        );
        const changed = cols.filter((c) => String(old[c] ?? '') !== String(t[c] ?? ''));
        if (changed.length) {
          await logAct('talent.edit', id, rows[0].name, {
            before: Object.fromEntries(changed.map((c) => [c, old[c] ?? null])),
            after: Object.fromEntries(changed.map((c) => [c, t[c] ?? null])),
          });
        }
        const version = await bump();
        return json({ talent: shapeTalent(rows[0]), version });
      }

      if (method === 'DELETE') {
        const rows = await query('UPDATE talents SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING id, name', [id]);
        if (!rows.length) return json({ error: 'Talent not found' }, 404);
        await logAct('talent.delete', id, rows[0].name);
        return json({ ok: true, version: await bump() });
      }
    }

    // ---- Campaign Management
    if (route === 'campaigns') return handleCampaigns({ req, parts, method, json, needEdit, actor, logAct });

    // ---- Shared lists and decks (anyone logged in can save)
    if (route === 'lists' || route === 'decks') {
      const table = route;
      const id = parts[1];
      if (table === 'decks' && method !== 'GET') { const d = needEdit(); if (d) return d; }
      if (method === 'PUT' && id) {
        const body = await req.json();
        const name = String(body.name || '').trim();
        if (!name) return json({ error: 'Name is required' }, 400);
        if (table === 'decks') {
          const [ex] = await query('SELECT data FROM decks WHERE id = $1', [id]);
          body.data = { ...(body.data || {}), createdBy: (ex && ex.data && ex.data.createdBy) || actor };
        }
        await pool().query(
          `INSERT INTO ${table} (id, name, data) VALUES ($1, $2, $3::jsonb)
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, data = EXCLUDED.data, updated_at = now()`,
          [id, name, JSON.stringify(body.data || {})]
        );
        return json({ ok: true, version: await bump() });
      }
      if (method === 'DELETE' && id) {
        await query(`DELETE FROM ${table} WHERE id = $1`, [id]);
        return json({ ok: true, version: await bump() });
      }
    }

    return json({ error: 'Not found' }, 404);
  } catch (e) {
    console.error(e);
    const msg = String(e.message || e);
    const userFacing = /must be|Invalid|required/.test(msg);
    return json({ error: userFacing ? msg : 'Server error' }, userFacing ? 400 : 500);
  }
};
