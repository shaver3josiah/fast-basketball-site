// Run: node --test server/functions/tests/deals.test.mjs
//
// Cut a Deal and the admin coupon codes, offline. The two admin handlers take their Stripe
// client as a parameter, so a fake one records every call and nothing reaches the network.
// Checkout and the webhook run with no STRIPE_SECRET_KEY, the same way their own suites do.
//
// Env before the imports: leads.mjs, ledger.mjs and deals.mjs read FB_LOCAL at import time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Stripe from 'stripe';
import { sampleRegistration } from '../../../src/lib/registration.mjs';
import { APP_PLANS } from '../../../src/lib/plans.mjs';

const SECRET = 'whsec_test_secret';
process.env.FB_LOCAL = 'true';
process.env.ADMIN_SESSION_SECRET = 'test-secret-1234567890';
process.env.STRIPE_WEBHOOK_SECRET = SECRET;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.RESEND_API_KEY;
delete process.env.PLAYBOOK_FROM_EMAIL;
process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), 'fb-deals-')));

const deals = await import('../lib/deals.mjs');
const { validateDeal, dealState, dealProblem, dealSpec, dealPrice, publicDeal, getDeal, putDeal, EXPIRY_HOURS, dealSessionExpiry } = deals;
const { handle: dealsHandle } = await import('../admin-deals.mjs');
const { handle: couponsHandle, couponParams, COUPON_SCOPES } = await import('../admin-coupons.mjs');
const { default: checkout, sessionParams } = await import('../checkout.mjs');
const { default: webhook } = await import('../stripe-webhook.mjs');
const { default: dealEndpoint } = await import('../deal.mjs');
const { createSessionCookie } = await import('../lib/auth.mjs');
const { listEntries } = await import('../lib/ledger.mjs');

const NOW = Date.UTC(2026, 8, 25, 12, 0, 0);
const cookie = () => createSessionCookie(60_000).split(';')[0];

function adminReq(pathname, body, signedIn = true) {
  const headers = { 'content-type': 'application/json' };
  if (signedIn) headers.cookie = cookie();
  return new Request('http://localhost/api/' + pathname, body === undefined
    ? { method: 'GET', headers }
    : { method: 'POST', headers, body: JSON.stringify(body) });
}

// Records every call; hands back plausible objects.
function fakeStripe({ clash = false } = {}) {
  const calls = [];
  let n = 0;
  const rec = (name, ret) => (...args) => { calls.push([name, ...args]); return Promise.resolve(typeof ret === 'function' ? ret(...args) : ret); };
  return {
    calls,
    checkout: { sessions: { expire: rec('checkout.sessions.expire', {}) } },
    products: { create: rec('products.create', () => ({ id: 'prod_' + (++n) })), update: rec('products.update', {}) },
    prices: {
      create: rec('prices.create', (p) => ({ id: 'price_' + (++n), unit_amount: p.unit_amount, active: true, recurring: p.recurring || null })),
      update: rec('prices.update', {}),
      retrieve: rec('prices.retrieve', {})
    },
    coupons: { create: rec('coupons.create', (p) => ({ id: 'co_' + (++n), ...p })), del: rec('coupons.del', {}) },
    promotionCodes: {
      list: rec('promotionCodes.list', () => ({ data: clash ? [{ id: 'promo_old', code: 'FALL50' }] : [] })),
      create: rec('promotionCodes.create', (p) => ({ id: 'promo_' + (++n), code: p.code, active: true, expires_at: p.expires_at, times_redeemed: 0, created: 1, promotion: p.promotion })),
      update: rec('promotionCodes.update', (id) => ({ id, code: 'X', active: false, promotion: {} }))
    }
  };
}

const records = () => {
  const f = path.resolve('.local/leads.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : [];
};

// ---------------------------------------------------------------- validation

test('a $750 four-week deal validates, paid in full, with an id and no expiry', () => {
  const { errors, deal } = validateDeal({ title: '4 weeks of group training', fullCents: 75000 }, NOW);
  assert.deepEqual(errors, {});
  assert.equal(deal.full, 75000);
  assert.equal(deal.monthly, null);
  assert.equal(deal.expiresAt, null);
  assert.match(deal.id, /^[A-Za-z0-9_-]{8,40}$/);
  assert.equal(dealState(deal, NOW), 'open');
});

test('a deal needs a title and at least one way to pay, and refuses silly numbers', () => {
  assert.ok(validateDeal({ fullCents: 75000 }).errors.title);
  assert.ok(validateDeal({ title: 'Four weeks' }).errors.fullCents, 'no price at all');
  assert.ok(validateDeal({ title: 'Four weeks', fullCents: 50 }).errors.fullCents, 'under $1');
  assert.ok(validateDeal({ title: 'Four weeks', fullCents: 750.5 }).errors.fullCents, 'not whole cents');
  assert.ok(validateDeal({ title: 'Four weeks', monthlyTotalCents: 90000, payments: 1 }).errors.payments);
  assert.ok(validateDeal({ title: 'Four weeks', monthlyTotalCents: 90000, payments: 13 }).errors.payments);
  assert.ok(validateDeal({ title: 'Four weeks', fullCents: 75000, expiresHours: 5 }).errors.expiresHours);
  assert.ok(validateDeal({ title: 'Four weeks', fullCents: 75000, expiresHours: 'abc' }).errors.expiresHours, 'junk is refused, never "no expiry"');
  assert.deepEqual(validateDeal({ title: 'Four weeks', fullCents: 75000, expiresHours: '0' }).errors, {});
});

test('a payment plan splits to whole cents, rounding down, never over the total', () => {
  const { deal } = validateDeal({ title: 'Plan', monthlyTotalCents: 55000, payments: 3 }, NOW);
  assert.deepEqual(deal.monthly, { payments: 3, eachCents: 18333 });
  assert.equal(publicDeal(deal).lines.monthly, '$183.33 a month for 3 months, $549.99 in total');
});

test('expiry, payment and closing each end a deal, and a parent is told why', () => {
  const { deal } = validateDeal({ title: 'X deal', fullCents: 10000, expiresHours: 24 }, NOW);
  assert.equal(dealState(deal, NOW + 23 * 3600e3), 'open');
  assert.equal(dealState(deal, NOW + 24 * 3600e3), 'expired');
  assert.match(dealProblem(deal, NOW + 25 * 3600e3), /ended/);
  assert.match(dealProblem({ ...deal, paidAt: 'x' }, NOW), /already been used/);
  assert.match(dealProblem({ ...deal, closedAt: 'x' }, NOW), /ended/);
  assert.match(dealProblem(null), /not right/);
  assert.equal(dealProblem(deal, NOW), null);
  assert.deepEqual(EXPIRY_HOURS.slice(0, 2), [24, 48]);
  assert.equal(EXPIRY_HOURS.at(-1), 720, 'a month is the ceiling');
});

// ---------------------------------------------------------------- the spec Stripe is sent

test('dealSpec: paid in full is one payment of exactly the deal price', () => {
  const { deal } = validateDeal({ title: '4 weeks of group training', fullCents: 75000 }, NOW);
  const spec = dealSpec(deal, 'full');
  assert.equal(spec.mode, 'payment');
  assert.equal(spec.amountCents, 75000);
  assert.equal(spec.plan, 'deal');
  assert.deepEqual(spec.metadata, { plan: 'deal', pay: 'full', deal: deal.id, totalCents: '75000' });
  assert.throws(() => dealSpec(deal, 'monthly'), /does not include/);

  const p = sessionParams(spec, { email: 'p@x.test', priceId: 'price_9', siteUrl: 'https://fast-basketball.com', nowSeconds: 1, registrationId: 'r1' });
  assert.equal(p.cancel_url, 'https://fast-basketball.com/enroll?deal=' + deal.id, 'cancel goes back to the deal, not the catalog');
  assert.equal(p.metadata.deal, deal.id);
  assert.deepEqual(p.payment_intent_data.metadata, p.metadata);
});

test('dealSpec: a payment plan is a subscription that ENDS after its payments', () => {
  const { deal } = validateDeal({ title: 'Plan', monthlyTotalCents: 90000, payments: 3 }, NOW);
  const spec = dealSpec(deal, 'monthly');
  assert.equal(spec.mode, 'subscription');
  assert.equal(spec.amountCents, 30000);
  assert.equal(spec.iterations, 3);
  assert.equal(spec.endBehavior, 'cancel', 'a deal must never roll on month to month');
  assert.equal(spec.metadata.payments, '3');
  const p = sessionParams(spec, { email: 'p@x.test', priceId: 'price_9', siteUrl: 'https://x.test', nowSeconds: 1, registrationId: 'r1' });
  assert.deepEqual(p.subscription_data.metadata, p.metadata, 'the invoices carry the deal and registration too');
});

test('dealPrice refuses a Stripe price that is archived, the wrong amount, or the wrong kind', async () => {
  const { deal } = validateDeal({ title: 'X deal', fullCents: 75000 }, NOW);
  deal.prices = { full: 'price_1' };
  const spec = dealSpec(deal, 'full');
  const with_ = (price) => ({ prices: { retrieve: async () => price } });
  assert.ok(await dealPrice(with_({ id: 'price_1', active: true, unit_amount: 75000, recurring: null }), deal, spec));
  assert.equal(await dealPrice(with_({ active: false, unit_amount: 75000, recurring: null }), deal, spec), null);
  assert.equal(await dealPrice(with_({ active: true, unit_amount: 100, recurring: null }), deal, spec), null);
  assert.equal(await dealPrice(with_({ active: true, unit_amount: 75000, recurring: { interval: 'month' } }), deal, spec), null);
  assert.equal(await dealPrice(with_({}), { ...deal, prices: {} }, spec), null, 'no stored price, no charge');
});

// ---------------------------------------------------------------- admin-deals

test('admin-deals refuses anyone without a session', async () => {
  const res = await dealsHandle(adminReq('admin-deals', undefined, false), fakeStripe());
  assert.equal(res.status, 401);
});

test('creating a deal makes one Stripe product and a price per pay option, then stores it', async () => {
  const stripe = fakeStripe();
  const res = await dealsHandle(adminReq('admin-deals', {
    action: 'create', title: '4 weeks of group training', forName: 'The Smith family',
    fullCents: 75000, monthlyTotalCents: 90000, payments: 3, expiresHours: 168
  }), stripe);
  assert.equal(res.status, 200);
  const { deal } = await res.json();
  assert.equal(deal.state, 'open');
  assert.equal(deal.link, 'https://fast-basketball.com/enroll?deal=' + deal.id);

  const names = stripe.calls.map((c) => c[0]);
  assert.deepEqual(names, ['products.create', 'prices.create', 'prices.create']);
  const [, full] = stripe.calls[1];
  const [, monthly] = stripe.calls[2];
  assert.equal(full.unit_amount, 75000);
  assert.equal(full.recurring, undefined);
  assert.equal(monthly.unit_amount, 30000);
  assert.deepEqual(monthly.recurring, { interval: 'month' });
  assert.equal(stripe.calls[0][1].name, '4 weeks of group training', 'the product name is what Stripe shows the parent');

  const stored = await getDeal(deal.id);
  assert.deepEqual(Object.keys(stored.prices).sort(), ['full', 'monthly']);

  const list = await (await dealsHandle(adminReq('admin-deals'), stripe)).json();
  assert.ok(list.deals.some((d) => d.id === deal.id));
});

test('a bad deal is 422 and Stripe is never asked', async () => {
  const stripe = fakeStripe();
  const res = await dealsHandle(adminReq('admin-deals', { action: 'create', title: 'x' }), stripe);
  assert.equal(res.status, 422);
  assert.equal(stripe.calls.length, 0);
});

test('a deal session never outlives the deal, and never drops under the 30 minute Stripe floor', () => {
  const now = 1_000_000;
  const TTL = 23 * 3600;
  assert.equal(dealSessionExpiry({ expiresAt: null }, now, TTL), now + TTL);
  assert.equal(dealSessionExpiry({ expiresAt: new Date((now + 3600) * 1000).toISOString() }, now, TTL), now + 3600);
  assert.equal(dealSessionExpiry({ expiresAt: new Date((now + 60) * 1000).toISOString() }, now, TTL), now + 31 * 60);
});

test('closing a deal expires every checkout it opened, so no open tab can still pay', async () => {
  const stripe = fakeStripe();
  const { deal } = await (await dealsHandle(adminReq('admin-deals', { action: 'create', title: 'Tabs test', fullCents: 5000 }), stripe)).json();
  await putDeal({ ...(await getDeal(deal.id)), sessions: ['cs_a', 'cs_b'] });
  await dealsHandle(adminReq('admin-deals', { action: 'close', id: deal.id }), stripe);
  const expired = stripe.calls.filter((c) => c[0] === 'checkout.sessions.expire').map((c) => c[1]);
  assert.deepEqual(expired, ['cs_a', 'cs_b']);
});

test('closing a deal kills the link first, then archives its Stripe prices', async () => {
  const stripe = fakeStripe();
  const { deal } = await (await dealsHandle(adminReq('admin-deals', { action: 'create', title: 'Closing test', fullCents: 5000 }), stripe)).json();
  const res = await dealsHandle(adminReq('admin-deals', { action: 'close', id: deal.id }), stripe);
  assert.equal((await res.json()).deal.state, 'closed');
  assert.ok(stripe.calls.some((c) => c[0] === 'prices.update' && c[2].active === false));
  assert.ok(stripe.calls.some((c) => c[0] === 'products.update' && c[2].active === false));
  const pub = await dealEndpoint(new Request('http://localhost/api/deal?id=' + deal.id));
  assert.equal(pub.status, 410);
});

// ---------------------------------------------------------------- coupons

test('couponParams: the name is upper-cased, the value and expiry go to Stripe exactly', () => {
  const p = couponParams({ code: ' fall-50 ', kind: 'amount', value: 5000, scope: 'all', hours: 48 }, 1000);
  assert.deepEqual(p.errors, {});
  assert.equal(p.code, 'FALL-50');
  assert.equal(p.coupon.amount_off, 5000);
  assert.equal(p.coupon.currency, 'usd');
  assert.equal(p.coupon.duration, 'once');
  assert.equal(p.coupon.redeem_by, 1000 + 48 * 3600);
  const promo = p.promo('co_1');
  assert.deepEqual(promo.promotion, { type: 'coupon', coupon: 'co_1' });
  assert.equal(promo.expires_at, 1000 + 48 * 3600);
  assert.equal(promo.code, 'FALL-50');

  const pct = couponParams({ code: 'TEN', kind: 'percent', value: 10, scope: 'eval', hours: 720 }, 0);
  assert.equal(pct.coupon.percent_off, 10);
  assert.equal(pct.coupon.amount_off, undefined);
  assert.equal(pct.coupon.metadata.plans, 'eval,eval-call');
});

test('couponParams refuses bad names, values, scopes and expiries', () => {
  assert.ok(couponParams({ code: 'no spaces', kind: 'amount', value: 500, scope: 'all', hours: 24 }).errors.code);
  assert.ok(couponParams({ code: 'AB', kind: 'amount', value: 500, scope: 'all', hours: 24 }).errors.code);
  assert.ok(couponParams({ code: 'OK1', kind: 'percent', value: 101, scope: 'all', hours: 24 }).errors.value);
  assert.ok(couponParams({ code: 'OK1', kind: 'amount', value: 50, scope: 'all', hours: 24 }).errors.value);
  assert.ok(couponParams({ code: 'OK1', kind: 'amount', value: 500, scope: 'everything', hours: 24 }).errors.scope);
  assert.ok(couponParams({ code: 'OK1', kind: 'amount', value: 500, scope: 'all', hours: 12 }).errors.hours, 'under 24 hours');
  assert.ok(couponParams({ code: 'OK1', kind: 'amount', value: 500, scope: 'all', hours: 1000 }).errors.hours, 'over a month');
});

test('no admin coupon can ever reach the 50/50 tool products', () => {
  for (const scope of Object.values(COUPON_SCOPES)) {
    for (const key of Object.keys(APP_PLANS)) assert.ok(!scope.plans.includes(key), key + ' in ' + scope.label);
  }
});

test('creating a coupon makes the coupon, then the promotion code pointing at it', async () => {
  const stripe = fakeStripe();
  const res = await couponsHandle(adminReq('admin-coupons', { action: 'create', code: 'fall50', kind: 'amount', value: 5000, scope: 'membership', hours: 168 }), stripe);
  assert.equal(res.status, 200);
  const { coupon } = await res.json();
  assert.equal(coupon.code, 'FALL50');
  assert.equal(coupon.amountOff, 5000);
  assert.equal(coupon.worksOn, 'Group memberships only');
  const names = stripe.calls.map((c) => c[0]);
  assert.deepEqual(names, ['promotionCodes.list', 'coupons.create', 'promotionCodes.create']);
  assert.equal(stripe.calls[2][1].promotion.coupon, 'co_1', 'the code points at the coupon just made');
});

test('a name already live is refused before any coupon is created', async () => {
  const stripe = fakeStripe({ clash: true });
  const res = await couponsHandle(adminReq('admin-coupons', { action: 'create', code: 'FALL50', kind: 'amount', value: 5000, scope: 'all', hours: 24 }), stripe);
  assert.equal(res.status, 422);
  assert.ok(!stripe.calls.some((c) => c[0] === 'coupons.create'), 'no orphan coupon');
});

test('turning a code off deactivates it in Stripe', async () => {
  const stripe = fakeStripe();
  const res = await couponsHandle(adminReq('admin-coupons', { action: 'off', id: 'promo_abc' }), stripe);
  assert.equal(res.status, 200);
  assert.deepEqual(stripe.calls[0], ['promotionCodes.update', 'promo_abc', { active: false }]);
  assert.equal((await couponsHandle(adminReq('admin-coupons', { action: 'off', id: 'nope' }), stripe)).status, 400);
});

test('coupons without a Stripe key say so, and need a session', async () => {
  assert.equal((await couponsHandle(adminReq('admin-coupons'), null)).status, 503);
  assert.equal((await couponsHandle(adminReq('admin-coupons', undefined, false), fakeStripe())).status, 401);
});

// ---------------------------------------------------------------- checkout and the webhook

function checkoutReq(body) {
  return new Request('http://localhost/api/checkout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

test('checkout prices a deal from the store, ignoring any amount or coupon the page sends', async () => {
  const { deal } = validateDeal({ title: '4 weeks of group training', fullCents: 75000 }, Date.now());
  await putDeal(deal);
  const res = await checkout(checkoutReq({
    ...sampleRegistration(), plan: 'deal', deal: deal.id, pay: 'full', 'en-hp': '',
    amountCents: 1, coupon: 'FALL50'
  }), { ip: '10.0.0.1' });
  assert.equal(res.status, 503, 'no Stripe key: saved, then 503, like every plan');
  const { registrationId } = await res.json();
  const row = records().find((r) => r.key === 'registration:' + registrationId);
  assert.equal(row.type, 'enrollment');
  assert.equal(row.plan, 'deal');
  assert.equal(row.deal, deal.id);
  assert.equal(row.planLabel, '4 weeks of group training');
  assert.equal(row.amountCents, 75000);
  assert.equal(row.termTotalCents, 75000);
  assert.equal(row.coupon, undefined, 'a coupon never rides on a deal');
  assert.equal(row.months, null, 'a deal has no term, so no renewal notice');
});

test('a closed, used or made-up deal is refused before anything is written', async () => {
  const { deal } = validateDeal({ title: 'Used deal', fullCents: 75000 }, Date.now());
  await putDeal({ ...deal, paidAt: new Date().toISOString() });
  const before = records().length;
  for (const id of [deal.id, 'madeUpDealId123']) {
    const res = await checkout(checkoutReq({ ...sampleRegistration(), plan: 'deal', deal: id, pay: 'full', 'en-hp': '' }), { ip: '10.0.0.2' });
    assert.equal(res.status, 422);
  }
  assert.equal(records().length, before);
});

test('a paid deal session completes the enrollment, closes the deal, and accrues as training', async () => {
  const { deal } = validateDeal({ title: '4 weeks of group training', fullCents: 75000 }, Date.now());
  await putDeal(deal);
  const res = await checkout(checkoutReq({ ...sampleRegistration(), plan: 'deal', deal: deal.id, pay: 'full', 'en-hp': '' }), { ip: '10.0.0.3' });
  const { registrationId } = await res.json();
  const spec = dealSpec(deal, 'full');
  const event = {
    id: 'evt_deal', object: 'event', type: 'checkout.session.completed', created: Math.floor(Date.now() / 1000), livemode: true,
    data: { object: {
      id: 'cs_live_deal', object: 'checkout.session', mode: 'payment', payment_status: 'paid', amount_total: 75000,
      currency: 'usd', customer: 'cus_1', subscription: null, payment_intent: 'pi_deal',
      customer_details: { email: 'parent@example.test', phone: '+15551234567' },
      consent: { terms_of_service: 'accepted' },
      custom_fields: [{ key: 'agree_name', type: 'text', text: { value: 'Pat Parent' } }],
      metadata: { ...spec.metadata, registrationId }
    } }
  };
  const payload = JSON.stringify(event);
  const hook = await webhook(new Request('http://localhost/api/stripe-webhook', {
    method: 'POST', headers: { 'stripe-signature': Stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET }) }, body: payload
  }));
  assert.equal(hook.status, 200);
  const row = records().find((r) => r.key === 'registration:' + registrationId);
  assert.equal(row.paymentStatus, 'paid');
  assert.equal(row.planLabel, '4 weeks of group training');
  assert.equal(row.cancelNoticeBy, null);
  assert.ok((await getDeal(deal.id)).paidAt, 'one family per link');

  // A resend after the deal record was lost still closes the link: marking runs before the
  // duplicate check, not after the owner email.
  await putDeal({ ...(await getDeal(deal.id)), paidAt: null });
  const again = await webhook(new Request('http://localhost/api/stripe-webhook', {
    method: 'POST', headers: { 'stripe-signature': Stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET }) }, body: payload
  }));
  assert.equal(again.status, 200);
  assert.ok((await getDeal(deal.id)).paidAt);

  const entry = (await listEntries()).entries.find((e) => e.sessionId === 'cs_live_deal');
  assert.equal(entry.amountCents, 75000);
  assert.equal(entry.product, 'training', 'a deal is training revenue, never the 50/50 rate');
});

test('a deal session that completes unpaid (a delayed payment) still closes the link', async () => {
  const { deal } = validateDeal({ title: 'Delayed', fullCents: 75000 }, Date.now());
  await putDeal(deal);
  const spec = dealSpec(deal, 'full');
  const event = {
    id: 'evt_delayed', object: 'event', type: 'checkout.session.completed', created: Math.floor(Date.now() / 1000), livemode: true,
    data: { object: {
      id: 'cs_live_delayed', object: 'checkout.session', mode: 'payment', payment_status: 'unpaid', amount_total: 75000,
      currency: 'usd', customer_details: { email: 'd@example.test' }, consent: {}, custom_fields: [],
      metadata: { ...spec.metadata, registrationId: 'no-such-reg' }
    } }
  };
  const payload = JSON.stringify(event);
  const res = await webhook(new Request('http://localhost/api/stripe-webhook', {
    method: 'POST', headers: { 'stripe-signature': Stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET }) }, body: payload
  }));
  assert.equal(res.status, 200);
  assert.equal(dealState(await getDeal(deal.id)), 'paid');
  const accrued = (await listEntries()).entries.find((e) => e.sessionId === 'cs_live_delayed');
  assert.equal(accrued, undefined, 'no commission until the money is actually collected');
});
