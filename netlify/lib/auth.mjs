import { createHmac, timingSafeEqual } from 'node:crypto';

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

export function issueToken(role) {
  const payload = Buffer.from(JSON.stringify({ role, exp: Date.now() + TTL_MS })).toString('base64url');
  return `${payload}.${sign(payload)}`;
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
