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
import { commissionCents, rateFor } from '../../../src/lib/commission.mjs';
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

/** The registration row behind a payment, or null. Its likedSite decides the rate. */
async function registrationFor(registrationId) {
  if (typeof registrationId !== 'string' || !registrationId) return null;
  try {
    return await getLead('registration:' + registrationId);
  } catch (err) {
    // A store blip must not fail the webhook: Stripe would retry for three days while the
    // enrollment record is already written. Fall back to the base rate and say so in the log.
    console.error('[accrue] could not read registration ' + registrationId + ': ' + err.message);
    return null;
  }
}

function entryFrom({ kind, amountCents, likedSite, paidAt, event, currency, fields }) {
  return {
    type: 'commission',
    kind,
    amountCents,
    rate: rateFor(likedSite),
    commissionCents: commissionCents(amountCents, likedSite),
    likedSite: likedSite === true,
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
  const reg = await registrationFor(meta.registrationId);

  const entry = entryFrom({
    kind: 'accrual',
    amountCents,
    likedSite: reg?.likedSite === true,
    paidAt: isoOf(event.created),
    event,
    currency: session.currency,
    fields: {
      sourceType: 'session',
      sourceId: session.id,
      sessionId: session.id,
      paymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : null,
      registrationId: meta.registrationId || null,
      familyName: reg?.name || null,
      playerName: reg?.playerName || null,
      planLabel: reg?.planLabel || null,
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
  const reg = await registrationFor(meta.registrationId);

  const entry = entryFrom({
    kind: 'accrual',
    amountCents,
    likedSite: reg?.likedSite === true,
    // paid_at is when the money moved; event.created is only when we heard about it.
    paidAt: isoOf(inv.status_transitions?.paid_at) || isoOf(event.created),
    event,
    currency: inv.currency,
    fields: {
      sourceType: 'invoice',
      sourceId: inv.id,
      invoiceId: inv.id,
      subscriptionId: invoiceSubscriptionId(inv),
      registrationId: meta.registrationId || null,
      familyName: reg?.name || inv.customer_name || null,
      playerName: reg?.playerName || null,
      planLabel: reg?.planLabel || null,
      // 'manual' is a dashboard invoice written by hand: a real sale at the base rate,
      // because no website checkbox was ever offered for it.
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
    likedSite: match ? match.likedSite === true : false,
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
      reversesId: match?.id || null,
      unmatched: !match,
      billingReason: kind === 'dispute' ? 'dispute' : 'refund'
    }
  });
  await putEntry(id, entry);
  return { ok: true, id, commissionCents: entry.commissionCents, unmatched: !match };
}
