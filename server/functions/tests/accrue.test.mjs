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

// The two answers that matter: the one that attributes, and one that does not.
const GOOGLE = 'Google or online search';
const REFERRAL = 'Friend, family, or referral';

async function registration(id, hearAbout, email) {
  await addLead('registration:' + id, {
    type: 'enrollment', name: 'Ben Parent', playerName: 'Jordan Parent',
    planLabel: 'Group Training Membership', hearAbout, email: email || (id + '@example.test')
  });
}

const paymentSession = (over = {}) => ({
  id: 'cs_live_A', mode: 'payment', payment_status: 'paid', amount_total: 45000,
  currency: 'usd', payment_intent: 'pi_A', metadata: { registrationId: 'reg-1' }, ...over
});

// --- the rate --------------------------------------------------------------------------
test('the attributing answer earns 8 percent, any other answer 2.5 percent', async () => {
  clear();
  await registration('reg-1', GOOGLE);
  const r = await accrueFromSession(paymentSession(), EVENT);
  assert.equal(r.ok, true);
  const [e] = await all();
  assert.equal(e.amountCents, 45000);
  assert.equal(e.rate, 0.08);
  assert.equal(e.commissionCents, 3600, '8% of $450 is $36');
  assert.equal(e.attributed, true);
  assert.equal(e.hearAbout, GOOGLE);

  clear();
  await registration('reg-1', REFERRAL);
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
  await registration('reg-2', GOOGLE);
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
  await registration('reg-1', GOOGLE);
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
  await registration('reg-3', GOOGLE);
  await accrueFromInvoice({
    id: 'in_legacy', amount_paid: 15000, currency: 'usd', billing_reason: 'subscription_cycle',
    subscription: 'sub_x', subscription_details: { metadata: { registrationId: 'reg-3' } }
  }, EVENT);
  const [e] = await all();
  assert.equal(e.rate, 0.08, 'the legacy shape must not silently drop to the base rate');
  assert.equal(e.commissionCents, 1200);
});

test('a hand-written dashboard invoice never attributes: it never saw the question', async () => {
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
  await registration('reg-1', GOOGLE);
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
  await registration('reg-1', GOOGLE);
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
  await registration('reg-1', GOOGLE);
  await accrueFromSession(paymentSession(), EVENT);
  await reverseFromCharge({ id: 'ch_d', amount: 45000, currency: 'usd', payment_intent: 'pi_A' }, EVENT, 'dispute');
  const rev = (await all()).find((e) => e.kind === 'reversal');
  assert.equal(rev.sourceType, 'dispute');
  assert.equal(rev.commissionCents, -3600);
});

// --- test mode -------------------------------------------------------------------------
test('a test-mode event is recorded but marked livemode false', async () => {
  clear();
  await registration('reg-1', GOOGLE);
  await accrueFromSession(paymentSession(), { created: 1_789_000_000, livemode: false });
  assert.equal((await all())[0].livemode, false, 'the report pays on livemode only');
});

// --- the ledger stays out of the leads store -------------------------------------------
test('commission rows never land in the leads store', async () => {
  clear();
  await registration('reg-1', GOOGLE);
  await accrueFromSession(paymentSession(), EVENT);
  const { listLeads } = await import('../lib/leads.mjs');
  const leads = await listLeads();
  assert.equal(leads.filter((l) => l.type === 'commission').length, 0);
  assert.equal((await all()).length, 1);
});

// --- Section 7: the 12-month attribution window ----------------------------------------
test('the 8 percent stops after the customer first 12 months', async () => {
  clear();
  await registration('reg-w', GOOGLE, 'window@example.test');
  // Month 1: the first collected payment opens the window.
  await accrueFromInvoice({
    id: 'in_m1', amount_paid: 18333, currency: 'usd', billing_reason: 'subscription_create',
    status_transitions: { paid_at: Math.floor(Date.parse('2026-10-01T00:00:00Z') / 1000) },
    parent: { subscription_details: { metadata: { registrationId: 'reg-w' } } }
  }, EVENT);
  const first = (await all()).find((e) => e.id === 'acc_in_m1');
  assert.equal(first.rate, 0.08, 'the first payment attributes');

  // Month 11: still inside the window.
  await accrueFromInvoice({
    id: 'in_m11', amount_paid: 18333, currency: 'usd', billing_reason: 'subscription_cycle',
    status_transitions: { paid_at: Math.floor(Date.parse('2027-09-01T00:00:00Z') / 1000) },
    parent: { subscription_details: { metadata: { registrationId: 'reg-w' } } }
  }, EVENT);
  assert.equal((await all()).find((e) => e.id === 'acc_in_m11').rate, 0.08);

  // Month 13: the 12 months are up. It stays on the ledger, at the base rate.
  await accrueFromInvoice({
    id: 'in_m13', amount_paid: 18333, currency: 'usd', billing_reason: 'subscription_cycle',
    status_transitions: { paid_at: Math.floor(Date.parse('2027-11-01T00:00:00Z') / 1000) },
    parent: { subscription_details: { metadata: { registrationId: 'reg-w' } } }
  }, EVENT);
  const late = (await all()).find((e) => e.id === 'acc_in_m13');
  assert.equal(late.rate, 0.025, 'the 8 percent ends permanently after 12 months');
  assert.equal(late.attributed, true, 'the customer is still attributed, just out of window');
  assert.equal(late.withinWindow, false);
});

test('a refund of an out-of-window payment reverses at 2.5, not 8', async () => {
  clear();
  await registration('reg-o', GOOGLE, 'out@example.test');
  await accrueFromInvoice({
    id: 'in_old', amount_paid: 10000, currency: 'usd', billing_reason: 'subscription_create',
    status_transitions: { paid_at: Math.floor(Date.parse('2026-01-01T00:00:00Z') / 1000) },
    parent: { subscription_details: { metadata: { registrationId: 'reg-o' } } }
  }, EVENT);
  await accrueFromInvoice({
    id: 'in_late', amount_paid: 10000, currency: 'usd', billing_reason: 'subscription_cycle',
    status_transitions: { paid_at: Math.floor(Date.parse('2027-06-01T00:00:00Z') / 1000) },
    parent: { subscription_details: { metadata: { registrationId: 'reg-o' } } }
  }, EVENT);
  const late = (await all()).find((e) => e.id === 'acc_in_late');
  assert.equal(late.rate, 0.025);

  await reverseFromCharge({ id: 'ch_late', amount_refunded: 10000, currency: 'usd', invoice: 'in_late' }, EVENT, 'refund');
  const rev = (await all()).find((e) => e.kind === 'reversal');
  assert.equal(rev.rate, 0.025, 'reversing at 8 would hand back money never earned');
  assert.equal(rev.commissionCents, -late.commissionCents);
});

// --- Section 7: what must NOT attribute ------------------------------------------------
test('every non-attributing answer is the base rate', async () => {
  const others = [
    'Instagram or other social media',
    'Friend, family, or referral',
    'Coach Blake directly',
    'School, camp, or clinic',
    'Other (please describe)'
  ];
  for (let i = 0; i < others.length; i++) {
    clear();
    await registration('reg-n' + i, others[i], 'n' + i + '@example.test');
    await accrueFromSession(
      paymentSession({ id: 'cs_n' + i, metadata: { registrationId: 'reg-n' + i } }), EVENT
    );
    const [e] = await all();
    assert.equal(e.rate, 0.025, others[i] + ' must not attribute');
    assert.equal(e.attributed, false);
  }
});

// No campaign is approved yet (APPROVED_CAMPAIGNS is empty and commission.test.mjs pins that),
// so the live behaviour of a campaign tag is that it changes nothing. This is the money-path
// half of that: a row carrying a tag nobody approved is priced on the ANSWER alone, and the
// tag does not survive onto the ledger, because the monthly statement prints that field beside
// a customer's name and must never name a campaign that was never agreed.
test('an unapproved campaign tag changes neither the rate nor the ledger row', async () => {
  clear();
  await addLead('registration:reg-c', {
    type: 'enrollment', name: 'Cam Parent', email: 'cam@example.test',
    hearAbout: 'Coach Blake directly', campaign: 'spring-search-ads'
  });
  await accrueFromSession(paymentSession({ metadata: { registrationId: 'reg-c' } }), EVENT);
  const [e] = await all();
  assert.equal(e.rate, 0.025);
  assert.equal(e.attributed, false);
  assert.equal(e.campaign, null);
});

test('an unapproved tag cannot take the 8% away from a family who answered for it', async () => {
  clear();
  await addLead('registration:reg-c2', {
    type: 'enrollment', name: 'Dee Parent', email: 'dee@example.test',
    hearAbout: 'Google or online search', campaign: 'made-up-by-anyone'
  });
  await accrueFromSession(paymentSession({ metadata: { registrationId: 'reg-c2' } }), EVENT);
  const [e] = await all();
  assert.equal(e.rate, 0.08);
  assert.equal(e.attributed, true);
  assert.equal(e.campaign, null);
});
