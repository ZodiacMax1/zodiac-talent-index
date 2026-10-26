import { createHmac, timingSafeEqual, scryptSync, randomBytes } from 'node:crypto';

const TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error('AUTH_SECRET is not set');
  return s;
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

function sign(payload) {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

// Returns 'edit', 'view' or null
export function roleForPassword(pw) {
  if (!pw) return null;
  const edit = process.env.EDIT_PASSWORD;
  const view = process.env.VIEW_PASSWORD;
  if (edit && safeEqual(pw, edit)) return 'edit';
  if (view && safeEqual(pw, view)) return 'view';
  return null;
}

export function issueToken(role, extra = {}) {
  const payload = Buffer.from(JSON.stringify({ role, ...extra, exp: Date.now() + TTL_MS })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

// Full identity from the token: { role, uid?, name? } or null
export function identityFromRequest(req) {
  const h = req.headers.get('authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  const [payload, sig] = token.split('.');
  if (!payload || !sig || !safeEqual(sig, sign(payload))) return null;
  try {
    const t = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!t.exp || t.exp < Date.now()) return null;
    if (t.role !== 'edit' && t.role !== 'view') return null;
    return { role: t.role, uid: t.uid || null, name: t.name || null };
  } catch {
    return null;
  }
}

export function hashPassword(pw) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('base64')}$${scryptSync(String(pw), salt, 32).toString('base64')}`;
}
export function verifyPassword(pw, stored) {
  const [alg, saltB64, hashB64] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const got = scryptSync(String(pw), Buffer.from(saltB64, 'base64'), expected.length);
  return got.length === expected.length && timingSafeEqual(got, expected);
}
// Easy to read out loud, no look-alike characters
export function tempPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  return Array.from(randomBytes(12), (b) => chars[b % chars.length]).join('');
}

// Returns 'edit' | 'view' | null
export function roleFromRequest(req) {
  const h = req.headers.get('authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  const [payload, sig] = token.split('.');
  if (!payload || !sig || !safeEqual(sig, sign(payload))) return null;
  try {
    const { role, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!exp || exp < Date.now()) return null;
    return role === 'edit' || role === 'view' ? role : null;
  } catch {
    return null;
  }
}
