// Referral commission rates and fortnightly pay periods.
//
// Pure module: no imports, no clock, no randomness. Every function is a
// function of its arguments only, so the same inputs always give the same
// money.
//
// TIMEZONE RULE: all period math is UTC. UTC has no DST, which is exactly why
// the boundaries are computed there: a fortnight is always 14 * 86400000 ms,
// with no 23- or 25-hour day to make that arithmetic lie. Never move whole days
// by adding fixed milliseconds in a zone that observes DST; here nothing ever
// leaves UTC, so 14 * 86400000 is exact.

export const RATE_LIKED = 0.08;
export const RATE_BASE = 0.025;

/** 8% only for a literal true. Anything else ("yes", 1, {}) is the base rate. */
export function rateFor(likedSite) {
  return likedSite === true ? RATE_LIKED : RATE_BASE;
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
export function commissionCents(amountCents, likedSite) {
  if (!Number.isSafeInteger(amountCents)) {
    throw new Error(
      `commissionCents: amountCents must be a safe integer number of cents, got ${typeof amountCents} ${String(amountCents)}`
    );
  }
  const sign = amountCents < 0 ? -1 : 1;
  const scaled = Math.abs(amountCents) * Math.round(rateFor(likedSite) * SCALE);
  if (!Number.isSafeInteger(scaled)) {
    throw new Error(`commissionCents: amountCents too large to price exactly: ${amountCents}`);
  }
  const whole = Math.floor(scaled / SCALE);
  const rest = scaled % SCALE;
  const rounded = rest * 2 >= SCALE ? whole + 1 : whole;
  // Never return -0: node:assert/strict compares with Object.is, and -0 is not 0.
  return rounded === 0 ? 0 : sign * rounded;
}

/** Monday, UTC midnight. Start of pay period 0. */
export const PAY_PERIOD_ANCHOR = '2026-09-14';

const DAY_MS = 86400000;
const WEEK_MS = 7 * DAY_MS;
const PERIOD_MS = 14 * DAY_MS;
const ANCHOR_MS = Date.parse(`${PAY_PERIOD_ANCHOR}T00:00:00.000Z`);
const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

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
const dateOf = (ms) => isoOf(ms).slice(0, 10);

/**
 * The 'YYYY-MM-DD' UTC date starting the 14-day period containing `instant`.
 * Periods are [anchor + 14n days, anchor + 14(n+1) days), half-open, so the
 * last millisecond of a period belongs to that period and not the next one.
 * Instants before the anchor are legal and give negative n, which is why this
 * floors rather than truncates: truncation would fold every pre-anchor instant
 * into period 0 and pay it in the wrong fortnight.
 */
export function periodKeyFor(instant) {
  const n = Math.floor((toMs(instant) - ANCHOR_MS) / PERIOD_MS);
  return dateOf(ANCHOR_MS + n * PERIOD_MS);
}

function startMsOf(periodKey) {
  if (typeof periodKey !== 'string' || !KEY_RE.test(periodKey)) {
    throw new Error(`periodKey: expected 'YYYY-MM-DD', got ${String(periodKey)}`);
  }
  const start = Date.parse(`${periodKey}T00:00:00.000Z`);
  if (Number.isNaN(start)) throw new Error(`periodKey: not a real date: ${periodKey}`);
  if ((start - ANCHOR_MS) % PERIOD_MS !== 0) {
    throw new Error(`periodKey: ${periodKey} is not a period start (anchor ${PAY_PERIOD_ANCHOR}, 14-day periods)`);
  }
  return start;
}

export function periodRange(periodKey) {
  const start = startMsOf(periodKey);
  const endExclusive = start + PERIOD_MS;
  return {
    key: periodKey,
    startISO: isoOf(start),
    endISO: isoOf(endExclusive - 1), // last instant inside the period, for display
    endExclusiveISO: isoOf(endExclusive),
    payDateISO: dateOf(endExclusive) // the day the period becomes payable
  };
}

export function previousPeriodKey(periodKey) {
  return dateOf(startMsOf(periodKey) - PERIOD_MS);
}

export function nextPeriodKey(periodKey) {
  return dateOf(startMsOf(periodKey) + PERIOD_MS);
}

/**
 * True when `instant` falls in the FIRST of the two UTC weeks of its period.
 * Weeks run Monday 00:00 UTC to the next Monday 00:00 UTC; the anchor is a
 * Monday and periods are exactly two of those weeks, so every week lies wholly
 * inside one period and "first week" is unambiguous. A weekly job guarded by
 * this fires every other week, forever, without drift.
 */
export function isPayWeek(instant) {
  const offset = (((toMs(instant) - ANCHOR_MS) % PERIOD_MS) + PERIOD_MS) % PERIOD_MS;
  return offset < WEEK_MS;
}
