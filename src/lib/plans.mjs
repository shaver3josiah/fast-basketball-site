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
// Private one on one ($3,000 per 6 month term), small group and drop-in sessions are
// deliberately absent. Blake schedules those by hand and bills them from the Stripe
// dashboard (Invoicing), no site code needed.

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
    totals: { full: 75000, monthly: 90000 }
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
  d.setUTCMonth(d.getUTCMonth() + Number(months));
  d.setUTCDate(d.getUTCDate() - Number(noticeDays));
  return d.toISOString().slice(0, 10);
}
