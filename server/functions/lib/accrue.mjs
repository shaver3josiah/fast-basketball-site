// Turning a confirmed Stripe payment into one commission ledger entry.
//
// THE DOUBLE-COUNT RULE, which is the whole reason this is a module and not four lines in the
// webhook: for a SUBSCRIPTION plan Stripe fires BOTH checkout.session.completed (with
// amount_total set to the first instalment) AND invoice.paid with billing_reason
// 'subscription_create', for the same money. Accruing on both pays twice on month one of
// every monthly enrollment. So:
//
//   mode 'payment'      -> accrue at checkout.session.completed. No invoice ever follows.
//   mode 'subscription' -> accrue NOTHING there. Every instalment arrives as an invoice.
//   invoice.paid        -> accrue, always. Covers the first instalment, renewals inside the
//                          term, month-to-month after it (end_behavior is 'release', so they
//                          keep billing until someone cancels) and the dashboard invoices
//                          written by hand, which carry billing_reason 'manual'.
//
// Exactly one accrual per movement of money, and the money is always what Stripe says it
// took: session.amount_total once paid, or invoice.amount_paid. Never the term total, which
// is a promise rather than cash, and never a sum of catalog figures, which does not match
// anyway (monthlyCents rounds: 18333 * 3 is 54999 against a published 55000).
import { commissionAtRate, rateFor, isAttributed, withinAttributionWindow, approvedCampaign, RATE_APP } from '../../../src/lib/commission.mjs';
import { isAppPlan, leadKey } from '../../../src/lib/plans.mjs';
import { getLead } from './leads.mjs';
import { getEntry, putEntry, listEntries } from './ledger.mjs';

const isoOf = (epochSeconds) =>
  Number.isFinite(epochSeconds) ? new Date(epochSeconds * 1000).toISOString() : null;

/**
 * The subscription metadata checkout.mjs attached, read at BOTH shapes.
 *
 * The live endpoint api_version is null, so Stripe delivers using the account default, which
 * can move under us. At 2025-03-31.basil and later an Invoice has no top-level `subscription`
 * or `subscription_details`; both moved under `parent`. Reading one shape only would turn
 * accrual into a silent no-op the day the account default changes, which is the worst failure
 * available here: money keeps moving and the ledger quietly stops.
 */
export function invoiceSubscriptionMeta(inv) {
  return (
    inv?.parent?.subscription_details?.metadata ||
    inv?.subscription_details?.metadata ||
    inv?.metadata ||
    {}
  );
}

export function invoiceSubscriptionId(inv) {
  return inv?.parent?.subscription_details?.subscription || inv?.subscription || null;
}

/**
 * The PaymentIntent an invoice was settled with, read at both Stripe API shapes.
 *
 * Recorded on every invoice accrual because it is the ONLY thing a dispute can be matched by.
 * charge.dispute.created delivers a Dispute, which carries a charge id and a payment intent and
 * NOT an invoice, so an instalment accrual that stored only `invoiceId` could never be found:
 * the reversal would fall through to `unmatched` and be priced at the base rate. On a training
 * membership that turns 8% into 2.5%; on a tool sale it turns 50% into 2.5%, and the Developer
 * keeps 47.5% of money that was taken back.
 *
 * At 2025-03-31.basil and later the top-level `payment_intent` is gone and payments live under
 * `payments[]`. The endpoint's api_version is null, so Stripe delivers at the account default,
 * which can move under us: both shapes are read for the same reason invoiceSubscriptionMeta does.
 */
export function invoicePaymentIntentId(inv) {
  if (typeof inv?.payment_intent === 'string') return inv.payment_intent;
  const fromPayments = inv?.payments?.data || inv?.payments;
  if (Array.isArray(fromPayments)) {
    for (const p of fromPayments) {
      const pi = p?.payment?.payment_intent;
      if (typeof pi === 'string') return pi;
    }
  }
  return null;
}

/** The customer, for the 12-month window. One family is one email, case folded. */
const customerKeyOf = (email) => (typeof email === 'string' ? email.trim().toLowerCase() : '');

/**
 * When this customer FIRST paid, from the ledger itself.
 *
 * The 8% runs 12 months from the customer's first collected payment (Section 7), so the window
 * needs a start date and the ledger already holds one: the earliest accrual for that email.
 * ponytail: a full scan per accrual, which is the same scan the reversal path already does and
 * is nothing at this volume. If the ledger ever gets big, store the first-payment date on the
 * customer instead of deriving it.
 */
async function firstPaidAtFor(customerKey, list) {
  if (!customerKey) return null;
  const { entries } = await list();
  let earliest = null;
  for (const e of entries) {
    if (e.kind !== 'accrual' || e.customerKey !== customerKey || !e.paidAt) continue;
    // TRAINING payments only. Section 7's window opens on the customer's first collected
    // payment for the thing the 8% is paid on; a $20 tool bought in March would otherwise start
    // the clock on a family who did not enroll until September and quietly cost them six months
    // of their own attribution window. App rows share this ledger and this email address, so
    // they have to be skipped by name. A row from before the app products has no `product`.
    if (e.product === 'app') continue;
    if (!earliest || e.paidAt < earliest) earliest = e.paidAt;
  }
  return earliest;
}

/**
 * The form row behind a payment, or null. For a training family its intake answer decides the
 * rate; for a tool purchase the rate is fixed and this is only where the buyer's name comes
 * from. leadKey picks the prefix, so an app order is never looked for under 'registration:'.
 */
async function registrationFor(registrationId, planKey) {
  if (typeof registrationId !== 'string' || !registrationId) return null;
  try {
    return await getLead(leadKey(planKey, registrationId));
  } catch (err) {
    // A store blip must not fail the webhook: Stripe would retry for three days while the
    // enrollment record is already written. Fall back to the base rate and say so in the log.
    console.error('[accrue] could not read registration ' + registrationId + ': ' + err.message);
    return null;
  }
}

function entryFrom({ kind, amountCents, attributed, withinWindow, product, paidAt, event, currency, fields }) {
  // Two pricing worlds, and they never mix. A Developer-built product sells at a flat 50/50
  // (RATE_APP): it is a product term, not an attribution term, so it does not depend on how the
  // buyer heard about FAST and has no 12-month window. Everything else is the agreement's pair,
  // where rateFor takes BOTH booleans, because a customer can be attributed and still be past
  // their 12 months, which drops them to the base rate rather than off the ledger.
  //
  // The rate is resolved ONCE here and both stored and used to price, so the row can never say
  // one rate and carry the money of another. A reversal reads it back off the row it reverses.
  const app = product === 'app';
  const rate = app ? RATE_APP : rateFor(attributed, withinWindow);
  return {
    type: 'commission',
    kind,
    product: app ? 'app' : 'training',
    amountCents,
    rate,
    commissionCents: commissionAtRate(amountCents, rate),
    // An app sale is never an Attributed Customer, so it never reaches the Section 8 list.
    attributed: app ? false : attributed === true,
    withinWindow: app ? true : withinWindow === true,
    paidAt,
    currency: currency || 'usd',
    // A test-mode event writes a structurally identical row. The report pays on livemode only.
    livemode: !!event.livemode,
    ...fields
  };
}

/**
 * checkout.session.completed. Subscription sessions accrue nothing: see the double-count rule.
 * A session also completes BEFORE the card is charged, so an 'unpaid' one accrues nothing
 * either; that money arrives later as an invoice.
 */
export async function accrueFromSession(session, event) {
  if (session?.mode !== 'payment') return { skipped: 'subscription accrues on its invoices' };
  const status = session.payment_status;
  if (status !== 'paid' && status !== 'no_payment_required') {
    return { skipped: 'not paid: ' + String(status) };
  }
  const meta = session.metadata || {};
  // stripe-check's preflight session carries this and no registration. It is expired without
  // ever being paid, but refuse it by name rather than by luck.
  if (meta.preflight) return { skipped: 'preflight probe' };

  const amountCents = Number(session.amount_total);
  if (!Number.isSafeInteger(amountCents) || amountCents === 0) return { skipped: 'no amount_total' };

  const id = 'acc_' + session.id;
  if (await getEntry(id)) return { duplicate: true, id };
  const app = isAppPlan(meta.plan);
  const reg = await registrationFor(meta.registrationId, meta.plan);

  const paidAt = isoOf(event.created);
  // Attribution is not even computed for an app sale: the rate is fixed, and asking the
  // question would invite a later edit that let an intake answer move a 50/50 product.
  const attributed = app ? false : isAttributed({ hearAbout: reg?.hearAbout, campaign: reg?.campaign });
  const customerKey = customerKeyOf(reg?.email || session.customer_email);
  const withinWindow = attributed
    ? withinAttributionWindow(await firstPaidAtFor(customerKey, listEntries), paidAt)
    : true;

  const entry = entryFrom({
    kind: 'accrual',
    amountCents,
    attributed,
    withinWindow,
    product: app ? 'app' : 'training',
    paidAt,
    event,
    currency: session.currency,
    fields: {
      sourceType: 'session',
      sourceId: session.id,
      sessionId: session.id,
      paymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : null,
      registrationId: meta.registrationId || null,
      customerKey,
      hearAbout: app ? null : reg?.hearAbout || null,
      campaign: app ? null : approvedCampaign(reg?.campaign),
      familyName: reg?.name || null,
      playerName: reg?.playerName || null,
      planLabel: reg?.planLabel || reg?.productLabel || null,
      billingReason: 'checkout'
    }
  });
  await putEntry(id, entry);
  return { ok: true, id, commissionCents: entry.commissionCents };
}

/** invoice.paid: every instalment, every renewal, and every hand-written dashboard invoice. */
export async function accrueFromInvoice(inv, event) {
  const amountCents = Number(inv?.amount_paid);
  if (!Number.isSafeInteger(amountCents) || amountCents === 0) return { skipped: 'nothing paid' };

  const id = 'acc_' + inv.id;
  if (await getEntry(id)) return { duplicate: true, id };
  const meta = invoiceSubscriptionMeta(inv);
  const app = isAppPlan(meta.plan);
  const reg = await registrationFor(meta.registrationId, meta.plan);

  // paid_at is when the money moved; event.created is only when we heard about it.
  const paidAt = isoOf(inv.status_transitions?.paid_at) || isoOf(event.created);
  const attributed = app ? false : isAttributed({ hearAbout: reg?.hearAbout, campaign: reg?.campaign });
  const customerKey = customerKeyOf(reg?.email || inv.customer_email);
  // The window opens at the customer's FIRST payment, so a renewal in month 13 drops to the
  // base rate on its own. Only looked up when it could change the answer.
  const withinWindow = attributed
    ? withinAttributionWindow(await firstPaidAtFor(customerKey, listEntries), paidAt)
    : true;

  const entry = entryFrom({
    kind: 'accrual',
    amountCents,
    attributed,
    withinWindow,
    product: app ? 'app' : 'training',
    paidAt,
    event,
    currency: inv.currency,
    fields: {
      sourceType: 'invoice',
      sourceId: inv.id,
      invoiceId: inv.id,
      // See invoicePaymentIntentId: without this a dispute on an instalment cannot be matched
      // to its accrual and is reversed at the wrong rate.
      paymentIntentId: invoicePaymentIntentId(inv),
      subscriptionId: invoiceSubscriptionId(inv),
      registrationId: meta.registrationId || null,
      customerKey,
      hearAbout: app ? null : reg?.hearAbout || null,
      campaign: app ? null : approvedCampaign(reg?.campaign),
      familyName: reg?.name || inv.customer_name || null,
      playerName: reg?.playerName || null,
      planLabel: reg?.planLabel || reg?.productLabel || null,
      // 'manual' is a dashboard invoice written by hand. It never saw the intake question,
      // so it cannot be an Attributed Customer and takes the base rate.
      billingReason: inv.billing_reason || null
    }
  });
  await putEntry(id, entry);
  return { ok: true, id, commissionCents: entry.commissionCents };
}

/**
 * charge.refunded / charge.dispute.created: give the commission back.
 *
 * The reversal must use the SAME rate the accrual used, or a refunded 8% sale is reversed at
 * only 2.5% and the ledger keeps the difference forever. The matching accrual is found by
 * payment intent, then invoice, then registration. When nothing matches, the row is still
 * written, at the base rate, flagged `unmatched` so the report can show it rather than
 * quietly guessing 8%.
 */
export async function reverseFromCharge(charge, event, kind, list = listEntries) {
  const amount = kind === 'dispute' ? Number(charge?.amount) : Number(charge?.amount_refunded);
  if (!Number.isSafeInteger(amount) || amount === 0) return { skipped: 'nothing to reverse' };

  const id = (kind === 'dispute' ? 'dsp_' : 'rev_') + charge.id;
  if (await getEntry(id)) return { duplicate: true, id };

  const { entries } = await list();
  const accruals = entries.filter((e) => e.kind === 'accrual');
  const pi = typeof charge.payment_intent === 'string' ? charge.payment_intent : null;
  const regId = charge.metadata?.registrationId || null;
  const match =
    (pi && accruals.find((e) => e.paymentIntentId === pi)) ||
    (charge.invoice && accruals.find((e) => e.invoiceId === charge.invoice)) ||
    (regId && accruals.find((e) => e.registrationId === regId)) ||
    null;

  const entry = entryFrom({
    kind: 'reversal',
    amountCents: -amount,
    // Mirror EVERY pricing flag off the matched accrual so the reversal reproduces exactly the
    // rate that accrual used. Recomputing from attribution alone would reverse an out-of-window
    // customer at 8% when they were only ever paid 2.5% -- and, since the app products landed,
    // would reverse a refunded $100 tool at 2.5% when it accrued at 50%, leaving the Developer
    // holding 47.5% of a sale that was given back. `product` is mirrored for that reason and
    // only falls back to the charge's own metadata when no accrual matched at all.
    attributed: match ? match.attributed === true : false,
    withinWindow: match ? match.withinWindow === true : true,
    product: match ? match.product : (isAppPlan(charge.metadata?.plan) ? 'app' : 'training'),
    paidAt: isoOf(event.created),
    event,
    currency: charge.currency,
    fields: {
      sourceType: kind === 'dispute' ? 'dispute' : 'refund',
      sourceId: charge.id,
      chargeId: charge.id,
      paymentIntentId: pi,
      registrationId: match?.registrationId || regId,
      familyName: match?.familyName || null,
      playerName: match?.playerName || null,
      planLabel: match?.planLabel || null,
      customerKey: match?.customerKey || null,
      hearAbout: match?.hearAbout || null,
      reversesId: match?.id || null,
      unmatched: !match,
      billingReason: kind === 'dispute' ? 'dispute' : 'refund'
    }
  });
  await putEntry(id, entry);
  return { ok: true, id, commissionCents: entry.commissionCents, unmatched: !match };
}
