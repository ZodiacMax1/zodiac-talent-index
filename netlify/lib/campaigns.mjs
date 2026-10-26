// Campaign Management API. Called from api.mjs for anything under /api/campaigns.
import { pool, query, bump } from './db.mjs';
import { normLocation } from './places.mjs';
import { gql } from './monday.mjs';

const CURS = ['GBP', 'USD', 'AED'];
const FX_DEFAULT = { GBP: 1, USD: 0.75, AED: 0.2 };
// Stages on the monday Agency Sales Pipeline board (5092522587)
const MONDAY_STAGES = ['3 - Proposal Sent', '4 - Negotiation', '5 - Verbal Agreement', '6 - Contract Sent', '7 - Won'];
const DEALS_BOARD = '5092522587';
const DEAL_COLS = ['deal_stage', 'deal_owner', 'color_mm1ybd67', 'deal_value', 'numeric_mm12q2jt', 'dropdown_mm2ns2za', 'deal_expected_close_date', 'board_relation_mm2179a3', 'board_relation_mm128ss1'];

// Deals sitting at Proposal Sent (the point where the creator list is put together), newest start date first.
async function mondayProposals() {
  const ITEM = 'id name column_values(ids: $cols) { id text }';
  const qp = { rules: [{ column_id: 'deal_stage', compare_value: [0], operator: 'any_of' }] };
  const out = [];
  let data = await gql(`query($id:[ID!], $cols:[String!], $qp:ItemsQuery){ boards(ids:$id){ items_page(limit:100, query_params:$qp){ cursor items{ ${ITEM} } } } }`, { id: [DEALS_BOARD], cols: DEAL_COLS, qp });
  let page = data.boards[0]?.items_page;
  for (let g = 0; page && g < 10; g++) {
    out.push(...page.items);
    if (!page.cursor) break;
    data = await gql(`query($cols:[String!], $cursor:String!){ next_items_page(limit:100, cursor:$cursor){ cursor items{ ${ITEM} } } }`, { cols: DEAL_COLS, cursor: page.cursor });
    page = data.next_items_page;
  }
  return out.map((it) => {
    const t = (id) => (it.column_values.find((c) => c.id === id) || {}).text || '';
    const parts = it.name.split('//').map((x) => x.trim());
    return {
      id: it.id, name: it.name, status: '3 - Proposal Sent',
      client: t('board_relation_mm2179a3') || t('board_relation_mm128ss1') || (parts.length > 1 ? parts[0] : ''),
      owner: t('deal_owner'), cur: t('color_mm1ybd67'), value: Number(t('deal_value').replace(/,/g, '')) || 0,
      target: Number(t('numeric_mm12q2jt')) || null, market: t('dropdown_mm2ns2za'), start: t('deal_expected_close_date'),
    };
  }).sort((a, b) => (b.start || '').localeCompare(a.start || ''));
}
const APPROVED = ['Yes', 'Maybe', 'Not yet', 'Declined'];
const CT_STAGES = ['Shortlisted', 'Outreach', 'Negotiating', 'Confirmed'];
const CONTRACT = ['–', 'Sent', 'Signed'];
const INVOICE = ['Not invoiced', 'Invoiced', 'Part paid', 'Paid'];
const D_STAGES = ['Brief sent', 'In production', 'Draft received', 'Feedback', 'Approved', 'Live'];
const C_STATUS = ['Not started', 'Sent to client', 'Signed'];
const TERMS = ['Upfront', 'Net 30', 'Net 45', 'Net 60'];
const INS_KEYS = ['views', 'reach', 'impr', 'likes', 'comments', 'shares', 'saves'];
const MAX_FILE = 4 * 1024 * 1024;

const newId = (p) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const num = (v) => { const n = Number(String(v ?? '').replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : NaN; };
const calc = (base, m) => base / (1 - m / 100);
const r2 = (n) => Math.round(n * 100) / 100;
const dateOrNull = (v) => { if (v === '' || v == null) return null; const s = String(v).slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || isNaN(new Date(s + 'T00:00:00Z'))) throw new Error('Invalid date'); return s; };
const text = (v, max = 4000) => (v == null ? null : String(v).trim().slice(0, max) || null);

const fmtFol = (n) => (n >= 1e6 ? (n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'K' : String(n));
function platLine(t) {
  const out = [];
  if (t.ig_followers) out.push('IG ' + fmtFol(Number(t.ig_followers)));
  if (t.tt_followers) out.push('TT ' + fmtFol(Number(t.tt_followers)));
  if (t.yt_followers) out.push('YT ' + fmtFol(Number(t.yt_followers)));
  return out.join(' · ');
}
// "£6,500", "6.5k", "AED 30,000" in the talent profile's free-text rate field -> GBP
export function rateToGbp(rateText) {
  const s = String(rateText || '');
  const m = s.match(/(\d[\d,]*\.?\d*)\s*(k)?/i);
  if (!m) return 0;
  let n = Number(m[1].replace(/,/g, '')) * (m[2] ? 1000 : 1);
  if (!Number.isFinite(n)) return 0;
  if (/aed/i.test(s)) n *= FX_DEFAULT.AED; else if (/\$|usd/i.test(s)) n *= FX_DEFAULT.USD;
  return n;
}

// Keep the Talent Index "typical rate" in step with the latest rate entered on any campaign
export function rateText(n, cur) {
  const f = Math.round(n).toLocaleString('en-GB');
  return cur === 'GBP' ? '£' + f : cur === 'USD' ? '$' + f : f + ' ' + cur;
}
async function saveRateToIndex(logAct, tid, n, cur, campaignName) {
  if (!(n > 0)) return;
  const text = rateText(n, cur);
  const [t] = await query('SELECT name, rate FROM talents WHERE id = $1 AND deleted_at IS NULL', [tid]);
  if (!t || t.rate === text) return;
  await query('UPDATE talents SET rate = $2, updated_at = now() WHERE id = $1', [tid, text]);
  await logAct('talent.edit', tid, t.name, { before: { rate: t.rate }, after: { rate: text }, via: campaignName });
}

async function fxFor(cur) {
  const [r] = await query('SELECT value FROM app_settings WHERE key = $1', ['fx_' + cur]);
  const n = r ? Number(r.value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : FX_DEFAULT[cur];
}

function shapeCampaign(c) {
  return {
    id: c.id, name: c.name, client: c.client || '', owner: c.owner || '',
    start: c.start_date || '', end: c.end_date || '',
    cur: c.cur, fx: Number(c.fx), budget: Number(c.budget), target: Number(c.target_margin),
    markets: c.markets || '', platforms: c.platforms || '', brief: c.brief || '', deck: c.deck_name || '',
    mondayItemId: c.monday_item_id || '', stage: c.monday_stage,
    contactName: c.contact_name || '', contactRole: c.contact_role || '', contactEmail: c.contact_email || '', contactPhone: c.contact_phone || '',
    cStatus: c.c_status, cValue: Number(c.c_value), cSigned: c.c_signed || '', cTerms: c.c_terms, cUsage: c.c_usage || '',
    cFile: c.c_file_name ? { name: c.c_file_name, size: c.c_file_size, type: c.c_file_type, at: c.c_file_at } : null,
  };
}

const CAMP_SQL = `SELECT *, to_char(start_date,'YYYY-MM-DD') AS start_date, to_char(end_date,'YYYY-MM-DD') AS end_date, to_char(c_signed,'YYYY-MM-DD') AS c_signed FROM campaigns`;

async function loadFull(id) {
  const [c] = await query(`${CAMP_SQL} WHERE id = $1 AND deleted_at IS NULL`, [id]);
  if (!c) return null;
  const cts = await query(
    `SELECT ct.*, t.name, t.region, t.location, t.niche, t.ig_followers, t.tt_followers, t.yt_followers,
            t.manager_name, t.manager_email, t.manager_phone
       FROM campaign_talents ct JOIN talents t ON t.id = ct.talent_id
      WHERE ct.campaign_id = $1 ORDER BY ct.created_at, ct.id`, [id]);
  const ids = cts.map((x) => x.id);
  const dels = ids.length ? await query(
    `SELECT id, ct_id, name, platform, stage, to_char(recv_by,'YYYY-MM-DD') AS recv_by, to_char(recv_at,'YYYY-MM-DD') AS recv_at,
            to_char(live_by,'YYYY-MM-DD') AS live_by, to_char(live_at,'YYYY-MM-DD') AS live_at, links, insights, no_post
       FROM campaign_deliverables WHERE ct_id = ANY($1::text[]) ORDER BY created_at, id`, [ids]) : [];
  const coms = ids.length ? await query(`SELECT id, ct_id, author, body, link, tag, created_at FROM campaign_comments WHERE ct_id = ANY($1::text[]) ORDER BY created_at, id`, [ids]) : [];
  const quotes = ids.length ? await query(`SELECT id, ct_id, amount, note, author, created_at FROM campaign_quotes WHERE ct_id = ANY($1::text[]) ORDER BY created_at, id`, [ids]) : [];
  const links = await query(
    `SELECT s.code, s.name, s.recipient, s.created_by, s.created_at, s.views, s.last_viewed_at, s.revoked, s.talent_count,
            (SELECT count(DISTINCT v.visitor) FROM deck_views v WHERE v.code = s.code AND NOT v.is_bot)::int AS visitors
       FROM shared_decks s WHERE s.campaign_id = $1 ORDER BY s.created_at DESC`, [id]);
  const out = shapeCampaign(c);
  out.infl = cts.map((x) => ({
    id: x.id, tid: x.talent_id, name: x.name, plat: platLine(x), region: x.region || '', location: x.location || '', niche: x.niche || '',
    mgr: x.manager_name || '', email: x.manager_email || '', phone: x.manager_phone || '',
    approved: x.approved, stage: x.stage, initial: Number(x.initial), neg: x.neg == null ? null : Number(x.neg), margin: Number(x.margin), client: Number(x.client_rate),
    contract: x.contract, invoice: x.invoice, next: x.next_action || '', feedback: x.feedback || '', archived: x.archived || null,
    deliv: dels.filter((d) => d.ct_id === x.id).map((d) => ({
      id: d.id, name: d.name, plat: d.platform || '', stage: d.stage, recv: d.recv_by || '', recvAt: d.recv_at || '', live: d.live_by || '', liveAt: d.live_at || '',
      noPost: !!d.no_post, links: d.links || [], ins: { ...Object.fromEntries(INS_KEYS.map((k) => [k, ''])), ...(d.insights || {}) },
    })),
    comments: coms.filter((m) => m.ct_id === x.id).map((m) => ({ id: Number(m.id), by: m.author, at: m.created_at, t: m.body, link: m.link || '', tag: m.tag || '' })),
    quotes: quotes.filter((q) => q.ct_id === x.id).map((q) => ({ id: Number(q.id), a: q.amount, n: q.note || '', by: q.author || '', d: q.created_at })),
  }));
  out.links = links;
  return out;
}

async function loadCt(campaignId, ctId) {
  const [ct] = await query('SELECT * FROM campaign_talents WHERE id = $1 AND campaign_id = $2', [ctId, campaignId]);
  return ct || null;
}

export async function handleCampaigns(ctx) {
  const { req, parts, method, json, needEdit, actor, logAct } = ctx;
  // parts[0] === 'campaigns'
  const id = parts[1];
  const sub = parts[2];
  const body = async () => (await req.json().catch(() => ({})));
  const bad = (m) => json({ error: m }, 400);

  if (method !== 'GET') { const d = needEdit(); if (d) return d; }

  // ---- List
  if (!id && method === 'GET') {
    const rows = await query(`${CAMP_SQL} WHERE deleted_at IS NULL ORDER BY updated_at DESC`);
    const cts = await query(`SELECT campaign_id, approved, archived, initial, neg, client_rate, id FROM campaign_talents WHERE campaign_id = ANY($1::text[])`, [rows.map((r) => r.id)]);
    const dels = await query(`SELECT ct.campaign_id, d.stage FROM campaign_deliverables d JOIN campaign_talents ct ON ct.id = d.ct_id WHERE ct.campaign_id = ANY($1::text[]) AND ct.approved = 'Yes' AND ct.archived IS NULL`, [rows.map((r) => r.id)]);
    return json({
      campaigns: rows.map((c) => {
        const mine = cts.filter((x) => x.campaign_id === c.id);
        const sel = mine.filter((x) => x.approved === 'Yes' && !x.archived);
        const cost = sel.reduce((a, x) => a + Number(x.neg ?? x.initial), 0);
        const price = sel.reduce((a, x) => a + Number(x.client_rate), 0);
        const dd = dels.filter((d) => d.campaign_id === c.id);
        return { ...shapeCampaign(c), total: mine.length, selected: sel.length, cost, price, margin: price - cost, deliverables: dd.length, live: dd.filter((d) => d.stage === 'Live').length };
      }),
    });
  }

  // ---- Create
  if (!id && method === 'POST') {
    const b = await body();
    const name = text(b.name, 200);
    if (!name) return bad('Campaign name is required');
    const cur = CURS.includes(b.cur) ? b.cur : 'GBP';
    const cid = newId('c');
    await query(
      `INSERT INTO campaigns (id, name, client, owner, start_date, end_date, cur, fx, budget, target_margin, markets, platforms, brief, monday_item_id, monday_stage, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [cid, name, text(b.client, 200), text(b.owner, 100), dateOrNull(b.start), dateOrNull(b.end), cur, await fxFor(cur),
        Math.max(0, num(b.budget) || 0), Number.isFinite(num(b.target)) ? num(b.target) : 30, text(b.markets, 200), text(b.platforms, 200), text(b.brief), text(b.mondayItemId, 40),
        MONDAY_STAGES.includes(b.stage) ? b.stage : MONDAY_STAGES[0], actor]);
    await logAct('campaign.add', cid, name);
    return json({ campaign: await loadFull(cid) }, 201);
  }

  // ---- monday: Proposal Sent deals, and importing the ticked ones as campaigns
  if (id === 'monday-deals' && method === 'GET') {
    let deals;
    try { deals = await mondayProposals(); } catch (e) { return json({ error: 'Could not read monday: ' + e.message }, 502); }
    const have = await query(`SELECT monday_item_id FROM campaigns WHERE deleted_at IS NULL AND monday_item_id IS NOT NULL`);
    const done = new Set(have.map((r) => r.monday_item_id));
    return json({ deals: deals.map((d) => ({ ...d, imported: done.has(d.id) })) });
  }
  if (id === 'import-monday' && method === 'POST') {
    const b = await body();
    const ids = (Array.isArray(b.ids) ? b.ids : []).map(String).slice(0, 50);
    if (!ids.length) return bad('Nothing ticked');
    let deals;
    try { deals = await mondayProposals(); } catch (e) { return json({ error: 'Could not read monday: ' + e.message }, 502); }
    const have = await query(`SELECT monday_item_id FROM campaigns WHERE deleted_at IS NULL AND monday_item_id IS NOT NULL`);
    const done = new Set(have.map((r) => r.monday_item_id));
    const made = [];
    for (const d of deals.filter((x) => ids.includes(x.id) && !done.has(x.id))) {
      const cur = CURS.includes(d.cur) ? d.cur : 'GBP';
      const cid = newId('c');
      await query(
        `INSERT INTO campaigns (id, name, client, owner, cur, fx, budget, target_margin, markets, start_date, monday_item_id, monday_stage, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [cid, d.name.slice(0, 200), text(d.client, 200), text(d.owner.split(',')[0], 100), cur, await fxFor(cur), d.value, d.target && d.target <= 95 ? d.target : 30, text(d.market, 200), dateOrNull(d.start), d.id, MONDAY_STAGES[0], actor]);
      await logAct('campaign.add', cid, d.name);
      made.push(cid);
    }
    return json({ imported: made.length });
  }

  // ---- Every rate we have entered for a talent across campaigns
  if (id === 'talent-rates' && method === 'GET') {
    const rows = await query(
      `SELECT c.name AS campaign, c.client, c.cur, COALESCE(c.start_date, c.created_at::date) AS date,
              ct.initial, ct.neg, ct.approved, ct.archived
         FROM campaign_talents ct JOIN campaigns c ON c.id = ct.campaign_id
        WHERE ct.talent_id = $1 AND (ct.initial > 0 OR ct.neg > 0)
        ORDER BY COALESCE(c.start_date, c.created_at::date) DESC, c.created_at DESC`, [parts[2]]);
    return json({ rates: rows.map((r) => ({
      campaign: r.campaign, client: r.client, cur: r.cur, date: r.date,
      initial: Number(r.initial) || null, neg: r.neg == null ? null : Number(r.neg),
      outcome: r.archived ? 'Archived' + (r.archived.reason ? ' · ' + r.archived.reason : '') : r.approved === 'Yes' ? 'Selected' : r.approved === 'Declined' ? 'Declined' : 'Proposed',
    })) });
  }

  // ---- Talent profile contact details (manager) saved back to the Index
  if (id === 'talent-contact' && method === 'PATCH') {
    const tid = parts[2];
    const b = await body();
    const rows = await query(
      `UPDATE talents SET manager_name = COALESCE($2, manager_name), manager_email = COALESCE($3, manager_email), manager_phone = COALESCE($4, manager_phone), updated_at = now()
        WHERE id = $1 AND deleted_at IS NULL RETURNING id, name, manager_name, manager_email, manager_phone`,
      [tid, b.mgr == null ? null : String(b.mgr).trim().slice(0, 200), b.email == null ? null : String(b.email).trim().slice(0, 200), b.phone == null ? null : String(b.phone).trim().slice(0, 60)]);
    if (!rows.length) return json({ error: 'Talent not found' }, 404);
    await logAct('talent.edit', tid, rows[0].name, { after: { manager: rows[0].manager_name, email: rows[0].manager_email, phone: rows[0].manager_phone } });
    return json({ ok: true, version: await bump() });
  }

  // ---- Read the numbers from an insights screenshot
  if (id === 'read-insights' && method === 'POST') {
    const b = await body();
    const data = String(b.data || '').replace(/^data:[^,]*,/, '');
    const type = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(b.type) ? b.type : 'image/png';
    if (!data || data.length > 5_500_000) return bad('Upload a screenshot under 4MB');
    if (!process.env.ANTHROPIC_API_KEY) return bad('ANTHROPIC_API_KEY is not set in Netlify.');
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', ...(process.env.ANTHROPIC_WORKSPACE_ID ? { 'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID } : {}) },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5', max_tokens: 400,
        system: 'You read social media post insights screenshots (Instagram, TikTok, YouTube). Extract only numbers that are clearly visible. Convert abbreviations (1.2K = 1200, 3.4M = 3400000). Never guess a number that is not on screen. Reply with one JSON object and nothing else: {"views":number|null,"reach":number|null,"impr":number|null,"likes":number|null,"comments":number|null,"shares":number|null,"saves":number|null}. "impr" is impressions.',
        messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: type, data } }, { type: 'text', text: 'Extract the post insight numbers from this screenshot.' }] }],
      }),
    });
    if (!res.ok) return json({ error: res.status === 401 ? 'The Anthropic API key was rejected.' : 'Could not read that screenshot. Try again or enter the numbers.' }, 502);
    const j = await res.json();
    const raw = (j.content || []).map((x) => x.text || '').join('');
    let parsed = {};
    try { parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)); } catch { return json({ error: 'Could not read numbers from that image. Enter them manually.' }, 422); }
    const out = {};
    for (const k of INS_KEYS) { const n = parsed[k] == null || parsed[k] === '' ? NaN : Number(parsed[k]); out[k] = Number.isFinite(n) && n >= 0 ? Math.round(n) : null; }
    return json({ insights: out });
  }

  if (!id) return json({ error: 'Not found' }, 404);

  // ---- One campaign
  if (!sub && method === 'GET') {
    const c = await loadFull(id);
    return c ? json({ campaign: c }) : json({ error: 'Campaign not found' }, 404);
  }

  const [exists] = await query('SELECT id, name, cur, fx FROM campaigns WHERE id = $1 AND deleted_at IS NULL', [id]);
  if (!exists) return json({ error: 'Campaign not found' }, 404);
  const touch = () => query('UPDATE campaigns SET updated_at = now() WHERE id = $1', [id]);

  if (!sub && method === 'PATCH') {
    const b = await body();
    const sets = []; const vals = [id];
    const set = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
    const strMap = { name: ['name', 200], client: ['client', 200], owner: ['owner', 100], markets: ['markets', 200], platforms: ['platforms', 200], brief: ['brief', 8000], deck: ['deck_name', 200], mondayItemId: ['monday_item_id', 40],
      contactName: ['contact_name', 200], contactRole: ['contact_role', 200], contactEmail: ['contact_email', 200], contactPhone: ['contact_phone', 60], cUsage: ['c_usage', 8000] };
    for (const [k, [col, max]] of Object.entries(strMap)) if (k in b) { if (k === 'name' && !text(b.name)) return bad('Campaign name is required'); set(col, text(b[k], max)); }
    if ('start' in b) set('start_date', dateOrNull(b.start));
    if ('end' in b) set('end_date', dateOrNull(b.end));
    if ('cSigned' in b) set('c_signed', dateOrNull(b.cSigned));
    if ('stage' in b) { if (!MONDAY_STAGES.includes(b.stage)) return bad('Invalid stage'); set('monday_stage', b.stage); }
    if ('cStatus' in b) { if (!C_STATUS.includes(b.cStatus)) return bad('Invalid contract status'); set('c_status', b.cStatus); }
    if ('cTerms' in b) { if (!TERMS.includes(b.cTerms)) return bad('Invalid payment terms'); set('c_terms', b.cTerms); }
    for (const [k, col] of [['budget', 'budget'], ['cValue', 'c_value'], ['target', 'target_margin'], ['fx', 'fx']]) {
      if (k in b) { const n = num(b[k]); if (!Number.isFinite(n) || n < 0 || (k === 'fx' && n <= 0) || (k === 'target' && n >= 100)) return bad(`Invalid ${k}`); set(col, n); }
    }
    let convert = null;
    if ('cur' in b && b.cur !== exists.cur) {
      if (!CURS.includes(b.cur)) return bad('Invalid currency');
      const newFx = 'fx' in b ? num(b.fx) : await fxFor(b.cur);
      convert = Number(exists.fx) / newFx;
      set('cur', b.cur); if (!('fx' in b)) set('fx', newFx);
    }
    const client = await pool().connect();
    try {
      await client.query('BEGIN');
      if (convert) {
        // Switching currency re-expresses every amount at the campaign rate; GBP values stay the same
        if (!('budget' in b)) sets.push(`budget = round(budget * ${convert}, 2)`);
        if (!('cValue' in b)) sets.push(`c_value = round(c_value * ${convert}, 2)`);
        await client.query(`UPDATE campaign_talents SET initial = round(initial * $2, 2), neg = round(neg * $2, 2), client_rate = round(client_rate * $2, 2) WHERE campaign_id = $1`, [id, convert]);
      }
      if (sets.length) await client.query(`UPDATE campaigns SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, vals);
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
    await logAct('campaign.edit', id, exists.name, { fields: Object.keys(b) });
    return json({ campaign: await loadFull(id) });
  }

  if (!sub && method === 'DELETE') {
    await query('UPDATE campaigns SET deleted_at = now() WHERE id = $1', [id]);
    await logAct('campaign.delete', id, exists.name);
    return json({ ok: true });
  }

  // ---- Signed agreement (stored in the database)
  if (sub === 'contract') {
    if (method === 'GET') {
      const [f] = await query('SELECT c.c_file_name, c.c_file_type, f.data FROM campaigns c JOIN campaign_files f ON f.campaign_id = c.id WHERE c.id = $1', [id]);
      if (!f) return json({ error: 'No file' }, 404);
      return new Response(f.data, { headers: { 'content-type': f.c_file_type || 'application/octet-stream', 'content-disposition': `inline; filename="${String(f.c_file_name).replace(/[^\w.\- ]/g, '_')}"`, 'cache-control': 'no-store' } });
    }
    if (method === 'POST') {
      const b = await body();
      const data = String(b.data || '').replace(/^data:[^,]*,/, '');
      const buf = Buffer.from(data, 'base64');
      if (!buf.length) return bad('No file received');
      if (buf.length > MAX_FILE) return bad('That file is over 4MB. Compress it or upload a smaller PDF.');
      const name = text(b.name, 200) || 'agreement';
      await query('INSERT INTO campaign_files (campaign_id, data) VALUES ($1,$2) ON CONFLICT (campaign_id) DO UPDATE SET data = EXCLUDED.data', [id, buf]);
      await query('UPDATE campaigns SET c_file_name=$2, c_file_size=$3, c_file_type=$4, c_file_at=now(), updated_at=now() WHERE id=$1', [id, name, buf.length, text(b.type, 100) || 'application/octet-stream']);
      await logAct('campaign.contract', id, exists.name, { file: name });
      return json({ campaign: await loadFull(id) });
    }
    if (method === 'DELETE') {
      await query('DELETE FROM campaign_files WHERE campaign_id = $1', [id]);
      await query('UPDATE campaigns SET c_file_name=NULL, c_file_size=NULL, c_file_type=NULL, c_file_at=NULL, updated_at=now() WHERE id=$1', [id]);
      return json({ campaign: await loadFull(id) });
    }
  }

  // ---- Tie a shared client link to this campaign
  if (sub === 'links') {
    if (method === 'POST') {
      const b = await body();
      const r = await query('UPDATE shared_decks SET campaign_id = $1 WHERE code = $2 RETURNING code', [id, String(b.code || '')]);
      if (!r.length) return json({ error: 'Link not found' }, 404);
    } else if (method === 'DELETE') {
      await query('UPDATE shared_decks SET campaign_id = NULL WHERE code = $1 AND campaign_id = $2', [parts[3] || '', id]);
    }
    await touch();
    return json({ campaign: await loadFull(id) });
  }

  // ---- Influencers in the campaign
  if (sub === 'talents') {
    const ctId = parts[3];
    const what = parts[4];

    if (!ctId && method === 'POST') {
      const b = await body();
      let tid = b.talent_id ? String(b.talent_id) : null;
      if (!tid && b.new) {
        // A creator who isn't in the Index yet: add the profile, then add them here
        const n = b.new;
        const name = text(n.name, 200);
        if (!name) return bad('Name is required');
        const [dupe] = await query('SELECT id FROM talents WHERE lower(name) = lower($1) AND deleted_at IS NULL', [name]);
        if (dupe) tid = dupe.id;
        else {
          tid = newId('t');
          const loc = normLocation(text(n.location, 120) || text(n.region, 60));
          const fol = Math.max(0, Math.round(num(n.followers) || 0));
          const plat = n.platform === 'TikTok' ? 'tt' : n.platform === 'YouTube' ? 'yt' : 'ig';
          const rate = Number.isFinite(num(n.rate)) && num(n.rate) > 0 ? '£' + Math.round(num(n.rate)).toLocaleString('en-GB') : null;
          await query(
            `INSERT INTO talents (id, name, exclusivity, region, location, niche, ig_followers, tt_followers, yt_followers, rate, manager_name, manager_email, manager_phone)
             VALUES ($1,$2,'Non-Exclusive',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [tid, name, loc.region, loc.location, text(n.niche, 100) || 'General', plat === 'ig' ? fol : null, plat === 'tt' ? fol : null, plat === 'yt' ? fol : null, rate, text(n.mgr, 200), text(n.email, 200), text(n.phone, 60)]);
          await logAct('talent.add', tid, name, { via: 'campaign' });
          await bump();
        }
      }
      if (!tid) return bad('Choose a creator');
      const [t] = await query('SELECT id, name, rate FROM talents WHERE id = $1 AND deleted_at IS NULL', [tid]);
      if (!t) return json({ error: 'Talent not found' }, 404);
      const [dup] = await query('SELECT id FROM campaign_talents WHERE campaign_id = $1 AND talent_id = $2', [id, tid]);
      if (dup) return json({ campaign: await loadFull(id), note: 'Already in this campaign' });
      const [camp] = await query('SELECT fx, target_margin FROM campaigns WHERE id = $1', [id]);
      const initial = r2(rateToGbp(t.rate) / Number(camp.fx));
      const margin = Number(camp.target_margin);
      await query('INSERT INTO campaign_talents (id, campaign_id, talent_id, initial, margin, client_rate) VALUES ($1,$2,$3,$4,$5,$6)', [newId('ct'), id, tid, initial, margin, r2(calc(initial, margin))]);
      await touch();
      await logAct('campaign.talent.add', id, exists.name, { talent: t.name });
      return json({ campaign: await loadFull(id) }, 201);
    }

    if (!ctId) return json({ error: 'Not found' }, 404);
    const ct = await loadCt(id, ctId);
    if (!ct) return json({ error: 'Not found in this campaign' }, 404);

    if (!what && method === 'PATCH') {
      const b = await body();
      const upd = {};
      if ('approved' in b) { if (!APPROVED.includes(b.approved)) return bad('Invalid value'); upd.approved = b.approved; }
      if ('stage' in b) { if (!CT_STAGES.includes(b.stage)) return bad('Invalid stage'); upd.stage = b.stage; }
      if ('contract' in b) { if (!CONTRACT.includes(b.contract)) return bad('Invalid contract status'); upd.contract = b.contract; }
      if ('invoice' in b) { if (!INVOICE.includes(b.invoice)) return bad('Invalid invoice status'); upd.invoice = b.invoice; }
      if ('next' in b) upd.next_action = text(b.next, 500);
      if ('feedback' in b) upd.feedback = text(b.feedback, 2000);
      if ('archived' in b) {
        if (b.archived === null) upd.archived = null;
        else upd.archived = JSON.stringify({ reason: text(b.archived.reason, 60) || 'Other', note: text(b.archived.note, 500) || '', date: new Date().toISOString().slice(0, 10) });
      }
      // Money: initial / negotiated / margin / client rate keep each other in step
      let initial = Number(ct.initial), neg = ct.neg == null ? null : Number(ct.neg), margin = Number(ct.margin), client = Number(ct.client_rate);
      const base = () => neg || initial;
      let money = false;
      if ('initial' in b) { const n = num(b.initial); if (!(n > 0)) return bad('Initial rate must be above 0'); initial = n; client = calc(base(), margin); money = true; }
      if ('neg' in b) { const n = num(b.neg); if (b.neg === null || b.neg === '' ) neg = null; else if (n > 0) neg = n; else return bad('Negotiated rate must be above 0'); client = calc(base(), margin); money = true; }
      if ('margin' in b) { const n = num(b.margin); if (!(n >= 0 && n < 100)) return bad('Margin must be between 0 and 99.9'); margin = n; client = calc(base(), n); money = true; }
      if ('client_rate' in b) { const n = num(b.client_rate); if (!(n > base())) return bad('Client rate must be above the creator rate'); client = n; margin = (1 - base() / n) * 100; money = true; }
      if (money) { upd.initial = r2(initial); upd.neg = neg == null ? null : r2(neg); upd.margin = Math.round(margin * 100) / 100; upd.client_rate = r2(client); }
      const cols = Object.keys(upd);
      if (cols.length) {
        await query(`UPDATE campaign_talents SET ${cols.map((c, i) => `${c} = $${i + 3}${c === 'archived' ? '::jsonb' : ''}`).join(', ')} WHERE id = $1 AND campaign_id = $2`, [ctId, id, ...cols.map((c) => upd[c])]);
        await touch();
        if ('archived' in b || 'approved' in b || 'stage' in b) {
          const [t] = await query('SELECT name FROM talents WHERE id = $1', [ct.talent_id]);
          await logAct('campaign.talent.edit', id, exists.name, { talent: t && t.name, fields: cols });
        }
      }
      if (money && ('initial' in b || 'neg' in b)) {
        const [cp] = await query('SELECT cur FROM campaigns WHERE id = $1', [id]);
        await saveRateToIndex(logAct, ct.talent_id, neg || initial, cp.cur, exists.name);
        await bump();
      }
      return json({ campaign: await loadFull(id) });
    }

    if (!what && method === 'DELETE') {
      await query('DELETE FROM campaign_talents WHERE id = $1', [ctId]);
      await touch();
      return json({ campaign: await loadFull(id) });
    }

    if (what === 'comments' && method === 'POST') {
      const b = await body();
      const t = text(b.body, 4000);
      if (!t) return bad('Write a comment first');
      await query('INSERT INTO campaign_comments (ct_id, author, body, link, tag) VALUES ($1,$2,$3,$4,$5)', [ctId, actor, t, text(b.link, 500), text(b.tag, 120)]);
      await touch();
      return json({ campaign: await loadFull(id) });
    }

    if (what === 'quotes' && method === 'POST') {
      const b = await body();
      const a = text(b.amount, 60);
      if (!a) return bad('Enter the quote');
      await query('INSERT INTO campaign_quotes (ct_id, amount, note, author) VALUES ($1,$2,$3,$4)', [ctId, a, text(b.note, 200) || 'Logged', actor]);
      await touch();
      return json({ campaign: await loadFull(id) });
    }

    if (what === 'deliverables') {
      const did = parts[5];
      if (!did && method === 'POST') {
        const b = await body();
        const name = text(b.name, 200);
        if (!name) return bad('Name the deliverable');
        await query('INSERT INTO campaign_deliverables (id, ct_id, name, platform, recv_by, live_by, no_post) VALUES ($1,$2,$3,$4,$5,$6,$7)', [newId('d'), ctId, name, text(b.platform, 60), dateOrNull(b.recv), b.noPost ? null : dateOrNull(b.live), !!b.noPost]);
        await touch();
        return json({ campaign: await loadFull(id) }, 201);
      }
      const [d] = did ? await query('SELECT * FROM campaign_deliverables WHERE id = $1 AND ct_id = $2', [did, ctId]) : [];
      if (!d) return json({ error: 'Deliverable not found' }, 404);
      if (method === 'DELETE') {
        await query('DELETE FROM campaign_deliverables WHERE id = $1', [did]);
        await touch();
        return json({ campaign: await loadFull(id) });
      }
      if (method === 'PATCH') {
        const b = await body();
        const upd = {};
        if ('name' in b) { const n = text(b.name, 200); if (!n) return bad('Name the deliverable'); upd.name = n; }
        if ('stage' in b) { if (!D_STAGES.includes(b.stage)) return bad('Invalid stage'); upd.stage = b.stage; }
        for (const [k, col] of [['recv', 'recv_by'], ['recvAt', 'recv_at'], ['live', 'live_by'], ['liveAt', 'live_at']]) if (k in b) upd[col] = dateOrNull(b[k]);
        if ('noPost' in b) { upd.no_post = !!b.noPost; if (b.noPost) { upd.live_by = null; upd.live_at = null; } }
        if ('links' in b) {
          if (!Array.isArray(b.links)) return bad('Invalid links');
          upd.links = JSON.stringify(b.links.slice(0, 30).map((l) => ({ l: text(l.l, 120) || 'Link', u: text(l.u, 800) || '' })).filter((l) => /^https?:\/\//i.test(l.u)));
        }
        if ('ins' in b) {
          const o = {};
          for (const k of INS_KEYS) { const v = b.ins && b.ins[k]; o[k] = v === '' || v == null ? '' : Number.isFinite(num(v)) ? num(v) : ''; }
          upd.insights = JSON.stringify(o);
        }
        const cols = Object.keys(upd);
        if (cols.length) {
          await query(`UPDATE campaign_deliverables SET ${cols.map((c, i) => `${c} = $${i + 3}${c === 'links' || c === 'insights' ? '::jsonb' : ''}`).join(', ')} WHERE id = $1 AND ct_id = $2`, [did, ctId, ...cols.map((c) => upd[c])]);
          await touch();
        }
        return json({ campaign: await loadFull(id) });
      }
    }
  }

  return json({ error: 'Not found' }, 404);
}
