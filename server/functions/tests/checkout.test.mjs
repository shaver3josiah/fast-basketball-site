// Run: node --test netlify/functions/tests/checkout.test.mjs
//
// Fully offline. FB_LOCAL makes the rate limiter skip Netlify Blobs and sends the leads
// store to .local/leads.json under cwd, so the test runs in a scratch directory. With no
// STRIPE_SECRET_KEY the handler saves the registration and stops at 503 before any network
// call. All of it must be set before the handler module loads, hence the dynamic import.
process.env.FB_LOCAL = 'true';
delete process.env.STRIPE_SECRET_KEY;
delete process.env.RESEND_API_KEY;
delete process.env.PLAYBOOK_FROM_EMAIL;

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkoutSpec } from '../../../src/lib/plans.mjs';
import { sampleRegistration } from '../../../src/lib/registration.mjs';

process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), 'fb-checkout-')));
const { default: handler, sessionParams, registrationRecord } = await import('../checkout.mjs');

const SITE = 'https://example.test/';
const NOW = 1_800_000_000;
const CTX = { ip: '127.0.0.1' };

function post(body, contentType = 'application/json') {
  return new Request('http://localhost/.netlify/functions/checkout', {
    method: 'POST',
    headers: { 'content-type': contentType },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });
}

function records() {
  const file = path.resolve('.local/leads.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
}

// records() re-reads the file every call, so emptying the array it returns changes nothing.
// The tests below count rows to prove a rejected registration was never stored, so a test
// that legitimately stores one has to clear the store rather than the copy.
function clearRecords() {
  const file = path.resolve('.local/leads.json');
  if (fs.existsSync(file)) fs.writeFileSync(file, '[]');
}

const VALID = { ...sampleRegistration(), plan: 'group-3m-1x', pay: 'monthly', 'en-hp': '' };

test('sessionParams for a one-off payment (eval, full)', () => {
  const spec = checkoutSpec('eval', 'full');
  const p = sessionParams(spec, { email: 'parent@example.com', priceId: 'price_123', siteUrl: SITE, nowSeconds: NOW });

  assert.equal(p.mode, 'payment');
  assert.deepEqual(p.line_items, [{ price: 'price_123', quantity: 1 }]);
  assert.equal(p.customer_email, 'parent@example.com');
  assert.deepEqual(p.phone_number_collection, { enabled: true });
  assert.equal(p.billing_address_collection, 'auto');
  assert.deepEqual(p.consent_collection, { terms_of_service: 'required' });
  assert.ok(p.custom_text.terms_of_service_acceptance.message.includes('https://example.test/terms'));
  // The player's name is on the registration now; only the typed agreement stays on Stripe.
  assert.deepEqual(p.custom_fields.map((f) => f.key), ['agree_name']);
  for (const f of p.custom_fields) {
    assert.equal(f.type, 'text');
    assert.equal(f.label.type, 'custom');
    assert.ok(f.label.custom.length <= 50, 'Stripe caps custom labels at 50 characters');
  }
  assert.equal(p.success_url, 'https://example.test/enroll/thanks');
  assert.equal(p.cancel_url, 'https://example.test/enroll?plan=eval&pay=full');
  assert.equal(p.expires_at, NOW + 82800, 'an hour under Stripe\'s 24h ceiling, not on it');
  assert.equal(p.client_reference_id, undefined, 'no registration, no reference');

  assert.deepEqual(p.metadata, { plan: 'eval', pay: 'full' });
  assert.deepEqual(p.payment_intent_data, { metadata: p.metadata });
  assert.equal(p.customer_creation, 'always');
  assert.equal(p.subscription_data, undefined);
});

test('sessionParams for an installment plan (group-6m-1x, monthly) with a registration', () => {
  const spec = checkoutSpec('group-6m-1x', 'monthly');
  const id = '0d1f2a3b-4c5d-4e6f-8a7b-9c0d1e2f3a4b';
  const p = sessionParams(spec, { email: 'parent@example.com', priceId: 'price_456', siteUrl: SITE, nowSeconds: NOW, registrationId: id });

  assert.equal(p.mode, 'subscription');
  assert.deepEqual(p.line_items, [{ price: 'price_456', quantity: 1 }]);
  assert.deepEqual(p.subscription_data, { metadata: p.metadata });
  assert.equal(p.payment_intent_data, undefined);
  assert.equal(p.customer_creation, undefined, 'a payment-mode-only parameter, Stripe rejects it on subscriptions');
  assert.equal(p.cancel_url, 'https://example.test/enroll?plan=group-6m-1x&pay=monthly');
  assert.equal(p.expires_at, NOW + 82800);
  assert.equal(p.client_reference_id, id);

  assert.deepEqual(Object.keys(p.metadata).sort(), ['months', 'noticeDays', 'pay', 'plan', 'registrationId', 'totalCents']);
  assert.equal(p.metadata.registrationId, id, 'the webhook finds the record by this');
  for (const [k, v] of Object.entries(p.metadata)) assert.equal(typeof v, 'string', 'metadata.' + k + ' must be a string');
});

test('registrationRecord is an enrollment row awaiting payment, with the shared columns filled', () => {
  const spec = checkoutSpec('group-3m-1x', 'monthly');
  const r = registrationRecord({ id: 'abc', timestamp: '2026-09-09T15:00:00.000Z', values: { ...sampleRegistration(), goals: '' }, spec });
  assert.equal(r.type, 'enrollment');
  assert.equal(r.registrationId, 'abc');
  assert.equal(r.name, 'Ben Parent');
  assert.equal(r.playerName, 'Jordan Parent');
  assert.equal(r.email, 'parent@example.com');
  assert.equal(r.paymentStatus, 'pending');
  assert.equal(r.notified, false);
  assert.equal(r.amount, '$183.33', 'the first invoice');
  assert.equal(r.termTotalCents, 55000, 'the term, which is what the page promised');
  assert.equal(r.months, 3);
  assert.equal(r.noticeDays, 7);
  assert.equal(r.insurancePolicy, 'XYZ123456');
  assert.equal(r.signature, undefined, 'the drawing pad was removed in September 2026');
});

test('GET is 405', async () => {
  const res = await handler(new Request('http://localhost/api/checkout'), CTX);
  assert.equal(res.status, 405);
});

test('malformed JSON is 400', async () => {
  const res = await handler(post('{not json'), CTX);
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'invalid request body' });
});

// The no-JS path came back when the signature pad went: a canvas cannot be drawn on without
// scripting, but every other field posts fine. urlencoded in, 303 out.
test('a form POST with JavaScript off is validated, and a bad one goes back with the plan kept', async () => {
  const res = await handler(post('plan=eval&pay=full', 'application/x-www-form-urlencoded'), CTX);
  assert.equal(res.status, 303, 'a 422 body of JSON would be a dead end in a browser');
  assert.equal(res.headers.get('location'), '/enroll?plan=eval&pay=full&err=1#enErr');
  assert.equal(records().length, 0, 'an invalid registration is never stored');
});

test('a complete form POST with JavaScript off is stored, and its checkboxes become booleans', async () => {
  const form = new URLSearchParams({ ...sampleRegistration(), plan: 'group-3m-1x', pay: 'monthly', 'en-hp': '' });
  // A browser sends a ticked box as its value and omits an unticked one; sampleRegistration
  // carries real booleans, which URLSearchParams would stringify to "true" and validation
  // would then reject. This is the shape the markup in build.mjs actually posts.
  form.set('reviewed', 'yes');
  form.set('terms', 'yes');
  const res = await handler(post(form.toString(), 'application/x-www-form-urlencoded'), CTX);
  assert.equal(res.status, 303);
  // No Stripe key in this suite, so the parent lands on the thanks page: the registration is
  // saved and Blake has been emailed, which is the whole of what could happen for them.
  assert.equal(res.headers.get('location'), '/enroll/thanks');
  const saved = records().find((r) => r.playerName === 'Jordan Parent' && r.pay === 'monthly');
  assert.ok(saved, 'the registration was stored');
  assert.equal(saved.reviewed, true);
  assert.equal(saved.termsAccepted, true);
  clearRecords();
});

test('an unticked box in a form POST is refused, not coerced', async () => {
  const form = new URLSearchParams({ ...sampleRegistration(), plan: 'group-3m-1x', pay: 'monthly' });
  form.set('reviewed', 'yes');
  form.delete('terms');
  const res = await handler(post(form.toString(), 'application/x-www-form-urlencoded'), CTX);
  assert.equal(res.status, 303);
  assert.match(res.headers.get('location'), /err=1#enErr$/);
});

test('honeypot filled gets the thanks page without writing or touching Stripe', async () => {
  const res = await handler(post({ ...VALID, 'en-hp': 'http://spam' }), CTX);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { url: '/enroll/thanks' });
  assert.equal(records().length, 0);
});

test('tampered plan is 422 naming the plan, before anything is written', async () => {
  for (const bad of [{ plan: 'group-99m-9x' }, { plan: '__proto__' }, { plan: 'eval', pay: 'monthly' }]) {
    const res = await handler(post({ ...VALID, ...bad }), CTX);
    assert.equal(res.status, 422, JSON.stringify(bad));
    const body = await res.json();
    assert.ok(body.errors.plan, 'plan error named');
  }
  assert.equal(records().length, 0);
});

test('a missing answer or an unticked box is 422 naming every field, nothing written', async () => {
  const res = await handler(post({ ...VALID, email: 'nope', insuranceProvider: '', terms: 'yes' }), CTX);
  assert.equal(res.status, 422);
  const body = await res.json();
  assert.deepEqual(Object.keys(body.errors).sort(), ['email', 'insuranceProvider', 'terms']);
  assert.equal(body.error, body.errors.email, 'the first problem is the headline');
  assert.equal(records().length, 0);
});

test('a valid registration with no STRIPE_SECRET_KEY is saved first, then answered 503 with its id', async () => {
  const res = await handler(post(VALID), CTX);
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.error, 'payments not configured');
  assert.match(body.registrationId, /^[0-9a-f-]{36}$/);

  const all = records();
  assert.equal(all.length, 1, 'the registration is in the store before Stripe was even asked');
  const r = all[0];
  assert.equal(r.key, 'registration:' + body.registrationId);
  assert.equal(r.type, 'enrollment');
  assert.equal(r.paymentStatus, 'pending');
  assert.equal(r.name, 'Ben Parent');
  assert.equal(r.playerName, 'Jordan Parent');
  assert.equal(r.plan, 'group-3m-1x');
  assert.equal(r.pay, 'monthly');
  assert.equal(r.school, 'Westglades Middle');
  assert.equal(r.reviewed, true);
  assert.equal(r.termsAccepted, true);
  assert.equal(r.signature, undefined, 'no signature is collected any more');
  assert.equal(r['en-hp'], undefined, 'the honeypot is not stored');
  assert.equal(r.registrationId, body.registrationId);

  // Back from Stripe's cancel link, the same tab resubmits with the id: one record, updated.
  const again = await handler(post({ ...VALID, registrationId: body.registrationId, grade: '9th' }), CTX);
  assert.equal((await again.json()).registrationId, body.registrationId, 'the pending id is kept');
  assert.equal(records().length, 1, 'no second record for the same tab');
  assert.equal(records()[0].grade, '9th', 'and the newer answers win');

  // An id that is not a pending registration of ours is never reused.
  const stranger = await handler(post({ ...VALID, registrationId: '11111111-2222-4333-8444-555555555555' }), CTX);
  const s = await stranger.json();
  assert.notEqual(s.registrationId, '11111111-2222-4333-8444-555555555555');
  assert.equal(records().length, 2);
});

test('the registration email goes to the owner with every answer in it', async () => {
  process.env.RESEND_API_KEY = 'test-key';
  process.env.PLAYBOOK_FROM_EMAIL = 'from@example.test';
  process.env.ENROLL_NOTIFY_EMAIL = 'blake@example.test';
  const sends = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sends.push(JSON.parse(init.body)); return { ok: true }; };
  try {
    const res = await handler(post({ ...VALID, plan: 'group-6m-unlimited', pay: 'full' }), CTX);
    assert.equal(res.status, 503, 'still no Stripe key; the email does not depend on it');
    assert.equal(sends.length, 1);
    const mail = sends[0];
    assert.deepEqual(mail.to, ['blake@example.test']);
    assert.equal(mail.subject, 'New registration, payment pending: Jordan Parent (Group Training Membership, 6 months, unlimited)');
    assert.ok(mail.html.includes('Florida Blue'), 'every answer is in the table');
    assert.equal(mail.attachments, undefined, 'nothing is attached now the drawing pad is gone');
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.RESEND_API_KEY;
    delete process.env.PLAYBOOK_FROM_EMAIL;
    delete process.env.ENROLL_NOTIFY_EMAIL;
  }
});
