// Run: node --test src/lib/plans.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLANS, catalog, checkoutSpec, payOptionsFor, totalCents, cancelNoticeBy, dollars, monthlyCents, applyOwnerPrices, validPriceCents } from './plans.mjs';

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
  // 14 September 2026: $800 in full against $900 monthly. The pitch on both once-a-week
  // terms is 'pay in full and save $100', so both uplifts are $100.
  assert.equal(PLANS['group-6m-1x'].totals.monthly - PLANS['group-6m-1x'].totals.full, 10000, '6 month uplift is $100');
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
  assert.equal(checkoutSpec('group-6m-1x', 'full').amountCents, 80000);
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
  // A start day the target month does not have must clamp to that month's last day, not
  // overflow into the next one: 31 Jan + 3 months is 30 April, not "31 April" = 1 May.
  assert.equal(cancelNoticeBy('2026-01-31T00:00:00Z', 3, 7), '2026-04-23');
  assert.equal(cancelNoticeBy('2026-08-31T15:00:00Z', 6, 60), '2026-12-30', '31 Aug + 6 months is 28 Feb');
  assert.equal(cancelNoticeBy('2026-08-31T15:00:00Z', 3, 7), '2026-11-23');
  assert.throws(() => cancelNoticeBy('not a date', 3, 7));
});

test('dollars formats cents the way the page prints them', () => {
  assert.equal(dollars(45000), '$450');
  assert.equal(dollars(100000), '$1,000');
  assert.equal(dollars(18333), '$183.33');
  assert.equal(dollars(15000), '$150');
});

// Owner-edited prices. This is the payment path and the value arrives from a saved admin
// draft, so the question each case asks is "what can a bad draft do", not "does the happy
// path work".
test('owner prices override only what is already priced, and only with whole sane cents', () => {
  const fresh = () => ({
    'eval': { label: 'E', cents: 5000, kind: 'once' },
    'group-3m-1x': { label: 'G', kind: 'membership', totals: { full: 45000, monthly: 55000 } },
    'group-3m-unlimited': { label: 'U', kind: 'membership', totals: { full: 65000 } }
  });

  // The happy path: a one-off and one leg of a membership.
  let p = applyOwnerPrices(fresh(), { 'eval': { full: 6000 }, 'group-3m-1x': { full: 47500 } });
  assert.equal(p['eval'].cents, 6000);
  assert.equal(p['group-3m-1x'].totals.full, 47500);
  assert.equal(p['group-3m-1x'].totals.monthly, 55000, 'an untouched pay option keeps its published figure');

  // A pay option the plan does not offer stays not offered. Whether Unlimited can be paid
  // monthly is an owner decision made in plans.mjs, not one made in a text box.
  p = applyOwnerPrices(fresh(), { 'group-3m-unlimited': { monthly: 20000 } });
  assert.equal(p['group-3m-unlimited'].totals.monthly, undefined);

  // A plan that does not exist cannot be invented.
  p = applyOwnerPrices(fresh(), { 'group-99y-free': { full: 100 } });
  assert.ok(!Object.hasOwn(p, 'group-99y-free'));

  // Everything a bad draft could carry, and none of it may land.
  for (const bad of [0, -1, 50, 2000001, 45.5, '45000', null, undefined, NaN, Infinity, {}, []]) {
    const q = applyOwnerPrices(fresh(), { 'group-3m-1x': { full: bad } });
    assert.equal(q['group-3m-1x'].totals.full, 45000, 'a price of ' + JSON.stringify(bad) + ' must be ignored');
  }

  // Junk in place of the map itself must not throw the catalog at import time.
  for (const bad of [null, undefined, 'nope', 7, []]) {
    assert.doesNotThrow(() => applyOwnerPrices(fresh(), bad));
  }
  assert.equal(applyOwnerPrices(fresh(), { 'eval': null })['eval'].cents, 5000);

  assert.equal(validPriceCents(100), true);
  assert.equal(validPriceCents(99), false, 'a dollar is the floor: nothing on this site is free');
});
