// The money rules from the signed agreement, pinned.
//
// Section 6: 2.5% of Net Collected Revenue per Website Transaction, 8% for an Attributed
// Customer for that customer's FIRST 12 MONTHS ONLY, and the two never stack.
// Section 7: the intake answers, verbatim from Schedule 1.
// Section 8: calendar-month periods, payable within 15 days of month end.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RATE_ATTRIBUTED,
  RATE_BASE,
  ATTRIBUTION_MONTHS,
  HEAR_ABOUT_CHOICES,
  ATTRIBUTING_ANSWER,
  isAttributed,
  rateFor,
  commissionCents,
  periodKeyFor,
  periodRange,
  previousPeriodKey,
  nextPeriodKey,
  withinAttributionWindow
} from './commission.mjs';

// --- Section 6: the rates ---------------------------------------------------------------
test('the rates are the ones in the agreement', () => {
  assert.equal(RATE_ATTRIBUTED, 0.08);
  assert.equal(RATE_BASE, 0.025);
  assert.equal(ATTRIBUTION_MONTHS, 12);
});

test('no stacking: exactly one rate applies to a payment', () => {
  assert.equal(rateFor(true, true), RATE_ATTRIBUTED);
  assert.equal(rateFor(false, true), RATE_BASE);
  // Attributed but past the 12 months is the BASE rate, not zero and not 8%.
  assert.equal(rateFor(true, false), RATE_BASE);
  assert.equal(rateFor(false, false), RATE_BASE);
});

test('only a strict true earns the attributed rate', () => {
  for (const truthy of ['yes', 1, {}, [], 'true']) {
    assert.equal(rateFor(truthy, true), RATE_BASE, `${String(truthy)} must not earn 8%`);
  }
  assert.equal(rateFor(), RATE_BASE);
});

// --- Section 7: the intake answers ------------------------------------------------------
test('the six answer choices are verbatim from Schedule 1', () => {
  assert.deepEqual(HEAR_ABOUT_CHOICES, [
    'Google or online search',
    'Instagram or other social media',
    'Friend, family, or referral',
    'Coach Blake directly',
    'School, camp, or clinic',
    'Other (please describe)'
  ]);
  assert.equal(ATTRIBUTING_ANSWER, 'Google or online search');
  assert.ok(HEAR_ABOUT_CHOICES.includes(ATTRIBUTING_ANSWER));
});

test('only the search answer attributes, and every other answer does not', () => {
  assert.equal(isAttributed({ hearAbout: 'Google or online search' }), true);
  for (const other of HEAR_ABOUT_CHOICES.filter((c) => c !== ATTRIBUTING_ANSWER)) {
    assert.equal(isAttributed({ hearAbout: other }), false, other + ' must not attribute');
  }
  // The agreement says so in as many words: none of these attribute on their own.
  assert.equal(isAttributed({}), false);
  assert.equal(isAttributed({ hearAbout: '' }), false);
  assert.equal(isAttributed({ hearAbout: 'google or online search' }), false, 'case must match the signed wording');
});

test('an approved Developer campaign attributes on its own', () => {
  assert.equal(isAttributed({ hearAbout: 'Coach Blake directly', campaign: 'spring-ads' }), true);
  assert.equal(isAttributed({ campaign: '   ' }), false, 'blank is not a campaign');
});

// --- Section 6: the arithmetic ----------------------------------------------------------
test('commission on the real catalog amounts, attributed', () => {
  const at8 = (c) => commissionCents(c, true);
  assert.equal(at8(5000), 400);      // $50 evaluation
  assert.equal(at8(3500), 280);      // $35 48-hour evaluation
  assert.equal(at8(45000), 3600);    // $450
  assert.equal(at8(65000), 5200);    // $650
  assert.equal(at8(80000), 6400);    // $800
  assert.equal(at8(100000), 8000);   // $1,000
  assert.equal(at8(18333), 1467);    // a monthly instalment
  assert.equal(at8(15000), 1200);
});

test('commission on the real catalog amounts, base', () => {
  const at25 = (c) => commissionCents(c, false);
  assert.equal(at25(5000), 125);
  assert.equal(at25(3500), 88, 'exactly 87.5 must round away from zero, not to 87');
  assert.equal(at25(45000), 1125);
  assert.equal(at25(65000), 1625);
  assert.equal(at25(80000), 2000);
  assert.equal(at25(100000), 2500);
  assert.equal(at25(18333), 458);
  assert.equal(at25(300000), 7500);  // a hand-written $3,000 invoice
});

test('every result is a whole number of cents', () => {
  for (let c = 0; c <= 20000; c += 37) {
    assert.ok(Number.isSafeInteger(commissionCents(c, true)));
    assert.ok(Number.isSafeInteger(commissionCents(c, false)));
  }
});

test('a reversal cancels its accrual exactly, at both rates', () => {
  // This is what makes a refunded sale net to zero instead of leaving a few cents behind.
  // negate() exists because -0 is not 0 under assert.equal: on an amount too small to earn a
  // cent the commission is 0, and negating that gives -0 on the EXPECTED side only. The module
  // deliberately never returns -0, so the expectation is what needs normalising.
  const negate = (n) => (n === 0 ? 0 : -n);
  for (let c = 1; c <= 200000; c += 971) {
    for (const rate of [true, false]) {
      assert.equal(commissionCents(-c, rate), negate(commissionCents(c, rate)), `failed at ${c}`);
    }
  }
});

test('zero is zero, and never negative zero', () => {
  assert.equal(commissionCents(0, true), 0);
  assert.ok(Object.is(commissionCents(0, true), 0), 'must not be -0');
  assert.ok(Object.is(commissionCents(-0, false), 0));
});

test('bad amounts throw rather than quietly pricing nonsense', () => {
  for (const bad of [NaN, undefined, null, 1.5, Infinity, -Infinity, '450', {}, []]) {
    assert.throws(() => commissionCents(bad, true), /safe integer/, `${String(bad)} should throw`);
  }
});

// --- Section 8: calendar-month periods --------------------------------------------------
test('a payment lands in the calendar month it was paid in', () => {
  assert.equal(periodKeyFor('2026-09-16T10:00:00.000Z'), '2026-09');
  assert.equal(periodKeyFor('2026-09-01T00:00:00.000Z'), '2026-09', 'first instant of the month');
  assert.equal(periodKeyFor('2026-09-30T23:59:59.999Z'), '2026-09', 'last instant of the month');
  assert.equal(periodKeyFor('2026-10-01T00:00:00.000Z'), '2026-10', 'and the next one rolls over');
  assert.equal(periodKeyFor(Date.parse('2026-09-16T10:00:00.000Z')), '2026-09', 'epoch ms agrees');
});

test('a period is the whole month, half-open, payable 15 days after it ends', () => {
  assert.deepEqual(periodRange('2026-09'), {
    key: '2026-09',
    startISO: '2026-09-01T00:00:00.000Z',
    endISO: '2026-09-30T23:59:59.999Z',
    endExclusiveISO: '2026-10-01T00:00:00.000Z',
    payDateISO: '2026-10-16'
  });
});

test('February and December are not special cases', () => {
  assert.equal(periodRange('2027-02').endISO, '2027-02-28T23:59:59.999Z');
  assert.equal(periodRange('2028-02').endISO, '2028-02-29T23:59:59.999Z', 'leap year');
  assert.equal(periodRange('2026-12').endExclusiveISO, '2027-01-01T00:00:00.000Z', 'year rolls over');
  assert.equal(periodRange('2026-12').payDateISO, '2027-01-16');
});

test('periods walk forwards and backwards across a year boundary', () => {
  assert.equal(previousPeriodKey('2027-01'), '2026-12');
  assert.equal(nextPeriodKey('2026-12'), '2027-01');
  let k = '2026-01';
  for (let i = 0; i < 36; i++) k = nextPeriodKey(k);
  assert.equal(k, '2029-01');
  for (let i = 0; i < 36; i++) k = previousPeriodKey(k);
  assert.equal(k, '2026-01', 'round trip');
});

test('a malformed period key throws instead of inventing a month', () => {
  for (const bad of ['2026-13', '2026-00', '2026', '2026-9', 'September', '', null, 20269]) {
    assert.throws(() => periodRange(bad), /periodKey/, `${String(bad)} should throw`);
  }
});

test('periodRange round-trips through its own bounds', () => {
  for (const key of ['2026-01', '2026-02', '2026-09', '2026-12', '2028-02']) {
    const r = periodRange(key);
    assert.equal(periodKeyFor(r.startISO), key);
    assert.equal(periodKeyFor(r.endISO), key, 'the last instant is still inside');
    assert.equal(periodKeyFor(r.endExclusiveISO), nextPeriodKey(key), 'and the next one is not');
  }
});

// --- Section 7: the 12-month window -----------------------------------------------------
test('the window runs 12 calendar months from the first collected payment', () => {
  const first = '2026-10-01T00:00:00.000Z';
  assert.equal(withinAttributionWindow(first, '2026-10-01T00:00:00.000Z'), true, 'the first payment itself');
  assert.equal(withinAttributionWindow(first, '2027-09-30T23:59:59.999Z'), true, 'the last instant inside');
  assert.equal(withinAttributionWindow(first, '2027-10-01T00:00:00.000Z'), false, 'ends permanently at 12 months');
  assert.equal(withinAttributionWindow(first, '2028-01-01T00:00:00.000Z'), false);
});

test('12 months is calendar months, not 365 days', () => {
  // A leap day sits inside this window, so a fixed 365 * 86400000 would end a day early.
  assert.equal(withinAttributionWindow('2027-06-01T00:00:00.000Z', '2028-05-31T23:59:59.999Z'), true);
  assert.equal(withinAttributionWindow('2027-06-01T00:00:00.000Z', '2028-06-01T00:00:00.000Z'), false);
});

test('with no earlier payment known, the payment being priced opens the window', () => {
  assert.equal(withinAttributionWindow(null, '2026-10-01T00:00:00.000Z'), true);
  assert.equal(withinAttributionWindow(undefined, '2030-01-01T00:00:00.000Z'), true);
});
