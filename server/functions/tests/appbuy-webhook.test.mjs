// Run: node --test server/functions/tests/appbuy-webhook.test.mjs
//
// The webhook's tool-purchase branch, offline. Events are signed with the SDK's own test-header
// helper against a fake secret, so the real constructEvent runs; there is no Stripe account and
// no network. Its own file rather than cases inside stripe-webhook.test.mjs because both files
// chdir into their own temp directory at import time and share a leads store within it.
//
// Env before the imports: leads.mjs and ledger.mjs read FB_LOCAL at import time.

import { test } from 'node:test';
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
delete process.env.PLAYBOOK_FROM_EMAIL;
process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), 'fb-appbuy-hook-')));

const { default: handler } = await import('../stripe-webhook.mjs');
const { addLead } = await import('../lib/leads.mjs');
const { listEntries } = await import('../lib/ledger.mjs');

const CREATED = Date.UTC(2026, 8, 17, 15, 0, 0) / 1000;

function toolEvent(id, spec, overrides = {}, type = 'checkout.session.completed') {
  return {
    id: 'evt_' + id,
    object: 'event',
    type,
    created: CREATED,
    livemode: true,
    data: {
      object: {
        id: 'cs_live_' + id,
        object: 'checkout.session',
        mode: spec.mode,
        payment_status: 'paid',
        amount_total: spec.amountCents,
        currency: 'usd',
        customer: 'cus_1',
        subscription: spec.mode === 'subscription' ? 'sub_1' : null,
        customer_email: null,
        customer_details: { email: 'buyer@example.test', phone: '+15551234567', name: 'Dana Buyer' },
        consent: { terms_of_service: 'accepted', promotions: null },
        custom_fields: [
          { key: 'agree_name', type: 'text', label: { type: 'custom', custom: 'Type your full name' }, text: { value: 'Dana Buyer' } }
        ],
        metadata: { ...spec.metadata, registrationId: id },
        ...overrides
      }
    }
  };
}

const sign = (payload) => Stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });

function post(event) {
  const payload = JSON.stringify(event);
  return handler(new Request('http://localhost/api/stripe-webhook', {
    method: 'POST', headers: { 'stripe-signature': sign(payload) }, body: payload
  }), {});
}

function records() {
  const file = path.resolve('.local/leads.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
}
function clear() {
  for (const f of ['.local/leads.json', '.local/commissions.json']) if (fs.existsSync(f)) fs.rmSync(f);
}
const ledger = async () => (await listEntries()).entries;
const find = (key) => records().find((r) => r.key === key);

async function pendingOrder(id, over = {}) {
  await addLead('apporder:' + id, {
    type: 'apporder', orderId: id, timestamp: '2026-09-17T14:00:00.000Z',
    name: 'Dana Buyer', email: 'buyer@example.test', role: 'A parent or guardian',
    product: 'shotform', productLabel: 'Shot Form Watcher', pay: 'full',
    paymentStatus: 'pending', ...over
  });
}

test('a paid tool purchase completes its own order row and never becomes an enrollment', async () => {
  clear();
  await pendingOrder('order-1');
  const res = await post(toolEvent('order-1', checkoutSpec('shotform', 'full')));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, delivered: false });

  const rows = records();
  assert.equal(rows.length, 1, 'the pending order is completed in place, not doubled');
  const row = find('apporder:order-1');
  assert.equal(row.type, 'apporder', 'a tool purchase must never be filed as an enrollment');
  assert.equal(row.paymentStatus, 'paid');
  assert.equal(row.amountCents, 10000);
  assert.equal(row.sessionId, 'cs_live_order-1');
  assert.equal(row.agreeName, 'Dana Buyer');
  assert.equal(row.accessUrl, 'https://fast-basketball.com/shotform');
  assert.equal(row.termsAccepted, true);
  // Nothing an enrollment carries and a tool purchase cannot have.
  assert.equal(row.cancelNoticeBy, undefined);
  assert.equal(row.playerName, undefined);
});

test('the access link on the row is the product the buyer actually paid for', async () => {
  clear();
  await pendingOrder('order-2', { product: 'dribble', productLabel: 'Dribble Listener' });
  const spec = checkoutSpec('dribble', 'm5');
  await post(toolEvent('order-2', spec));
  const row = find('apporder:order-2');
  assert.equal(row.accessUrl, 'https://fast-basketball.com/dribble');
  assert.equal(row.months, 5);
  assert.equal(row.amountCents, 400);
  assert.equal(row.priceCents, 2000, 'the published price rides on the session metadata');
});

test('a tool purchase accrues at 50 percent from the webhook, not the training rate', async () => {
  clear();
  await pendingOrder('order-3');
  await post(toolEvent('order-3', checkoutSpec('shotform', 'full')));
  const [e] = await ledger();
  assert.equal(e.product, 'app');
  assert.equal(e.rate, 0.5);
  assert.equal(e.commissionCents, 5000);
});

test('a subscription tool session accrues nothing here: its money arrives as invoices', async () => {
  clear();
  await pendingOrder('order-4');
  await post(toolEvent('order-4', checkoutSpec('shotform', 'm3')));
  // The double-count rule. Accruing on both the session and invoice.paid would pay twice on
  // month one of every payment plan.
  assert.equal((await ledger()).length, 0);
  assert.equal(find('apporder:order-4').paymentStatus, 'paid');
});

test('a payment plan gets a schedule, because without one it would bill forever', async () => {
  // Stripe Checkout creates an OPEN-ENDED subscription. spec.iterations and endBehavior 'cancel'
  // do nothing until a subscription schedule is wrapped around it, so this is the whole reason a
  // 5 month plan ever stops. There is no Stripe key in this test, so the attempt cannot succeed;
  // what is asserted is that the attempt is MADE and that its failure is reported to the owner
  // rather than swallowed. The enrollment path has said the same thing for months.
  clear();
  await pendingOrder('order-11');
  const errs = [];
  const realErr = console.error;
  console.error = (m) => errs.push(String(m));
  try {
    const res = await post(toolEvent('order-11', checkoutSpec('shotform', 'm5')));
    assert.equal(res.status, 200);
  } finally {
    console.error = realErr;
  }
  assert.ok(
    errs.some((m) => m.includes('schedule for sub_1')),
    'attachSchedule must run for a tool payment plan: ' + JSON.stringify(errs)
  );
});

test('a one-off tool purchase needs no schedule and does not try for one', async () => {
  clear();
  await pendingOrder('order-12');
  const errs = [];
  const realErr = console.error;
  console.error = (m) => errs.push(String(m));
  try {
    await post(toolEvent('order-12', checkoutSpec('shotform', 'full')));
  } finally {
    console.error = realErr;
  }
  assert.ok(!errs.some((m) => m.includes('schedule for')), JSON.stringify(errs));
});

test('an unpaid tool session is recorded and nothing is sent to the buyer', async () => {
  clear();
  await pendingOrder('order-5');
  const res = await post(toolEvent('order-5', checkoutSpec('shotform', 'full'), { payment_status: 'unpaid' }));
  assert.equal((await res.json()).delivered, false, 'an unpaid order must never be delivered');
  assert.equal(find('apporder:order-5').paymentStatus, 'unpaid');
  assert.equal((await ledger()).length, 0, 'unpaid money is not money');
  // And it must NOT be marked notified: see the next case for why that matters.
  assert.notEqual(find('apporder:order-5').notified, true);
});

test('a buyer whose card failed and was fixed still gets their link on a resend', async () => {
  // A subscription checkout whose first invoice fails completes as 'unpaid'. When the buyer
  // updates their card the session's payment_status becomes 'paid', so Blake resending that
  // event from the dashboard is the thing that finally delivers. Marking the unpaid attempt
  // `notified` would make that resend answer `duplicate` and the buyer, who has now paid,
  // would never receive what they bought.
  clear();
  await pendingOrder('order-13');
  const spec = checkoutSpec('shotform', 'm2');
  await post(toolEvent('order-13', spec, { payment_status: 'unpaid' }));
  assert.notEqual(find('apporder:order-13').notified, true);

  const paidAgain = await post({ ...toolEvent('order-13', spec), id: 'evt_after_card_fixed' });
  const body = await paidAgain.json();
  assert.notEqual(body.duplicate, true, 'the resend must not be dismissed as a duplicate');
  assert.equal(find('apporder:order-13').paymentStatus, 'paid');
});

test('a replayed event does not write a second row or a second ledger entry', async () => {
  clear();
  await pendingOrder('order-6');
  const event = toolEvent('order-6', checkoutSpec('shotform', 'full'));
  await post(event);
  const after = records().length;
  const entries = (await ledger()).length;
  // Stripe retries a non-2xx for three days and a dashboard resend makes a NEW event id for
  // the SAME payment, so idempotency cannot key on the event.
  await post({ ...event, id: 'evt_resent' });
  assert.equal(records().length, after);
  assert.equal((await ledger()).length, entries);
});

test('a session naming a product that is not in the catalog is refused, not guessed at', async () => {
  clear();
  const event = toolEvent('order-7', checkoutSpec('shotform', 'full'));
  event.data.object.metadata.plan = 'shotform-deluxe-gold';
  const res = await post(event);
  // Not an app key, so it falls through to the enrollment path, which records what Stripe
  // knows rather than inventing a product. What must NOT happen is a tool being delivered.
  assert.equal(res.status, 200);
  assert.equal(records().every((r) => r.accessUrl === undefined), true);
});

test('an expired tool checkout is marked abandoned quietly, with no chase-them alert', async () => {
  clear();
  await pendingOrder('order-8');
  const spec = checkoutSpec('shotform', 'full');
  const event = toolEvent('order-8', spec, {}, 'checkout.session.expired');
  const res = await post(event);
  assert.deepEqual(await res.json(), { ok: true, quiet: true });
  assert.equal(find('apporder:order-8').paymentStatus, 'abandoned');
});

test('a dashboard session with no order id still gets a row of its own', async () => {
  clear();
  const event = toolEvent('order-9', checkoutSpec('dribble', 'full'));
  delete event.data.object.metadata.registrationId;
  const res = await post(event);
  assert.equal(res.status, 200);
  const row = records().find((r) => r.key === 'apporder:session-cs_live_order-9');
  assert.equal(row.type, 'apporder');
  assert.equal(row.accessUrl, 'https://fast-basketball.com/dribble');
});

test('a retry of a DASHBOARD sale does not write twice or deliver twice', async () => {
  // The duplicate check has to read the same key the row was written under. A dashboard sale
  // has no order id, so it is keyed on the session; reading the order key instead would find
  // nothing and email the buyer their link again on every Stripe retry.
  clear();
  process.env.RESEND_API_KEY = 'test';
  process.env.PLAYBOOK_FROM_EMAIL = 'coach@example.test';
  const sends = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    sends.push(JSON.parse(opts.body).to);
    return { ok: true };
  };
  try {
    const event = toolEvent('order-10', checkoutSpec('dribble', 'full'));
    delete event.data.object.metadata.registrationId;
    await post(event);
    const afterFirst = sends.length;
    assert.ok(afterFirst >= 2, 'the buyer and the owner are both emailed once: ' + JSON.stringify(sends));
    // Stripe makes a NEW event id when the same payment is resent from the dashboard.
    const second = await post({ ...event, id: 'evt_resent_dashboard' });
    assert.deepEqual(await second.json(), { duplicate: true });
    assert.equal(sends.length, afterFirst, 'a retry must not email the buyer a second link');
    assert.equal(records().length, 1);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.RESEND_API_KEY;
    delete process.env.PLAYBOOK_FROM_EMAIL;
  }
});
