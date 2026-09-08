// Run: node --test netlify/functions/checkout.test.mjs
//
// Fully offline. FB_LOCAL makes the rate limiter skip Netlify Blobs, and with no
// STRIPE_SECRET_KEY the handler stops at 503 before any network call. Both must be set
// before the handler module loads, hence the dynamic import.
process.env.FB_LOCAL = 'true';
delete process.env.STRIPE_SECRET_KEY;

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkoutSpec } from '../../src/lib/plans.mjs';

const { default: handler, sessionParams } = await import('./checkout.mjs');

const SITE = 'https://example.test/';
const NOW = 1_800_000_000;

function post(body, contentType = 'application/json') {
  return new Request('http://localhost/.netlify/functions/checkout', {
    method: 'POST',
    headers: { 'content-type': contentType },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });
}

const VALID = { plan: 'group-3m-1x', pay: 'monthly', email: 'parent@example.com', guardianConfirmed: true, 'en-hp': '' };

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
  assert.equal(p.custom_fields.length, 2);
  assert.deepEqual(p.custom_fields.map((f) => f.key), ['player_name', 'agree_name']);
  for (const f of p.custom_fields) {
    assert.equal(f.type, 'text');
    assert.equal(f.label.type, 'custom');
    assert.ok(f.label.custom.length <= 50, 'Stripe caps custom labels at 50 characters');
  }
  assert.equal(p.success_url, 'https://example.test/enroll/thanks');
  assert.equal(p.cancel_url, 'https://example.test/enroll?plan=eval&pay=full');
  assert.equal(p.expires_at, NOW + 86400);

  assert.deepEqual(p.metadata, { plan: 'eval', pay: 'full' });
  assert.deepEqual(p.payment_intent_data, { metadata: p.metadata });
  assert.equal(p.customer_creation, 'always');
  assert.equal(p.subscription_data, undefined);
});

test('sessionParams for an installment plan (group-6m-1x, monthly)', () => {
  const spec = checkoutSpec('group-6m-1x', 'monthly');
  const p = sessionParams(spec, { email: 'parent@example.com', priceId: 'price_456', siteUrl: SITE, nowSeconds: NOW });

  assert.equal(p.mode, 'subscription');
  assert.deepEqual(p.line_items, [{ price: 'price_456', quantity: 1 }]);
  assert.deepEqual(p.subscription_data, { metadata: p.metadata });
  assert.equal(p.payment_intent_data, undefined);
  assert.equal(p.customer_creation, undefined, 'a payment-mode-only parameter, Stripe rejects it on subscriptions');
  assert.equal(p.cancel_url, 'https://example.test/enroll?plan=group-6m-1x&pay=monthly');
  assert.equal(p.expires_at, NOW + 86400);

  assert.deepEqual(Object.keys(p.metadata).sort(), ['months', 'noticeDays', 'pay', 'plan', 'totalCents']);
  for (const [k, v] of Object.entries(p.metadata)) assert.equal(typeof v, 'string', 'metadata.' + k + ' must be a string');
});

test('GET is 405', async () => {
  const res = await handler(new Request('http://localhost/.netlify/functions/checkout'), { ip: '127.0.0.1' });
  assert.equal(res.status, 405);
});

test('malformed JSON is 400', async () => {
  const res = await handler(post('{not json'), { ip: '127.0.0.1' });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'invalid request body' });
});

test('tampered plan is 422, before any Stripe call', async () => {
  for (const bad of [{ plan: 'group-99m-9x' }, { plan: '__proto__' }, { plan: 'eval', pay: 'monthly' }]) {
    const res = await handler(post({ ...VALID, ...bad }), { ip: '127.0.0.1' });
    assert.equal(res.status, 422, JSON.stringify(bad));
  }
});

test('missing guardian confirmation is 422', async () => {
  for (const guardianConfirmed of [undefined, false, 'true', 'yes']) {
    const res = await handler(post({ ...VALID, guardianConfirmed }), { ip: '127.0.0.1' });
    assert.equal(res.status, 422, String(guardianConfirmed));
  }
});

test('bad email is 422', async () => {
  const res = await handler(post({ ...VALID, email: 'not-an-email' }), { ip: '127.0.0.1' });
  assert.equal(res.status, 422);
});

test('honeypot filled gets the thanks page without touching Stripe', async () => {
  const res = await handler(post({ ...VALID, 'en-hp': 'http://spam' }), { ip: '127.0.0.1' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { url: '/enroll/thanks' });
});

test('urlencoded honeypot is a 303 to the thanks page', async () => {
  const form = new URLSearchParams({ plan: 'eval', pay: 'full', email: 'parent@example.com', 'guardian-confirmed': 'yes', 'en-hp': 'x' });
  const res = await handler(post(form.toString(), 'application/x-www-form-urlencoded'), { ip: '127.0.0.1' });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/enroll/thanks');
});

test('urlencoded failure is a 303 back to the form with the selection kept', async () => {
  const form = new URLSearchParams({ plan: 'eval', pay: 'full', email: 'parent@example.com', 'en-hp': '' });
  const res = await handler(post(form.toString(), 'application/x-www-form-urlencoded'), { ip: '127.0.0.1' });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/enroll?plan=eval&pay=full&err=1');
});

test('valid request with no STRIPE_SECRET_KEY is 503 payments not configured', async () => {
  const res = await handler(post(VALID), { ip: '127.0.0.1' });
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { error: 'payments not configured' });
  assert.equal(res.headers.get('content-type'), 'application/json');

  const form = new URLSearchParams({ plan: 'group-3m-1x', pay: 'monthly', email: 'parent@example.com', 'guardian-confirmed': 'yes', 'en-hp': '' });
  const formRes = await handler(post(form.toString(), 'application/x-www-form-urlencoded'), { ip: '127.0.0.1' });
  assert.equal(formRes.status, 303);
  assert.equal(formRes.headers.get('location'), '/enroll?plan=group-3m-1x&pay=monthly&err=1');
});
