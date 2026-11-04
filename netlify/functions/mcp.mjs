// Zodiac OS connector for Claude (MCP over streamable HTTP, JSON responses).
// URL: https://<site>/mcp/<personal key>. Read-only, plus one write: shortlist a creator on a campaign (with a confirm step).
// Every tool call goes through the normal /api handler as that person, so roles, logging and data shaping are identical to the app.
import api from './api.mjs';
import { issueToken } from '../lib/auth.mjs';
import { query } from '../lib/db.mjs';
import { createHash } from 'node:crypto';

export const config = { path: ['/mcp', '/mcp/*'] };

const FX = { GBP: 1, USD: 0.75, AED: 0.2, EUR: 0.85, SAR: 0.2 };
const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const keyHash = (k) => createHash('sha256').update(`${process.env.AUTH_SECRET || ''}|claude|${k}`).digest('hex');
const r0 = (n) => Math.round(Number(n) || 0);
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const pct = (m, b) => (b ? Math.round((m / b) * 1000) / 10 : null);
const low = (s) => String(s || '').toLowerCase();

const out = (data, status = 200, extra = {}) => new Response(data == null ? null : JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra },
});

async function who(key) {
  if (!/^zos_[A-Za-z0-9]{20,80}$/.test(key || '')) return null;
  const [k] = await query(
    `SELECT k.id, k.last_used_at, u.id AS uid, u.name, u.role, u.active FROM claude_keys k JOIN users u ON u.id = k.user_id
      WHERE k.key_hash = $1 AND k.revoked_at IS NULL`, [keyHash(key)]);
  if (!k || !k.active) return null;
  await query('UPDATE claude_keys SET last_used_at = now(), uses = uses + 1 WHERE id = $1', [k.id]);
  return { uid: Number(k.uid), name: k.name, role: k.role === 'viewer' ? 'view' : 'edit' };
}

// Call the app's own API as this person
function caller(u) {
  const token = issueToken(u.role, { uid: u.uid, name: u.name });
  return async (path, opts = {}) => {
    const res = await api(new Request('https://zodiac-os.internal/api' + path, {
      method: opts.method || 'GET',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }), {});
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || `Zodiac OS returned ${res.status}`);
    return j;
  };
}

function pick(list, q, label) {
  const s = low(q).trim();
  if (!s) throw new Error(`Say which ${label}`);
  const byId = list.find((x) => low(x.id) === s);
  if (byId) return byId;
  const exact = list.filter((x) => low(x.name) === s);
  if (exact.length === 1) return exact[0];
  const words = s.split(/\s+/);
  const part = list.filter((x) => { const n = low([x.name, x.client, x.instagram, x.tiktok].filter(Boolean).join(' ')); return words.every((w) => n.includes(w)); });
  if (part.length === 1) return part[0];
  if (!part.length) throw new Error(`No ${label} matches "${q}"`);
  throw new Error(`"${q}" matches ${part.length} ${label}s: ${part.slice(0, 12).map((x) => `${x.name}${x.client ? ' (' + x.client + ')' : ''} [id ${x.id}]`).join('; ')}. Ask which one, then use its id.`);
}

const talentOut = (t) => ({
  id: t.id, name: t.name, niche: t.niche || '', location: t.location || t.region || '', region: t.region || '', gender: t.gender || '',
  exclusivity: t.exclusivity, instagram: t.instagram || '', ig_followers: t.ig_followers, tiktok: t.tiktok || '', tt_followers: t.tt_followers,
  youtube: t.youtube || '', yt_followers: t.yt_followers, total_followers: t.total_followers, rate: t.rate || '',
  manager: t.manager_name || '', manager_email: t.manager_email || '', campaigns_with_rates: t.rate_count, monday_deals: t.deal_count, added: t.added,
});

function campSummary(c) {
  const fx = Number(c.fx) || FX[c.cur] || 1;
  return {
    id: c.id, name: c.name, client: c.client, owner: c.owner, stage: c.stage, archived: !!c.archived, currency: c.cur,
    budget: r2(c.budget), budget_gbp: r0(c.budget * fx), target_margin_pct: c.target,
    creators_selected: c.selected, creators_total: c.total, creator_cost: r2(c.cost), client_price: r2(c.price),
    margin: r2(c.margin), margin_pct: pct(c.margin, c.price), start: c.start, end: c.end, won_on: c.wonAt,
    deliverables: c.deliverables, live: c.live, overdue: c.overdue, due_this_week: c.dueWeek,
    contracts_unsigned: c.unsigned, creators_not_invoiced: c.uninvoiced, client_invoices_ready: c.readyInv, ready_to_invoice_amount: r2(c.toInvoice),
    monday_mismatches: c.mondayDiffs,
  };
}

const TOOLS = [
  { name: 'search_talent', title: 'Search the Talent Index',
    description: 'Search Zodiac Global\'s Talent Index of creators. Filter by free text (name, handle, niche, city), niche, region (UK or UAE), gender (F, M, Mixed), follower range and platform. Returns up to `limit` creators with followers, rate, niche and manager.',
    inputSchema: { type: 'object', properties: {
      text: { type: 'string', description: 'Free text matched against name, handles, niche and location' },
      niche: { type: 'string', description: 'e.g. F&B, Fashion, Beauty, Lifestyle, Health & Wellness, Travel & Tourism, Parenting, Comedy, Gaming, Sports, Automotive' },
      region: { type: 'string', enum: ['UK', 'UAE'] }, gender: { type: 'string', enum: ['F', 'M', 'Mixed'] },
      platform: { type: 'string', enum: ['instagram', 'tiktok', 'youtube', 'total'], description: 'Which follower count the min/max apply to (default total)' },
      min_followers: { type: 'number' }, max_followers: { type: 'number' }, exclusive_only: { type: 'boolean' },
      sort: { type: 'string', enum: ['followers', 'name', 'newest'] }, limit: { type: 'number', description: 'Default 25, max 100' } } },
    annotations: { readOnlyHint: true } },
  { name: 'get_talent', title: 'Creator profile and history',
    description: 'Full profile for one creator: followers, handles, rate, manager contact, notes, every fee they have quoted on Zodiac campaigns (proposed, selected, declined) and their past deals from monday. Pass a name, handle or id.',
    inputSchema: { type: 'object', properties: { creator: { type: 'string' } }, required: ['creator'] }, annotations: { readOnlyHint: true } },
  { name: 'list_campaigns', title: 'List campaigns',
    description: 'Campaigns in Campaign Management with stage, owner, budget (campaign currency and £), creator cost, margin, delivery status and anything needing attention. By default leaves out archived and Closed Lost.',
    inputSchema: { type: 'object', properties: {
      stage: { type: 'string', enum: ['open', 'won', 'pipeline', 'lost', 'all'], description: 'open (default) = not lost or archived; won = 7 - Won; pipeline = stages before Won' },
      owner: { type: 'string' }, text: { type: 'string', description: 'Matches campaign or client name' } } },
    annotations: { readOnlyHint: true } },
  { name: 'get_campaign', title: 'Campaign detail',
    description: 'Everything on one campaign: brief, client agreement, each creator (approval, stage, fee, client rate, margin, contract, invoice status, next action), every deliverable with due and live dates, client invoices, documents and any differences from monday. Pass a campaign name, client or id.',
    inputSchema: { type: 'object', properties: { campaign: { type: 'string' } }, required: ['campaign'] }, annotations: { readOnlyHint: true } },
  { name: 'sales_pipeline', title: 'Sales pipeline from monday',
    description: 'Live deals from the monday Agency Sales Pipeline board (read only): stage, owner, client, value in currency and £, expected close, likelihood, next steps, invoicing status. Includes totals by stage. Closed Lost is left out unless include_lost is true.',
    inputSchema: { type: 'object', properties: { owner: { type: 'string' }, stage: { type: 'string', description: 'Part of a stage name, e.g. "Proposal", "Won", "Negotiation"' },
      closing_by: { type: 'string', description: 'YYYY-MM-DD: only deals expected to close on or before this date' }, include_lost: { type: 'boolean' } } },
    annotations: { readOnlyHint: true } },
  { name: 'needs_attention', title: 'What needs attention',
    description: 'Across all open campaigns: overdue deliverables, posts due this week, client invoices ready to raise, unsigned creator contracts on won campaigns, creators not yet invoiced, and monday mismatches.',
    inputSchema: { type: 'object', properties: { owner: { type: 'string' } } }, annotations: { readOnlyHint: true } },
  { name: 'add_creator_to_campaign', title: 'Shortlist a creator on a campaign',
    description: 'Adds an existing Talent Index creator to a campaign as a shortlisted, not-yet-approved option, priced from their Index rate at the campaign\'s target margin. It never approves them or changes fees. Call first WITHOUT confirm to get a preview, show it to the user, and only call again with confirm: true once they say yes.',
    inputSchema: { type: 'object', properties: { campaign: { type: 'string' }, creator: { type: 'string' }, confirm: { type: 'boolean' } }, required: ['campaign', 'creator'] },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true } },
];

async function run(name, a, u) {
  const call = caller(u);
  a = a || {};
  if (name === 'search_talent') {
    const { talents } = await call('/state');
    const f = { instagram: 'ig_followers', tiktok: 'tt_followers', youtube: 'yt_followers', total: 'total_followers' }[a.platform || 'total'] || 'total_followers';
    const words = low(a.text).split(/\s+/).filter(Boolean);
    let r = talents.filter((t) => {
      const hay = low([t.name, t.instagram, t.tiktok, t.youtube, t.niche, t.location, t.region].join(' '));
      if (words.length && !words.every((w) => hay.includes(w))) return false;
      if (a.niche && !low(t.niche).includes(low(a.niche))) return false;
      if (a.region && t.region !== a.region) return false;
      if (a.gender && t.gender !== a.gender) return false;
      if (a.exclusive_only && t.exclusivity !== 'Exclusive') return false;
      const n = Number(t[f]) || 0;
      if (a.min_followers != null && n < a.min_followers) return false;
      if (a.max_followers != null && n > a.max_followers) return false;
      return true;
    });
    if (a.sort === 'name') r.sort((x, y) => x.name.localeCompare(y.name));
    else if (a.sort === 'newest') r.sort((x, y) => String(y.added).localeCompare(String(x.added)));
    else r.sort((x, y) => (Number(y[f]) || 0) - (Number(x[f]) || 0));
    const lim = Math.min(100, Math.max(1, Number(a.limit) || 25));
    return { matches: r.length, showing: Math.min(lim, r.length), creators: r.slice(0, lim).map(talentOut) };
  }
  if (name === 'get_talent') {
    const { talents } = await call('/state');
    const t = pick(talents, a.creator, 'creator');
    const [rates, deals, notes] = await Promise.all([
      call('/campaigns/talent-rates/' + encodeURIComponent(t.id)).catch(() => ({ rates: [] })),
      call('/talents/' + encodeURIComponent(t.id) + '/deals').catch(() => ({ deals: [] })),
      call('/talents/' + encodeURIComponent(t.id) + '/notes').catch(() => ({ notes: [] })),
    ]);
    return { ...talentOut(t), manager_phone: t.manager_phone || '', bio: t.public_bio || '',
      zodiac_campaign_fees: rates.rates || [], monday_deals: deals.deals || [], notes: (notes.notes || []).slice(0, 30) };
  }
  if (name === 'list_campaigns' || name === 'needs_attention') {
    const { campaigns } = await call('/campaigns');
    let r = campaigns;
    const st = name === 'needs_attention' ? 'open' : (a.stage || 'open');
    if (st === 'open') r = r.filter((c) => !c.archived && !/lost/i.test(c.stage));
    else if (st === 'won') r = r.filter((c) => c.stage === '7 - Won');
    else if (st === 'pipeline') r = r.filter((c) => !c.archived && !/won|lost/i.test(c.stage));
    else if (st === 'lost') r = r.filter((c) => /lost/i.test(c.stage));
    if (a.owner) r = r.filter((c) => low(c.owner).includes(low(a.owner)));
    if (a.text) r = r.filter((c) => low(c.name + ' ' + c.client).includes(low(a.text)));
    if (name === 'list_campaigns') return { count: r.length, campaigns: r.map(campSummary) };
    const flag = r.map(campSummary).filter((c) => c.overdue || c.due_this_week || c.client_invoices_ready || c.contracts_unsigned || c.creators_not_invoiced || c.monday_mismatches);
    return {
      totals: { overdue: flag.reduce((s, c) => s + c.overdue, 0), due_this_week: flag.reduce((s, c) => s + c.due_this_week, 0),
        client_invoices_ready: flag.reduce((s, c) => s + c.client_invoices_ready, 0), contracts_unsigned: flag.reduce((s, c) => s + c.contracts_unsigned, 0),
        creators_not_invoiced: flag.reduce((s, c) => s + c.creators_not_invoiced, 0), monday_mismatches: flag.reduce((s, c) => s + c.monday_mismatches, 0) },
      campaigns: flag.map((c) => ({ id: c.id, name: c.name, client: c.client, owner: c.owner, currency: c.currency, overdue: c.overdue, due_this_week: c.due_this_week,
        client_invoices_ready: c.client_invoices_ready, ready_to_invoice_amount: c.ready_to_invoice_amount, contracts_unsigned: c.contracts_unsigned,
        creators_not_invoiced: c.creators_not_invoiced, monday_mismatches: c.monday_mismatches })),
      tip: 'Use get_campaign for the individual items.',
    };
  }
  if (name === 'get_campaign') {
    const { campaigns } = await call('/campaigns');
    const c0 = pick(campaigns, a.campaign, 'campaign');
    const { campaign: c } = await call('/campaigns/' + encodeURIComponent(c0.id));
    const fee = (x) => (x.neg != null ? x.neg : x.initial);
    return {
      ...campSummary(c0), markets: c.markets, platforms: c.platforms, billing: c.billing, brief: String(c.brief || '').slice(0, 3000),
      client_contact: { name: c.contactName, role: c.contactRole, email: c.contactEmail, phone: c.contactPhone },
      client_agreement: { status: c.cStatus, value: c.cValue, signed: c.cSigned, terms: c.cTerms, usage: c.cUsage },
      creators: (c.infl || []).map((x) => ({
        name: x.name, talent_id: x.tid, approved: x.approved, stage: x.stage, archived: x.archived ? (x.archived.reason || 'yes') : '',
        fee: r2(fee(x)), fee_initial: r2(x.initial), fee_negotiated: x.neg, client_rate: r2(x.client), margin: r2(x.client - fee(x)), margin_pct: pct(x.client - fee(x), x.client),
        scope: (x.scope || []).map((s) => `${s.qty || 1} × ${s.item}`).join(', '), contract: x.contract, contract_signed: x.contractSigned, invoice: x.invoice, next_action: x.next,
        deliverables: (x.deliv || []).map((d) => ({ name: d.name, platform: d.plat, stage: d.stage, content_due: d.recv, content_received: d.recvAt, live_due: d.noPost ? '' : d.live, went_live: d.liveAt,
          not_a_post: d.noPost || undefined, links: (d.links || []).length || undefined, creator_payment: d.crRate != null ? { rate: d.crRate, status: d.crStatus, paid: d.crPaidAt } : undefined })),
        creator_invoices: (x.crinv || []).map((v) => ({ number: v.number, date: v.date, amount: v.amount, paid: v.paidAt || '' })),
      })),
      client_invoices: (c.cinv || []).map((v) => ({ label: v.label, amount: v.amount, period_start: v.start, period_end: v.end, invoiced: v.invAt, paid: v.paidAt })),
      documents: (c.docs || []).map((d) => `${d.kind || 'File'}: ${d.name}`),
      monday_differences: c.mondayCheck && c.mondayCheck.diffs ? c.mondayCheck.diffs : [],
      currency_note: `Money is in ${c.cur} unless marked _gbp (1 ${c.cur} = £${Number(c.fx) || FX[c.cur] || 1}).`,
    };
  }
  if (name === 'sales_pipeline') {
    const { deals } = await call('/campaigns/monday-pipeline');
    let r = (deals || []).filter((d) => a.include_lost || !/lost/i.test(d.stage));
    if (a.owner) r = r.filter((d) => low(d.owner).includes(low(a.owner)));
    if (a.stage) r = r.filter((d) => low(d.stage).includes(low(a.stage)));
    if (a.closing_by) r = r.filter((d) => d.start && d.start <= a.closing_by);
    const rows = r.map((d) => ({ name: d.name, client: d.client, owner: d.owner, stage: d.stage, currency: d.cur, value: d.value, value_gbp: r0(d.value * (FX[d.cur] || 1)),
      target_margin_pct: d.target, expected_close: d.start, agreed: d.agreed, likelihood_pct: d.prob, market: d.market, next_steps: d.next,
      invoicing: d.invStatus, invoice_sent: d.invSent, paid: d.paid, lost_reason: d.lostReason || undefined }));
    const by = {};
    rows.forEach((d) => { const k = d.stage || 'No stage'; by[k] = by[k] || { deals: 0, value_gbp: 0 }; by[k].deals++; by[k].value_gbp += d.value_gbp; });
    rows.sort((x, y) => y.value_gbp - x.value_gbp);
    return { source: 'monday Agency Sales Pipeline (live, read only)', fx_to_gbp: FX, by_stage: by, count: rows.length, deals: rows.slice(0, 150) };
  }
  if (name === 'add_creator_to_campaign') {
    if (u.role !== 'edit') throw new Error('Your Zodiac OS account is view-only, so it cannot add creators.');
    const [{ campaigns }, { talents }] = await Promise.all([call('/campaigns'), call('/state')]);
    const c = pick(campaigns.filter((x) => !x.archived && !/lost/i.test(x.stage)), a.campaign, 'campaign');
    const t = pick(talents, a.creator, 'creator');
    const { campaign: full } = await call('/campaigns/' + encodeURIComponent(c.id));
    if ((full.infl || []).some((x) => x.tid === t.id)) return { done: false, message: `${t.name} is already on ${c.name}.` };
    if (!a.confirm) return { done: false, needs_confirmation: true,
      preview: `Add ${t.name} (${t.niche || 'no niche'}, ${t.location || t.region || 'no location'}, ${(t.total_followers || 0).toLocaleString('en-GB')} followers, Index rate ${t.rate || 'not set'}) to "${c.name}" for ${c.client || 'no client'} as shortlisted, not approved. Fee is taken from the Index rate at the ${c.target}% target margin; the team sets the final fee in Zodiac OS.`,
      next: 'Show this to the user. Only if they confirm, call add_creator_to_campaign again with the same campaign and creator ids and confirm: true.',
      campaign_id: c.id, creator_id: t.id };
    const res = await call('/campaigns/' + encodeURIComponent(c.id) + '/talents', { method: 'POST', body: { talent_id: t.id } });
    const added = (res.campaign.infl || []).find((x) => x.tid === t.id);
    return { done: true, message: `Added ${t.name} to ${c.name} as shortlisted. It shows in Zodiac OS now, logged as added by ${u.name}.`,
      fee: added ? r2(added.initial) : null, client_rate: added ? r2(added.client) : null, currency: c.cur };
  }
  throw new Error('Unknown tool ' + name);
}

async function handle(msg, u) {
  const { id, method, params } = msg || {};
  const reply = (result) => ({ jsonrpc: '2.0', id, result });
  const fail = (code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
  if (!msg || msg.jsonrpc !== '2.0' || typeof method !== 'string') return fail(-32600, 'Invalid request');
  if (id === undefined) return null; // notification
  if (method === 'initialize') {
    const want = params && params.protocolVersion;
    return reply({ protocolVersion: PROTOCOLS.includes(want) ? want : PROTOCOLS[0], capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'zodiac-os', title: 'Zodiac OS', version: '1.0.0' },
      instructions: `Zodiac OS is Zodiac Global's internal system: the Talent Index (creators) and Campaign Management (campaigns, creators, deliverables, invoices), plus the live monday sales pipeline. You are connected as ${u.name}. Everything is read-only except shortlisting a creator on a campaign, which always needs the user's confirmation. Money is in the campaign's currency unless a field ends in _gbp. Use British English.` });
  }
  if (method === 'ping') return reply({});
  if (method === 'tools/list') return reply({ tools: TOOLS });
  if (method === 'tools/call') {
    const name = params && params.name;
    if (!TOOLS.some((t) => t.name === name)) return fail(-32602, 'Unknown tool: ' + name);
    try {
      const data = await run(name, params.arguments || {}, u);
      return reply({ content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data, isError: false });
    } catch (e) {
      return reply({ content: [{ type: 'text', text: e.message || String(e) }], isError: true });
    }
  }
  if (method === 'resources/list') return reply({ resources: [] });
  if (method === 'prompts/list') return reply({ prompts: [] });
  return fail(-32601, 'Method not found: ' + method);
}

export default async (req) => {
  const url = new URL(req.url);
  const decksHost = (process.env.DECKS_HOST || '').toLowerCase();
  if (decksHost && url.host.toLowerCase() === decksHost) return out({ error: 'Not found' }, 404);
  const key = url.pathname.replace(/^\/mcp\/?/, '').split('/')[0] || '';
  if (req.method === 'OPTIONS') return out(null, 204, { allow: 'POST, OPTIONS' });
  if (req.method !== 'POST') return out({ error: 'This is the Zodiac OS connector for Claude. Add this URL to Claude as a custom connector.' }, 405, { allow: 'POST' });
  const u = await who(key).catch(() => null);
  if (!u) return out({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'This Zodiac OS connector link is not valid or has been switched off. Make a new one in Zodiac OS: Account → Connect Claude.' } }, 401);
  let body;
  try { body = await req.json(); } catch { return out({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400); }
  if (Array.isArray(body)) {
    const res = (await Promise.all(body.map((m) => handle(m, u)))).filter(Boolean);
    return res.length ? out(res) : out(null, 202);
  }
  const res = await handle(body, u);
  return res ? out(res) : out(null, 202);
};
