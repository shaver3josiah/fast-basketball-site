import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RATE_LIKED,
  RATE_BASE,
  PAY_PERIOD_ANCHOR,
  rateFor,
  commissionCents,
  periodKeyFor,
  periodRange,
  previousPeriodKey,
  nextPeriodKey,
  isPayWeek
} from './commission.mjs';

const DAY = 86400000;
const WEEK = 7 * DAY;
const PERIOD = 14 * DAY;
const ANCHOR = Date.parse(`${PAY_PERIOD_ANCHOR}T00:00:00.000Z`);

test('rates are the published numbers', () => {
  assert.equal(RATE_LIKED, 0.08);
  assert.equal(RATE_BASE, 0.025);
});

test('only a strict true earns the liked rate', () => {
  assert.equal(rateFor(true), RATE_LIKED);
  for (const truthy of ['yes', 'true', 1, {}, [], 'TRUE']) {
    assert.equal(rateFor(truthy), RATE_BASE, `${String(truthy)} must not earn 8%`);
  }
  for (const falsy of [false, 0, '', null, undefined, NaN]) {
    assert.equal(rateFor(falsy), RATE_BASE);
  }
  assert.equal(rateFor(), RATE_BASE);
});

test('commission on the real catalog amounts, liked', () => {
  const expected = [
    [5000, 400],
    [3500, 280],
    [45000, 3600],
    [65000, 5200],
    [80000, 6400],
    [100000, 8000],
    [18333, 1467], // 1466.64 rounds up
    [15000, 1200]
  ];
  for (const [amount, cents] of expected) {
    assert.equal(commissionCents(amount, true), cents, `${amount} at 8%`);
  }
});

test('commission on the real catalog amounts, base', () => {
  const expected = [
    [5000, 125],
    [3500, 88], // exactly 87.5, rounds away from zero
    [45000, 1125],
    [65000, 1625],
    [80000, 2000],
    [100000, 2500],
    [18333, 458], // 458.325 rounds down
    [15000, 375]
  ];
  for (const [amount, cents] of expected) {
    assert.equal(commissionCents(amount, false), cents, `${amount} at 2.5%`);
  }
});

test('every result is an integer number of cents', () => {
  for (let a = 0; a <= 200000; a += 137) {
    assert.ok(Number.isInteger(commissionCents(a, true)));
    assert.ok(Number.isInteger(commissionCents(a, false)));
  }
});

test('a reversal cancels its accrual exactly, at both rates', () => {
  // negating 0 in JS gives -0, which node:assert compares with Object.is and so
  // treats as a different value; the module deliberately never returns -0.
  const negate = (cents) => (cents === 0 ? 0 : -cents);
  for (let a = 1; a <= 250000; a += 7) {
    for (const liked of [true, false]) {
      assert.equal(
        commissionCents(-a, liked),
        negate(commissionCents(a, liked)),
        `${a} at ${liked ? 'liked' : 'base'} rate is not symmetric`
      );
    }
  }
  // the .5 boundaries Math.round gets wrong: 2.5% of 20n + 20 lands on a half cent
  for (let a = 20; a <= 400000; a += 40) {
    assert.equal(commissionCents(-a, false), negate(commissionCents(a, false)));
  }
  assert.equal(commissionCents(3500, false), 88);
  assert.equal(commissionCents(-3500, false), -88);
});

test('zero is zero, and never negative zero', () => {
  assert.equal(commissionCents(0, true), 0);
  assert.equal(commissionCents(0, false), 0);
  assert.equal(commissionCents(-0, true), 0);
  assert.ok(!Object.is(commissionCents(0, true), -0));
  // 2.5% of 19 cents is 0.475, which rounds to nothing in either direction
  assert.equal(commissionCents(19, false), 0);
  assert.equal(commissionCents(-19, false), 0);
  assert.ok(!Object.is(commissionCents(-19, false), -0));
});

test('bad amounts throw', () => {
  const bad = [1.5, -1.5, 0.1, NaN, undefined, null, Infinity, -Infinity, '5000', {}, [], true];
  for (const value of bad) {
    assert.throws(
      () => commissionCents(value, true),
      /safe integer/,
      `${String(value)} should have thrown`
    );
  }
  assert.throws(() => commissionCents(Number.MAX_SAFE_INTEGER, true), /too large/);
});

test('the anchor is a Monday at UTC midnight and starts its own period', () => {
  assert.equal(new Date(ANCHOR).getUTCDay(), 1);
  assert.equal(new Date(ANCHOR).toISOString(), `${PAY_PERIOD_ANCHOR}T00:00:00.000Z`);
  assert.equal(periodKeyFor(ANCHOR), PAY_PERIOD_ANCHOR);
  assert.equal(periodKeyFor(`${PAY_PERIOD_ANCHOR}T00:00:00.000Z`), PAY_PERIOD_ANCHOR);
  assert.equal(periodKeyFor(PAY_PERIOD_ANCHOR), PAY_PERIOD_ANCHOR);
});

test('period boundaries are half-open', () => {
  assert.equal(periodKeyFor(ANCHOR - 1), '2026-08-31'); // 1ms before the anchor
  assert.equal(periodKeyFor(ANCHOR), PAY_PERIOD_ANCHOR);
  assert.equal(periodKeyFor(ANCHOR + PERIOD - 1), PAY_PERIOD_ANCHOR); // last ms inside
  assert.equal(periodKeyFor(ANCHOR + PERIOD), '2026-09-28'); // first ms of the next
});

test('a payment on the very last millisecond stays in its own period', () => {
  for (let n = -10; n <= 40; n++) {
    const start = ANCHOR + n * PERIOD;
    const key = periodKeyFor(start);
    assert.equal(periodKeyFor(start + PERIOD - 1), key, `last ms of period ${n} leaked forward`);
    assert.notEqual(periodKeyFor(start + PERIOD), key);
    assert.equal(periodKeyFor(start + PERIOD), nextPeriodKey(key));
  }
});

test('pre-anchor instants floor into negative periods, they do not truncate', () => {
  assert.equal(periodKeyFor(ANCHOR - PERIOD), '2026-08-31');
  assert.equal(periodKeyFor(ANCHOR - PERIOD - 1), '2026-08-17');
  assert.equal(periodKeyFor('2026-08-31T00:00:00.000Z'), '2026-08-31');
  assert.equal(periodKeyFor('2026-09-13T23:59:59.999Z'), '2026-08-31');
  assert.equal(periodKeyFor('2020-02-29T23:00:00.000Z'), periodKeyFor(Date.parse('2020-02-29T23:00:00.000Z')));
  // a truncating implementation would fold all of these into period 0
  for (let n = -1; n >= -60; n--) {
    const start = ANCHOR + n * PERIOD;
    assert.equal(periodKeyFor(start), periodKeyFor(start + PERIOD - 1));
    assert.notEqual(periodKeyFor(start), PAY_PERIOD_ANCHOR);
    assert.ok(Date.parse(`${periodKeyFor(start)}T00:00:00.000Z`) < ANCHOR);
  }
});

test('ISO strings and epoch ms agree', () => {
  for (let n = -30; n <= 30; n++) {
    const ms = ANCHOR + n * PERIOD + 3 * DAY + 3600000;
    assert.equal(periodKeyFor(ms), periodKeyFor(new Date(ms).toISOString()));
  }
});

test('periodKeyFor rejects junk', () => {
  for (const value of [NaN, Infinity, undefined, null, {}, 'not-a-date']) {
    assert.throws(() => periodKeyFor(value), `${String(value)} should have thrown`);
  }
});

test('periodRange round-trips through its own bounds', () => {
  for (let n = -60; n <= 60; n++) {
    const key = periodKeyFor(ANCHOR + n * PERIOD);
    const r = periodRange(key);
    assert.equal(r.key, key);
    assert.equal(periodKeyFor(r.startISO), key);
    assert.equal(periodKeyFor(r.endISO), key);
    assert.equal(periodKeyFor(r.endExclusiveISO), nextPeriodKey(key));
    assert.equal(Date.parse(r.endExclusiveISO) - Date.parse(r.startISO), PERIOD);
    assert.equal(Date.parse(r.endExclusiveISO) - Date.parse(r.endISO), 1);
    assert.equal(r.startISO, `${key}T00:00:00.000Z`);
    assert.equal(r.endExclusiveISO, `${nextPeriodKey(key)}T00:00:00.000Z`);
    assert.equal(r.payDateISO, nextPeriodKey(key));
    assert.ok(r.endISO.endsWith('T23:59:59.999Z'));
  }
});

test('periodRange on the anchor reads the way a payslip would', () => {
  assert.deepEqual(periodRange(PAY_PERIOD_ANCHOR), {
    key: '2026-09-14',
    startISO: '2026-09-14T00:00:00.000Z',
    endISO: '2026-09-27T23:59:59.999Z',
    endExclusiveISO: '2026-09-28T00:00:00.000Z',
    payDateISO: '2026-09-28'
  });
});

test('periodRange rejects a date that is not a period start', () => {
  for (const value of ['2026-09-15', '2026-09-13', '2026-09-21', 'nonsense', '2026-9-14', 20260914, null]) {
    assert.throws(() => periodRange(value), `${String(value)} should have thrown`);
  }
  assert.throws(() => previousPeriodKey('2026-09-15'));
  assert.throws(() => nextPeriodKey('2026-09-15'));
});

test('previous/next round-trip over many periods', () => {
  const first = periodKeyFor(ANCHOR - 100 * PERIOD);
  let key = first;
  for (let n = 0; n < 200; n++) {
    assert.equal(previousPeriodKey(nextPeriodKey(key)), key);
    assert.equal(nextPeriodKey(previousPeriodKey(key)), key);
    const next = nextPeriodKey(key);
    assert.equal(Date.parse(`${next}T00:00:00.000Z`) - Date.parse(`${key}T00:00:00.000Z`), PERIOD);
    key = next;
  }
  // walking forward 200 and back 200 lands where it started
  for (let n = 0; n < 200; n++) key = previousPeriodKey(key);
  assert.equal(key, first);
});

test('isPayWeek alternates across Mondays for more than two years, with no drift', () => {
  let trues = 0;
  for (let w = -30; w < 130; w++) {
    // 160 weeks = 80 periods, spanning several clock changes in every local zone
    const monday = ANCHOR + w * WEEK;
    assert.equal(new Date(monday).getUTCDay(), 1);
    const expected = ((w % 2) + 2) % 2 === 0;
    assert.equal(isPayWeek(monday), expected, `week ${w} (${new Date(monday).toISOString()})`);
    if (expected) trues++;
    // every instant in that UTC week gives the same answer
    assert.equal(isPayWeek(monday + WEEK - 1), expected);
    assert.equal(isPayWeek(monday + 3 * DAY + 12 * 3600000), expected);
    assert.equal(isPayWeek(new Date(monday).toISOString()), expected);
  }
  assert.equal(trues, 80); // exactly half of 160 weeks
});

test('a pay week is the first week of its own period', () => {
  for (let n = -20; n <= 40; n++) {
    const start = ANCHOR + n * PERIOD;
    assert.equal(isPayWeek(start), true);
    assert.equal(isPayWeek(start + WEEK - 1), true);
    assert.equal(isPayWeek(start + WEEK), false);
    assert.equal(isPayWeek(start + PERIOD - 1), false);
    assert.equal(isPayWeek(start + PERIOD), true);
    assert.equal(periodKeyFor(start + WEEK), periodKeyFor(start));
  }
});
