// Run: node --test server/functions/tests/admin-auth.test.mjs
//
// Offline. FB_LOCAL sends the OTP + rate-limit stores to a scratch dir, and a fixed secret
// makes the hashes and cookie signatures deterministic. Set before the handlers import.
process.env.FB_LOCAL = 'true';
process.env.ADMIN_SESSION_SECRET = 'test-secret-1234567890';
delete process.env.RESEND_API_KEY;
delete process.env.PLAYBOOK_FROM_EMAIL;

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), 'fb-auth-')));
const { default: login } = await import('../admin-login.mjs');
const { default: requestCode } = await import('../admin-otp-request.mjs');
const { hashOtp, verifyRequestSession, SESSION_DURATIONS } = await import('../lib/auth.mjs');
const { setOtp, getOtp } = await import('../lib/otp.mjs');

const CTX = { ip: '10.0.0.1' };
function post(handler, body) {
  return handler(new Request('http://localhost/api/x', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  }), CTX);
}
// Turn a Set-Cookie into a Request carrying that cookie, to test verifyRequestSession.
function withCookie(setCookie) {
  const pair = setCookie.split(';')[0];
  return new Request('http://localhost/api/x', { headers: { cookie: pair } });
}
function maxAge(setCookie) {
  const m = /Max-Age=(\d+)/.exec(setCookie);
  return m ? Number(m[1]) : null;
}

test('requesting a code stores a hashed code and emails it, never the code in the clear', async () => {
  const sends = [];
  process.env.RESEND_API_KEY = 'k'; process.env.PLAYBOOK_FROM_EMAIL = 'from@test';
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sends.push(JSON.parse(init.body)); return { ok: true }; };
  try {
    const res = await post(requestCode, {});
    assert.equal(res.status, 200);
    assert.equal(sends.length, 1, 'one email');
    const code = (sends[0].subject.match(/\b(\d{6})\b/) || [])[1];
    assert.ok(code, 'the email carries a 6-digit code');
    const stored = await getOtp();
    assert.ok(stored && stored.hash, 'a record is stored');
    assert.notEqual(stored.hash, code, 'the store holds a hash, not the code');
    assert.equal(stored.hash, hashOtp(code), 'and it is the hash of the emailed code');
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.RESEND_API_KEY; delete process.env.PLAYBOOK_FROM_EMAIL;
  }
});

test('the right code with a valid duration mints a session cookie of that length', async () => {
  await setOtp({ hash: hashOtp('123456'), expires: Date.now() + 60000, tries: 0 });
  const res = await post(login, { code: '123456', ttl: 'week' });
  assert.equal(res.status, 200);
  const setCookie = res.headers.get('set-cookie');
  assert.ok(setCookie && setCookie.startsWith('__session='), 'a __session cookie is set');
  assert.equal(maxAge(setCookie), Math.floor(SESSION_DURATIONS.week / 1000), 'Max-Age matches the chosen week');
  assert.equal(verifyRequestSession(withCookie(setCookie)), true, 'the cookie verifies as a live session');
  assert.equal(await getOtp(), null, 'the code is single-use: burned on success');
});

test('"This visit" is a browser-session cookie (no Max-Age) and reports persist:false', async () => {
  await setOtp({ hash: hashOtp('333333'), expires: Date.now() + 60000, tries: 0 });
  const res = await post(login, { code: '333333', ttl: 'visit' });
  assert.equal(res.status, 200);
  const data = await res.clone().json();
  assert.equal(data.persist, false, 'the client is told this session does not persist');
  const setCookie = res.headers.get('set-cookie');
  assert.ok(setCookie.startsWith('__session='), 'still sets the session cookie');
  assert.equal(maxAge(setCookie), null, 'but with no Max-Age, so the browser drops it on close');
  assert.equal(verifyRequestSession(withCookie(setCookie)), true, 'and it still verifies while the tab lives');
});

test('a longer choice persists: Max-Age is set and persist is true', async () => {
  await setOtp({ hash: hashOtp('444444'), expires: Date.now() + 60000, tries: 0 });
  const res = await post(login, { code: '444444', ttl: 'month' });
  const data = await res.clone().json();
  assert.equal(data.persist, true);
  assert.equal(maxAge(res.headers.get('set-cookie')), Math.floor(SESSION_DURATIONS.month / 1000));
});

test('a duration off the allowlist is refused', async () => {
  await setOtp({ hash: hashOtp('222222'), expires: Date.now() + 60000, tries: 0 });
  const res = await post(login, { code: '222222', ttl: 'forever' });
  assert.equal(res.status, 400);
  assert.ok(await getOtp(), 'a rejected duration does not burn the code');
});

test('a wrong code counts against the five tries, then locks the code out', async () => {
  await setOtp({ hash: hashOtp('654321'), expires: Date.now() + 60000, tries: 0 });
  for (let i = 1; i <= 5; i++) {
    const res = await post(login, { code: '000000', ttl: 'day' });
    assert.equal(res.status, 401, 'wrong code is 401 (attempt ' + i + ')');
  }
  assert.equal((await getOtp()).tries, 5, 'tries were counted');
  const locked = await post(login, { code: '654321', ttl: 'day' });
  assert.equal(locked.status, 401, 'even the right code is refused once the tries are spent');
  assert.equal(await getOtp(), null, 'and the code is cleared, forcing a fresh request');
});

test('an expired code is refused', async () => {
  await setOtp({ hash: hashOtp('999999'), expires: Date.now() - 1000, tries: 0 });
  const res = await post(login, { code: '999999', ttl: 'day' });
  assert.equal(res.status, 401);
});

test('a malformed code shape never reaches the store', async () => {
  await setOtp({ hash: hashOtp('111111'), expires: Date.now() + 60000, tries: 0 });
  const res = await post(login, { code: 'abc', ttl: 'day' });
  assert.equal(res.status, 401);
  assert.equal((await getOtp()).tries, 0, 'a shape check is not a try');
});
