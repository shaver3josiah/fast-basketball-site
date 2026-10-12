// Run: node --test server/functions/tests/packages.test.mjs
//
// The admin's Prices tab, offline: the catalog layer in plans.mjs, the change rules in
// lib/packages.mjs, the two endpoints, and checkout refusing a hidden package. The Stripe client
// is a parameter of the admin handler, so a fake records every call and nothing reaches the network.
//
// Env before the imports: the stores read FB_LOCAL, and the session cookie needs its secret.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sampleRegistration } from '../../../src/lib/registration.mjs';

process.env.FB_LOCAL = 'true';
process.env.ADMIN_SESSION_SECRET = 'test-secret-1234567890';
delete process.env.STRIPE_SECRET_KEY;
delete process.env.RESEND_API_KEY;
delete process.env.PLAYBOOK_FROM_EMAIL;
process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), 'fb-packages-')));

const plans = await import('../../../src/lib/plans.mjs');
const { PLANS, normalizeDoc, effectivePlans, setStoredPackages, isRetired, checkoutSpec, payOptionsFor, priceFigure, catalogView } = plans;
const { applyChange, specsFor, readDoc, adminView, publicView, refreshPackages } = await import('../lib/packages.mjs');
const { handle } = await import('../admin-packages.mjs');
const { default: publicHandler } = await import('../packages.mjs');
const { default: checkout } = await import('../checkout.mjs');
const { syncSpecs } = await import('../lib/catalog-sync.mjs');
const { createSessionCookie } = await import('../lib/auth.mjs');

const cookie = () => createSessionCookie(60_000).split(';')[0];
const req = (body, signedIn = true) => {
  const headers = { 'content-type': 'application/json' };
  if (signedIn) headers.cookie = cookie();
  return new Request('http://localhost/api/admin-packages', body === undefined
    ? { method: 'GET', headers }
    : { method: 'POST', headers, body: JSON.stringify(body) });
};

// The slice of Stripe syncSpecs touches, plus a switch to make it refuse.
function fakeStripe({ refuse = false } = {}) {
  const state = { products: [], prices: [], calls: [] };
  let seq = 0;
  return {
    state,
    prices: {
      async list({ lookup_keys, active }) {
        if (lookup_keys.length > 10) throw new Error('up to 10 lookup_keys');
        return { data: state.prices.filter((p) => p.active === active && lookup_keys.includes(p.lookup_key)).map((p) => ({ ...p, product: state.products.find((pr) => pr.id === p.product) || p.product })) };
      },
      async create(params) {
        state.calls.push(['prices.create', params]);
        if (refuse) throw new Error('card reader says no');
        if (params.transfer_lookup_key) for (const p of state.prices) if (p.lookup_key === params.lookup_key) p.lookup_key = null;
        const price = { id: 'price_' + ++seq, active: true, unit_amount: params.unit_amount, currency: 'usd', lookup_key: params.lookup_key, product: params.product, recurring: params.recurring ? { interval: params.recurring.interval, interval_count: 1 } : null };
        state.prices.push(price);
        return price;
      },
      async update(id, params) { state.calls.push(['prices.update', id, params]); Object.assign(state.prices.find((p) => p.id === id), params); return {}; }
    },
    products: {
      async search() { return { data: [] }; },
      async create(params) { state.calls.push(['products.create', params]); const p = { id: 'prod_' + ++seq, active: true, name: params.name, metadata: params.metadata }; state.products.push(p); return p; }
    }
  };
}

// Every test starts from the published catalog and an empty store.
function reset() {
  setStoredPackages(null);
  fs.rmSync(path.resolve('.local/packages.json'), { force: true });
}

const TERM = { action: 'add', program: 'individual', kind: 'term', termMonths: 9, frequency: 'once a week', cents: 270000 };

// ---------------------------------------------------------------- the layer in plans.mjs

test('an empty store leaves the published catalog exactly as it was', () => {
  reset();
  const before = JSON.stringify(PLANS);
  setStoredPackages({});
  assert.equal(JSON.stringify(PLANS), before);
  assert.equal(isRetired('individual-3m'), false);
});

test('a stored price replaces a published one, and clearing the store puts it back', () => {
  reset();
  setStoredPackages({ overrides: { 'individual-3m': { full: 95000 } } });
  assert.equal(PLANS['individual-3m'].totals.full, 95000);
  assert.equal(checkoutSpec('individual-3m', 'full').amountCents, 95000);
  setStoredPackages(null);
  assert.equal(PLANS['individual-3m'].totals.full, 90000);
});

test('bad stored data is dropped, never repaired into a price', () => {
  const doc = normalizeDoc({
    overrides: { 'individual-3m': { full: 5, monthly: 'free' }, 'no-such-plan': { full: 90000 }, shotform: { full: 100 } },
    added: {
      'pk-good0001': { label: 'Individual Training, 9 months, once a week', program: 'individual', kind: 'term', termMonths: 9, frequency: 'once a week', cents: 270000 },
      'pk-badfreq1': { label: 'Individual Training, x', program: 'individual', kind: 'term', termMonths: 9, frequency: 'daily', cents: 270000 },
      'pk-badmon01': { label: 'Individual Training, x', program: 'individual', kind: 'term', termMonths: 99, frequency: 'once a week', cents: 270000 },
      'pk-free0001': { label: 'Individual Training, free', program: 'individual', kind: 'once', cents: 0 },
      'pk-evalprog': { label: 'Sneaky', program: 'evaluation', kind: 'once', cents: 5000 },
      'individual-3m': { label: 'Individual Training, 3 months, once a week', program: 'individual', kind: 'once', cents: 1 },
      'NOT A KEY': { label: 'Individual Training, x', program: 'individual', kind: 'once', cents: 5000 }
    },
    retired: ['individual-6m', 'no-such-plan', 7]
  });
  assert.deepEqual(Object.keys(doc.added), ['pk-good0001']);
  assert.deepEqual(doc.overrides, {}, 'a sub-dollar price, an unknown plan and a tool are all dropped');
  assert.deepEqual(doc.retired, ['individual-6m']);
});

test('an added package becomes a real plan with a spec Stripe can price', () => {
  reset();
  setStoredPackages({ added: { 'pk-aaaaaa01': { label: 'Individual Training, 9 months, once a week', program: 'individual', kind: 'term', termMonths: 9, frequency: 'once a week', cents: 270000 } } });
  assert.deepEqual(payOptionsFor('pk-aaaaaa01'), ['full']);
  const spec = checkoutSpec('pk-aaaaaa01', 'full');
  assert.equal(spec.amountCents, 270000);
  assert.equal(spec.mode, 'payment');
  assert.equal(spec.lookupKey, 'pk-aaaaaa01-full');
  assert.equal(spec.metadata.months, undefined, 'a prepaid term carries no renewal metadata');
  assert.equal(priceFigure('pk-aaaaaa01:full'), '$2,700');
  reset();
});

test('a monthly package bills until cancelled, a one-off package is one payment', () => {
  reset();
  setStoredPackages({ added: {
    'pk-monthly01': { label: 'Group Training, twice a week', program: 'group', kind: 'recurring', frequency: 'twice a week', cents: 40000 },
    'pk-clinic001': { label: 'Individual Training, Skills clinic', program: 'individual', kind: 'once', cents: 6000, description: 'Two hours on the court.' }
  } });
  const monthly = checkoutSpec('pk-monthly01', 'monthly');
  assert.equal(monthly.mode, 'subscription');
  assert.equal(monthly.iterations, null);
  const once = checkoutSpec('pk-clinic001', 'full');
  assert.equal(once.mode, 'payment');
  assert.equal(once.description, 'Two hours on the court.');
  reset();
});

test('the two tools can never be repriced from here', () => {
  reset();
  setStoredPackages({ overrides: { shotform: { full: 100 }, dribble: { full: 100 } } });
  assert.equal(checkoutSpec('shotform', 'full').amountCents, 10000);
  assert.equal(checkoutSpec('dribble', 'full').amountCents, 2000);
  reset();
});

// ---------------------------------------------------------------- the rules for a change

test('a price change: set, and typed back to the published figure removes the override', () => {
  reset();
  const first = applyChange(normalizeDoc(null), { action: 'price', key: 'individual-3m', prices: { full: 95000 } });
  assert.deepEqual(first.doc.overrides, { 'individual-3m': { full: 95000 } });
  assert.deepEqual(first.keys, ['individual-3m']);
  const back = applyChange(first.doc, { action: 'price', key: 'individual-3m', prices: { full: 90000 } });
  assert.deepEqual(back.doc.overrides, {});
});

test('a price change refuses what plans.mjs would refuse', () => {
  const none = normalizeDoc(null);
  assert.match(applyChange(none, { action: 'price', key: 'nope', prices: { full: 90000 } }).error, /No package/);
  assert.match(applyChange(none, { action: 'price', key: 'individual-3m', prices: { monthly: 90000 } }).error, /no "monthly"/);
  assert.match(applyChange(none, { action: 'price', key: 'individual-3m', prices: { full: 50 } }).error, /\$1 and \$20,000/);
  assert.match(applyChange(none, { action: 'price', key: 'individual-3m', prices: { full: 2000001 } }).error, /\$1 and \$20,000/);
  assert.match(applyChange(none, { action: 'price', key: 'shotform', prices: { full: 90000 } }).error, /No package/);
  assert.match(applyChange(none, { action: 'price', key: 'individual-3m', prices: {} }).error, /Type a price/);
});

test('a group membership prices its monthly TOTAL, not one instalment', () => {
  const change = applyChange(normalizeDoc(null), { action: 'price', key: 'group-3m-1x', prices: { monthly: 60000 } });
  setStoredPackages(change.doc);
  assert.equal(PLANS['group-3m-1x'].totals.monthly, 60000);
  assert.equal(checkoutSpec('group-3m-1x', 'monthly').amountCents, 20000);
  reset();
});

test('adding: a term gets a generated name, a one-off needs one, and a twin is refused', () => {
  reset();
  const added = applyChange(normalizeDoc(null), TERM);
  const [key] = Object.keys(added.doc.added);
  assert.match(key, /^pk-[0-9a-f]{10}$/);
  assert.equal(added.doc.added[key].label, 'Individual Training, 9 months, once a week');
  assert.deepEqual(added.keys, [key]);

  assert.match(applyChange(normalizeDoc(null), { ...TERM, kind: 'once' }).error, /name/i);
  assert.match(applyChange(added.doc, TERM).error, /already exists/);
  assert.match(applyChange(normalizeDoc(null), { ...TERM, termMonths: 3 }).error, /already exists/, 'the built-in 3 month term counts');
  assert.ok(applyChange(added.doc, { ...TERM, name: 'Summer intensive' }).doc, 'a named one is allowed beside it');
  assert.match(applyChange(normalizeDoc(null), { ...TERM, termMonths: 25 }).error, /1 to 24/);
  assert.match(applyChange(normalizeDoc(null), { ...TERM, frequency: 'daily' }).error, /sessions a week/);
  assert.match(applyChange(normalizeDoc(null), { ...TERM, program: 'evaluation' }).error, /Individual or Group/);
  assert.match(applyChange(normalizeDoc(null), { ...TERM, cents: 0 }).error, /\$1 and \$20,000/);
  assert.match(applyChange(normalizeDoc(null), { ...TERM, name: 'x'.repeat(61) }).error, /60/);
});

test('hiding and showing change no price, so they touch no Stripe object', () => {
  const hid = applyChange(normalizeDoc(null), { action: 'retire', key: 'individual-6m' });
  assert.deepEqual(hid.doc.retired, ['individual-6m']);
  assert.deepEqual(hid.keys, []);
  assert.deepEqual(applyChange(hid.doc, { action: 'restore', key: 'individual-6m' }).doc.retired, []);
});

// ---------------------------------------------------------------- the admin endpoint

test('the admin endpoint refuses a stranger', async () => {
  reset();
  assert.equal((await handle(req(undefined, false), fakeStripe())).status, 401);
  assert.equal((await handle(req(TERM, false), fakeStripe())).status, 401);
});

test('adding writes Stripe first, then the store, and the plan is live in this process', async () => {
  reset();
  const stripe = fakeStripe();
  const res = await handle(req(TERM), stripe);
  assert.equal(res.status, 200);
  const body = await res.json();
  const made = body.plans.find((p) => p.custom);
  assert.equal(made.label, 'Individual Training, 9 months, once a week');
  assert.equal(made.payOptions[0].totalCents, 270000);
  // Stripe saw a product and a price carrying the lookup key checkout will resolve it by.
  assert.equal(stripe.state.products.length, 1);
  assert.equal(stripe.state.products[0].metadata.plan, made.key);
  const price = stripe.state.prices.find((p) => p.lookup_key === made.key + '-full');
  assert.equal(price.unit_amount, 270000);
  assert.equal(price.recurring, null);
  // The store has it, and so does the catalog every handler reads.
  assert.ok((await readDoc()).added[made.key]);
  assert.equal(checkoutSpec(made.key, 'full').amountCents, 270000);
  reset();
});

test('if Stripe refuses, nothing is stored and nothing changes', async () => {
  reset();
  const res = await handle(req(TERM), fakeStripe({ refuse: true }));
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /nothing changed/);
  assert.deepEqual((await readDoc()).added, {});
  assert.equal(Object.keys(PLANS).some((k) => k.startsWith('pk-')), false);
});

test('repricing a built-in plan moves its lookup key to a new price and archives the old', async () => {
  reset();
  const stripe = fakeStripe();
  await syncSpecs(stripe, specsFor(PLANS, ['individual-3m']), { log: () => {} });
  const oldPrice = stripe.state.prices.find((p) => p.lookup_key === 'individual-3m-full');
  assert.equal(oldPrice.unit_amount, 90000);

  const res = await handle(req({ action: 'price', key: 'individual-3m', prices: { full: 95000 } }), stripe);
  assert.equal(res.status, 200);
  const active = stripe.state.prices.filter((p) => p.active && p.lookup_key === 'individual-3m-full');
  assert.equal(active.length, 1, 'exactly one active price answers the lookup key');
  assert.equal(active[0].unit_amount, 95000);
  assert.equal(oldPrice.active, false);
  assert.equal(PLANS['individual-3m'].totals.full, 95000);

  // Back to published: the lookup key returns to $900.
  await handle(req({ action: 'reset', key: 'individual-3m' }), stripe);
  assert.equal(stripe.state.prices.filter((p) => p.active && p.lookup_key === 'individual-3m-full')[0].unit_amount, 90000);
  assert.deepEqual((await readDoc()).overrides, {});
  reset();
});

test('an unchanged price creates nothing in Stripe', async () => {
  reset();
  const stripe = fakeStripe();
  await syncSpecs(stripe, specsFor(PLANS, ['individual-3m']), { log: () => {} });
  const before = stripe.state.calls.length;
  await handle(req({ action: 'price', key: 'individual-3m', prices: { full: 90000 } }), stripe);
  assert.equal(stripe.state.calls.length, before);
});

test('hiding a package refuses it at checkout, and showing it brings it back', async () => {
  reset();
  assert.equal((await handle(req({ action: 'retire', key: 'individual-6m' }), fakeStripe())).status, 200);
  assert.equal(isRetired('individual-6m'), true);
  const post = (plan) => new Request('http://localhost/api/checkout', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...sampleRegistration(), plan, pay: 'full', 'en-hp': '' })
  });
  const refused = await checkout(post('individual-6m'), { ip: '10.9.9.1' });
  assert.equal(refused.status, 422);
  assert.match((await refused.json()).errors.plan, /not available/);

  await handle(req({ action: 'restore', key: 'individual-6m' }), fakeStripe());
  assert.equal(isRetired('individual-6m'), false);
  const ok = await checkout(post('individual-6m'), { ip: '10.9.9.2' });
  assert.notEqual(ok.status, 422, 'a shown package is accepted again (503 here: no Stripe key in the suite)');
  reset();
});

test('the admin view carries published prices so a change can be undone', async () => {
  reset();
  await handle(req({ action: 'price', key: 'individual-6m', prices: { full: 170000 } }), fakeStripe());
  const view = adminView();
  const six = view.plans.find((p) => p.key === 'individual-6m').payOptions[0];
  assert.equal(six.totalCents, 170000);
  assert.equal(six.publishedTotalCents, 180000);
  assert.deepEqual(view.options.frequencies, ['once a week', 'twice a week', 'three times a week']);
  reset();
});

// ---------------------------------------------------------------- the public endpoint

test('the public endpoint serves figures and cards for the live catalog, and hides what is hidden', async () => {
  reset();
  const stripe = fakeStripe();
  await handle(req(TERM), stripe);
  await handle(req({ action: 'price', key: 'individual-3m', prices: { full: 95000 } }), stripe);
  await handle(req({ action: 'retire', key: 'individual-6m' }), stripe);

  const res = await publicHandler(new Request('http://localhost/api/packages'));
  assert.equal(res.status, 200);
  assert.match(res.headers.get('cache-control'), /max-age=10/);
  const v = await res.json();
  assert.equal(v.figures['individual-3m:full'], '$950');
  assert.deepEqual(v.retired, ['individual-6m']);
  assert.equal(v.cards['individual-6m'], undefined, 'a hidden package has no card');
  const made = v.plans.find((p) => p.custom);
  assert.ok(v.cards[made.key], 'the added package has a card');
  assert.match(v.cards[made.key].inner, /9 months, once a week/);
  assert.match(v.cards[made.key].inner, /\$2,700/);
  assert.equal(v.cards[made.key].attrs.full, '$2,700 today');
  assert.equal(v.cards[made.key].program, 'individual');
  assert.ok(v.order.individual.includes(made.key));
  assert.ok(!v.order.individual.includes('individual-6m'));
  // doc is what the stripe scripts replay to sync the catalog the site really sells.
  assert.ok(v.doc.added[made.key]);
  assert.equal(v.doc.overrides['individual-3m'].full, 95000);
  assert.equal(await publicHandler(new Request('http://localhost/api/packages', { method: 'POST' })).then((r) => r.status), 405);
  reset();
});

test('a name Blake types cannot inject markup into a card', async () => {
  reset();
  const stripe = fakeStripe();
  await handle(req({ action: 'add', program: 'individual', kind: 'once', cents: 6000, name: '<img src=x onerror=alert(1)>' }), stripe);
  const v = publicView();
  const made = v.plans.find((p) => p.custom);
  assert.ok(!/<img/.test(v.cards[made.key].inner), v.cards[made.key].inner);
  assert.match(v.cards[made.key].inner, /&lt;img/);
  reset();
});

test('the store is re-read after its TTL but never throws when it cannot be', async () => {
  reset();
  await refreshPackages({ force: true });
  // Corrupt the local store: the refresh must swallow it and leave the catalog standing.
  fs.mkdirSync('.local', { recursive: true });
  fs.writeFileSync('.local/packages.json', '{ not json');
  await refreshPackages({ force: true });
  assert.equal(PLANS['individual-3m'].totals.full, 90000);
  reset();
});

test('catalogView lists every training plan once, in the shape the admin always had', () => {
  reset();
  const view = catalogView();
  assert.equal(new Set(view.map((p) => p.key)).size, view.length);
  for (const p of view) {
    assert.ok(p.key && p.label && p.program && p.payOptions.length, p.key);
    for (const o of p.payOptions) assert.ok(Number.isInteger(o.totalCents) && Number.isInteger(o.amountCents), p.key + ' ' + o.pay);
  }
  assert.equal(view.length, Object.keys(PLANS).length);
});
