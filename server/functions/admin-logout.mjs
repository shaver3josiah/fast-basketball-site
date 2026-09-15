// POST /api/admin-logout: clear the session cookie. Used two ways by admin.js: a manual
// sign-out, and ending a "This visit" session that a fresh or reopened tab inherited, which
// is what makes closing the tab a real logout rather than a cosmetic one.
import { clearSessionCookie } from './lib/auth.mjs';

export default async (request) => {
  const status = request.method === 'POST' ? 200 : 405;
  return new Response(JSON.stringify(status === 200 ? { ok: true } : { error: 'method not allowed' }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'Set-Cookie': clearSessionCookie() }
  });
};
