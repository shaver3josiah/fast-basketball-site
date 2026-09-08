// Run: node --test netlify/functions/stripe-webhook.test.mjs
//
// Offline. Events are signed with the SDK's own test-header helper against a fake secret,
// so the real constructEvent runs; there is no Stripe account and no network. Records land
// in .local/leads.json inside a fresh temp directory.
//
// The env has to be set before the handler loads: leads.mjs reads FB_LOCAL at import
// time, so the handler comes in through a dynamic import at the bottom of the setup.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Stripe from 'stripe';
import { checkoutSpec } from '../../../src/lib/plans.mjs';

const SECRET = 'whsec_test_secret';
process.env.FB_LOCAL = 'true';
process.env.STRIPE_WEBHOOK_SECRET = SECRET;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.RESEND_API_KEY;
process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), 'fb-webhook-')));

const { default: handler } = await import('../stripe-webhook.mjs');

// 2026-09-07 15:00 UTC. Three months minus seven days lands on 2026-11-30.
const CREATED = Date.UTC(2026, 8, 7, 15, 0, 0) / 1000;

function sessionEvent(id, spec, overrides = {}) {
  return {
    id: 'evt_' + id,
    object: 'event',
    type: 'checkout.session.completed',
    created: CREATED,
    livemode: false,
    data: {
      object: {
        id: 'cs_test_' + id,
        object: 'checkout.session',
        mode: spec.mode,
        payment_status: 'paid',
        amount_total: spec.amountCents,
        customer: 'cus_test_1',
        subscription: null,
        customer_email: null,
        customer_details: { email: 'ben@example.com', phone: '+15551234567', name: 'Ben Parent' },
        consent: { terms_of_service: 'accepted', promotions: null },
        custom_fields: [
          { key: 'player_name', type: 'text', label: { type: 'custom', custom: "Player's full name" }, text: { value: 'Jordan Parent' } },
          { key: 'agree_name', type: 'text', label: { type: 'custom', custom: 'Type your full name to agree to the terms' }, text: { value: 'Ben Parent' } }
        ],
        metadata: spec.metadata,
        ...overrides
      }
    }
  };
}

const sign = (payload) => Stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });

function post(payload, header) {
  const headers = header ? { 'stripe-signature': header } : {};
  return handler(new Request('http://localhost/.netlify/functions/stripe-webhook', { method: 'POST', headers, body: payload }), {});
}

function records() {
  const file = path.resolve('.local/leads.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
}

{
  const payload = JSON.stringify(sessionEvent('1', checkoutSpec('group-3m-1x', 'full')));
  const header = sign(payload);

  const res = await post(payload, header);
  assert.equal(res.status, 200, 'a signed completed session is accepted');
  assert.deepEqual(await res.json(), { ok: true });

  const all = records();
  assert.equal(all.length, 1, 'exactly one record written');
  const r = all[0];
  assert.equal(r.key, 'enrollment:cs_test_1');
  assert.equal(r.type, 'enrollment');
  assert.equal(r.name, 'Ben Parent', 'name is the typed-to-agree field');
  assert.equal(r.playerName, 'Jordan Parent');
  assert.equal(r.email, 'ben@example.com');
  assert.equal(r.phone, '+15551234567');
  assert.equal(r.plan, 'group-3m-1x');
  assert.equal(r.planLabel, 'Group Training Membership, 3 months, once a week');
  assert.equal(r.pay, 'full');
  assert.equal(r.amountCents, 45000);
  assert.equal(r.amount, '$450');
  assert.equal(r.months, 3);
  assert.equal(r.termTotalCents, 45000);
  assert.equal(r.noticeDays, 7);
  assert.equal(r.startDate, '2026-09-07');
  assert.equal(r.cancelNoticeBy, '2026-11-30', 'start + 3 months - 7 days');
  assert.equal(r.termsAccepted, true);
  assert.equal(r.paymentStatus, 'paid');
  assert.equal(r.livemode, false);
  assert.equal(r.subscriptionId, null);

  // Stripe retries and dashboard resends deliver the same session again. RESEND_API_KEY is
  // unset here, so the owner email never went out and the record is not marked notified: a
  // redelivery is a real second attempt at the email, and must still leave one record.
  const replay = await post(payload, header);
  assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), { ok: true }, 'an un-notified enrollment is retried, not skipped');
  assert.equal(records().length, 1, 'still one record after replay');

  // A body that does not match the signature must be refused before anything is written.
  const tampered = payload.replace('"amount_total":45000', '"amount_total":1');
  assert.notEqual(tampered, payload, 'fixture actually changed');
  const bad = await post(tampered, header);
  assert.equal(bad.status, 400, 'tampered payload with the old header is rejected');
  assert.equal(records().length, 1, 'tampered payload wrote nothing');

  const noHeader = await post(payload);
  assert.equal(noHeader.status, 400, 'missing signature header is rejected');
}

{
  const payload = JSON.stringify({ id: 'evt_x', object: 'event', type: 'payment_intent.created', created: CREATED, livemode: false, data: { object: { id: 'pi_1' } } });
  const res = await post(payload, sign(payload));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ignored: 'payment_intent.created' });
  assert.equal(records().length, 1, 'unhandled events write nothing');
}

{
  const payload = JSON.stringify(sessionEvent('2', checkoutSpec('eval', 'full')));
  const res = await post(payload, sign(payload));
  assert.equal(res.status, 200);
  const r = records().find((x) => x.key === 'enrollment:cs_test_2');
  assert.ok(r, 'evaluation recorded');
  assert.equal(r.amount, '$50');
  assert.equal(r.months, null);
  assert.equal(r.cancelNoticeBy, null, 'evaluations have no term to give notice on');
}

{
  // The record must survive the schedule step failing. With no STRIPE_SECRET_KEY (and
  // possibly no lib/stripe.mjs yet) the step cannot run; the enrollment is still saved
  // and the response is still 200 so Stripe does not retry.
  const spec = checkoutSpec('group-3m-1x', 'monthly');
  const payload = JSON.stringify(sessionEvent('3', spec, { subscription: 'sub_test_3' }));
  const res = await post(payload, sign(payload));
  assert.equal(res.status, 200, 'a subscription session with no Stripe client still answers 200');
  assert.deepEqual(await res.json(), { ok: true });
  const r = records().find((x) => x.key === 'enrollment:cs_test_3');
  assert.ok(r, 'monthly enrollment recorded even though the schedule could not be attached');
  assert.equal(r.subscriptionId, 'sub_test_3');
  assert.equal(r.amount, '$183.33');
}

{
  const res = await handler(new Request('http://localhost/x', { method: 'GET' }), {});
  assert.equal(res.status, 405);

  delete process.env.STRIPE_WEBHOOK_SECRET;
  const payload = JSON.stringify(sessionEvent('4', checkoutSpec('eval', 'full')));
  const unconfigured = await post(payload, sign(payload));
  assert.equal(unconfigured.status, 503, 'no webhook secret is a clear 503, not a 400');
  assert.deepEqual(await unconfigured.json(), { error: 'payments not configured' });
  assert.equal(records().length, 3, 'nothing written without a secret');
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
}

{
  // With the owner email actually going out, the record is marked notified and the next
  // delivery of the same session is the duplicate Stripe's retries are meant to hit.
  process.env.RESEND_API_KEY = 'test-key';
  process.env.PLAYBOOK_FROM_EMAIL = 'from@example.test';
  const sends = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sends.push(JSON.parse(init.body)); return { ok: true }; };

  const spec = checkoutSpec('group-6m-1x', 'monthly');
  const payload = JSON.stringify(sessionEvent('5', spec, { subscription: 'sub_test_5' }));
  const header = sign(payload);
  assert.deepEqual(await (await post(payload, header)).json(), { ok: true });
  assert.equal(sends.length, 1, 'one owner email');
  assert.ok(sends[0].subject.startsWith('New enrollment: '), sends[0].subject);
  assert.ok(sends[0].html.includes('Welcome email to paste'), 'a paid enrollment gets the pasteable welcome');
  assert.deepEqual(await (await post(payload, header)).json(), { duplicate: true }, 'a notified record is not emailed again');
  assert.equal(sends.length, 1, 'no second owner email');
  assert.equal(records().filter((x) => x.key === 'enrollment:cs_test_5').length, 1, 'marking notified does not add a record');

  // Stripe completes the session before the money lands: a card that attaches but fails its
  // first invoice arrives as 'unpaid'. Record it, but never hand Blake a welcome to paste.
  const unpaid = JSON.stringify(sessionEvent('6', spec, { subscription: 'sub_test_6', payment_status: 'unpaid' }));
  assert.deepEqual(await (await post(unpaid, sign(unpaid))).json(), { ok: true });
  assert.equal(sends.length, 2);
  assert.ok(sends[1].subject.startsWith('UNPAID'), sends[1].subject);
  assert.ok(!sends[1].html.includes('Welcome email to paste'), 'no pasteable welcome for an unpaid session');
  assert.ok(records().find((x) => x.key === 'enrollment:cs_test_6'), 'an unpaid enrollment is still recorded');

  globalThis.fetch = realFetch;
  delete process.env.RESEND_API_KEY;
  delete process.env.PLAYBOOK_FROM_EMAIL;
}

{
  // A leads-store failure has to be answered non-2xx: a 200 would tell Stripe a paid
  // enrollment was handled when nothing was recorded and nobody was emailed, and Stripe
  // would never deliver it again. '.local' as a plain file makes addLead's mkdirSync throw,
  // which is the shape of Blobs being unavailable.
  const broken = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-webhook-broken-'));
  const back = process.cwd();
  process.chdir(broken);
  fs.writeFileSync(path.resolve('.local'), 'not a directory');
  const payload = JSON.stringify(sessionEvent('7', checkoutSpec('eval', 'full')));
  const res = await post(payload, sign(payload));
  assert.equal(res.status, 500, 'a store failure is retried by Stripe, not swallowed as 200');
  process.chdir(back);
}

console.log('stripe-webhook: ok');
