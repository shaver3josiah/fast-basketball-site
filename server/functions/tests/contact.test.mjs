// Run: node --test server/functions/tests/contact.test.mjs
//
// Fully offline, the way checkout.test.mjs is: FB_LOCAL sends the leads store to
// .local/leads.json under a scratch cwd and makes the rate limiter a no-op, and with no
// RESEND_API_KEY sendEmail returns false without touching the network. What this pins is
// the September 2026 bot filter and the one place the site hands out the number: a request
// that passes is stored and answered with the contact details, a request that trips a tell
// is stored with `spam` set, thanked, and told nothing.
process.env.FB_LOCAL = 'true';
delete process.env.RESEND_API_KEY;
delete process.env.PLAYBOOK_FROM_EMAIL;

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CONTACT } from '../../../src/lib/site-config.mjs';

process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), 'fb-contact-')));
const { default: handler, spamReason } = await import('../contact.mjs');

const CTX = { ip: '127.0.0.1' };

function post(body, contentType = 'application/json', extra = {}) {
  return new Request('http://localhost/api/contact', {
    method: 'POST',
    headers: { 'content-type': contentType, ...extra },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });
}

function records() {
  const file = path.resolve('.local/leads.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
}

function clearRecords() {
  const file = path.resolve('.local/leads.json');
  if (fs.existsSync(file)) fs.writeFileSync(file, '[]');
}

// A page loaded a minute ago, filled in by a person.
const VALID = {
  name: 'Jordan Parent', email: 'parent@example.com', phone: '(954) 555 0100', area: 'Parkland',
  hearAbout: 'Friend, family, or referral',
  message: 'Eighth grade guard, wants more minutes.', guardianConfirmed: true, 'ct-hp': '',
  ts: String(Date.now() - 60_000)
};

test('spamReason: no ts or a too-fast ts on the JSON path, links in the message', () => {
  const now = 1_800_000_000_000;
  assert.equal(spamReason({ message: 'hi' }, { isForm: false, now }), 'fast');
  assert.equal(spamReason({ message: 'hi', ts: String(now - 1000) }, { isForm: false, now }), 'fast');
  assert.equal(spamReason({ message: 'hi', ts: String(now - 5000) }, { isForm: false, now }), '');
  assert.equal(spamReason({ message: 'see http://a.example and https://b.example', ts: String(now - 5000) }, { isForm: false, now }), 'links');
  assert.equal(spamReason({ message: 'one link https://a.example is fine', ts: String(now - 5000) }, { isForm: false, now }), '');
  // The no-JS form post cannot carry a ts and is not punished for it.
  assert.equal(spamReason({ message: 'hi' }, { isForm: true, now }), '');
  assert.equal(spamReason({ message: 'www.a.example and www.b.example' }, { isForm: true, now }), 'links');
});

test('a real request is stored, and only then is the number handed out', async () => {
  clearRecords();
  const res = await handler(post(VALID), CTX);
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.deepEqual(out, { ok: true, phone: CONTACT.phone, tel: CONTACT.tel, email: CONTACT.email });
  const rows = records();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].type, 'contact');
  assert.equal(rows[0].email, 'parent@example.com');
  assert.equal(rows[0].hearAbout, 'Friend, family, or referral');
  assert.equal(rows[0].spam, undefined);
});

test('a post with no ts is stored flagged and told nothing', async () => {
  clearRecords();
  const { ts, ...noTs } = VALID;
  const res = await handler(post(noTs), CTX);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  const rows = records();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].spam, 'fast');
});

test('a message full of links is stored flagged and told nothing', async () => {
  clearRecords();
  const res = await handler(post({ ...VALID, message: 'Buy https://x.example now https://y.example' }), CTX);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(records()[0].spam, 'links');
});

test('the honeypot is thanked and nothing is stored', async () => {
  clearRecords();
  const res = await handler(post({ ...VALID, 'ct-hp': 'filled by a bot' }), CTX);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(records().length, 0);
});

test('a missing name, a bad email or no guardian tick is 422 and not stored', async () => {
  clearRecords();
  assert.equal((await handler(post({ ...VALID, name: '' }), CTX)).status, 422);
  assert.equal((await handler(post({ ...VALID, email: 'nope' }), CTX)).status, 422);
  assert.equal((await handler(post({ ...VALID, guardianConfirmed: 'yes' }), CTX)).status, 422);
  assert.equal(records().length, 0);
});

test('the no-JS form post is stored and sent back to #ctDone on the page it came from', async () => {
  clearRecords();
  const body = new URLSearchParams({
    name: 'Jordan Parent', email: 'parent@example.com', area: 'Parkland', message: 'hi', 'guardian-confirmed': 'yes'
  }).toString();
  const res = await handler(post(body, 'application/x-www-form-urlencoded', { referer: 'http://localhost/contact' }), CTX);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/contact#ctDone');
  assert.equal(records().length, 1);
  assert.equal(records()[0].spam, undefined);
});
