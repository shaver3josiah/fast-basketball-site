// POST /api/admin-login: exchange the emailed six-digit code for a session. No password any
// more; the code (from admin-otp-request) IS the login and proves control of the owner's
// inbox, so a session only ever starts on a device that just passed an email challenge. That
// is the "recognized device" gate: publishing needs a session, and a session needs a code.
//
// The body carries the code and the chosen session length. Ten guesses per quarter hour per
// IP on top of five tries per code makes a six-digit code impractical to guess in its life.
import { createSessionCookie, resolveTtlMs, hashOtp, sameHash } from './lib/auth.mjs';
import { getOtp, clearOtp, setOtp } from './lib/otp.mjs';
import { checkRateLimit, clientIp } from './lib/rate-limit.mjs';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const MAX_TRIES_PER_CODE = 5;

const json = (status, body, extraHeaders = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', ...extraHeaders }
});

export default async (request, context) => {
  if (request.method !== 'POST') return json(405, { error: 'method not allowed' });

  const ip = clientIp(request, context);
  if (!(await checkRateLimit('admin-login:' + ip, { windowMs: WINDOW_MS, max: MAX_ATTEMPTS }))) {
    return json(429, { error: 'too many attempts, try again later' }, { 'Retry-After': String(WINDOW_MS / 1000) });
  }

  let payload;
  try { payload = await request.json(); } catch { return json(400, { error: 'invalid request body' }); }

  const ttlMs = resolveTtlMs(payload && payload.ttl);
  if (ttlMs === null) return json(400, { error: 'pick how long to stay signed in' });

  const code = typeof payload.code === 'string' ? payload.code.trim() : '';
  if (!/^\d{6}$/.test(code)) return json(401, { error: 'enter the 6-digit code from your email' });

  const otp = await getOtp();
  if (!otp || !otp.expires || otp.expires < Date.now()) {
    return json(401, { error: 'that code has expired. Send yourself a new one.' });
  }
  if ((otp.tries || 0) >= MAX_TRIES_PER_CODE) {
    await clearOtp();
    return json(401, { error: 'too many wrong tries. Send yourself a new code.' });
  }
  if (!sameHash(hashOtp(code), otp.hash)) {
    await setOtp({ ...otp, tries: (otp.tries || 0) + 1 });
    return json(401, { error: 'wrong code. Check it and try again.' });
  }

  // Single use: burn the code the moment it works.
  await clearOtp();
  return json(200, { ok: true, until: Date.now() + ttlMs }, {
    'Cache-Control': 'private, no-store',
    'Set-Cookie': createSessionCookie(ttlMs)
  });
};
