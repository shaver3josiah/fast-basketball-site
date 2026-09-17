// Run: node --test server/functions/tests/appbuy.test.mjs
//
// The /appbuy path end to end, offline: the order form's validator, the checkout handler's
// branch between an athlete registration and a tool purchase, and the 50/50 accrual that
// follows. Money code, so every case here asks "what does a wrong answer cost", not "does the
// happy path work".
//
// FB_LOCAL must be set BEFORE the imports: leads.mjs and ledger.mjs capture it into a
// module-level const at import time, so setting it afterwards silently takes the Firestore
// path. With no STRIPE_SECRET_KEY the handler saves the order and stops at 503 before any
// network call, which is exactly the graceful path a live site falls back to.
process.env.FB_LOCAL = 'true';
delete process.env.STRIPE_SECRET_KEY;
delete process.env.RESEND_API_KEY;
delete process.env.PLAYBOOK_FROM_EMAIL;

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkoutSpec, APP_PLANS } from '../../../src/lib/plans.mjs';
import { validateAppOrder, sampleAppOrder, FIELDS } from '../../../src/lib/apporder.mjs';
import { sampleRegistration } from '../../../src/lib/registration.mjs';

process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), 'fb-appbuy-')));
const { default: handler, sessionParams, appOrderRecord } = await import('../checkout.mjs');
const { accrueFromSession, accrueFromInvoice, reverseFromCharge } = await import('../lib/accrue.mjs');
const { listEntries } = await import('../lib/ledger.mjs');

const SITE = 'https://example.test/';
const NOW = 1_800_000_000;
const EVENT = { created: 1_789_000_000, livemode: true };

// The handler rate-limits on the client IP: 10 per 10 minutes. Several cases below post a
// valid order, so each one that needs to get past the limiter gets its own address.
let ipSeq = 0;
const ctx = () => ({ ip: '10.0.0.' + (++ipSeq) });

function post(body, contentType = 'application/json') {
  return new Request('http://localhost/api/checkout', {
    method: 'POST',
    headers: { 'content-type': contentType },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });
}

function records() {
  const file = path.resolve('.local/leads.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
}

function clear() {
  for (const f of ['.local/leads.json', '.local/commissions.json']) {
    if (fs.existsSync(f)) fs.rmSync(f);
  }
}
const ledger = async () => (await listEntries()).entries;

const ORDER = { ...sampleAppOrder(), plan: 'shotform', pay: 'full', 'en-hp': '' };

// --- the order form ----------------------------------------------------------------------

test('the order form asks for what a purchase needs and nothing a child owns', () => {
  const keys = FIELDS.map((f) => f.key);
  // Deliberately absent. Registration collects these because a coach needs them courtside;
  // holding a child's date of birth, school or insurance policy number to sell a $20 app
  // would be collecting medical identifiers with no reason to.
  for (const forbidden of ['dob', 'school', 'grade', 'insuranceProvider', 'insurancePolicy', 'gender']) {
    assert.ok(!keys.includes(forbidden), '/appbuy must not ask for ' + forbidden);
  }
  // And the intake question, whose stated purpose on /privacy is setting the commission rate.
  // These products pay a flat 50/50 whatever the answer, so asking it here would be untrue.
  assert.ok(!keys.includes('hearAbout'));
  assert.deepEqual(FIELDS.filter((f) => f.required).map((f) => f.key), ['firstName', 'lastName', 'email', 'role']);
});

test('both boxes must be literally true, and neither stands in for the other', () => {
  assert.equal(validateAppOrder(sampleAppOrder()).ok, true);
  for (const truthy of ['yes', 'true', 1, 'on', {}]) {
    assert.equal(validateAppOrder({ ...sampleAppOrder(), terms: truthy }).ok, false, 'terms: ' + String(truthy));
    assert.equal(validateAppOrder({ ...sampleAppOrder(), norefund: truthy }).ok, false, 'norefund: ' + String(truthy));
  }
  // The no-refund acknowledgement is its own box on purpose: agreeing to the page is not the
  // same as saying you understood the payments cannot be stopped.
  const missing = validateAppOrder({ ...sampleAppOrder(), norefund: false });
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.norefund);
  assert.ok(!missing.errors.terms);
});

test('the same bounds as the registration form: this arrives over the same public endpoint', () => {
  assert.equal(validateAppOrder({ ...sampleAppOrder(), email: 'not-an-email' }).ok, false);
  assert.equal(validateAppOrder({ ...sampleAppOrder(), firstName: 'x'.repeat(201) }).ok, false);
  assert.equal(validateAppOrder({ ...sampleAppOrder(), phone: '12345' }).ok, false, 'a phone needs ten digits');
  assert.equal(validateAppOrder({ ...sampleAppOrder(), role: 'A federal agent' }).ok, false, 'a select must be one of its options');
  assert.equal(validateAppOrder({ ...sampleAppOrder(), notes: 'x'.repeat(2001) }).ok, false);
  assert.equal(validateAppOrder(null).ok, false);
  assert.equal(validateAppOrder('nope').ok, false);
});

// --- the Stripe session ------------------------------------------------------------------

test('a tool purchase returns to /appbuy, never to the athlete registration form', () => {
  const p = sessionParams(checkoutSpec('shotform', 'm3'), {
    email: 'buyer@example.test', priceId: 'price_x', siteUrl: SITE, nowSeconds: NOW, registrationId: 'order-1'
  });
  assert.equal(p.success_url, 'https://example.test/appbuy/thanks');
  assert.equal(p.cancel_url, 'https://example.test/appbuy?plan=shotform&pay=m3');
  assert.equal(p.mode, 'subscription');
  assert.deepEqual(p.subscription_data.metadata, { plan: 'shotform', pay: 'm3', totalCents: '10000', months: '3', registrationId: 'order-1' });
  // A buyer of a phone tool must not be asked to agree to an agreement about court sessions,
  // 60 days written notice and health insurance.
  const msg = p.custom_text.terms_of_service_acceptance.message;
  assert.ok(msg.includes('https://example.test/appbuy'), msg);
  assert.ok(!msg.includes('/terms'), 'the training agreement is not what a tool buyer agrees to');
  assert.ok(msg.includes('non-refundable'), msg);
});

test('an enrollment still returns to /enroll and still cites the training agreement', () => {
  const p = sessionParams(checkoutSpec('group-3m-1x', 'monthly'), {
    email: 'parent@example.test', priceId: 'price_y', siteUrl: SITE, nowSeconds: NOW, registrationId: 'reg-1'
  });
  assert.equal(p.success_url, 'https://example.test/enroll/thanks');
  assert.equal(p.cancel_url, 'https://example.test/enroll?plan=group-3m-1x&pay=monthly');
  assert.ok(p.custom_text.terms_of_service_acceptance.message.includes('https://example.test/terms'));
});

// --- the handler -------------------------------------------------------------------------

test('a valid order is stored under apporder:, never as an enrollment', async () => {
  clear();
  const res = await handler(post(ORDER), ctx());
  // 503: saved, but Stripe is not configured in this test. The record is what matters.
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.ok(body.registrationId);

  const rows = records();
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.ok(row.key.startsWith('apporder:'), 'a tool order must not live under registration:');
  assert.equal(row.type, 'apporder');
  assert.equal(row.product, 'shotform');
  assert.equal(row.paymentStatus, 'pending');
  assert.equal(row.amountCents, 10000);
  assert.equal(row.nonRefundableAccepted, true);
  // No athlete anywhere on it.
  assert.equal(row.playerName, undefined);
  assert.equal(row.registrationId, undefined);
});

test('an order on a payment plan records one instalment and what the term collects', async () => {
  clear();
  const res = await handler(post({ ...ORDER, plan: 'dribble', pay: 'm3' }), ctx());
  assert.equal(res.status, 503);
  const row = records()[0];
  assert.equal(row.amountCents, 666, 'one instalment, floored');
  assert.equal(row.months, 3);
  assert.equal(row.priceCents, 2000, 'the published price');
  assert.equal(row.collectedCents, 1998, 'what the card is actually charged across the term');
  assert.ok(row.collectedCents <= row.priceCents, 'a plan must never collect more than the price');
});

test('an order missing a box is refused before anything is stored', async () => {
  clear();
  const res = await handler(post({ ...ORDER, norefund: false }), ctx());
  assert.equal(res.status, 422);
  assert.equal(records().length, 0, 'nothing may be written for a refused order');
  const body = await res.json();
  assert.ok(body.errors.norefund);
});

test('a tool key posted with registration answers is validated as an order, not an enrollment', async () => {
  clear();
  // The forms share one endpoint. The plan key is what decides which validator runs, so a
  // registration body aimed at a tool must not sail through on the strength of its own fields.
  const res = await handler(post({ ...sampleRegistration(), plan: 'shotform', pay: 'full', norefund: true }), ctx());
  assert.equal(res.status, 422, 'the order form still wants a first name, last name and role');
  assert.equal(records().length, 0);
});

test('a registration key posted with an order body is still an enrollment', async () => {
  clear();
  const res = await handler(post({ ...sampleAppOrder(), plan: 'group-3m-1x', pay: 'full' }), ctx());
  assert.equal(res.status, 422, 'the registration form wants an athlete');
  assert.equal(records().length, 0);
});

test('the honeypot sends a bot to the tool thanks page and stores nothing', async () => {
  clear();
  const res = await handler(post({ ...ORDER, 'en-hp': 'gotcha' }), ctx());
  assert.equal(res.status, 200);
  assert.equal((await res.json()).url, '/appbuy/thanks');
  assert.equal(records().length, 0);
});

test('a no-JS post comes back to /appbuy, not to /enroll', async () => {
  clear();
  const form = new URLSearchParams({ plan: 'shotform', pay: 'full' });  // nothing else filled in
  const res = await handler(post(form.toString(), 'application/x-www-form-urlencoded'), ctx());
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/appbuy?plan=shotform&pay=full&err=1#enErr');
});

test('a no-JS post with both boxes ticked is accepted the same as the JSON path', async () => {
  clear();
  const form = new URLSearchParams({
    ...sampleAppOrder(), terms: 'yes', norefund: 'yes', plan: 'dribble', pay: 'm5'
  });
  const res = await handler(post(form.toString(), 'application/x-www-form-urlencoded'), ctx());
  // No Stripe key: a no-JS visitor is sent to the thanks page rather than shown an error,
  // because the order IS saved and Blake has been told.
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/appbuy/thanks');
  assert.equal(records()[0].type, 'apporder');
});

test('a campaign tag cannot reach a tool order: nothing about a link can move a 50/50 split', async () => {
  clear();
  await handler(post({ ...ORDER, campaign: 'anything' }), ctx());
  assert.equal(records()[0].campaign, undefined);
});

test('an id from the other form cannot be borrowed to rewrite a record of the wrong kind', async () => {
  clear();
  const first = await (await handler(post({ ...sampleRegistration(), plan: 'group-3m-1x', pay: 'full', 'en-hp': '' }), ctx())).json();
  assert.ok(first.registrationId);
  assert.equal(records().length, 1);

  // Same id, now on a tool order. It must start a NEW apporder row, not overwrite the family's
  // pending registration.
  const second = await (await handler(post({ ...ORDER, registrationId: first.registrationId }), ctx())).json();
  assert.notEqual(second.registrationId, first.registrationId);
  const rows = records();
  assert.equal(rows.length, 2);
  assert.equal(rows.filter((r) => r.type === 'enrollment').length, 1);
  assert.equal(rows.filter((r) => r.type === 'apporder').length, 1);
});

test('a resubmit from the same tab rewrites the same pending order', async () => {
  clear();
  const c = ctx();
  const first = await (await handler(post(ORDER), c)).json();
  const again = await (await handler(post({ ...ORDER, registrationId: first.registrationId }), c)).json();
  assert.equal(again.registrationId, first.registrationId);
  assert.equal(records().length, 1, 'a return from Stripe must not add a second order');
});

// --- the 50/50 ---------------------------------------------------------------------------

const toolSession = (over = {}) => ({
  id: 'cs_live_TOOL', mode: 'payment', payment_status: 'paid', amount_total: 10000,
  currency: 'usd', payment_intent: 'pi_TOOL', customer_email: 'buyer@example.test',
  metadata: { plan: 'shotform', pay: 'full', registrationId: 'order-9' }, ...over
});

test('a tool sale accrues at 50 percent and is never an Attributed Customer', async () => {
  clear();
  const { addLead } = await import('../lib/leads.mjs');
  // The intake answer that pays 8% on a training family. It must change nothing here.
  await addLead('apporder:order-9', {
    type: 'apporder', name: 'Dana Buyer', email: 'buyer@example.test',
    productLabel: 'Shot Form Watcher', hearAbout: 'Google or online search'
  });

  const r = await accrueFromSession(toolSession(), EVENT);
  assert.equal(r.ok, true);
  const [e] = await ledger();
  assert.equal(e.product, 'app');
  assert.equal(e.rate, 0.5);
  assert.equal(e.commissionCents, 5000, 'half of $100');
  assert.equal(e.attributed, false, 'a tool buyer never reaches the Section 8 attribution list');
  assert.equal(e.hearAbout, null);
  assert.equal(e.familyName, 'Dana Buyer');
  assert.equal(e.planLabel, 'Shot Form Watcher');
});

test('an instalment invoice accrues at 50 percent of what actually cleared', async () => {
  clear();
  const inv = {
    id: 'in_TOOL1', amount_paid: 666, currency: 'usd', billing_reason: 'subscription_create',
    status_transitions: { paid_at: 1_789_000_100 },
    customer_email: 'buyer@example.test', customer_name: 'Dana Buyer',
    parent: { subscription_details: { subscription: 'sub_1', metadata: { plan: 'dribble', pay: 'm3', registrationId: 'order-10' } } }
  };
  const r = await accrueFromInvoice(inv, EVENT);
  assert.equal(r.ok, true);
  const [e] = await ledger();
  assert.equal(e.product, 'app');
  assert.equal(e.rate, 0.5);
  assert.equal(e.commissionCents, 333, 'half of $6.66');
  assert.equal(e.attributed, false);
});

test('a refunded tool is reversed at 50 percent, not at the training base rate', async () => {
  clear();
  await accrueFromSession(toolSession(), EVENT);
  const r = await reverseFromCharge(
    { id: 'ch_TOOL', amount_refunded: 10000, currency: 'usd', payment_intent: 'pi_TOOL', metadata: {} },
    EVENT, 'refund'
  );
  assert.equal(r.ok, true);
  const rev = (await ledger()).find((e) => e.kind === 'reversal');
  // The whole point. Reversing a $100 tool at 2.5% would leave the developer holding $47.50
  // of a sale that was given back.
  assert.equal(rev.product, 'app');
  assert.equal(rev.rate, 0.5);
  assert.equal(rev.commissionCents, -5000);
  const net = (await ledger()).reduce((sum, e) => sum + e.commissionCents, 0);
  assert.equal(net, 0, 'a full refund must leave nothing owed');
});

test('an unmatched refund of a tool charge still reverses at 50 percent', async () => {
  clear();
  // No accrual to match (the ledger row was lost, or the charge came from the dashboard).
  // The charge's own metadata carries the plan, and the catalog says it is a tool.
  const r = await reverseFromCharge(
    { id: 'ch_LONE', amount_refunded: 2000, currency: 'usd', payment_intent: 'pi_LONE', metadata: { plan: 'dribble' } },
    EVENT, 'refund'
  );
  assert.equal(r.unmatched, true);
  const [rev] = await ledger();
  assert.equal(rev.product, 'app');
  assert.equal(rev.commissionCents, -1000);
});

test('a disputed instalment is reversed at the rate it accrued, not at the base rate', async () => {
  clear();
  // An instalment accrues from an INVOICE, and a dispute delivers a Dispute object: it carries a
  // charge id and a payment intent, and no invoice. So unless the invoice accrual recorded its
  // payment intent, nothing links the two and the reversal falls through to `unmatched` at the
  // base rate: 2.5% against a 50% accrual, leaving 47.5% of disputed money on the ledger.
  const inv = {
    id: 'in_D1', amount_paid: 3333, currency: 'usd', billing_reason: 'subscription_cycle',
    status_transitions: { paid_at: 1_789_000_100 },
    payment_intent: 'pi_D1',
    customer_email: 'buyer@example.test',
    parent: { subscription_details: { subscription: 'sub_D', metadata: { plan: 'shotform', pay: 'm3', registrationId: 'order-D' } } }
  };
  await accrueFromInvoice(inv, EVENT);
  const acc = (await ledger())[0];
  assert.equal(acc.paymentIntentId, 'pi_D1', 'an invoice accrual must record its payment intent');

  const r = await reverseFromCharge(
    { id: 'ch_D1', amount: 3333, currency: 'usd', payment_intent: 'pi_D1' }, EVENT, 'dispute'
  );
  assert.equal(r.unmatched, false, 'the dispute must find its accrual');
  const rev = (await ledger()).find((e) => e.kind === 'reversal');
  assert.equal(rev.product, 'app');
  assert.equal(rev.rate, 0.5);
  assert.equal((await ledger()).reduce((s, e) => s + e.commissionCents, 0), 0);
});

test('an invoice payment intent is read at both Stripe API shapes', async () => {
  const { invoicePaymentIntentId } = await import('../lib/accrue.mjs');
  // The endpoint's api_version is null, so Stripe delivers at the account default, which moves.
  assert.equal(invoicePaymentIntentId({ payment_intent: 'pi_legacy' }), 'pi_legacy');
  assert.equal(invoicePaymentIntentId({ payments: { data: [{ payment: { payment_intent: 'pi_new' } }] } }), 'pi_new');
  assert.equal(invoicePaymentIntentId({ payments: [{ payment: { payment_intent: 'pi_arr' } }] }), 'pi_arr');
  assert.equal(invoicePaymentIntentId({}), null);
  assert.equal(invoicePaymentIntentId(null), null);
});

test('a tool purchase does not start a family\'s training attribution window', async () => {
  clear();
  const { addLead } = await import('../lib/leads.mjs');
  const { putEntry } = await import('../lib/ledger.mjs');
  const EMAIL = 'family@example.test';
  // March: the family buys a $20 tool. That is a 50/50 product and has nothing to do with the
  // Section 7 window, which opens on their first collected TRAINING payment.
  await putEntry('acc_tool_old', {
    type: 'commission', kind: 'accrual', product: 'app', amountCents: 2000, rate: 0.5,
    commissionCents: 1000, attributed: false, withinWindow: true,
    paidAt: '2025-03-01T00:00:00.000Z', customerKey: EMAIL, livemode: true
  });
  // September 2026, eighteen months later: they enroll, answering the attributing question.
  await addLead('registration:reg-W', {
    type: 'enrollment', name: 'A Family', email: EMAIL, hearAbout: 'Google or online search'
  });
  const r = await accrueFromSession({
    id: 'cs_live_W', mode: 'payment', payment_status: 'paid', amount_total: 45000,
    currency: 'usd', payment_intent: 'pi_W', metadata: { plan: 'group-3m-1x', pay: 'full', registrationId: 'reg-W' }
  }, EVENT);
  assert.equal(r.ok, true);
  const e = (await ledger()).find((x) => x.sourceId === 'cs_live_W');
  // If the March tool purchase had opened the window, this payment would be 18 months past it
  // and drop to 2.5%, quietly costing the family's enrollment its attributed rate.
  assert.equal(e.withinWindow, true);
  assert.equal(e.rate, 0.08);
});

test('a training accrual written before the app products existed is still training', async () => {
  clear();
  const { putEntry } = await import('../lib/ledger.mjs');
  // A row with no `product` field at all: everything in the ledger before this change.
  await putEntry('acc_old', {
    type: 'commission', kind: 'accrual', amountCents: 45000, rate: 0.025, commissionCents: 1125,
    attributed: false, withinWindow: true, paidAt: '2026-09-01T00:00:00.000Z', livemode: true,
    paymentIntentId: 'pi_OLD'
  });
  const r = await reverseFromCharge(
    { id: 'ch_OLD', amount_refunded: 45000, currency: 'usd', payment_intent: 'pi_OLD', metadata: {} },
    EVENT, 'refund'
  );
  assert.equal(r.ok, true);
  const rev = (await ledger()).find((e) => e.kind === 'reversal');
  assert.equal(rev.product, 'training');
  assert.equal(rev.rate, 0.025);
  assert.equal(rev.commissionCents, -1125);
});

// --- the record --------------------------------------------------------------------------

test('appOrderRecord never carries an amount the client sent', () => {
  const spec = checkoutSpec('shotform', 'm5');
  const record = appOrderRecord({
    id: 'order-x',
    timestamp: '2026-09-17T00:00:00.000Z',
    // validateAppOrder builds `values` from FIELDS only, so these never reach it. Passed here
    // to prove the record builder takes its figures from the server spec regardless.
    values: { firstName: 'Dana', lastName: 'Buyer', amountCents: 1, priceCents: 1 },
    spec
  });
  assert.equal(record.amountCents, 2000, 'one fifth of $100');
  assert.equal(record.priceCents, 10000);
  assert.equal(record.collectedCents, 10000);
  assert.equal(record.product, 'shotform');
  assert.equal(record.productLabel, APP_PLANS.shotform.label);
  assert.equal(record.payLabel, '5 months');
});
