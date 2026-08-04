import { checkPassword, createSessionCookie } from './lib/auth.mjs';

export default async (request) => {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405 });
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
