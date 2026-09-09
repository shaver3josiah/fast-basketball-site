import { createHmac, timingSafeEqual } from 'node:crypto';

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const COOKIE_NAME = 'fb_admin';

function sign(value, secret) {
  return createHmac('sha256', secret).update(value).digest('hex');
}

// Secure is correct and non-negotiable in production. The local dev server runs on
// plain http://localhost, and while current browsers do treat localhost as a secure
// context and accept the flag there, that is a browser policy the admin login should
// not be betting on. FB_LOCAL is set by scripts/dev-server.mjs and nothing else, so
// this can never drop Secure on a deployed site.
const SECURE = process.env.FB_LOCAL === 'true' ? '' : ' Secure;';

export function createSessionCookie() {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) throw new Error('ADMIN_SESSION_SECRET is not configured');
  const expires = Date.now() + SESSION_TTL_MS;
  const value = String(expires);
  const signature = sign(value, secret);
  const cookieValue = value + '.' + signature;
  return COOKIE_NAME + '=' + cookieValue + '; Path=/; HttpOnly;' + SECURE + ' SameSite=Strict; Max-Age=' + Math.floor(SESSION_TTL_MS / 1000);
}

export function clearSessionCookie() {
  return COOKIE_NAME + '=; Path=/; HttpOnly;' + SECURE + ' SameSite=Strict; Max-Age=0';
}

export function verifyRequestSession(request) {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) return false;
  const cookieHeader = request.headers.get('cookie') || '';
  const match = cookieHeader.split(';').map((c) => c.trim()).find((c) => c.startsWith(COOKIE_NAME + '='));
  if (!match) return false;
  const cookieValue = match.slice(COOKIE_NAME.length + 1);
  const parts = cookieValue.split('.');
  if (parts.length !== 2) return false;
  const [value, signature] = parts;
  const expected = sign(value, secret);
  if (expected.length !== signature.length) return false;
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return false;
  const expires = Number(value);
  return Number.isFinite(expires) && expires > Date.now();
}

export function checkPassword(candidate) {
  const configured = process.env.ADMIN_PASSWORD;
  if (!configured || !candidate) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(configured);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
