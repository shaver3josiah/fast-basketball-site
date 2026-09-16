// Run: node --test server/functions/tests/accrue.test.mjs
//
// FB_LOCAL must be set BEFORE the imports: leads.mjs and ledger.mjs both capture it into a
// module-level const at import time, so setting it afterwards silently exercises the
// Firestore path. Same rule the webhook test documents at its own top.
process.env.FB_LOCAL = 'true';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), 'fb-accrue-')));
const { accrueFromSession, accrueFromInvoice, reverseFromCharge, invoiceSubscriptionMeta } =
  await import('../lib/accrue.mjs');
const { listEntries, putEntry } = await import('../lib/ledger.mjs');
const { addLead } = await import('../lib/leads.mjs');

const EVENT = { created: 1_789_000_000, livemode: true };
const clear = () => {
  for (const f of ['.local/commissions.json', '.local/leads.json']) {
    if (fs.existsSync(f)) fs.rmSync(f);
  }
};
const all = async () => (await listEntries()).entries;

// A family that ticked the box, and one that did not.
async function registration(id, likedSite) {
  await addLead('registration:' + id, {
    type: 'enrollment', name: 'Ben Parent', playerName: 'Jordan Parent',
    planLabel: 'Group Training Membership', likedSite
  });
}

const paymentSession = (over = {}) => ({
  id: 'cs_live_A', mode: 'payment', payment_status: 'paid', amount_total: 45000,
  currency: 'usd', payment_intent: 'pi_A', metadata: { registrationId: 'reg-1' }, ...over
});

// --- the rate --------------------------------------------------------------------------
test('a ticked box accrues 8 percent, an unticked one 2.5 percent', async () => {
  clear();
  await registration('reg-1', true);
  const r = await accrueFromSession(paymentSession(), EVENT);
  assert.equal(r.ok, true);
  const [e] = await all();
  assert.equal(e.amountCents, 45000);
  assert.equal(e.rate, 0.08);
  assert.equal(e.commissionCents, 3600, '8% of $450 is $36');
  assert.equal(e.likedSite, true);

  clear();
  await registration('reg-1', false);
  await accrueFromSession(paymentSession(), EVENT);
  const [f] = await all();
  assert.equal(f.rate, 0.025);
  assert.equal(f.commissionCents, 1125, '2.5% of $450 is $11.25');
});

test('a registration that cannot be found falls back to the base rate, never 8 percent', async () => {
  clear();
  const r = await accrueFromSession(paymentSession({ metadata: { registrationId: 'missing' } }), EVENT);
  assert.equal(r.ok, true);
  assert.equal((await all())[0].rate, 0.025);
});

// --- THE DOUBLE-COUNT RULE -------------------------------------------------------------
test('a monthly enrollment accrues EXACTLY ONCE across both events Stripe fires', async () => {
  clear();
  await registration('reg-2', true);
  // 1. Stripe completes the subscription session, amount_total set to the first instalment.
  const sess = await accrueFromSession({
    id: 'cs_live_B', mode: 'subscription', payment_status: 'paid', amount_total: 18333,
    currency: 'usd', metadata: { registrationId: 'reg-2' }
  }, EVENT);
  assert.ok(sess.skipped, 'the subscription session must accrue nothing: ' + JSON.stringify(sess));
  assert.equal((await all()).length, 0);

  // 2. ...and then invoice.paid arrives for the SAME money.
  await accrueFromInvoice({
    id: 'in_1', amount_paid: 18333, currency: 'usd', billing_reason: 'subscription_create',
    status_transitions: { paid_at: 1_789_000_100 },
    parent: { subscription_details: { subscription: 'sub_1', metadata: { registrationId: 'reg-2' } } }
  }, EVENT);

  const entries = await all();
  assert.equal(entries.length, 1, 'exactly one accrual for one movement of money');
  assert.equal(entries[0].amountCents, 18333);
  assert.equal(entries[0].commissionCents, 1467, '8% of 18333 cents, rounded half away from zero');
});

test('an unpaid session and the preflight probe both accrue nothing', async () => {
  clear();
  assert.ok((await accrueFromSession(paymentSession({ payment_status: 'unpaid' }), EVENT)).skipped);
  assert.ok((await accrueFromSession(paymentSession({ metadata: { preflight: 'stripe-check' } }), EVENT)).skipped);
  assert.equal((await all()).length, 0);
});

// --- replay ----------------------------------------------------------------------------
test('a Stripe retry or dashboard resend never doubles the money', async () => {
  clear();
  await registration('reg-1', true);
  await accrueFromSession(paymentSession(), EVENT);
  // A resend carries a NEW event id for the SAME session, which is why the ledger id is
  // derived from the payment and not from the event.
  const again = await accrueFromSession(paymentSession(), { created: 1_789_999_999, livemode: true });
  assert.equal(again.duplicate, true);
  assert.equal((await all()).length, 1);
});

// --- the API-version shape hazard ------------------------------------------------------
test('subscription metadata is read at both the parent and the legacy shape', () => {
  assert.equal(
    invoiceSubscriptionMeta({ parent: { subscription_details: { metadata: { registrationId: 'new' } } } }).registrationId,
    'new'
  );
  assert.equal(
    invoiceSubscriptionMeta({ subscription_details: { metadata: { registrationId: 'old' } } }).registrationId,
    'old'
  );
  assert.deepEqual(invoiceSubscriptionMeta({}), {});
});

test('a legacy-shaped invoice still finds its registration and its rate', async () => {
  clear();
  await registration('reg-3', true);
  await accrueFromInvoice({
    id: 'in_legacy', amount_paid: 15000, currency: 'usd', billing_reason: 'subscription_cycle',
    subscription: 'sub_x', subscription_details: { metadata: { registrationId: 'reg-3' } }
  }, EVENT);
  const [e] = await all();
  assert.equal(e.rate, 0.08, 'the legacy shape must not silently drop to the base rate');
  assert.equal(e.commissionCents, 1200);
});

test('a hand-written dashboard invoice accrues at the base rate', async () => {
  clear();
  await accrueFromInvoice({
    id: 'in_manual', amount_paid: 300000, currency: 'usd', billing_reason: 'manual',
    customer_name: 'Private client'
  }, EVENT);
  const [e] = await all();
  assert.equal(e.rate, 0.025);
  assert.equal(e.commissionCents, 7500, '2.5% of $3,000');
  assert.equal(e.billingReason, 'manual');
});

// --- reversals -------------------------------------------------------------------------
test('a refund reverses at the rate the accrual used, and cancels it exactly', async () => {
  clear();
  await registration('reg-1', true);
  await accrueFromSession(paymentSession(), EVENT);
  const accrued = (await all())[0];

  const r = await reverseFromCharge(
    { id: 'ch_1', amount_refunded: 45000, currency: 'usd', payment_intent: 'pi_A' },
    EVENT, 'refund'
  );
  assert.equal(r.ok, true);
  assert.equal(r.unmatched, false);

  const entries = await all();
  const rev = entries.find((e) => e.kind === 'reversal');
  assert.equal(rev.rate, 0.08, 'an 8% sale must not be reversed at 2.5%');
  assert.equal(rev.amountCents, -45000);
  assert.equal(rev.commissionCents, -accrued.commissionCents, 'the reversal cancels the accrual exactly');
  assert.equal(rev.reversesId, accrued.id);
  assert.equal(entries.reduce((s, e) => s + e.commissionCents, 0), 0, 'nothing is owed on refunded money');
});

test('a partial refund reverses only the part refunded', async () => {
  clear();
  await registration('reg-1', true);
  await accrueFromSession(paymentSession(), EVENT);
  await reverseFromCharge(
    { id: 'ch_p', amount_refunded: 10000, currency: 'usd', payment_intent: 'pi_A' }, EVENT, 'refund'
  );
  const total = (await all()).reduce((s, e) => s + e.commissionCents, 0);
  assert.equal(total, 3600 - 800, '8% of the $350 actually kept');
});

test('a refund with no matching accrual is written at the base rate and flagged', async () => {
  clear();
  const r = await reverseFromCharge(
    { id: 'ch_orphan', amount_refunded: 45000, currency: 'usd', payment_intent: 'pi_unknown' },
    EVENT, 'refund'
  );
  assert.equal(r.unmatched, true, 'it must not quietly guess 8%');
  const [e] = await all();
  assert.equal(e.rate, 0.025);
  assert.equal(e.unmatched, true);
});

test('a dispute reverses the whole charge', async () => {
  clear();
  await registration('reg-1', true);
  await accrueFromSession(paymentSession(), EVENT);
  await reverseFromCharge({ id: 'ch_d', amount: 45000, currency: 'usd', payment_intent: 'pi_A' }, EVENT, 'dispute');
  const rev = (await all()).find((e) => e.kind === 'reversal');
  assert.equal(rev.sourceType, 'dispute');
  assert.equal(rev.commissionCents, -3600);
});

// --- test mode -------------------------------------------------------------------------
test('a test-mode event is recorded but marked livemode false', async () => {
  clear();
  await registration('reg-1', true);
  await accrueFromSession(paymentSession(), { created: 1_789_000_000, livemode: false });
  assert.equal((await all())[0].livemode, false, 'the report pays on livemode only');
});

// --- the ledger stays out of the leads store -------------------------------------------
test('commission rows never land in the leads store', async () => {
  clear();
  await registration('reg-1', true);
  await accrueFromSession(paymentSession(), EVENT);
  const { listLeads } = await import('../lib/leads.mjs');
  const leads = await listLeads();
  assert.equal(leads.filter((l) => l.type === 'commission').length, 0);
  assert.equal((await all()).length, 1);
});
