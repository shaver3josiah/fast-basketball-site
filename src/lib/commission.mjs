// Commission rates, attribution, and calendar-month pay periods.
//
// Every rule here comes from the signed Website Development, Maintenance & Digital Growth
// Agreement (Sections 6, 7 and 8, and Schedule 1). Where a constant is quoted from that
// document the comment says so, because changing it changes what someone is owed.
//
// Pure module: no imports, no clock, no randomness. Every function is a
// function of its arguments only, so the same inputs always give the same
// money.
//
// TIMEZONE RULE: all period math is UTC, which has no DST, so no 23- or 25-hour day can
// make the arithmetic lie. Month boundaries go through Date.UTC rather than any fixed number
// of milliseconds, because months are not all the same length and 12 months is not 365 days.

// The two rates in the signed agreement, Section 6.
export const RATE_ATTRIBUTED = 0.08;
export const RATE_BASE = 0.025;

/**
 * The Developer's share of a Developer-built product sold on the site, agreed 17 September 2026.
 *
 * NOT IN THE SIGNED AGREEMENT. Sections 6 to 8 price FAST's own training revenue at 8% or 2.5%;
 * the app products (see APP_PLANS in plans.mjs) are a new line of business the Developer built
 * and FAST sells, split 50/50. That is a new commercial term and it needs writing into the
 * agreement or a signed addendum; until it is, this constant is the only record of it, which is
 * why it says so here. See docs/owner-open-items.md.
 *
 * It is a PRODUCT rate, not an attribution rate: it never stacks with 8% or 2.5%, it does not
 * depend on how the buyer heard about FAST, and it has no 12-month window. A row priced at this
 * rate is never an Attributed Customer and never appears in the Section 8 attribution list.
 */
export const RATE_APP = 0.5;

/**
 * The intake answers, Schedule 1, VERBATIM.
 *
 * These strings are quoted in a signed agreement and are the primary evidence of attribution
 * (Section 7). Do not reword, reorder or re-case them: a stored answer that no longer matches
 * this list stops qualifying and silently drops a customer from 8% to 2.5%.
 */
export const HEAR_ABOUT_CHOICES = [
  'Google or online search',
  'Instagram or other social media',
  'Friend, family, or referral',
  'Coach Blake directly',
  'School, camp, or clinic',
  'Other (please describe)'
];

/** The one answer that attributes, Section 7. */
export const ATTRIBUTING_ANSWER = 'Google or online search';

/** 8% runs for this many months from the customer's FIRST collected payment, Section 6. */
export const ATTRIBUTION_MONTHS = 12;

/**
 * The campaigns both Parties have approved, Section 7.
 *
 * A campaign attributes only where Developer "created and both Parties approved" it, so this
 * cannot be free text: `?camp=` is a query parameter, and anyone who can read a URL can invent
 * one. An open parameter would be a self-serve switch from 2.5% to 8%, which is precisely the
 * self-dealing Section 7 rules out, so nothing attributes unless its slug is listed HERE.
 *
 * THE LIST IS THE APPROVAL RECORD. Adding a slug is a commit with both names on the pull
 * request, which is the paper trail the agreement asks for. Empty is the correct state until a
 * campaign is actually agreed: today the intake answer is the only route to 8%.
 */
export const APPROVED_CAMPAIGNS = [];

// A slug, not a sentence: lower-case letters, digits, dash and underscore, starting with a
// letter or digit. Bounded so nothing long or strange rides a query parameter into the ledger,
// the statement email or the spreadsheet.
const CAMPAIGN_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/**
 * The canonical slug for an approved campaign, or null for everything else.
 *
 * Case and surrounding space are forgiven because a link gets pasted through mail clients and
 * phone keyboards; membership is not. Returning the canonical form rather than a boolean means
 * the value STORED is the one on the list, so a row can never carry a variant spelling that
 * later fails to match.
 *
 * `list` is a seam for tests only, so the positive path can be proved without inventing a live
 * campaign. Production always uses APPROVED_CAMPAIGNS.
 */
export function approvedCampaign(value, list = APPROVED_CAMPAIGNS) {
  if (typeof value !== 'string') return null;
  const slug = value.trim().toLowerCase();
  if (!CAMPAIGN_RE.test(slug)) return null;
  return list.includes(slug) ? slug : null;
}

/**
 * Is this customer an Attributed Customer (Section 7)?
 *
 * Two of the three routes in the agreement are decidable here: the intake answer, and a
 * Developer campaign the customer arrived through. The third, a non-branded organic search
 * shown in Analytics or Search Console, is explicitly SECONDARY evidence and is not something
 * the checkout path can see, so it is never inferred: it would have to be agreed between the
 * parties and recorded deliberately.
 *
 * Note what does NOT attribute, because the agreement says so in as many words: searching for
 * FAST by name, visiting the site, or paying online. Only the answer, or an APPROVED campaign.
 * An unapproved campaign is not an error and does not disqualify anybody: it is simply ignored,
 * and the answer decides, which is the "if the evidence is unclear, 2.5% applies" default.
 */
export function isAttributed({ hearAbout, campaign } = {}, list = APPROVED_CAMPAIGNS) {
  if (approvedCampaign(campaign, list)) return true;
  return hearAbout === ATTRIBUTING_ANSWER;
}

/**
 * The rate for one payment.
 *
 * `attributed` is whether the customer qualifies at all; `withinWindow` is whether this payment
 * falls inside that customer's first 12 months. Both must hold, because the 8% "ends permanently
 * after that 12-month period". No stacking: exactly one rate applies to a given payment.
 */
export function rateFor(attributed, withinWindow = true) {
  return attributed === true && withinWindow === true ? RATE_ATTRIBUTED : RATE_BASE;
}

// Rates are scaled to hundred-thousandths so the whole calculation is integer
// arithmetic: amountCents * 2500 / 100000 is exact, amountCents * 0.025 is not.
const SCALE = 100000;

/**
 * Commission on amountCents, in whole cents.
 *
 * Negative amounts are legal: a refund reversal passes the negative of the
 * accrual and must give back exactly the negative of it. That is why the sign
 * is taken off first and put back last (round half AWAY FROM ZERO), instead of
 * trusting Math.round, which rounds half UP and so breaks the symmetry at every
 * .5 boundary: Math.round(87.5) is 88 but Math.round(-87.5) is -87.
 */
export function commissionCents(amountCents, earnsAttributedRate) {
  return commissionAtRate(amountCents, rateFor(earnsAttributedRate));
}

/**
 * The same arithmetic against a rate that is already resolved.
 *
 * The attributed/base pair is not the only rate any more: a Developer-built product sells at
 * RATE_APP, which no combination of the two booleans can express. The rate is therefore an
 * argument, and the row in the ledger stores the rate it was priced at, so a reversal can
 * reproduce it exactly rather than re-deriving it from a customer's circumstances months later.
 */
export function commissionAtRate(amountCents, rate) {
  if (!Number.isSafeInteger(amountCents)) {
    throw new Error(
      `commissionAtRate: amountCents must be a safe integer number of cents, got ${typeof amountCents} ${String(amountCents)}`
    );
  }
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
    throw new Error(`commissionAtRate: rate must be a fraction between 0 and 1, got ${String(rate)}`);
  }
  const sign = amountCents < 0 ? -1 : 1;
  const scaled = Math.abs(amountCents) * Math.round(rate * SCALE);
  if (!Number.isSafeInteger(scaled)) {
    throw new Error(`commissionAtRate: amountCents too large to price exactly: ${amountCents}`);
  }
  const whole = Math.floor(scaled / SCALE);
  const rest = scaled % SCALE;
  const rounded = rest * 2 >= SCALE ? whole + 1 : whole;
  // Never return -0: node:assert/strict compares with Object.is, and -0 is not 0.
  return rounded === 0 ? 0 : sign * rounded;
}

// --- calendar-month pay periods, Section 8 ---------------------------------------------
//
// "FAST will calculate compensation monthly and pay undisputed amounts within 15 days after
// the end of each calendar month." Calendar months, so there is no anchor date, no 14-day
// arithmetic and no parity check: the month a payment falls in IS its period, and cron can
// express "the 1st" natively. Months are UTC, which is also how Stripe timestamps arrive.

const KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const PAY_DAYS_AFTER_MONTH_END = 15;

function toMs(instant) {
  if (typeof instant === 'number') {
    if (!Number.isFinite(instant)) throw new Error(`instant: not a finite epoch ms: ${instant}`);
    return instant;
  }
  if (typeof instant === 'string') {
    const ms = Date.parse(instant);
    if (Number.isNaN(ms)) throw new Error(`instant: unparseable ISO string: ${instant}`);
    return ms;
  }
  throw new Error(`instant: expected an ISO string or epoch ms, got ${typeof instant}`);
}

const isoOf = (ms) => new Date(ms).toISOString();

/** The 'YYYY-MM' UTC month containing `instant`. */
export function periodKeyFor(instant) {
  return isoOf(toMs(instant)).slice(0, 7);
}

function partsOf(periodKey) {
  if (typeof periodKey !== 'string' || !KEY_RE.test(periodKey)) {
    throw new Error(`periodKey: expected 'YYYY-MM', got ${String(periodKey)}`);
  }
  return [Number(periodKey.slice(0, 4)), Number(periodKey.slice(5, 7))];
}

const keyOf = (y, m) => String(y).padStart(4, '0') + '-' + String(m).padStart(2, '0');

export function periodRange(periodKey) {
  const [y, m] = partsOf(periodKey);
  // Date.UTC normalises month 13 into January of the next year, so the end of December needs
  // no special case.
  const start = Date.UTC(y, m - 1, 1);
  const endExclusive = Date.UTC(y, m, 1);
  return {
    key: periodKey,
    startISO: isoOf(start),
    endISO: isoOf(endExclusive - 1), // last instant inside the month, for display
    endExclusiveISO: isoOf(endExclusive),
    // Payable within 15 days of month end. Whole days added to a UTC midnight, so no DST.
    payDateISO: isoOf(endExclusive + PAY_DAYS_AFTER_MONTH_END * 86400000).slice(0, 10)
  };
}

export function previousPeriodKey(periodKey) {
  const [y, m] = partsOf(periodKey);
  return m === 1 ? keyOf(y - 1, 12) : keyOf(y, m - 1);
}

export function nextPeriodKey(periodKey) {
  const [y, m] = partsOf(periodKey);
  return m === 12 ? keyOf(y + 1, 1) : keyOf(y, m + 1);
}

/**
 * Is `paidAt` inside this customer's 12-month attribution window?
 *
 * The window opens on the date of the customer's FIRST collected payment (Section 7) and the
 * 8% "ends permanently after that 12-month period". Calendar months via Date.UTC, never a
 * fixed number of milliseconds: 12 months is not 365 days in a leap year.
 */
export function withinAttributionWindow(firstPaidAt, paidAt) {
  if (!firstPaidAt) return true; // no earlier payment known: this one opens the window
  const first = new Date(toMs(firstPaidAt));
  const endsAt = Date.UTC(
    first.getUTCFullYear(), first.getUTCMonth() + ATTRIBUTION_MONTHS, first.getUTCDate(),
    first.getUTCHours(), first.getUTCMinutes(), first.getUTCSeconds(), first.getUTCMilliseconds()
  );
  return toMs(paidAt) < endsAt;
}
