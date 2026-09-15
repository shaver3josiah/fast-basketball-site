// The Stripe catalog. One file decides what can be bought and for how much; the
// functions resolve prices by lookup_key, the /enroll page renders from catalog(), and
// scripts/stripe-catalog.mjs pushes it into Stripe. Amounts trace to
// docs/source-of-truth/fast-basketball-facts.md and must match OFFERS in site-config.mjs,
// TRAINING_PAGES in build.mjs, programs.html and /terms. Cents everywhere: Stripe takes
// integers, and $550 / 3 is not one (see monthlyCents).
//
// SEPTEMBER 2026 PRICE CHANGE. Paying over time now costs MORE than paying up front —
// $450 in full or $550 monthly on the same 3 month plan. The old model derived every pay
// option from a single `total`, which cannot say that, so a membership now carries a
// `totals` map keyed by pay option. A plan offers exactly the pay options it prices, and
// nothing invents a number the owner has not published.
//
// Two consequences worth knowing:
//   - `split` (two payments) is gone. The new sheet prices one alternative to paying up
//     front, monthly instalments over the term. The signed agreement still lists a split
//     option; that is a document to reconcile, not a price to guess at here.
//   - The Unlimited tiers publish one figure each, so they are pay-in-full only. Adding a
//     monthly price for them is an owner decision, not an arithmetic one.
//
// Private one on one (priced on consultation, not published), small group and drop-in sessions are
// deliberately absent. Blake schedules those by hand and bills them from the Stripe
// dashboard (Invoicing), no site code needed.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLANS = {
  'eval': {
    label: 'Evaluation Session',
    description: '60 minutes on court with Coach Blake. The step before any commitment.',
    cents: 5000, kind: 'once'
  },
  // The rate Blake quotes on the intro call. Not enforced by the site: without a call there
  // is no evaluation slot, so a found link buys nothing (STRIPE-PLAN.md, decision 4).
  'eval-call': {
    label: 'Evaluation Session',
    description: '60 minutes on court with Coach Blake. Booked within 48 hours of your intro call.',
    cents: 3500, kind: 'once'
  },
  'group-3m-1x': {
    label: 'Group Training Membership, 3 months, once a week',
    frequency: 'once a week',
    months: 3, noticeDays: 7, kind: 'membership',
    totals: { full: 45000, monthly: 55000 }
  },
  'group-3m-unlimited': {
    label: 'Group Training Membership, 3 months, unlimited',
    frequency: 'up to twice a week',
    months: 3, noticeDays: 7, kind: 'membership',
    totals: { full: 65000 }
  },
  'group-6m-1x': {
    label: 'Group Training Membership, 6 months, once a week',
    frequency: 'once a week',
    months: 6, noticeDays: 60, kind: 'membership',
    // 14 September 2026: Blake set this back to $800 and reframed the pitch from "one month
    // free" to "pay in full and save $100", which is true of both once-a-week terms.
    totals: { full: 80000, monthly: 90000 }
  },
  'group-6m-unlimited': {
    label: 'Group Training Membership, 6 months, unlimited',
    frequency: 'up to twice a week',
    months: 6, noticeDays: 60, kind: 'membership',
    totals: { full: 100000 }
  }
};

// Page order, and the order the pay radios render in. A plan offers a subset of these.
export const PAY_OPTIONS = ['full', 'monthly'];

// ---------------------------------------------------------------- owner prices
//
// The amounts above are the defaults AND the fallback. content.json's top-level `prices`
// overrides them, which is what makes the admin panel's Pricing section real: one number,
// edited once, and /enroll, the training pages, /terms, the admin link builder and
// scripts/stripe-catalog.mjs all read it, because they all read it through getPlan().
//
// What this CANNOT do is change what a card is charged. checkout.mjs sends Stripe a price
// id resolved by lookup_key and Stripe's own price object holds the amount, so until
// `npm run stripe:catalog` pushes these figures the site advertises one number and Stripe
// would collect another. That is why the panel says so next to the fields, and why
// `npm run stripe:check` exists to answer "do they agree", per mode.
//
// The validation is strict on purpose. This file is on the payment path and the value
// arrives from a saved admin draft. Anything that is not a whole number of cents inside a
// sane band, for a plan and a pay option that ALREADY EXIST, is ignored and the published
// default stands. A bad draft cannot make a plan free, cannot invent a plan, and cannot
// add a monthly price to a pay-in-full-only tier — that last one stays an owner decision
// made in this file, not an arithmetic one made in a text box.
const PRICE_MIN_CENTS = 100;
const PRICE_MAX_CENTS = 2000000;

export function validPriceCents(value) {
  return Number.isInteger(value) && value >= PRICE_MIN_CENTS && value <= PRICE_MAX_CENTS;
}

export function applyOwnerPrices(plans, prices) {
  if (!prices || typeof prices !== 'object') return plans;
  for (const key of Object.keys(prices)) {
    if (!Object.hasOwn(plans, key)) continue;
    const plan = plans[key];
    const entry = prices[key];
    if (!entry || typeof entry !== 'object') continue;
    if (plan.kind === 'once') {
      if (validPriceCents(entry.full)) plan.cents = entry.full;
      continue;
    }
    for (const pay of Object.keys(plan.totals)) {
      if (validPriceCents(entry[pay])) plan.totals[pay] = entry[pay];
    }
  }
  return plans;
}

// src/data/ is packed into the Cloud Function (scripts/functions-pack.mjs), and the copy
// mirrors the original depth, so this relative path resolves in the build, the dev server
// and the deployed function alike. Any failure at all leaves the defaults standing: a
// catalog that throws at import would take checkout down with it.
function readOwnerPrices() {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    return JSON.parse(readFileSync(resolve(here, '../data/content.json'), 'utf8')).prices || null;
  } catch {
    return null;
  }
}

applyOwnerPrices(PLANS, readOwnerPrices());

export const PAY_LABELS = {
  full: 'Pay in full',
  monthly: 'Monthly'
};

export function dollars(cents) {
  const whole = Math.floor(cents / 100);
  const frac = cents % 100;
  const withCommas = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return '$' + withCommas + (frac ? '.' + String(frac).padStart(2, '0') : '');
}

// ponytail: nearest cent, which can land a cent either side of the published total.
// $550 / 3 = $183.333…, so the 3 month monthly plan bills $183.33 x 3 = $549.99, a cent
// under. Under is the right direction to miss: it never charges more than the page says.
// Every other plan divides exactly ($900 / 6 = $150.00, the figure on the price sheet).
export function monthlyCents(total, months) {
  return Math.round(total / months);
}

// Own keys only: PLANS['__proto__'] is Object.prototype, which is truthy.
export function getPlan(planKey) {
  if (typeof planKey !== 'string' || !Object.hasOwn(PLANS, planKey)) throw new Error('unknown plan: ' + planKey);
  return PLANS[planKey];
}

// A plan offers exactly what it prices. PAY_OPTIONS fixes the order so the page and the
// catalog agree; a membership with no monthly total simply does not offer monthly.
export function payOptionsFor(planKey) {
  const plan = getPlan(planKey);
  if (plan.kind === 'once') return ['full'];
  return PAY_OPTIONS.filter((pay) => Object.hasOwn(plan.totals, pay));
}

// The published total for one plan and pay option, in cents. This is the number the page
// prints and the number Stripe collects across the term.
export function totalCents(planKey, pay) {
  const plan = getPlan(planKey);
  if (plan.kind === 'once') return plan.cents;
  if (!Object.hasOwn(plan.totals, pay)) throw new Error('plan ' + planKey + ' does not offer ' + pay);
  return plan.totals[pay];
}

// The one function the checkout function, the webhook, the page and the catalog script
// all agree through. Throws on anything not in the catalog, so a tampered request dies
// here rather than becoming a Stripe call.
export function checkoutSpec(planKey, pay) {
  const plan = getPlan(planKey);
  if (!payOptionsFor(planKey).includes(pay)) throw new Error('plan ' + planKey + ' does not offer ' + pay);

  const base = {
    plan: planKey, pay, label: plan.label,
    lookupKey: planKey + '-' + pay,
    metadata: { plan: planKey, pay }
  };

  if (plan.kind === 'once') {
    return { ...base, description: plan.description, mode: 'payment', amountCents: plan.cents, interval: null, iterations: null, endBehavior: null };
  }

  const total = plan.totals[pay];
  const metadata = {
    ...base.metadata,
    months: String(plan.months),
    noticeDays: String(plan.noticeDays),
    totalCents: String(total)
  };
  const termLine = plan.months + ' months, ' + plan.frequency + '. ';

  if (pay === 'full') {
    return { ...base, metadata, description: termLine + 'Paid in full.', mode: 'payment', amountCents: total, interval: null, iterations: null, endBehavior: null };
  }
  // monthly: keeps billing after the term until Blake cancels on written notice, which is
  // the auto-renewal the parent expectations describe (STRIPE-PLAN.md, decision 3).
  return {
    ...base, metadata,
    description: termLine + 'Billed monthly for ' + plan.months + ' months, ' + dollars(total) + ' in total.',
    mode: 'subscription', amountCents: monthlyCents(total, plan.months), interval: 'month', iterations: plan.months, endBehavior: 'release'
  };
}

// Every sellable combination, in page order.
export function catalog() {
  const out = [];
  for (const key of Object.keys(PLANS)) {
    for (const pay of payOptionsFor(key)) out.push(checkoutSpec(key, pay));
  }
  return out;
}

// The blank Blake fills by hand in the welcome email today: the last day a parent can
// give written notice. Term end is start + months; notice is noticeDays before that.
// UTC date arithmetic so a Netlify function and a laptop agree on the day.
export function cancelNoticeBy(startIso, months, noticeDays) {
  const d = new Date(startIso);
  if (Number.isNaN(d.getTime())) throw new Error('bad start date: ' + startIso);
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + Number(months));
  // A start day the target month does not have overflows: 31 Aug + 6 months is "31 Feb",
  // which JS rolls into March, handing the parent a deadline days past the term it belongs
  // to. setUTCDate(0) steps back to the last day of the month that was meant.
  if (d.getUTCDate() !== day) d.setUTCDate(0);
  d.setUTCDate(d.getUTCDate() - Number(noticeDays));
  return d.toISOString().slice(0, 10);
}
