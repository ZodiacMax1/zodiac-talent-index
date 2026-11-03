// Payments: client invoices per campaign, creator invoices per influencer, and the rule that ties them:
// a creator is only paid for a deliverable once the client has paid for it.
import { query } from './db.mjs';

const MAX_FILE = 4 * 1024 * 1024;
export const BILLING = ['completion', 'quarterly', 'monthly', 'custom'];
export const CR_STATUS = ['Not due', 'Invoiced', 'Paid'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const newId = (p) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const today = () => new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10);
const num = (v) => { const n = Number(String(v ?? '').replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : NaN; };
const text = (v, max = 4000) => (v == null ? null : String(v).trim().slice(0, max) || null);
const dateOrNull = (v) => { if (v === '' || v == null) return null; const s = String(v).slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || isNaN(new Date(s + 'T00:00:00Z'))) throw new Error('Invalid date'); return s; };
const r2 = (n) => Math.round(n * 100) / 100;
const ymd = (d) => d.toISOString().slice(0, 10);

const CINV_SQL = `SELECT id, campaign_id, label, to_char(period_start,'YYYY-MM-DD') AS period_start, to_char(period_end,'YYYY-MM-DD') AS period_end, amount,
  to_char(invoiced_at,'YYYY-MM-DD') AS invoiced_at, to_char(paid_at,'YYYY-MM-DD') AS paid_at, file_name, file_type, file_size FROM client_invoices`;
const CRINV_SQL = `SELECT id, ct_id, number, to_char(inv_date,'YYYY-MM-DD') AS inv_date, amount, to_char(paid_at,'YYYY-MM-DD') AS paid_at, file_name, file_type, file_size, created_by, created_at FROM creator_invoices`;

// The date a deliverable counts from: go-live, or the filming date for filming days
const ddate = (d) => (d.no_post ? d.recv_by : d.live_by) || null;
// Which client invoice covers a deliverable: the one whose period holds its date, else one with no period (covers everything)
export function coverFor(invs, date) {
  if (date) { const p = invs.find((v) => v.period_start && v.period_end && date >= v.period_start && date <= v.period_end); if (p) return p; }
  return invs.find((v) => !v.period_start && !v.period_end) || null;
}
export const clientStatus = (inv) => (!inv ? 'Not due' : inv.paid_at ? 'Paid' : inv.invoiced_at ? 'Invoiced' : 'Not due');
const posted = (d) => d.stage === 'Live' || (d.no_post && d.recv_by && d.recv_by <= today());

export async function loadPayments(campaignId, ctIds) {
  const cinv = (await query(`${CINV_SQL} WHERE campaign_id = $1 ORDER BY period_start NULLS LAST, created_at, id`, [campaignId]))
    .map((v) => ({ id: v.id, label: v.label, start: v.period_start || '', end: v.period_end || '', amount: Number(v.amount), invAt: v.invoiced_at || '', paidAt: v.paid_at || '',
      file: v.file_name ? { name: v.file_name, type: v.file_type || '', size: v.file_size || 0 } : null }));
  const cr = ctIds.length ? await query(`${CRINV_SQL} WHERE ct_id = ANY($1::text[]) ORDER BY created_at, id`, [ctIds]) : [];
  const crinv = cr.map((v) => ({ id: v.id, ct: v.ct_id, number: v.number || '', date: v.inv_date || '', amount: Number(v.amount), paidAt: v.paid_at || '', by: v.created_by || '',
    file: v.file_name ? { name: v.file_name, type: v.file_type || '', size: v.file_size || 0 } : null }));
  return { cinv, crinv };
}

// Keep each influencer's old Invoicing field (used by the sales reports) in step with the client invoices
export async function syncCtInvoice(campaignId) {
  const invs = await query(`${CINV_SQL} WHERE campaign_id = $1`, [campaignId]);
  // Until an invoice has actually been issued, leave any statuses set by hand (older campaigns) alone
  if (!invs.some((v) => v.invoiced_at || v.paid_at)) return;
  const cts = await query(`SELECT id FROM campaign_talents WHERE campaign_id = $1 AND approved = 'Yes' AND archived IS NULL`, [campaignId]);
  const dels = await query(`SELECT d.ct_id, d.no_post, to_char(d.recv_by,'YYYY-MM-DD') AS recv_by, to_char(d.live_by,'YYYY-MM-DD') AS live_by FROM campaign_deliverables d JOIN campaign_talents ct ON ct.id = d.ct_id WHERE ct.campaign_id = $1`, [campaignId]);
  for (const ct of cts) {
    const mine = dels.filter((d) => d.ct_id === ct.id);
    const covs = mine.map((d) => coverFor(invs, ddate(d)));
    const st = covs.map(clientStatus);
    let inv = 'Not invoiced';
    if (st.length && st.every((x) => x === 'Paid')) inv = 'Paid';
    else if (st.some((x) => x === 'Paid')) inv = 'Part paid';
    else if (st.some((x) => x === 'Invoiced')) inv = 'Invoiced';
    const dates = covs.filter((v) => v && v.invoiced_at).map((v) => v.invoiced_at).sort();
    await query(`UPDATE campaign_talents SET invoice = $2, invoiced_at = $3 WHERE id = $1`, [ct.id, inv, inv === 'Not invoiced' ? null : (dates[0] || today())]);
  }
}

// Client status for a set of deliverable ids, and whether each is posted
async function delsWithClient(campaignId, ids) {
  const invs = await query(`${CINV_SQL} WHERE campaign_id = $1`, [campaignId]);
  const ds = await query(`SELECT d.id, d.name, d.stage, d.no_post, to_char(d.recv_by,'YYYY-MM-DD') AS recv_by, to_char(d.live_by,'YYYY-MM-DD') AS live_by
    FROM campaign_deliverables d JOIN campaign_talents ct ON ct.id = d.ct_id WHERE ct.campaign_id = $1 AND d.id = ANY($2::text[])`, [campaignId, ids]);
  return ds.map((d) => ({ ...d, client: clientStatus(coverFor(invs, ddate(d))), posted: posted(d) }));
}
export async function payBlock(campaignId, ids) {
  const ds = await delsWithClient(campaignId, ids);
  const notPosted = ds.filter((d) => !d.posted).map((d) => d.name);
  const unpaid = ds.filter((d) => d.client !== 'Paid').map((d) => d.name);
  if (notPosted.length) return `Not posted yet: ${notPosted.join(', ')}. Creators are paid once the content is live.`;
  if (unpaid.length) return `The client hasn't paid for ${unpaid.join(', ')} yet. Creators are paid once the client has paid.`;
  return null;
}

// Rows for quarterly / monthly billing between the campaign dates, budget split evenly (last row takes the rounding)
function billingRows(kind, start, end, budget) {
  const s = new Date((start || `${today().slice(0, 4)}-01-01`) + 'T00:00:00Z');
  const e = new Date((end || start || `${today().slice(0, 4)}-12-31`) + 'T00:00:00Z');
  if (e < s) return [];
  const rows = [];
  if (kind === 'quarterly') {
    let y = s.getUTCFullYear(), q = Math.floor(s.getUTCMonth() / 3);
    while (rows.length < 40) {
      const ps = new Date(Date.UTC(y, q * 3, 1)), pe = new Date(Date.UTC(y, q * 3 + 3, 0));
      if (ps > e) break;
      rows.push({ label: `Q${q + 1} ${y}`, start: ymd(ps), end: ymd(pe) });
      q++; if (q > 3) { q = 0; y++; }
    }
  } else {
    let y = s.getUTCFullYear(), m = s.getUTCMonth();
    while (rows.length < 60) {
      const ps = new Date(Date.UTC(y, m, 1)), pe = new Date(Date.UTC(y, m + 1, 0));
      if (ps > e) break;
      rows.push({ label: `${MON[m]} ${y}`, start: ymd(ps), end: ymd(pe) });
      m++; if (m > 11) { m = 0; y++; }
    }
  }
  const each = rows.length ? Math.floor((budget / rows.length) * 100) / 100 : 0;
  rows.forEach((r, k) => { r.amount = k === rows.length - 1 ? r2(budget - each * (rows.length - 1)) : each; });
  return rows;
}

// Switch how the client is billed. Refused once any invoice has been issued, so nothing sent gets lost.
export async function setBilling(campaignId, kind) {
  if (!BILLING.includes(kind)) return 'Invalid billing';
  const [c] = await query(`SELECT budget, to_char(start_date,'YYYY-MM-DD') AS s, to_char(end_date,'YYYY-MM-DD') AS e FROM campaigns WHERE id = $1`, [campaignId]);
  const issued = await query('SELECT 1 FROM client_invoices WHERE campaign_id = $1 AND (invoiced_at IS NOT NULL OR paid_at IS NOT NULL OR data IS NOT NULL) LIMIT 1', [campaignId]);
  if (issued.length) return 'An invoice has already been issued on this campaign. Delete it first to change how the client is billed.';
  await query('DELETE FROM client_invoices WHERE campaign_id = $1', [campaignId]);
  await query('UPDATE campaigns SET billing = $2, updated_at = now() WHERE id = $1', [campaignId, kind]);
  const budget = Number(c.budget) || 0;
  if (kind === 'completion') {
    await query('INSERT INTO client_invoices (id, campaign_id, label, amount) VALUES ($1,$2,$3,$4)', [newId('ci'), campaignId, 'Final invoice', budget]);
  } else if (kind === 'quarterly' || kind === 'monthly') {
    for (const r of billingRows(kind, c.s, c.e, budget))
      await query('INSERT INTO client_invoices (id, campaign_id, label, period_start, period_end, amount) VALUES ($1,$2,$3,$4,$5,$6)', [newId('ci'), campaignId, r.label, r.start, r.end, r.amount]);
  }
  return null;
}

// Every campaign starts on "one invoice on completion" the first time its payments are opened
export async function ensureBilling(campaignId) {
  const [c] = await query('SELECT billing, budget FROM campaigns WHERE id = $1', [campaignId]);
  const n = await query('SELECT 1 FROM client_invoices WHERE campaign_id = $1 LIMIT 1', [campaignId]);
  if (n.length || !c || c.billing !== 'completion') return;
  // Older campaigns: carry over what was set by hand on each creator, when the whole campaign was invoiced / paid
  const sel = await query(`SELECT invoice, to_char(invoiced_at,'YYYY-MM-DD') AS d FROM campaign_talents WHERE campaign_id = $1 AND approved = 'Yes' AND archived IS NULL`, [campaignId]);
  const allPaid = sel.length && sel.every((x) => x.invoice === 'Paid');
  const allInv = sel.length && sel.every((x) => x.invoice !== 'Not invoiced');
  const first = sel.map((x) => x.d).filter(Boolean).sort()[0] || null;
  await query('INSERT INTO client_invoices (id, campaign_id, label, amount, invoiced_at, paid_at) VALUES ($1,$2,$3,$4,$5,$6)',
    [newId('ci'), campaignId, 'Final invoice', Number(c.budget) || 0, allInv ? (first || today()) : null, allPaid ? (first || today()) : null]);
}

function fileFrom(b) {
  if (!b || !b.data) return null;
  const buf = Buffer.from(String(b.data).replace(/^data:[^,]*,/, ''), 'base64');
  if (!buf.length) throw Object.assign(new Error('No file received'), { status: 400 });
  if (buf.length > MAX_FILE) throw Object.assign(new Error('That file is over 4MB. Compress it or upload a smaller PDF.'), { status: 400 });
  return { buf, name: text(b.name, 200) || 'invoice.pdf', type: text(b.type, 100) || 'application/pdf' };
}
const fileResponse = (f) => new Response(f.data, { headers: { 'content-type': f.file_type || 'application/octet-stream', 'content-disposition': `inline; filename="${String(f.file_name || 'invoice').replace(/[^\w.\- ]/g, '_')}"`, 'cache-control': 'no-store' } });

// /api/campaigns/:id/cinv[/:iid[/file]]
export async function handleClientInvoices({ id, parts, method, body, json, bad, logAct, campName }) {
  const iid = parts[3];
  if (method === 'GET' && iid && parts[4] === 'file') {
    const [f] = await query('SELECT file_name, file_type, data FROM client_invoices WHERE id = $1 AND campaign_id = $2 AND data IS NOT NULL', [iid, id]);
    return f ? fileResponse(f) : json({ error: 'No file' }, 404);
  }
  if (method === 'POST' && !iid) {
    const b = await body();
    const amount = num(b.amount);
    await query('INSERT INTO client_invoices (id, campaign_id, label, period_start, period_end, amount) VALUES ($1,$2,$3,$4,$5,$6)',
      [newId('ci'), id, text(b.label, 80) || 'Invoice', dateOrNull(b.start), dateOrNull(b.end), Number.isFinite(amount) && amount >= 0 ? amount : 0]);
    await query("UPDATE campaigns SET billing = 'custom' WHERE id = $1 AND billing <> 'custom'", [id]);
    return null;
  }
  const [inv] = iid ? await query('SELECT id, label FROM client_invoices WHERE id = $1 AND campaign_id = $2', [iid, id]) : [];
  if (!inv) return json({ error: 'Invoice not found' }, 404);
  if (method === 'DELETE') {
    await query('DELETE FROM client_invoices WHERE id = $1', [iid]);
    await syncCtInvoice(id);
    return null;
  }
  if (method === 'PATCH') {
    const b = await body();
    const sets = []; const vals = [iid];
    const set = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
    if ('label' in b) set('label', text(b.label, 80) || inv.label);
    if ('amount' in b) { const n = num(b.amount); if (!Number.isFinite(n) || n < 0) return bad('Invalid amount'); set('amount', n); }
    if ('start' in b) set('period_start', dateOrNull(b.start));
    if ('end' in b) set('period_end', dateOrNull(b.end));
    if ('invAt' in b) set('invoiced_at', dateOrNull(b.invAt));
    if ('paidAt' in b) set('paid_at', dateOrNull(b.paidAt));
    if ('file' in b) {
      if (b.file === null) { set('data', null); set('file_name', null); set('file_type', null); set('file_size', null); }
      else { const f = fileFrom(b.file); if (f) { set('data', f.buf); set('file_name', f.name); set('file_type', f.type); set('file_size', f.buf.length); } }
    }
    if (sets.length) await query(`UPDATE client_invoices SET ${sets.join(', ')} WHERE id = $1`, vals);
    // Un-paying an invoice that creators were already paid against is allowed, but logged
    await syncCtInvoice(id);
    await logAct('campaign.cinv', id, campName, { invoice: inv.label, fields: Object.keys(b).filter((k) => k !== 'file').concat('file' in b ? ['file'] : []) });
    return null;
  }
  return json({ error: 'Not found' }, 404);
}

// /api/campaigns/:id/talents/:ct/crinv[/:iid[/file]]
export async function handleCreatorInvoices({ id, ctId, parts, method, body, json, bad, actor, logAct, campName }) {
  const iid = parts[5];
  if (method === 'GET' && iid && parts[6] === 'file') {
    const [f] = await query('SELECT file_name, file_type, data FROM creator_invoices WHERE id = $1 AND ct_id = $2 AND data IS NOT NULL', [iid, ctId]);
    return f ? fileResponse(f) : json({ error: 'No file' }, 404);
  }
  if (method === 'POST' && !iid) {
    const b = await body();
    const dids = (Array.isArray(b.dids) ? b.dids : []).map(String).slice(0, 100);
    if (!dids.length) return bad('Tick at least one deliverable the invoice covers');
    const own = await query('SELECT id, cr_status FROM campaign_deliverables WHERE ct_id = $1 AND id = ANY($2::text[])', [ctId, dids]);
    if (own.length !== dids.length) return bad('One of those deliverables is not on this creator');
    if (own.some((d) => d.cr_status === 'Paid')) return bad('One of those deliverables has already been paid');
    const f = fileFrom(b.file);
    const amount = num(b.amount);
    const nid = newId('cr');
    await query('INSERT INTO creator_invoices (id, ct_id, number, inv_date, amount, file_name, file_type, file_size, data, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [nid, ctId, text(b.number, 60), dateOrNull(b.date), Number.isFinite(amount) && amount >= 0 ? amount : 0, f && f.name, f && f.type, f && f.buf.length, f && f.buf, actor]);
    await query("UPDATE campaign_deliverables SET cr_invoice = $2, cr_status = 'Invoiced' WHERE id = ANY($1::text[])", [dids, nid]);
    await logAct('campaign.crinv', id, campName, { number: text(b.number, 60), deliverables: dids.length });
    return null;
  }
  const [inv] = iid ? await query('SELECT id, number FROM creator_invoices WHERE id = $1 AND ct_id = $2', [iid, ctId]) : [];
  if (!inv) return json({ error: 'Invoice not found' }, 404);
  const covered = (await query('SELECT id FROM campaign_deliverables WHERE cr_invoice = $1', [iid])).map((d) => d.id);
  if (method === 'DELETE') {
    await query("UPDATE campaign_deliverables SET cr_invoice = NULL, cr_status = 'Not due', cr_paid_at = NULL WHERE cr_invoice = $1", [iid]);
    await query('DELETE FROM creator_invoices WHERE id = $1', [iid]);
    return null;
  }
  if (method === 'PATCH') {
    const b = await body();
    if ('paidAt' in b) {
      const pd = dateOrNull(b.paidAt);
      if (pd) { const why = await payBlock(id, covered); if (why) return bad(why); }
      await query('UPDATE creator_invoices SET paid_at = $2 WHERE id = $1', [iid, pd]);
      await query(`UPDATE campaign_deliverables SET cr_status = $2, cr_paid_at = $3 WHERE cr_invoice = $1`, [iid, pd ? 'Paid' : 'Invoiced', pd]);
    }
    const sets = []; const vals = [iid];
    const set = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
    if ('number' in b) set('number', text(b.number, 60));
    if ('date' in b) set('inv_date', dateOrNull(b.date));
    if ('amount' in b) { const n = num(b.amount); if (!Number.isFinite(n) || n < 0) return bad('Invalid amount'); set('amount', n); }
    if (sets.length) await query(`UPDATE creator_invoices SET ${sets.join(', ')} WHERE id = $1`, vals);
    await logAct('campaign.crinv', id, campName, { number: inv.number, fields: Object.keys(b) });
    return null;
  }
  return json({ error: 'Not found' }, 404);
}
