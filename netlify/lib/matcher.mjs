import { pool } from './db.mjs';

const MODEL = () => process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
const k = (n) => (n >= 1e6 ? (n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'K' : String(n));

const SYSTEM = `You are the talent-matching assistant for Zodiac Global, a talent management and influencer marketing agency working across the UK and UAE.
You are given the agency's full talent roster and a brand brief. Pick the talent who best fit the brief.

How to judge fit, in order of importance:
1. Niche and brand fit: does the talent's content genuinely suit the product, category and tone of the brief?
2. Audience and location: match any country/city, gender or audience requirements in the brief. If the brief names a market, strongly prefer talent based there.
3. Platform and reach: use the platform(s) the brief asks for. If a budget or tier is implied (micro, mid, mega), respect it. Follower counts are per platform.
4. Exclusive talent are represented exclusively by Zodiac; note it only if relevant.

Rules:
- Only use talent ids that appear in the roster. Never invent talent, facts or numbers.
- Give each reason in one or two plain sentences that a busy account manager can read at a glance. Cite concrete facts from the roster (niche, location, follower counts, and bio). No hype.
- Score 1-10 for fit (10 = ideal). Return up to 15 matches, best first, and only include talent scoring 6 or higher. Fewer is fine if few fit.
- If the brief is thin or the roster has gaps (for example no suitable male fitness creators in the UAE), say so in "gaps".

Reply with a single JSON object and nothing else:
{"understood": "one or two sentences: the brand/product, audience, market, platforms and budget as you read them",
 "matches": [{"id": "...", "score": 9, "reason": "..."}],
 "gaps": "anything missing or ambiguous, or empty string"}`;

async function loadRoster() {
  const db = pool();
  const talents = (await db.query(
    `SELECT id, name, niche, location, gender, exclusivity, ig_followers, tt_followers, yt_followers, public_bio
       FROM talents WHERE deleted_at IS NULL ORDER BY name`)).rows;
  const brands = {};
  return { talents, brands };
}

function rosterText({ talents, brands }) {
  return talents.map((t) => {
    const f = [t.ig_followers ? 'IG ' + k(Number(t.ig_followers)) : '', t.tt_followers ? 'TT ' + k(Number(t.tt_followers)) : '', t.yt_followers ? 'YT ' + k(Number(t.yt_followers)) : ''].filter(Boolean).join(' ') || 'no counts';
    const bits = [t.id, t.name, t.niche || '-', t.location || '-', t.gender || '-', t.exclusivity === 'Exclusive' ? 'Exclusive' : 'Non-excl', f];
    if (t.public_bio) bits.push(String(t.public_bio).replace(/\s+/g, ' ').slice(0, 110));
    return bits.join(' | ');
  }).join('\n');
}

function parseJson(text) {
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('The assistant did not return a usable answer. Try again.');
  return JSON.parse(text.slice(start, end + 1));
}

export async function runMatch(id) {
  const db = pool();
  const fail = async (msg) => { await db.query(`UPDATE brief_matches SET status = 'failed', error = $2 WHERE id = $1`, [id, msg]); };
  try {
    const row = (await db.query('SELECT brief FROM brief_matches WHERE id = $1', [id])).rows[0];
    if (!row) return;
    if (!process.env.ANTHROPIC_API_KEY) return fail('ANTHROPIC_API_KEY is not set in Netlify.');
    const roster = await loadRoster();
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: MODEL(),
        max_tokens: 3000,
        system: [{ type: 'text', text: SYSTEM }],
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'ROSTER (one talent per line: id | name | niches | locations | gender | status | followers | bio)\n' + rosterText(roster), cache_control: { type: 'ephemeral' } },
            { type: 'text', text: 'BRIEF:\n' + row.brief },
          ],
        }],
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const m = body && body.error && body.error.message ? body.error.message : 'HTTP ' + res.status;
      return fail(res.status === 401 ? 'The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in Netlify.' : res.status === 429 ? 'The AI service is busy or out of credit. Try again shortly.' : 'AI request failed: ' + m);
    }
    const text = (body.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
    const out = parseJson(text);
    const valid = new Set(roster.talents.map((t) => t.id));
    const matches = (Array.isArray(out.matches) ? out.matches : [])
      .filter((m) => m && valid.has(m.id))
      .map((m) => ({ id: m.id, score: Math.max(1, Math.min(10, Math.round(Number(m.score) || 0))), reason: String(m.reason || '').slice(0, 400) }))
      .slice(0, 15);
    const seen = new Set();
    const uniq = matches.filter((m) => (seen.has(m.id) ? false : seen.add(m.id)));
    await db.query(`UPDATE brief_matches SET status = 'done', result = $2::jsonb WHERE id = $1`, [id, JSON.stringify({ understood: String(out.understood || '').slice(0, 600), gaps: String(out.gaps || '').slice(0, 600), matches: uniq })]);
  } catch (e) {
    console.error('brief match failed', e);
    await fail(/usable answer/.test(String(e.message)) ? e.message : 'Something went wrong matching this brief. Try again.');
  }
}
