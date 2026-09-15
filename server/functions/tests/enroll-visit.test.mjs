// Run: node --test server/functions/tests/enroll-visit.test.mjs
//
// Offline. FB_LOCAL sends the leads store to .local/leads.json under a scratch cwd and makes
// the rate limiter skip Blobs. Email is captured by stubbing fetch, the way checkout.test does.
process.env.FB_LOCAL = 'true';
delete process.env.RESEND_API_KEY;
delete process.env.PLAYBOOK_FROM_EMAIL;

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), 'fb-visit-')));
const { default: handler } = await import('../enroll-visit.mjs');

const CTX = { ip: '127.0.0.1' };
function post(body) {
  return new Request('http://localhost/api/enroll-visit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
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
const VID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

test('a malformed or eventless beacon writes nothing and answers 204', async () => {
  clearRecords();
  assert.equal((await handler(post('not json'), CTX)).status, 204);
  assert.equal((await handler(post({ vid: VID }), CTX)).status, 204);
  assert.equal((await handler(post({ event: 'open' }), CTX)).status, 204);
  assert.equal((await handler(post({ vid: 'bad vid!', event: 'open' }), CTX)).status, 204);
  assert.equal(records().length, 0);
});

test('open then leave records one visit row with the dwell and the tag', async () => {
  clearRecords();
  await handler(post({ vid: VID, event: 'open', ref: 'Smith family' }), CTX);
  let rows = records();
  assert.equal(rows.length, 1, 'one row for the visit');
  assert.equal(rows[0].type, 'visit');
  assert.equal(rows[0].ref, 'Smith family');
  assert.equal(rows[0].submitted, false);

  await new Promise((r) => setTimeout(r, 25));
  await handler(post({ vid: VID, event: 'leave', submitted: false }), CTX);
  rows = records();
  assert.equal(rows.length, 1, 'the leave updates the same row, it does not add one');
  assert.ok(rows[0].dwellMs > 0, 'dwell was measured on the server clock');
  assert.equal(rows[0].ref, 'Smith family', 'the tag survives a leave that omits it');
});

test('a tagged family that looks and leaves without submitting emails Blake once', async () => {
  clearRecords();
  process.env.RESEND_API_KEY = 'test-key';
  process.env.PLAYBOOK_FROM_EMAIL = 'from@example.test';
  process.env.ENROLL_NOTIFY_EMAIL = 'blake@example.test';
  const sends = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sends.push(JSON.parse(init.body)); return { ok: true }; };
  try {
    const vid = 'ffffffff-1111-2222-3333-444444444444';
    await handler(post({ vid, event: 'open', ref: 'Jones' }), CTX);
    // Force the dwell past the 20s email threshold by ageing openedAt in the stored row.
    const file = path.resolve('.local/leads.json');
    const rows = records();
    rows[0].openedAt = Date.now() - 60000;
    fs.writeFileSync(file, JSON.stringify(rows));

    await handler(post({ vid, event: 'leave', submitted: false }), CTX);
    assert.equal(sends.length, 1, 'exactly one follow-up email');
    assert.deepEqual(sends[0].to, ['blake@example.test']);
    assert.ok(sends[0].subject.includes('Jones'), 'the email names the family');
    assert.equal(records()[0].emailed, true, 'the row is marked so a repeat leave does not email again');

    await handler(post({ vid, event: 'leave', submitted: false }), CTX);
    assert.equal(sends.length, 1, 'a second leave beacon does not send a second email');
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.RESEND_API_KEY;
    delete process.env.PLAYBOOK_FROM_EMAIL;
    delete process.env.ENROLL_NOTIFY_EMAIL;
  }
});

test('an untagged visit is logged but never emailed, and a submitted one is not either', async () => {
  clearRecords();
  process.env.RESEND_API_KEY = 'test-key';
  process.env.PLAYBOOK_FROM_EMAIL = 'from@example.test';
  const sends = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sends.push(JSON.parse(init.body)); return { ok: true }; };
  try {
    // Untagged, long dwell: logged, no email (Blake can't act on "someone").
    const a = 'aaaa0000-1111-2222-3333-444444444444';
    await handler(post({ vid: a, event: 'open' }), CTX);
    let rows = records(); rows[0].openedAt = Date.now() - 60000; fs.writeFileSync(path.resolve('.local/leads.json'), JSON.stringify(rows));
    await handler(post({ vid: a, event: 'leave', submitted: false }), CTX);

    // Tagged but submitted: no "did not finish" email.
    const b = 'bbbb0000-1111-2222-3333-444444444444';
    await handler(post({ vid: b, event: 'open', ref: 'Lee' }), CTX);
    rows = records(); rows.find((r) => r.vid === b).openedAt = Date.now() - 60000; fs.writeFileSync(path.resolve('.local/leads.json'), JSON.stringify(rows));
    await handler(post({ vid: b, event: 'leave', submitted: true }), CTX);

    assert.equal(sends.length, 0, 'no emails for untagged or submitted visits');
    assert.equal(records().length, 2, 'both are still logged');
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.RESEND_API_KEY;
    delete process.env.PLAYBOOK_FROM_EMAIL;
  }
});
