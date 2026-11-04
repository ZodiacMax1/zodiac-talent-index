// Zodiac OS connector for Claude (MCP over streamable HTTP, JSON responses).
// URL: https://<site>/mcp/<personal key>. Reads everything; shortlisting for any editor; other changes only when an admin switches on "Claude can edit" for that person.
// Every change returns a preview and a confirm_token tied to the exact arguments; nothing is written to monday and nothing can be marked paid.
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
const stable = (v) => (Array.isArray(v) ? '[' + v.map(stable).join(',') + ']' : v && typeof v === 'object' ? '{' + Object.keys(v).sort().filter((k) => k !== 'confirm_token' && k !== 'confirm' && v[k] !== undefined).map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}' : JSON.stringify(v));
const tokenFor = (tool, a, u) => createHash('sha256').update(`${process.env.AUTH_SECRET || ''}|confirm|${u.uid}|${tool}|${stable(a || {})}`).digest('hex').slice(0, 16);
const NEXT = 'Show the user exactly these changes. Only if they say yes, call this tool again with exactly the same arguments plus confirm_token. If they want anything different, call it again without the token to get a new preview.';
const NICHES = ['F&B', 'Fashion', 'Beauty', 'Lifestyle', 'Health & Wellness', 'Travel & Tourism', 'Events', 'Parenting', 'Comedy', 'Gaming', 'Sports', 'Automotive', 'Celebrity', 'TV & Media', 'Hospitality', 'Model', 'UGC', 'Art', 'Actor', 'Other'];
const ITEMS = ['IG Reel', 'IG Story', 'IG Post', 'IG Carousel', 'TikTok video', 'YouTube video', 'YouTube Short', 'YouTube integration', 'Event / attendance', 'Filming day', 'Usage rights'];
const NOPOST = ['Filming day', 'Event / attendance'];
const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '') && !isNaN(Date.parse(d));
const plat = (x) => (/^IG/.test(x) ? 'Instagram' : /TikTok/.test(x) ? 'TikTok' : /YouTube/.test(x) ? 'YouTube' : '');
// Same split as the app: stories go in one set, everything else one deliverable each; usage rights is scope only
function split(item, qty) {
  if (item === 'Usage rights') return [];
  const noPost = NOPOST.includes(item);
  if (/stor(y|ies)/i.test(item)) return [{ name: qty > 1 ? `${qty} × ${item}` : item, item, qty, platform: plat(item), noPost }];
  return Array.from({ length: qty }, (_, k) => ({ name: qty > 1 ? `${item} ${k + 1}` : item, item, qty: 1, platform: plat(item), noPost }));
}

const out = (data, status = 200, extra = {}) => new Response(data == null ? null : JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra },
});

async function who(key) {
  if (!/^zos_[A-Za-z0-9]{20,80}$/.test(key || '')) return null;
  const [k] = await query(
    `SELECT k.id, k.last_used_at, u.id AS uid, u.name, u.role, u.active, u.claude_edit FROM claude_keys k JOIN users u ON u.id = k.user_id
      WHERE k.key_hash = $1 AND k.revoked_at IS NULL`, [keyHash(key)]);
  if (!k || !k.active) return null;
  await query('UPDATE claude_keys SET last_used_at = now(), uses = uses + 1 WHERE id = $1', [k.id]);
  return { uid: Number(k.uid), name: k.name, role: k.role === 'viewer' ? 'view' : 'edit', canChange: k.role !== 'viewer' && !!k.claude_edit };
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
    description: 'Adds an existing Talent Index creator to a campaign as a shortlisted, not-yet-approved option. Optionally sets their fee (what the creator is paid, in the campaign currency), the client rate or margin, and their deliverables (scope) with content-due and go-live dates. Without a fee it uses their Index rate; without a client rate or margin it uses the campaign target margin. It never approves them. Call first without confirm_token to get a preview, show it to the user, and only call again with exactly the same details plus the confirm_token from the preview once they say yes.',
    inputSchema: { type: 'object', properties: {
      campaign: { type: 'string' }, creator: { type: 'string' },
      fee: { type: 'number', description: 'Creator fee for the whole scope, in the campaign currency' },
      client_rate: { type: 'number', description: 'What the client is charged for this creator, in the campaign currency. Use this or margin_pct, not both.' },
      margin_pct: { type: 'number', description: 'Zodiac margin on this creator, 0-99' },
      deliverables: { type: 'array', description: 'The creator\'s scope', items: { type: 'object', properties: {
        item: { type: 'string', enum: ITEMS }, qty: { type: 'number', description: 'Default 1' },
        rate: { type: 'number', description: 'Optional creator rate per item, campaign currency' },
        content_due: { type: 'string', description: 'YYYY-MM-DD the draft is due' }, live: { type: 'string', description: 'YYYY-MM-DD it goes live (or the date of a filming day / event)' } }, required: ['item'] } },
      confirm_token: { type: 'string', description: 'From the preview, only once the user has said yes' } }, required: ['campaign', 'creator'] },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true } },
];

// ---------- Changes (need the "Claude can edit" switch; every one previews first and needs the user's yes) ----------
const DATE = { type: 'string', description: 'YYYY-MM-DD, or empty string to clear' };
const TOK = { type: 'string', description: 'From the preview, only once the user has said yes' };
const D_STAGES = ['Brief sent', 'In production', 'Draft received', 'Feedback', 'Approved', 'Live'];
const EDIT_TOOLS = [
  { name: 'update_campaign_creator', title: 'Change a creator on a campaign',
    description: 'Change one creator on a campaign: fee (initial and negotiated, in the campaign currency; client rate and margin keep calculating), client rate or margin, scope, approval, stage, next action, creator contract status and signed date, archive or un-archive. remove takes them off the campaign, but only if they have no deliverables or invoices (otherwise archive them). Never touches payments. Preview first, then confirm_token.',
    inputSchema: { type: 'object', properties: {
      campaign: { type: 'string' }, creator: { type: 'string' },
      fee_initial: { type: 'number' }, fee_negotiated: { type: ['number', 'null'], description: 'null clears it' },
      client_rate: { type: 'number' }, margin_pct: { type: 'number' },
      scope: { type: 'array', description: 'Replaces the whole scope', items: { type: 'object', properties: { item: { type: 'string', enum: ITEMS }, qty: { type: 'number' }, rate: { type: 'number' } }, required: ['item'] } },
      approved: { type: 'string', enum: ['Yes', 'Maybe', 'Not yet', 'Declined'] }, stage: { type: 'string', enum: ['Shortlisted', 'Outreach', 'Negotiating', 'Confirmed'] },
      next_action: { type: 'string' }, contract: { type: 'string', enum: ['–', 'Sent', 'Signed'] }, contract_signed: DATE,
      archive: { type: 'object', properties: { reason: { type: 'string', description: 'e.g. Declined by client, Creator unavailable, Budget, Other' }, note: { type: 'string' } } },
      unarchive: { type: 'boolean' }, remove: { type: 'boolean' }, confirm_token: TOK }, required: ['campaign', 'creator'] },
    annotations: { readOnlyHint: false, destructiveHint: true } },
  { name: 'edit_deliverables', title: 'Add, change or remove deliverables',
    description: 'Several deliverable changes on one campaign in one go (up to 40), e.g. dating every undated deliverable. Each change: action add | update | remove, the creator, and for update/remove the deliverable (name or id from get_campaign). Fields: name, item, platform, stage, content_due, content_received, live_due, went_live, not_a_post, add_link {label, url}, remove_link (url). Remove is refused for anything live or invoiced. Never changes creator payments. Preview first, then confirm_token.',
    inputSchema: { type: 'object', properties: { campaign: { type: 'string' }, changes: { type: 'array', items: { type: 'object', properties: {
      action: { type: 'string', enum: ['add', 'update', 'remove'] }, creator: { type: 'string' }, deliverable: { type: 'string' },
      name: { type: 'string' }, item: { type: 'string', enum: ITEMS }, platform: { type: 'string', enum: ['Instagram', 'TikTok', 'YouTube', 'Other', ''] },
      stage: { type: 'string', enum: D_STAGES }, content_due: DATE, content_received: DATE, live_due: DATE, went_live: DATE, not_a_post: { type: 'boolean' },
      add_link: { type: 'object', properties: { label: { type: 'string' }, url: { type: 'string' } }, required: ['url'] }, remove_link: { type: 'string' } }, required: ['action', 'creator'] } },
      confirm_token: TOK }, required: ['campaign', 'changes'] },
    annotations: { readOnlyHint: false, destructiveHint: true } },
  { name: 'log_creator_invoice', title: 'Log a creator invoice',
    description: 'Record an invoice received from a creator against some or all of their deliverables (marks them Invoiced). Amount in the campaign currency. It cannot mark anything paid; payment is done in Zodiac OS. Preview first, then confirm_token.',
    inputSchema: { type: 'object', properties: { campaign: { type: 'string' }, creator: { type: 'string' }, number: { type: 'string' }, date: { type: 'string', description: 'YYYY-MM-DD received' },
      amount: { type: 'number' }, deliverables: { type: 'array', items: { type: 'string' }, description: 'Names or ids. Leave out for every deliverable not yet invoiced.' }, confirm_token: TOK }, required: ['campaign', 'creator', 'amount'] },
    annotations: { readOnlyHint: false, destructiveHint: false } },
  { name: 'update_client_invoice', title: 'Raise or mark a client invoice',
    description: 'Mark a client invoice as invoiced (with the date sent), change its amount or dates, or add a new client invoice line. Amounts in the campaign currency. It cannot mark anything paid; payment is done in Zodiac OS. Preview first, then confirm_token.',
    inputSchema: { type: 'object', properties: { campaign: { type: 'string' }, invoice: { type: 'string', description: 'Label or id of an existing client invoice' },
      invoiced_on: DATE, amount: { type: 'number' }, period_start: DATE, period_end: DATE,
      add: { type: 'object', properties: { label: { type: 'string' }, amount: { type: 'number' }, period_start: { type: 'string' }, period_end: { type: 'string' } }, required: ['label', 'amount'] },
      confirm_token: TOK }, required: ['campaign'] },
    annotations: { readOnlyHint: false, destructiveHint: false } },
  { name: 'update_campaign', title: 'Change campaign details',
    description: 'Change a campaign: name, client, owner, stage, budget, target margin, start and end dates, brief, markets, platforms, billing (completion, quarterly, monthly, custom), client contact, client agreement (status, value, signed date, payment terms, usage) and add a document link. Money in the campaign currency (currency itself is changed in Zodiac OS). Nothing is written to monday. Preview first, then confirm_token.',
    inputSchema: { type: 'object', properties: { campaign: { type: 'string' },
      name: { type: 'string' }, client: { type: 'string' }, owner: { type: 'string' },
      stage: { type: 'string', enum: ['2 - Discovery / Scoping', '3 - Proposal Sent', '4 - Negotiation', '5 - Verbal Agreement', '6 - Contract Sent', '7 - Won', '8 - Closed Lost'] },
      budget: { type: 'number' }, target_margin_pct: { type: 'number' }, start: DATE, end: DATE, brief: { type: 'string' }, markets: { type: 'string' }, platforms: { type: 'string' },
      billing: { type: 'string', enum: ['completion', 'quarterly', 'monthly', 'custom'] },
      contact_name: { type: 'string' }, contact_role: { type: 'string' }, contact_email: { type: 'string' }, contact_phone: { type: 'string' },
      agreement_status: { type: 'string', enum: ['Not started', 'Sent to client', 'Signed'] }, agreement_value: { type: 'number' }, agreement_signed: DATE,
      payment_terms: { type: 'string', enum: ['Upfront', 'Net 30', 'Net 45', 'Net 60'] }, usage: { type: 'string' },
      add_document_link: { type: 'object', properties: { name: { type: 'string' }, url: { type: 'string' }, kind: { type: 'string', description: 'e.g. Proposal, Client brief, Client deck, Other' } }, required: ['url'] },
      confirm_token: TOK }, required: ['campaign'] },
    annotations: { readOnlyHint: false, destructiveHint: false } },
  { name: 'create_campaign_from_monday', title: 'Create a campaign from a monday deal',
    description: 'Create a campaign in Zodiac OS from a deal on the monday Agency Sales Pipeline (name, client, owner, currency, value, target margin, market, start date and contact come across). monday itself is not changed. Preview first, then confirm_token.',
    inputSchema: { type: 'object', properties: { deal: { type: 'string', description: 'Deal name or monday item id' }, confirm_token: TOK }, required: ['deal'] },
    annotations: { readOnlyHint: false, destructiveHint: false } },
  { name: 'resolve_monday_mismatch', title: 'Use the monday value',
    description: 'Where a campaign differs from its monday deal, update Zodiac OS to the monday value (stage, budget, target margin, start date, owner or client). Runs a fresh check first. monday itself is never changed. Preview first, then confirm_token.',
    inputSchema: { type: 'object', properties: { campaign: { type: 'string' }, fields: { type: 'array', items: { type: 'string', enum: ['stage', 'budget', 'target', 'start', 'owner', 'client'] }, description: 'Leave out for every difference that has a monday value' }, confirm_token: TOK }, required: ['campaign'] },
    annotations: { readOnlyHint: false, destructiveHint: false } },
  { name: 'add_talent', title: 'Add a creator to the Talent Index',
    description: `Add a new creator to the Talent Index. Niche should use the Index niches (${NICHES.join(', ')}), comma separated for several. Location is a city or country (UK and UAE places are recognised). Rate is free text, e.g. "£1,500 per Reel". Refuses likely duplicates. Preview first, then confirm_token.`,
    inputSchema: { type: 'object', properties: TALENT_PROPS(true), required: ['name'] }, annotations: { readOnlyHint: false, destructiveHint: false } },
  { name: 'update_talent', title: 'Update a creator in the Talent Index',
    description: 'Update a creator: rate, followers, handles, niche, location, gender, exclusivity, manager contact, bio, and/or add a note. Preview first, then confirm_token.',
    inputSchema: { type: 'object', properties: { creator: { type: 'string' }, ...TALENT_PROPS(false), add_note: { type: 'string' } }, required: ['creator'] }, annotations: { readOnlyHint: false, destructiveHint: false } },
];
function TALENT_PROPS(isNew) {
  return { ...(isNew ? { name: { type: 'string' } } : { name: { type: 'string', description: 'Rename' } }),
    niche: { type: 'string' }, location: { type: 'string' }, gender: { type: 'string', enum: ['F', 'M', 'Mixed'] }, exclusivity: { type: 'string', enum: ['Exclusive', 'Non-Exclusive'] },
    instagram: { type: 'string' }, ig_followers: { type: 'number' }, tiktok: { type: 'string' }, tt_followers: { type: 'number' }, youtube: { type: 'string' }, yt_followers: { type: 'number' },
    rate: { type: 'string' }, manager_name: { type: 'string' }, manager_email: { type: 'string' }, manager_phone: { type: 'string' }, bio: { type: 'string' }, confirm_token: TOK };
}

const show = (v) => (v === null || v === undefined || v === '' ? '—' : Array.isArray(v) ? v.map((x) => (x.item ? `${x.qty || 1} × ${x.item}${x.rate != null ? ' @ ' + x.rate : ''}` : x)).join(', ') || '—' : String(v));
const dOk = (v, label) => { if (v !== undefined && v !== '' && v !== null && !isDate(v)) throw new Error(`${label} must be YYYY-MM-DD`); };
const dVal = (v) => (v === '' || v === null ? null : v);
function pickIn(list, q, label, keys = ['id']) {
  const s = low(q).trim();
  const hit = list.find((x) => keys.some((k) => low(x[k]) === s));
  return hit || pick(list, q, label);
}
async function gate(tool, a, u, title, lines, doIt) {
  if (!lines.length) throw new Error('Nothing to change: those values are already set.');
  if (a.confirm_token !== tokenFor(tool, a, u)) return { done: false, needs_confirmation: true, change: title, changes: lines, confirm_token: tokenFor(tool, a, u), next: NEXT };
  const r = await doIt();
  return { done: true, change: title, changes: lines, ...(r || {}), logged_as: u.name };
}
async function loadCamp(call, q, open = true) {
  const { campaigns } = await call('/campaigns');
  const c0 = pick(open ? campaigns.filter((x) => !x.archived) : campaigns, q, 'campaign');
  const { campaign } = await call('/campaigns/' + encodeURIComponent(c0.id));
  return campaign;
}

async function runEdit(name, a, u, call) {
  if (!u.canChange) throw new Error(u.role === 'edit'
    ? `Changes through Claude aren't switched on for ${u.name}. An admin can switch them on in Zodiac OS: Account → Connect Claude. Until then, make this change in Zodiac OS.`
    : 'Your Zodiac OS account is view-only.');
  const C = (id) => '/campaigns/' + encodeURIComponent(id);

  if (name === 'update_campaign_creator') {
    const c = await loadCamp(call, a.campaign);
    const x = pickIn(c.infl || [], a.creator, 'creator on this campaign', ['id', 'tid']);
    const cur = c.cur, lines = [], body = {};
    const fee = x.neg != null ? x.neg : x.initial;
    const ch = (label, oldV, newV, key, val) => { if (String(show(oldV)) !== String(show(newV))) { lines.push(`${label}: ${show(oldV)} → ${show(newV)}`); body[key] = val === undefined ? newV : val; } };
    if (a.remove) {
      if ((x.deliv || []).length || (x.crinv || []).length) throw new Error(`${x.name} has deliverables or invoices on this campaign, so archive them instead of removing.`);
      return gate(name, a, u, `Take ${x.name} off ${c.name}`, [`Remove ${x.name} from ${c.name} (they stay in the Talent Index)`], async () => { await call(C(c.id) + '/talents/' + x.id, { method: 'DELETE' }); });
    }
    if (a.fee_initial != null) { if (!(a.fee_initial > 0)) throw new Error('fee_initial must be above 0'); ch(`Initial fee (${cur})`, x.initial, a.fee_initial, 'initial'); }
    if (a.fee_negotiated !== undefined) { if (a.fee_negotiated !== null && !(a.fee_negotiated > 0)) throw new Error('fee_negotiated must be above 0'); ch(`Negotiated fee (${cur})`, x.neg, a.fee_negotiated, 'neg'); }
    if (a.client_rate != null && a.margin_pct != null) throw new Error('Give a client rate or a margin, not both');
    if (a.margin_pct != null) { if (!(a.margin_pct >= 0 && a.margin_pct < 100)) throw new Error('margin_pct must be 0 to 99'); ch('Margin %', r2(x.margin), a.margin_pct, 'margin'); }
    if (a.client_rate != null) ch(`Client rate (${cur})`, x.client, a.client_rate, 'client_rate');
    if (body.initial != null || body.neg !== undefined || body.margin != null) {
      const nf = body.neg !== undefined ? (body.neg || body.initial || x.initial) : (x.neg != null ? x.neg : (body.initial || x.initial));
      if (body.client_rate == null) lines.push(`Client rate then works out at ${cur} ${r2(nf / (1 - (body.margin != null ? body.margin : x.margin) / 100))}`);
    }
    if (a.scope) {
      const sc = a.scope.map((l) => { const it = ITEMS.find((i) => low(i) === low(l.item)); if (!it) throw new Error('Scope item must be one of ' + ITEMS.join(', ')); return { item: it, qty: Math.max(1, Math.round(l.qty || 1)), ...(l.rate != null ? { rate: l.rate } : {}) }; });
      ch('Scope', x.scope || [], sc, 'scope');
    }
    if (a.approved) ch('Approved', x.approved, a.approved, 'approved');
    if (a.stage) ch('Stage', x.stage, a.stage, 'stage');
    if (a.next_action !== undefined) ch('Next action', x.next, a.next_action, 'next');
    if (a.contract) ch('Contract', x.contract, a.contract, 'contract');
    if (a.contract_signed !== undefined) { dOk(a.contract_signed, 'contract_signed'); ch('Contract signed', x.contractSigned, a.contract_signed, 'contractSigned', dVal(a.contract_signed)); }
    if (a.archive) { if (x.archived) throw new Error(`${x.name} is already archived`); lines.push(`Archive ${x.name} (${a.archive.reason || 'Other'}${a.archive.note ? ': ' + a.archive.note : ''})`); body.archived = { reason: a.archive.reason || 'Other', note: a.archive.note || '' }; }
    if (a.unarchive) { if (!x.archived) throw new Error(`${x.name} isn't archived`); lines.push(`Bring ${x.name} back from the archive`); body.archived = null; }
    return gate(name, a, u, `${x.name} on ${c.name}`, lines, async () => {
      const { campaign: after } = await call(C(c.id) + '/talents/' + x.id, { method: 'PATCH', body });
      const y = (after.infl || []).find((i) => i.id === x.id) || {}; const f = y.neg != null ? y.neg : y.initial;
      return { now: { currency: cur, fee: f, client_rate: y.client, margin_pct: pct(y.client - f, y.client), approved: y.approved, stage: y.stage, contract: y.contract } };
    });
  }

  if (name === 'edit_deliverables') {
    const c = await loadCamp(call, a.campaign);
    const ch = (Array.isArray(a.changes) ? a.changes : []);
    if (!ch.length || ch.length > 40) throw new Error('Give 1 to 40 changes');
    const ops = [], lines = [];
    ch.forEach((d, i) => {
      const n = `Change ${i + 1}`;
      const x = pickIn(c.infl || [], d.creator, 'creator on this campaign', ['id', 'tid']);
      for (const k of ['content_due', 'content_received', 'live_due', 'went_live']) dOk(d[k], `${n}: ${k}`);
      const map = { name: 'name', platform: 'platform', stage: 'stage', content_due: 'recv', content_received: 'recvAt', live_due: 'live', went_live: 'liveAt', not_a_post: 'noPost', item: 'item' };
      if (d.action === 'add') {
        const item = d.item ? ITEMS.find((t) => low(t) === low(d.item)) : '';
        const nm = d.name || item; if (!nm) throw new Error(`${n}: give a name or item`);
        const b = { name: nm, item: item || null, qty: 1, platform: d.platform != null ? d.platform : plat(item || ''), noPost: !!d.not_a_post, recv: dVal(d.content_due) || null, live: d.not_a_post ? null : dVal(d.live_due) || null };
        ops.push({ path: C(c.id) + '/talents/' + x.id + '/deliverables', method: 'POST', body: b });
        const after = {}; if (d.stage && d.stage !== 'Brief sent') after.stage = d.stage; if (d.content_received) after.recvAt = d.content_received; if (d.went_live) after.liveAt = d.went_live;
        if (Object.keys(after).length || d.add_link) ops[ops.length - 1].then = { ...after, ...(d.add_link ? { links: [{ l: d.add_link.label || 'Post', u: d.add_link.url }] } : {}) };
        lines.push(`${x.name}: add "${nm}"${b.platform ? ' (' + b.platform + ')' : ''}${b.recv ? ', content due ' + b.recv : ''}${b.live ? ', live ' + b.live : ''}${d.stage ? ', stage ' + d.stage : ''}${d.add_link ? ', link ' + d.add_link.url : ''}`);
        return;
      }
      const dl = pickIn((x.deliv || []).map((y) => ({ ...y, client: '' })), d.deliverable, `deliverable of ${x.name}`, ['id']);
      const path = C(c.id) + '/talents/' + x.id + '/deliverables/' + dl.id;
      if (d.action === 'remove') {
        if (dl.stage === 'Live' || dl.liveAt) throw new Error(`${n}: "${dl.name}" is live, so it can't be removed`);
        if (dl.crInv || (dl.crStatus && dl.crStatus !== 'Not due')) throw new Error(`${n}: "${dl.name}" has a creator invoice, so it can't be removed`);
        ops.push({ path, method: 'DELETE' }); lines.push(`${x.name}: remove "${dl.name}"`); return;
      }
      const body = {}, parts = [];
      const cur = { name: dl.name, platform: dl.plat, stage: dl.stage, recv: dl.recv, recvAt: dl.recvAt, live: dl.live, liveAt: dl.liveAt, noPost: !!dl.noPost, item: dl.item };
      for (const [k, key] of Object.entries(map)) {
        if (d[k] === undefined) continue;
        let v = d[k]; if (k === 'item') { v = ITEMS.find((t) => low(t) === low(v)); if (!v) throw new Error(`${n}: unknown item`); }
        if (['content_due', 'content_received', 'live_due', 'went_live'].includes(k)) v = dVal(v);
        if (String(show(cur[key])) === String(show(v))) continue;
        body[key] = v; parts.push(`${k.replace(/_/g, ' ')} ${show(cur[key])} → ${show(v)}`);
      }
      if (d.add_link) { if (!/^https?:\/\//i.test(d.add_link.url)) throw new Error(`${n}: the link must start with https://`); body.links = [...(dl.links || []), { l: d.add_link.label || 'Post', u: d.add_link.url }]; parts.push('add link ' + d.add_link.url); }
      if (d.remove_link) { const left = (dl.links || []).filter((l) => l.u !== d.remove_link); if (left.length === (dl.links || []).length) throw new Error(`${n}: that link isn't on "${dl.name}"`); body.links = left; parts.push('remove link ' + d.remove_link); }
      const rv = 'recv' in body ? body.recv : cur.recv, lv = 'live' in body ? body.live : cur.live;
      if (rv && lv && rv > lv) throw new Error(`${n}: content can't be due after it goes live`);
      if (!parts.length) return;
      ops.push({ path, method: 'PATCH', body }); lines.push(`${x.name} · ${dl.name}: ${parts.join('; ')}`);
    });
    return gate(name, a, u, `Deliverables on ${c.name}`, lines, async () => {
      let n = 0;
      try {
        for (const o of ops) {
          const j = await call(o.path, { method: o.method, body: o.body });
          if (o.then) { const x = (j.campaign.infl || []).find((i) => o.path.includes('/talents/' + i.id + '/')); const nd = x && x.deliv[x.deliv.length - 1]; if (nd) await call(o.path + '/' + nd.id, { method: 'PATCH', body: o.then }); }
          n++;
        }
      } catch (e) { return { done: 'partly', message: `${n} of ${ops.length} changes saved, then: ${e.message}` }; }
      return { saved: n };
    });
  }

  if (name === 'log_creator_invoice') {
    const c = await loadCamp(call, a.campaign);
    const x = pickIn(c.infl || [], a.creator, 'creator on this campaign', ['id', 'tid']);
    if (!(a.amount >= 0)) throw new Error('amount must be 0 or more');
    dOk(a.date, 'date');
    const open = (x.deliv || []).filter((d) => !d.crInv && d.crStatus !== 'Paid');
    const ds = a.deliverables && a.deliverables.length ? a.deliverables.map((q) => pickIn((x.deliv || []).map((y) => ({ ...y, client: '' })), q, `deliverable of ${x.name}`, ['id'])) : open;
    if (!ds.length) throw new Error(`${x.name} has no deliverables waiting for an invoice`);
    if (ds.some((d) => d.crInv)) throw new Error('One of those deliverables already has an invoice');
    return gate(name, a, u, `Creator invoice from ${x.name}`, [`Log invoice ${a.number || '(no number)'} from ${x.name}: ${c.cur} ${a.amount}${a.date ? ', received ' + a.date : ''}, covering ${ds.map((d) => d.name).join(', ')}. Marks them Invoiced (not paid).`],
      async () => { await call(C(c.id) + '/talents/' + x.id + '/crinv', { method: 'POST', body: { number: a.number || '', date: a.date || null, amount: a.amount, dids: ds.map((d) => d.id) } }); });
  }

  if (name === 'update_client_invoice') {
    const c = await loadCamp(call, a.campaign);
    for (const k of ['invoiced_on', 'period_start', 'period_end']) dOk(a[k], k);
    if (a.add) {
      if (!(a.add.amount >= 0)) throw new Error('amount must be 0 or more');
      dOk(a.add.period_start, 'period_start'); dOk(a.add.period_end, 'period_end');
      return gate(name, a, u, `New client invoice on ${c.name}`, [`Add client invoice "${a.add.label}" for ${c.cur} ${a.add.amount}${a.add.period_start ? ', period ' + a.add.period_start + (a.add.period_end ? ' to ' + a.add.period_end : '') : ''}. Billing becomes custom.`],
        async () => { await call(C(c.id) + '/cinv', { method: 'POST', body: { label: a.add.label, amount: a.add.amount, start: a.add.period_start || null, end: a.add.period_end || null } }); });
    }
    const inv = pickIn((c.cinv || []).map((v) => ({ ...v, name: v.label, client: '' })), a.invoice || ((c.cinv || []).length === 1 ? c.cinv[0].id : ''), 'client invoice', ['id']);
    const body = {}, lines = [];
    if (a.invoiced_on !== undefined && show(inv.invAt) !== show(dVal(a.invoiced_on))) { body.invAt = dVal(a.invoiced_on); lines.push(`Invoiced: ${show(inv.invAt)} → ${show(body.invAt)}`); }
    if (a.amount != null && Number(inv.amount) !== Number(a.amount)) { body.amount = a.amount; lines.push(`Amount (${c.cur}): ${inv.amount} → ${a.amount}`); }
    if (a.period_start !== undefined && show(inv.start) !== show(dVal(a.period_start))) { body.start = dVal(a.period_start); lines.push(`Period start: ${show(inv.start)} → ${show(body.start)}`); }
    if (a.period_end !== undefined && show(inv.end) !== show(dVal(a.period_end))) { body.end = dVal(a.period_end); lines.push(`Period end: ${show(inv.end)} → ${show(body.end)}`); }
    return gate(name, a, u, `Client invoice "${inv.label}" on ${c.name}`, lines, async () => { await call(C(c.id) + '/cinv/' + inv.id, { method: 'PATCH', body }); });
  }

  if (name === 'update_campaign') {
    const c = await loadCamp(call, a.campaign);
    const body = {}, lines = [];
    const F = [['name', 'name', 'Name'], ['client', 'client', 'Client'], ['owner', 'owner', 'Owner'], ['stage', 'stage', 'Stage'], ['budget', 'budget', `Budget (${c.cur})`], ['target_margin_pct', 'target', 'Target margin %'],
      ['start', 'start', 'Start'], ['end', 'end', 'End'], ['brief', 'brief', 'Brief'], ['markets', 'markets', 'Markets'], ['platforms', 'platforms', 'Platforms'],
      ['contact_name', 'contactName', 'Contact name'], ['contact_role', 'contactRole', 'Contact role'], ['contact_email', 'contactEmail', 'Contact email'], ['contact_phone', 'contactPhone', 'Contact phone'],
      ['agreement_status', 'cStatus', 'Agreement status'], ['agreement_value', 'cValue', `Agreement value (${c.cur})`], ['agreement_signed', 'cSigned', 'Agreement signed'], ['payment_terms', 'cTerms', 'Payment terms'], ['usage', 'cUsage', 'Usage']];
    for (const [k, key, label] of F) {
      if (a[k] === undefined) continue;
      if (['start', 'end', 'agreement_signed'].includes(k)) dOk(a[k], k);
      const v = ['start', 'end', 'agreement_signed'].includes(k) ? dVal(a[k]) : a[k];
      if (k === 'target_margin_pct' && !(v >= 0 && v < 100)) throw new Error('target_margin_pct must be 0 to 99');
      if (k === 'budget' && !(v >= 0)) throw new Error('budget must be 0 or more');
      if (String(show(c[key])) === String(show(v))) continue;
      body[key] = v; lines.push(`${label}: ${k === 'brief' || k === 'usage' ? (c[key] ? 'replaced' : 'added') + ` (${String(v).length} characters)` : show(c[key]) + ' → ' + show(v)}`);
    }
    if (a.agreement_signed && a.agreement_status === undefined && c.cStatus !== 'Signed') lines.push('Agreement status: ' + c.cStatus + ' → Signed (a signed date means it is signed)');
    if (a.billing && a.billing !== c.billing) { body.billing = a.billing; lines.push(`Billing: ${c.billing} → ${a.billing} (client invoice lines are rebuilt; refused if one has been issued)`); }
    const link = a.add_document_link;
    if (link) { if (!/^https?:\/\//i.test(link.url || '')) throw new Error('The document link must start with https://'); lines.push(`Add document link "${link.name || link.url}" (${link.kind || 'Other'})`); }
    return gate(name, a, u, `${c.name}`, lines, async () => {
      if (Object.keys(body).length) await call(C(c.id), { method: 'PATCH', body });
      if (link) await call(C(c.id) + '/docs', { method: 'POST', body: { url: link.url, name: link.name || '', kind: link.kind || 'Other' } });
    });
  }

  if (name === 'create_campaign_from_monday') {
    const [{ deals }, { campaigns }] = await Promise.all([call('/campaigns/monday-pipeline'), call('/campaigns')]);
    const d = pickIn((deals || []).map((x) => ({ ...x })), a.deal, 'monday deal', ['id']);
    const has = campaigns.find((x) => String(x.mondayItemId) === String(d.id));
    if (has) return { done: false, message: `There's already a campaign for that deal: ${has.name} [id ${has.id}].` };
    return gate(name, a, u, `New campaign from monday`, [`Create "${d.name}" for ${d.client || 'no client'}, owner ${d.owner || '—'}, ${d.cur} ${d.value}, stage ${d.stage}, target margin ${d.target != null ? d.target + '%' : '30% (default)'}, start ${d.start || '—'}. monday isn't changed.`],
      async () => {
        const r = await call('/campaigns/import-monday', { method: 'POST', body: { ids: [d.id] } });
        if (!r.imported) throw new Error('monday did not return that deal for import (it may be at a stage that can\'t be imported). Create it in Zodiac OS.');
        const { campaigns: after } = await call('/campaigns'); const n = after.find((x) => String(x.mondayItemId) === String(d.id));
        return { campaign_id: n && n.id, name: n && n.name };
      });
  }

  if (name === 'resolve_monday_mismatch') {
    const c0 = await loadCamp(call, a.campaign);
    await call(C(c0.id) + '/monday-check', { method: 'POST' }).catch(() => null);
    const { campaign: c } = await call(C(c0.id));
    const diffs = ((c.mondayCheck && c.mondayCheck.diffs) || []).filter((x) => x.use && (!a.fields || a.fields.includes(x.key)));
    if (!diffs.length) throw new Error('No differences with a monday value to use on this campaign' + (a.fields ? ' for those fields' : ''));
    const body = Object.assign({}, ...diffs.map((x) => x.use));
    return gate(name, a, u, `Use monday values on ${c.name}`, diffs.map((x) => `${x.label}: ${x.ours} → ${x.theirs} (from monday)`), async () => {
      await call(C(c.id), { method: 'PATCH', body });
      await call(C(c.id) + '/monday-check', { method: 'POST' }).catch(() => null);
    });
  }

  if (name === 'add_talent' || name === 'update_talent') {
    const { talents } = await call('/state');
    const map = { name: 'name', niche: 'niche', location: 'location', gender: 'gender', exclusivity: 'exclusivity', instagram: 'instagram', ig_followers: 'ig_followers', tiktok: 'tiktok', tt_followers: 'tt_followers', youtube: 'youtube', yt_followers: 'yt_followers', rate: 'rate', manager_name: 'manager_name', manager_email: 'manager_email', manager_phone: 'manager_phone', bio: 'public_bio' };
    const handle = (h) => low(h).replace(/^@/, '').replace(/^https?:\/\/(www\.)?(instagram|tiktok|youtube)\.com\/@?/, '').replace(/\/.*$/, '');
    const warn = [];
    if (a.niche) { const bad2 = String(a.niche).split(',').map((x) => x.trim()).filter((x) => x && !NICHES.some((nn) => low(nn) === low(x))); if (bad2.length) throw new Error(`Not an Index niche: ${bad2.join(', ')}. Use one or more of: ${NICHES.join(', ')}.`); }
    for (const k of ['ig_followers', 'tt_followers', 'yt_followers']) if (a[k] != null && !(a[k] >= 0)) throw new Error(`${k} must be 0 or more`);
    if (name === 'add_talent') {
      const nm = String(a.name || '').trim(); if (!nm) throw new Error('name is required');
      const dupe = talents.filter((t) => low(t.name) === low(nm) || ['instagram', 'tiktok', 'youtube'].some((k) => a[k] && t[k] && handle(t[k]) === handle(a[k])));
      if (dupe.length) throw new Error(`Looks like they're already in the Index: ${dupe.map((t) => `${t.name} [id ${t.id}]`).join('; ')}. Use update_talent instead.`);
      const body = {}; const lines = [];
      for (const [k, col] of Object.entries(map)) if (a[k] !== undefined && a[k] !== '') { body[col] = a[k]; lines.push(`${k.replace(/_/g, ' ')}: ${a[k]}`); }
      return gate(name, a, u, `Add ${nm} to the Talent Index`, [...lines, ...warn], async () => { const r = await call('/talents', { method: 'POST', body }); return { talent_id: r.talent.id, region: r.talent.region, location: r.talent.location }; });
    }
    const t = pick(talents, a.creator, 'creator');
    const body = {}, lines = [];
    for (const [k, col] of Object.entries(map)) {
      if (a[k] === undefined) continue;
      const v = a[k] === '' ? null : a[k];
      if (String(show(t[col])) === String(show(v))) continue;
      body[col] = v; lines.push(`${k.replace(/_/g, ' ')}: ${show(t[col])} → ${show(v)}`);
    }
    if (a.add_note) lines.push(`Add note: "${String(a.add_note).slice(0, 200)}"`);
    return gate(name, a, u, `${t.name} in the Talent Index`, [...lines, ...(lines.length ? warn : [])], async () => {
      if (Object.keys(body).length) await call('/talents/' + encodeURIComponent(t.id), { method: 'PATCH', body });
      if (a.add_note) await call('/talents/' + encodeURIComponent(t.id) + '/notes', { method: 'POST', body: { body: a.add_note } });
    });
  }
  throw new Error('Unknown tool ' + name);
}

async function run(name, a, u) {
  const call = caller(u);
  a = a || {};
  if (EDIT_TOOLS.some((t) => t.name === name)) return runEdit(name, a, u, call);
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
    let { campaign: c } = await call('/campaigns/' + encodeURIComponent(c0.id));
    const ck = c.mondayCheck && c.mondayCheck.at ? Date.parse(c.mondayCheck.at) : 0;
    if (c.mondayItemId && u.role === 'edit' && Date.now() - ck > 10 * 60000) {
      const fresh = await call('/campaigns/' + encodeURIComponent(c0.id) + '/monday-check', { method: 'POST' }).catch(() => null);
      if (fresh && fresh.campaign) c = fresh.campaign; else ({ campaign: c } = await call('/campaigns/' + encodeURIComponent(c0.id)));
    }
    const fee = (x) => (x.neg != null ? x.neg : x.initial);
    return {
      ...campSummary(c0), markets: c.markets, platforms: c.platforms, billing: c.billing, brief: String(c.brief || '').slice(0, 3000),
      client_contact: { name: c.contactName, role: c.contactRole, email: c.contactEmail, phone: c.contactPhone },
      client_agreement: { status: c.cStatus, value: c.cValue, signed: c.cSigned, terms: c.cTerms, usage: c.cUsage },
      creators: (c.infl || []).map((x) => ({
        name: x.name, creator_id: x.id, talent_id: x.tid, approved: x.approved, stage: x.stage, archived: x.archived ? (x.archived.reason || 'yes') : '',
        fee: r2(fee(x)), fee_initial: r2(x.initial), fee_negotiated: x.neg, client_rate: r2(x.client), margin: r2(x.client - fee(x)), margin_pct: pct(x.client - fee(x), x.client),
        scope: (x.scope || []).map((s) => `${s.qty || 1} × ${s.item}`).join(', '), contract: x.contract, contract_signed: x.contractSigned, invoice: x.invoice, next_action: x.next,
        deliverables: (x.deliv || []).map((d) => ({ id: d.id, name: d.name, item: d.item, platform: d.plat, stage: d.stage, content_due: d.recv, content_received: d.recvAt, live_due: d.noPost ? '' : d.live, went_live: d.liveAt,
          not_a_post: d.noPost || undefined, link_urls: (d.links || []).map((l) => l.u), creator_payment: d.crStatus && d.crStatus !== 'Not due' ? d.crStatus + (d.crPaidAt ? ' ' + d.crPaidAt : '') : undefined, creator_rate: d.crRate != null ? d.crRate : undefined })),
        creator_invoices: (x.crinv || []).map((v) => ({ number: v.number, date: v.date, amount: v.amount, paid: v.paidAt || '' })),
      })),
      client_invoices: (c.cinv || []).map((v) => ({ id: v.id, label: v.label, amount: v.amount, period_start: v.start, period_end: v.end, invoiced: v.invAt, paid: v.paidAt })),
      documents: (c.docs || []).map((d) => `${d.kind || 'File'}: ${d.name}`),
      monday_differences: c.mondayCheck && c.mondayCheck.diffs ? c.mondayCheck.diffs.map((d) => ({ field: d.key, label: d.label, zodiac_os: d.ours, monday: d.theirs, can_use_monday_value: !!d.use })) : [], monday_checked_at: c.mondayCheck && c.mondayCheck.at,
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
    // Check the details before anything is written
    const fee = a.fee == null || a.fee === '' ? null : Number(a.fee);
    if (fee != null && !(fee > 0)) throw new Error('fee must be above 0');
    if (a.client_rate != null && a.margin_pct != null) throw new Error('Give a client rate or a margin, not both');
    const cr = a.client_rate == null ? null : Number(a.client_rate);
    const mp = a.margin_pct == null ? null : Number(a.margin_pct);
    if (mp != null && !(mp >= 0 && mp < 100)) throw new Error('margin_pct must be between 0 and 99');
    const lines = (Array.isArray(a.deliverables) ? a.deliverables : []).slice(0, 20).map((d, i) => {
      const item = ITEMS.find((x) => low(x) === low(d && d.item));
      if (!item) throw new Error(`Deliverable ${i + 1}: item must be one of ${ITEMS.join(', ')}`);
      const qty = d.qty == null ? 1 : Math.round(Number(d.qty));
      if (!(qty >= 1 && qty <= 50)) throw new Error(`Deliverable ${i + 1}: qty must be 1 to 50`);
      for (const k of ['content_due', 'live']) if (d[k] && !isDate(d[k])) throw new Error(`Deliverable ${i + 1}: ${k} must be YYYY-MM-DD`);
      if (d.content_due && d.live && d.content_due > d.live) throw new Error(`Deliverable ${i + 1}: content can't be due after it goes live`);
      const rate = d.rate == null || d.rate === '' ? null : Number(d.rate);
      if (rate != null && !(rate >= 0)) throw new Error(`Deliverable ${i + 1}: rate must be 0 or more`);
      return { item, qty, rate, due: d.content_due || '', live: d.live || '' };
    });
    const [{ campaigns }, { talents }] = await Promise.all([call('/campaigns'), call('/state')]);
    const c = pick(campaigns.filter((x) => !x.archived && !/lost/i.test(x.stage)), a.campaign, 'campaign');
    const t = pick(talents, a.creator, 'creator');
    const { campaign: full } = await call('/campaigns/' + encodeURIComponent(c.id));
    if ((full.infl || []).some((x) => x.tid === t.id)) return { done: false, message: `${t.name} is already on ${c.name}. Changes to an existing creator are made in Zodiac OS.` };
    const effFee = fee;
    if (cr != null && effFee != null && !(cr > effFee)) throw new Error('client_rate must be above the creator fee');
    const cur = c.cur;
    const m = (n) => `${cur} ${Number(n).toLocaleString('en-GB', { maximumFractionDigits: 2 })}`;
    const dels = [];
    lines.forEach((l) => split(l.item, l.qty).forEach((y) => dels.push({ ...y, recv: y.noPost ? (l.live || l.due) : l.due, live: y.noPost ? '' : l.live })));
    const scope = lines.reduce((acc, l) => { const f = acc.find((x) => x.item === l.item); if (f) f.qty += l.qty; else acc.push({ item: l.item, qty: l.qty, ...(l.rate != null ? { rate: l.rate } : {}) }); return acc; }, []);
    if (a.confirm_token !== tokenFor(name, a, u)) {
      const money = fee != null
        ? `Creator fee ${m(fee)}${cr != null ? `, client rate ${m(cr)} (margin ${pct(cr - fee, cr)}%)` : `, client rate at ${mp != null ? mp : c.target}% margin = ${m(Math.round(fee / (1 - (mp != null ? mp : c.target) / 100) * 100) / 100)}`}.`
        : `No fee given, so it uses their Index rate (${t.rate || 'not set'}) at ${mp != null ? mp : c.target}% margin${cr != null ? `, client rate ${m(cr)}` : ''}.`;
      return { done: false, needs_confirmation: true,
        preview: `Add ${t.name} (${t.niche || 'no niche'}, ${t.location || t.region || 'no location'}, ${(t.total_followers || 0).toLocaleString('en-GB')} followers) to "${c.name}" for ${c.client || 'no client'} as shortlisted, not approved. ${money}`
          + (lines.length ? ` Scope: ${scope.map((x) => `${x.qty} × ${x.item}${x.rate != null ? ' @ ' + m(x.rate) : ''}`).join(', ')}. Creates ${dels.length} deliverable${dels.length === 1 ? '' : 's'}: ${dels.map((d) => d.noPost ? `${d.name}${d.recv ? ' on ' + d.recv : ''}` : `${d.name}${d.recv || d.live ? ' (' + [d.recv && 'content due ' + d.recv, d.live && 'live ' + d.live].filter(Boolean).join(', ') + ')' : ''}`).join('; ')}.` : ' No deliverables.')
          + (fee != null ? ' The fee is also saved to their Index rate, as it is when entered in Zodiac OS.' : ''),
        next: NEXT, confirm_token: tokenFor(name, a, u), campaign_id: c.id, creator_id: t.id };
    }
    const res = await call('/campaigns/' + encodeURIComponent(c.id) + '/talents', { method: 'POST', body: { talent_id: t.id } });
    const added = (res.campaign.infl || []).find((x) => x.tid === t.id);
    if (!added) throw new Error('Could not add them');
    const base = P => '/campaigns/' + encodeURIComponent(c.id) + '/talents/' + encodeURIComponent(added.id) + P;
    const steps = [];
    try {
      const patch = {};
      if (fee != null) patch.initial = fee;
      if (mp != null) patch.margin = mp;
      if (scope.length) patch.scope = scope;
      if (Object.keys(patch).length) { await call(base(''), { method: 'PATCH', body: patch }); steps.push('fee and scope'); }
      if (cr != null) await call(base(''), { method: 'PATCH', body: { client_rate: cr } });
      for (const d of dels) await call(base('/deliverables'), { method: 'POST', body: { name: d.name, platform: d.platform, item: d.item, qty: d.qty, noPost: d.noPost, recv: d.recv || null, live: d.live || null } });
    } catch (e) {
      return { done: 'partly', message: `${t.name} was added to ${c.name}, but saving the rest stopped: ${e.message}. Finish it in Zodiac OS.` };
    }
    const { campaign: after } = await call('/campaigns/' + encodeURIComponent(c.id));
    const x = (after.infl || []).find((i) => i.tid === t.id) || added;
    const f2 = x.neg != null ? x.neg : x.initial;
    return { done: true, message: `Added ${t.name} to ${c.name} as shortlisted${dels.length ? ` with ${dels.length} deliverable${dels.length === 1 ? '' : 's'}` : ''}. It shows in Zodiac OS now, logged as added by ${u.name}.`,
      currency: cur, fee: r2(f2), client_rate: r2(x.client), margin_pct: pct(x.client - f2, x.client),
      scope: (x.scope || []).map((s2) => `${s2.qty} × ${s2.item}`).join(', '), deliverables: (x.deliv || []).map((d) => ({ name: d.name, content_due: d.recv, live: d.live })) };
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
      instructions: `Zodiac OS is Zodiac Global's internal system: the Talent Index (creators) and Campaign Management (campaigns, creators, deliverables, invoices), plus the live monday sales pipeline. You are connected as ${u.name}. ${u.canChange ? 'You can also make changes (creators, deliverables, invoices, campaign details, monday mismatches, Talent Index): every change tool returns a preview first; show it and only send the confirm_token once the user says yes. Nothing is ever written to monday and nothing can be marked paid.' : 'Everything is read-only except shortlisting a creator on a campaign, which needs the user\'s confirmation. Other change tools will say changes are not switched on for this person.'} Money is in the campaign's currency unless a field ends in _gbp. Use British English.` });
  }
  if (method === 'ping') return reply({});
  if (method === 'tools/list') return reply({ tools: [...TOOLS, ...EDIT_TOOLS] });
  if (method === 'tools/call') {
    const name = params && params.name;
    if (![...TOOLS, ...EDIT_TOOLS].some((t) => t.name === name)) return fail(-32602, 'Unknown tool: ' + name);
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
