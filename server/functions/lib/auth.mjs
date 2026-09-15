import { createHmac, timingSafeEqual } from 'node:crypto';

// How long a session lasts is the owner's choice at sign-in, from this allowlist. Anything
// off it is refused rather than clamped, so a crafted request can never mint a longer
// session than the UI offers. The cookie's own Max-Age and the signed expiry inside it are
// both set from the chosen value, so the browser and the server agree on the logout moment.
export const SESSION_DURATIONS = {
  visit: 2 * 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000
};
const DEFAULT_DURATION = 'day';

export function resolveTtlMs(label) {
  return Object.prototype.hasOwnProperty.call(SESSION_DURATIONS, label) ? SESSION_DURATIONS[label] : null;
}

// __session is the only cookie name Firebase Hosting forwards to a function. Any other
// name is stripped at the CDN, so the admin panel would log in and then be signed out on
// its very next request. Renaming it is the whole fix. It is also why device recognition
// rides on the login itself (an emailed code) rather than a second long-lived cookie: a
// second cookie would never reach the function.
const COOKIE_NAME = '__session';

function sign(value, secret) {
  return createHmac('sha256', secret).update(value).digest('hex');
}

// Secure is correct and non-negotiable in production. The local dev server runs on
// plain http://localhost, and while current browsers do treat localhost as a secure
// context and accept the flag there, that is a browser policy the admin login should
// not be betting on. FB_LOCAL is set by scripts/dev-server.mjs and nothing else, so
// this can never drop Secure on a deployed site.
const SECURE = process.env.FB_LOCAL === 'true' ? '' : ' Secure;';

export function createSessionCookie(ttlMs, persist = true) {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) throw new Error('ADMIN_SESSION_SECRET is not configured');
  const life = Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : SESSION_DURATIONS[DEFAULT_DURATION];
  const expires = Date.now() + life;
  const value = String(expires);
  const signature = sign(value, secret);
  const cookieValue = value + '.' + signature;
  // persist=false makes a browser-session cookie: no Max-Age, so the browser drops it when the
  // session ends (the "This visit" option). The signed expiry inside still caps it server-side
  // either way, so a session cookie a browser chooses to keep alive still dies on schedule.
  const age = persist ? '; Max-Age=' + Math.floor(life / 1000) : '';
  return COOKIE_NAME + '=' + cookieValue + '; Path=/; HttpOnly;' + SECURE + ' SameSite=Strict' + age;
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

// HMAC of the emailed code, so the store never holds the code itself. Same secret as the
// session cookie: one secret to rotate, and both are owner-auth material.
export function hashOtp(code) {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) throw new Error('ADMIN_SESSION_SECRET is not configured');
  return sign(String(code), secret + ':otp');
}

// Constant-time compare of two hex hashes of equal length.
export function sameHash(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
