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
// OCTOBER 2026: Individual (private 1-on-1) training is sold here too, on Blake's sheet of
// 7 October: a single session at $100, or a weekly plan at $300, $550 or $750 a month for one,
// two or three sessions a week. A weekly plan is the one kind of plan with no term: it bills
// every month until Blake cancels it (kind 'recurring', see checkoutSpec), which is why it
// prices `monthly` only. Small group and drop-in sessions are still absent; Blake bills those
// from the Stripe dashboard (Invoicing).
//
// `program` is what /enroll groups the cards by (the evaluation, then Individual, then Group)
// and what a coupon's "works on" scope means. It is NOT `kind`, which says how a plan is
// billed: a single individual session bills exactly like an evaluation, and must not be
// swept into an "evaluations only" coupon for it.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLANS = {
  'eval': {
    label: 'Evaluation Session', program: 'evaluation',
    description: '60 minutes on court with Coach Blake. The step before any commitment.',
    cents: 5000, kind: 'once'
  },
  // The rate Blake quotes on the intro call. Not enforced by the site: without a call there
  // is no evaluation slot, so a found link buys nothing (STRIPE-PLAN.md, decision 4).
  'eval-call': {
    label: 'Evaluation Session', program: 'evaluation',
    description: '60 minutes on court with Coach Blake. Booked within 48 hours of your intro call.',
    cents: 3500, kind: 'once'
  },
  'individual-single': {
    label: 'Individual Training, single session', program: 'individual',
    description: 'One private session with Coach Blake, built around your athlete.',
    cents: 10000, kind: 'once'
  },
  'individual-1x': {
    label: 'Individual Training, once a week', program: 'individual',
    frequency: 'once a week', kind: 'recurring',
    totals: { monthly: 30000 }
  },
  'individual-2x': {
    label: 'Individual Training, twice a week', program: 'individual',
    frequency: 'twice a week', kind: 'recurring',
    totals: { monthly: 55000 }
  },
  'individual-3x': {
    label: 'Individual Training, three times a week', program: 'individual',
    frequency: 'three times a week', kind: 'recurring',
    totals: { monthly: 75000 }
  },
  // 12 October 2026: prepaid once-a-week terms, $900 / $1,800 (Blake: 3 month $900, 6 month $1800,
  // which is $300 a month with no prepay discount). kind 'term' is a one-off payment for a
  // fixed stretch of weekly sessions. It has `termMonths`, NOT `months`/`noticeDays`: those mean
  // "auto-renews unless cancelled in writing" to the webhook's welcome email, and a prepaid
  // term ends by itself. Not kind 'membership' either, or it would stretch the group price range.
  'individual-3m': {
    label: 'Individual Training, 3 months, once a week', program: 'individual',
    frequency: 'once a week', termMonths: 3, kind: 'term',
    totals: { full: 90000 }
  },
  'individual-6m': {
    label: 'Individual Training, 6 months, once a week', program: 'individual',
    frequency: 'once a week', termMonths: 6, kind: 'term',
    totals: { full: 180000 }
  },
  'group-3m-1x': {
    label: 'Group Training Membership, 3 months, once a week', program: 'group',
    frequency: 'once a week',
    months: 3, noticeDays: 7, kind: 'membership',
    totals: { full: 45000, monthly: 55000 }
  },
  'group-3m-unlimited': {
    label: 'Group Training Membership, 3 months, unlimited', program: 'group',
    frequency: 'up to twice a week',
    months: 3, noticeDays: 7, kind: 'membership',
    totals: { full: 65000 }
  },
  'group-6m-1x': {
    label: 'Group Training Membership, 6 months, once a week', program: 'group',
    frequency: 'once a week',
    months: 6, noticeDays: 60, kind: 'membership',
    // 14 September 2026: Blake set this back to $800 and reframed the pitch from "one month
    // free" to "pay in full and save $100", which is true of both once-a-week terms.
    totals: { full: 80000, monthly: 90000 }
  },
  'group-6m-unlimited': {
    label: 'Group Training Membership, 6 months, unlimited', program: 'group',
    frequency: 'up to twice a week',
    months: 6, noticeDays: 60, kind: 'membership',
    totals: { full: 100000 }
  }
};

// ---------------------------------------------------------------- app products
//
// The two tools the Developer built, sold from /appbuy. They are in this file because this
// file is the Stripe catalog: catalog() below feeds scripts/stripe-catalog.mjs, so a product
// added here gets a Stripe product and price with no other edit. They are a SEPARATE map from
// PLANS because /enroll renders a card per key of PLANS and must never offer a phone tool as a
// training membership, and because content.json's owner prices deliberately do not reach them
// (applyOwnerPrices only walks PLANS): these are split 50/50 with the Developer, so the price
// is a term both parties agreed, not a number one of them edits in a text box.
//
// One price each, and the instalment plans collect exactly that price spread over N months,
// with no uplift. The training sheet charges more to pay over time; nobody has published such a
// figure for these, and inventing one is not arithmetic this file gets to do.
//
// NON-REFUNDABLE, including every instalment: that is what /appbuy says and what the buyer
// ticks. It is also why an instalment plan CANCELS at the end of its term (endBehavior below)
// rather than releasing to month-to-month the way a membership does. A tool bought once must
// never keep billing.
export const APP_PLANS = {
  'shotform': {
    label: 'Shot Form Watcher',
    description: 'The side-view shooting form tracker. Set a phone on a tripod and every rep is graded against the form you set.',
    kind: 'app', cents: 10000, instalments: [2, 3, 4, 5],
    url: '/shotform'
  },
  'dribble': {
    label: 'Dribble Listener',
    description: 'Counts dribbles through the phone microphone. Teach it your ball once and it keeps the count, the pace and the clock.',
    kind: 'app', cents: 2000, instalments: [2, 3, 4, 5],
    url: '/dribble'
  }
};

export const isAppPlan = (key) => typeof key === 'string' && Object.hasOwn(APP_PLANS, key);

/**
 * Where a form record for this plan lives in the leads store.
 *
 * checkout.mjs writes it, stripe-webhook.mjs completes it and accrue.mjs reads it, so the three
 * have to agree on one spelling. An app order is NOT an enrollment: keeping it under its own
 * prefix is what stops a $20 tool purchase rendering in the admin Leads tab as a family whose
 * athlete has no date of birth, and what stops the expired-session handler texting Blake about it.
 */
export const leadKey = (planKey, id) => (isAppPlan(planKey) ? 'apporder:' : 'registration:') + id;

// Page order, and the order the pay radios render in. A TRAINING plan offers a subset of these;
// /enroll renders exactly this list. App products price their own options (full, then m2..m5),
// which is why PAY_ORDER below exists and this constant stays the training pair.
export const PAY_OPTIONS = ['full', 'monthly'];

// Every pay option in the whole catalog, in the order a page renders them.
const PAY_ORDER = [...PAY_OPTIONS, 'm2', 'm3', 'm4', 'm5'];

// The number of monthly payments an 'm<N>' option collects, or null for anything else.
export function instalmentsIn(pay) {
  const m = typeof pay === 'string' ? /^m([2-9])$/.exec(pay) : null;
  return m ? Number(m[1]) : null;
}

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

// The figure a data-price hook prints: one plan and pay option ("group-3m-1x:full"), or the
// cheapest-to-dearest membership range. HTML-ready (an en dash is an entity). Null when the spec
// names nothing, so a caller leaves the template's own figure alone.
function membershipFulls() {
  return Object.keys(PLANS)
    .filter((k) => PLANS[k].kind === 'membership' && PLANS[k].totals && typeof PLANS[k].totals.full === 'number')
    .map((k) => PLANS[k].totals.full)
    .sort((a, b) => a - b);
}

export function priceFigure(spec) {
  if (spec === 'range' || spec === 'range-to') {
    const fulls = membershipFulls();
    if (!fulls.length) return null;
    const join = spec === 'range' ? '&ndash;' : ' to ';
    return dollars(fulls[0]) + join + dollars(fulls[fulls.length - 1]);
  }
  const [key, pay] = String(spec).split(':');
  const plan = Object.hasOwn(PLANS, key) ? PLANS[key] : null;
  if (!plan) return null;
  if (plan.kind === 'once') return typeof plan.cents === 'number' ? dollars(plan.cents) : null;
  const cents = plan.totals && plan.totals[pay];
  return typeof cents === 'number' ? dollars(cents) : null;
}

// ---------------------------------------------------------------- admin packages (live layer)
//
// October 2026: the admin's Prices tab edits the catalog WITHOUT a deploy. What it stores (one
// Firestore document, server/functions/lib/packages.mjs) is a layer over the plans above:
//   overrides  { key: { full?, monthly? } }  a changed price for a plan that already exists
//   added      { 'pk-xxxxxx': def }          a package Blake made (term, monthly or single session)
//   retired    [key]                         hidden from the site and refused at checkout
// setStoredPackages() rewrites PLANS in place from that document, so every module that already
// reads PLANS through getPlan() sees the change with no edit of its own. The router calls it
// (through refreshPackages) before any handler that touches a plan. Nothing here ever reaches
// APP_PLANS: the two tools are split 50/50 with the Developer and are not Blake's to reprice.
//
// A retired plan still RESOLVES (the webhook needs its label for a family who bought it last
// month); only checkout refuses it, through isRetired().
const BASE = structuredClone(PLANS);

export const PACKAGE_PROGRAMS = { individual: 'Individual Training', group: 'Group Training' };
export const PACKAGE_FREQUENCIES = ['once a week', 'twice a week', 'three times a week'];
export const PACKAGE_MAX_TERM_MONTHS = 24;
const ADDED_KEY_RE = /^pk-[a-z0-9]{6,12}$/;

// A stored definition to the plan it describes, or null. Strict: this arrives from Firestore and
// feeds checkout, so anything off-shape is dropped rather than repaired.
export function planFromDef(def) {
  if (!def || typeof def !== 'object') return null;
  const label = typeof def.label === 'string' ? def.label.trim() : '';
  if (label.length < 2 || label.length > 80) return null;
  if (!Object.hasOwn(PACKAGE_PROGRAMS, def.program)) return null;
  if (!validPriceCents(def.cents)) return null;
  const base = { label, program: def.program, custom: true };
  if (def.kind === 'once') {
    const description = typeof def.description === 'string' ? def.description.trim().slice(0, 160) : '';
    return { ...base, kind: 'once', cents: def.cents, ...(description ? { description } : {}) };
  }
  if (!PACKAGE_FREQUENCIES.includes(def.frequency)) return null;
  if (def.kind === 'recurring') return { ...base, kind: 'recurring', frequency: def.frequency, totals: { monthly: def.cents } };
  if (def.kind === 'term') {
    if (!Number.isInteger(def.termMonths) || def.termMonths < 1 || def.termMonths > PACKAGE_MAX_TERM_MONTHS) return null;
    return { ...base, kind: 'term', frequency: def.frequency, termMonths: def.termMonths, totals: { full: def.cents } };
  }
  return null;
}

// The document as it will be stored: only what is valid, only for plans that exist.
export function normalizeDoc(doc) {
  const d = doc && typeof doc === 'object' ? doc : {};
  const added = {};
  for (const [key, def] of Object.entries(d.added && typeof d.added === 'object' ? d.added : {})) {
    if (!ADDED_KEY_RE.test(key) || Object.hasOwn(BASE, key) || Object.hasOwn(APP_PLANS, key) || !planFromDef(def)) continue;
    added[key] = {
      label: def.label.trim(), program: def.program, kind: def.kind, cents: def.cents,
      ...(def.frequency ? { frequency: def.frequency } : {}),
      ...(def.termMonths ? { termMonths: def.termMonths } : {}),
      ...(def.kind === 'once' && def.description ? { description: String(def.description).trim().slice(0, 160) } : {})
    };
  }
  const known = new Set([...Object.keys(BASE), ...Object.keys(added)]);
  const overrides = {};
  for (const [key, entry] of Object.entries(d.overrides && typeof d.overrides === 'object' ? d.overrides : {})) {
    if (!known.has(key) || !entry || typeof entry !== 'object') continue;
    const o = {};
    for (const pay of ['full', 'monthly']) if (validPriceCents(entry[pay])) o[pay] = entry[pay];
    if (Object.keys(o).length) overrides[key] = o;
  }
  const retired = [...new Set((Array.isArray(d.retired) ? d.retired : []).filter((k) => typeof k === 'string' && known.has(k)))];
  return { overrides, added, retired };
}

// The catalog a document produces, as a NEW object: the admin builds the plans a change WOULD
// make, syncs Stripe against them, and only then stores the document.
export function effectivePlans(doc) {
  const { overrides, added } = normalizeDoc(doc);
  const plans = structuredClone(BASE);
  for (const [key, def] of Object.entries(added)) plans[key] = planFromDef(def);
  applyOwnerPrices(plans, overrides);
  return plans;
}

let stored = { doc: normalizeDoc(null), retired: [] };

export function setStoredPackages(doc) {
  const clean = normalizeDoc(doc);
  const next = effectivePlans(clean);
  for (const k of Object.keys(PLANS)) delete PLANS[k];
  Object.assign(PLANS, next);
  stored = { doc: clean, retired: clean.retired };
}

export const isRetired = (key) => stored.retired.includes(key);
export const storedDoc = () => structuredClone(stored.doc);
export const basePlans = () => structuredClone(BASE);

// The training plans as the admin and the pages see them, in the shape /admin/plans.js always had.
export function catalogView(plans = PLANS, retired = stored.retired) {
  return Object.keys(plans).map((key) => ({
    key, label: plans[key].label, kind: plans[key].kind, program: plans[key].program,
    custom: !!plans[key].custom, retired: retired.includes(key),
    frequency: plans[key].frequency || null, termMonths: plans[key].termMonths || plans[key].months || null,
    payOptions: payOptionsFor(key, plans).map((pay) => {
      const spec = checkoutSpec(key, pay, plans);
      return { pay, label: PAY_LABELS[pay], amountCents: spec.amountCents, amount: dollars(spec.amountCents), totalCents: totalCents(key, pay, plans), mode: spec.mode, iterations: spec.iterations };
    })
  }));
}

export const PAY_LABELS = {
  full: 'Pay in full',
  monthly: 'Monthly',
  m2: '2 months',
  m3: '3 months',
  m4: '4 months',
  m5: '5 months'
};

export function dollars(cents) {
  const whole = Math.floor(cents / 100);
  const frac = cents % 100;
  const withCommas = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return '$' + withCommas + (frac ? '.' + String(frac).padStart(2, '0') : '');
}

// ponytail: floor, so instalments can only ever add up to LESS than the published total, never
// more. $550 / 3 = $183.333…, so the 3 month monthly plan bills $183.33 x 3 = $549.99, a cent
// under. Every training plan divides exactly or rounds down anyway ($900 / 6 = $150.00), so this
// is the same number it always was for them; it is the app instalments that need the guarantee,
// since $20 over 3 months is $6.666… and Math.round would have billed $20.01 for a product the
// page prices at $20.
export function monthlyCents(total, months) {
  return Math.floor(total / months);
}

// Own keys only: PLANS['__proto__'] is Object.prototype, which is truthy. Training first, then
// the app products: one lookup for both, so every consumer downstream (checkout, the webhook,
// the ledger, the catalog script) needed no branch of its own.
export function getPlan(planKey, plans = PLANS) {
  if (typeof planKey !== 'string') throw new Error('unknown plan: ' + planKey);
  if (Object.hasOwn(plans, planKey)) return plans[planKey];
  if (Object.hasOwn(APP_PLANS, planKey)) return APP_PLANS[planKey];
  throw new Error('unknown plan: ' + planKey);
}

// A plan offers exactly what it prices. PAY_OPTIONS fixes the order so the page and the
// catalog agree; a membership with no monthly total simply does not offer monthly.
export function payOptionsFor(planKey, plans = PLANS) {
  const plan = getPlan(planKey, plans);
  if (plan.kind === 'once') return ['full'];
  if (plan.kind === 'app') return ['full', ...plan.instalments.map((n) => 'm' + n)];
  return PAY_ORDER.filter((pay) => Object.hasOwn(plan.totals, pay));
}

// The published total for one plan and pay option, in cents. This is the number the page
// prints and the number Stripe collects across the term. A 'recurring' plan has no term, so
// its "total" is one month.
export function totalCents(planKey, pay, plans = PLANS) {
  const plan = getPlan(planKey, plans);
  if (plan.kind === 'once') return plan.cents;
  // An app product costs the same however it is paid, so every option resolves to one figure.
  if (plan.kind === 'app') {
    if (!payOptionsFor(planKey, plans).includes(pay)) throw new Error('plan ' + planKey + ' does not offer ' + pay);
    return plan.cents;
  }
  if (!Object.hasOwn(plan.totals, pay)) throw new Error('plan ' + planKey + ' does not offer ' + pay);
  return plan.totals[pay];
}

// The one function the checkout function, the webhook, the page and the catalog script
// all agree through. Throws on anything not in the catalog, so a tampered request dies
// here rather than becoming a Stripe call.
export function checkoutSpec(planKey, pay, plans = PLANS) {
  const plan = getPlan(planKey, plans);
  if (!payOptionsFor(planKey, plans).includes(pay)) throw new Error('plan ' + planKey + ' does not offer ' + pay);

  const base = {
    plan: planKey, pay, label: plan.label,
    lookupKey: planKey + '-' + pay,
    // Where the buyer came from and goes back to. sessionParams() builds Stripe's success and
    // cancel URLs from it, so a tool purchase that is abandoned lands back on /appbuy with its
    // choice still made rather than on the athlete registration form.
    page: plan.kind === 'app' ? '/appbuy' : '/enroll',
    metadata: { plan: planKey, pay }
  };

  if (plan.kind === 'app') {
    const months = instalmentsIn(pay);
    const metadata = { ...base.metadata, totalCents: String(plan.cents) };
    if (!months) {
      return { ...base, metadata, description: plan.description, mode: 'payment', amountCents: plan.cents, interval: null, iterations: null, endBehavior: null };
    }
    const each = monthlyCents(plan.cents, months);
    return {
      ...base,
      metadata: { ...metadata, months: String(months) },
      description: plan.label + '. ' + months + ' monthly payments of ' + dollars(each) + '. Non-refundable.',
      mode: 'subscription', amountCents: each, interval: 'month', iterations: months,
      // 'cancel', not the membership's 'release'. A tool is bought once: when the instalments
      // are done the subscription must stop, not roll on month to month.
      endBehavior: 'cancel'
    };
  }

  if (plan.kind === 'once') {
    return { ...base, description: plan.description || plan.label, mode: 'payment', amountCents: plan.cents, interval: null, iterations: null, endBehavior: null };
  }

  // A weekly individual plan: one price a month and no term, so no schedule is wrapped around
  // the subscription (iterations null) and it bills until Blake cancels it in the dashboard.
  if (plan.kind === 'recurring') {
    return {
      ...base,
      description: plan.label + '. Billed monthly until cancelled.',
      mode: 'subscription', amountCents: plan.totals.monthly, interval: 'month', iterations: null, endBehavior: null
    };
  }

  if (plan.kind === 'term') {
    const total = plan.totals.full;
    return {
      ...base, metadata: { ...base.metadata, totalCents: String(total) },
      description: plan.label + '. Paid in full.',
      mode: 'payment', amountCents: total, interval: null, iterations: null, endBehavior: null
    };
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
export function catalog(plans = PLANS) {
  const out = [];
  for (const key of [...Object.keys(plans), ...Object.keys(APP_PLANS)]) {
    for (const pay of payOptionsFor(key, plans)) out.push(checkoutSpec(key, pay, plans));
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
