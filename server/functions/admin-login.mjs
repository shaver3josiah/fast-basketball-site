import { checkPassword, createSessionCookie } from './lib/auth.mjs';
import { checkRateLimit, clientIp } from './lib/rate-limit.mjs';

// This endpoint is unauthenticated by definition and one correct guess hands over the
// whole admin panel, so it is the one function that most needs a limit. Ten tries per
// quarter hour per IP leaves a fat-fingered owner alone and makes guessing pointless.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

export default async (request, context) => {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405 });
  }

  const ip = clientIp(request, context);
  if (!(await checkRateLimit('admin-login:' + ip, { windowMs: WINDOW_MS, max: MAX_ATTEMPTS }))) {
    return new Response(JSON.stringify({ error: 'too many attempts, try again later' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': String(WINDOW_MS / 1000) }
    });
  }

  let payload;
  try {
    payload = await request.json();
  } catch (err) {
    return new Response(JSON.stringify({ error: 'invalid request body' }), { status: 400 });
  }
  if (!checkPassword(payload.password)) {
    return new Response(JSON.stringify({ error: 'wrong password' }), { status: 401 });
  }
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': createSessionCookie()
    }
  });
};
