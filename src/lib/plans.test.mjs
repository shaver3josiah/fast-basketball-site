// Run: node --test src/lib/plans.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLANS, catalog, checkoutSpec, payOptionsFor, totalCents, cancelNoticeBy, dollars, monthlyCents } from './plans.mjs';

test('catalog is 8 specs with unique lookup keys and whole-cent amounts', () => {
  const specs = catalog();
  assert.equal(specs.length, 8);
  const keys = new Set(specs.map((s) => s.lookupKey));
  assert.equal(keys.size, 8);
  for (const s of specs) {
    assert.ok(Number.isInteger(s.amountCents) && s.amountCents > 0, s.lookupKey + ' amount ' + s.amountCents);
    assert.ok(['payment', 'subscription'].includes(s.mode));
    if (s.mode === 'subscription') assert.equal(s.interval, 'month');
    else assert.equal(s.interval, null);
  }
});

test('a plan offers exactly the pay options it prices, and never invents one', () => {
  for (const [key, plan] of Object.entries(PLANS)) {
    if (plan.kind === 'once') {
      assert.deepEqual(payOptionsFor(key), ['full'], key);
      continue;
    }
    assert.deepEqual(payOptionsFor(key), Object.keys(plan.totals), key + ' offers what it prices');
    for (const pay of ['full', 'monthly']) {
      if (Object.hasOwn(plan.totals, pay)) assert.equal(totalCents(key, pay), plan.totals[pay], key + ' ' + pay);
      else assert.throws(() => checkoutSpec(key, pay), key + ' must refuse unpriced ' + pay);
    }
  }
});

test('the Unlimited tiers publish one figure, so they are pay in full only', () => {
  assert.deepEqual(payOptionsFor('group-3m-unlimited'), ['full']);
  assert.deepEqual(payOptionsFor('group-6m-unlimited'), ['full']);
  assert.throws(() => checkoutSpec('group-6m-unlimited', 'monthly'));
});

test('paying monthly costs more than paying up front — the September 2026 rule', () => {
  for (const [key, plan] of Object.entries(PLANS)) {
    if (plan.kind !== 'membership' || !Object.hasOwn(plan.totals, 'monthly')) continue;
    assert.ok(plan.totals.monthly > plan.totals.full, key + ' monthly must exceed full');
  }
  assert.equal(PLANS['group-3m-1x'].totals.monthly - PLANS['group-3m-1x'].totals.full, 10000, '3 month uplift is $100');
  assert.equal(PLANS['group-6m-1x'].totals.monthly - PLANS['group-6m-1x'].totals.full, 15000, '6 month uplift is $150');
});

test('published totals: full is exact, monthly sums within a cent per month', () => {
  for (const [key, plan] of Object.entries(PLANS)) {
    if (plan.kind !== 'membership') continue;
    assert.equal(checkoutSpec(key, 'full').amountCents, plan.totals.full, key + ' full');
    if (!Object.hasOwn(plan.totals, 'monthly')) continue;
    const monthly = checkoutSpec(key, 'monthly');
    assert.equal(monthly.iterations, plan.months);
    assert.equal(monthly.endBehavior, 'release');
    // Rounding may land a cent either side; it must never drift by a whole month's worth.
    const drift = monthly.amountCents * plan.months - plan.totals.monthly;
    assert.ok(Math.abs(drift) < plan.months, key + ' monthly drift ' + drift + ' cents');
  }
});

test('the rates on the page', () => {
  assert.equal(checkoutSpec('eval', 'full').amountCents, 5000);
  assert.equal(checkoutSpec('eval-call', 'full').amountCents, 3500);
  assert.equal(checkoutSpec('group-3m-1x', 'full').amountCents, 45000);
  assert.equal(checkoutSpec('group-3m-unlimited', 'full').amountCents, 65000);
  assert.equal(checkoutSpec('group-6m-1x', 'full').amountCents, 75000);
  assert.equal(checkoutSpec('group-6m-unlimited', 'full').amountCents, 100000);
  // $900 over 6 months is exactly $150, the figure printed on the price sheet.
  assert.equal(checkoutSpec('group-6m-1x', 'monthly').amountCents, 15000);
  // $550 over 3 months is $183.33, a cent under across the term rather than over.
  assert.equal(checkoutSpec('group-3m-1x', 'monthly').amountCents, 18333);
  assert.equal(monthlyCents(55000, 3) * 3, 54999);
});

test('six month terms carry the 60 day notice, three month terms 7 days', () => {
  assert.equal(PLANS['group-3m-1x'].noticeDays, 7);
  assert.equal(PLANS['group-3m-unlimited'].noticeDays, 7);
  assert.equal(PLANS['group-6m-1x'].noticeDays, 60);
  assert.equal(PLANS['group-6m-unlimited'].noticeDays, 60);
});

test('evaluations are pay in full only, and bad input throws before any Stripe call', () => {
  assert.deepEqual(payOptionsFor('eval'), ['full']);
  assert.throws(() => checkoutSpec('eval', 'monthly'));
  assert.throws(() => checkoutSpec('group-3m-1x', 'weekly'));
  assert.throws(() => checkoutSpec('group-3m-1x', 'split'), 'split is no longer sold');
  assert.throws(() => checkoutSpec('group-12m-2x', 'full'), 'retired plan keys must not resolve');
  assert.throws(() => checkoutSpec('__proto__', 'full'));
  assert.throws(() => checkoutSpec('constructor', 'full'));
  assert.throws(() => checkoutSpec('', 'full'));
  assert.throws(() => checkoutSpec(undefined, 'full'));
});

test('metadata is strings only, which is what Stripe accepts', () => {
  for (const s of catalog()) {
    for (const v of Object.values(s.metadata)) assert.equal(typeof v, 'string', s.lookupKey);
  }
});

test('cancelNoticeBy: 3 months minus 7 days, 6 months minus 60 days', () => {
  assert.equal(cancelNoticeBy('2026-09-10T15:00:00Z', 3, 7), '2026-12-03');
  assert.equal(cancelNoticeBy('2026-09-10T15:00:00Z', 6, 60), '2027-01-09');
  // Month-end start rolls forward the way JS Date does; the point is it never throws.
  assert.equal(cancelNoticeBy('2026-01-31T00:00:00Z', 3, 7), '2026-04-24');
  assert.throws(() => cancelNoticeBy('not a date', 3, 7));
});

test('dollars formats cents the way the page prints them', () => {
  assert.equal(dollars(45000), '$450');
  assert.equal(dollars(100000), '$1,000');
  assert.equal(dollars(18333), '$183.33');
  assert.equal(dollars(15000), '$150');
});
