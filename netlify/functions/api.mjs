import { roleForPassword, issueToken, roleFromRequest } from '../lib/auth.mjs';
import { pool, query, bump, currentVersion } from '../lib/db.mjs';

export const config = { path: '/api/*' };

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

const TALENT_FIELDS = [
  'name', 'exclusivity', 'region', 'niche', 'gender',
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
  return out;
}

const newId = (p) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

function shapeTalent(r) {
  const ig = r.ig_followers == null ? null : Number(r.ig_followers);
  const tt = r.tt_followers == null ? null : Number(r.tt_followers);
  const yt = r.yt_followers == null ? null : Number(r.yt_followers);
  return {
    id: r.id, name: r.name, exclusivity: r.exclusivity, region: r.region, niche: r.niche,
    gender: r.gender, ig_followers: ig, tt_followers: tt, yt_followers: yt,
    total_followers: (ig || 0) + (tt || 0) + (yt || 0),
    rate: r.rate, instagram: r.instagram, tiktok: r.tiktok, youtube: r.youtube,
    photo: r.photo, public_bio: r.public_bio,
  };
}

export default async (req) => {
  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  const method = req.method;
  const route = parts[0] || '';

  try {
    // ---- Login (no token needed)
    if (route === 'login' && method === 'POST') {
      const { password } = await req.json().catch(() => ({}));
      const role = roleForPassword(password);
      if (!role) return json({ error: 'Incorrect password' }, 401);
      return json({ token: issueToken(role), role });
    }

    const role = roleFromRequest(req);
    if (!role) return json({ error: 'Unauthorised' }, 401);
    const canEdit = role === 'edit';
    const needEdit = () => (canEdit ? null : json({ error: 'Edit password required' }, 403));

    // ---- Lightweight poll
    if (route === 'version' && method === 'GET') {
      return json({ version: await currentVersion(), role });
    }

    // ---- Full state
    if (route === 'state' && method === 'GET') {
      const [talents, lists, decks, version] = await Promise.all([
        query('SELECT * FROM talents ORDER BY lower(name)'),
        query('SELECT id, name, data, updated_at FROM lists ORDER BY updated_at DESC'),
        query('SELECT id, name, data, updated_at FROM decks ORDER BY updated_at DESC'),
        currentVersion(),
      ]);
      return json({ version, role, talents: talents.map(shapeTalent), lists, decks });
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
        return json({ talent: shapeTalent(row), version }, 201);
      }

      const id = parts[1];
      if (!id) return json({ error: 'Not found' }, 404);

      if (method === 'PATCH') {
        const t = clean(await req.json());
        const cols = Object.keys(t);
        if (!cols.length) return json({ error: 'Nothing to update' }, 400);
        const rows = await query(
          `UPDATE talents SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`,
          [id, ...cols.map((c) => t[c])]
        );
        if (!rows.length) return json({ error: 'Talent not found' }, 404);
        const version = await bump();
        return json({ talent: shapeTalent(rows[0]), version });
      }

      if (method === 'DELETE') {
        const rows = await query('DELETE FROM talents WHERE id = $1 RETURNING id', [id]);
        if (!rows.length) return json({ error: 'Talent not found' }, 404);
        return json({ ok: true, version: await bump() });
      }
    }

    // ---- Shared lists and decks (anyone logged in can save)
    if (route === 'lists' || route === 'decks') {
      const table = route;
      const id = parts[1];
      if (method === 'PUT' && id) {
        const body = await req.json();
        const name = String(body.name || '').trim();
        if (!name) return json({ error: 'Name is required' }, 400);
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
