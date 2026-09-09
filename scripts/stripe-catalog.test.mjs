// Run: node --test scripts/stripe-catalog.test.mjs
//
// The catalog script is the only thing that decides what Stripe will charge, and it is the
// one money-critical path with no live safety net: it runs once, by hand, against a real
// account, and whatever it leaves behind is what parents get billed. So it is exercised
// here against an in-memory fake client that behaves the way the Stripe API does on the
// four calls the script makes.
//
// What must never break, in order of how much it would cost:
//   - one active price per lookup key. Two, and the wrong amount can be charged; none, and
//     priceByLookupKey() returns null and every checkout is a 500.
//   - the replacement is created BEFORE the old one is archived, so the key is always
//     resolvable, even if the script dies between the two calls.
//   - a second run writes nothing. It is documented as safe to re-run, and someone will.
//   - both pay options of one plan share a product, because the product name is what the
//     parent reads on Stripe's checkout page.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncCatalog } from './stripe-catalog.mjs';
import { catalog, PLANS } from '../src/lib/plans.mjs';

const SPECS = catalog();
const PLAN_COUNT = Object.keys(PLANS).length;

// The slice of Stripe the script actually touches: prices.list/create/update and
// products.search/create. Every call is recorded so the tests can assert on order and on
// the absence of writes, which is the thing a dry run has to prove.
function makeFake({ products = [], prices = [] } = {}) {
  const state = { products: [...products], prices: [...prices], calls: [] };
  let seq = 0;

  const api = {
    prices: {
      async list({ lookup_keys, active }) {
        state.calls.push({ op: 'prices.list' });
        // expand: ['data.product'] means the product arrives as an object, which is how
        // the script finds a plan's product without ever storing its id.
        const data = state.prices
          .filter((p) => p.active === active && p.lookup_key && lookup_keys.includes(p.lookup_key))
          .map((p) => ({ ...p, product: state.products.find((pr) => pr.id === p.product) || p.product }));
        return { data };
      },
      async create(params) {
        state.calls.push({ op: 'prices.create', params });
        // transfer_lookup_key takes the key off whichever price currently holds it, which
        // is what lets a replacement claim it without a window where nothing has it.
        if (params.transfer_lookup_key) {
          for (const p of state.prices) if (p.lookup_key === params.lookup_key) p.lookup_key = null;
        }
        const price = {
          id: 'price_' + ++seq,
          active: true,
          unit_amount: params.unit_amount,
          currency: params.currency,
          lookup_key: params.lookup_key,
          nickname: params.nickname,
          metadata: params.metadata,
          product: params.product,
          recurring: params.recurring ? { interval: params.recurring.interval, interval_count: 1 } : null
        };
        state.prices.push(price);
        return price;
      },
      async update(id, params) {
        state.calls.push({ op: 'prices.update', id, params });
        Object.assign(state.prices.find((p) => p.id === id), params);
        return state.prices.find((p) => p.id === id);
      }
    },
    products: {
      async search({ query }) {
        state.calls.push({ op: 'products.search' });
        const plan = /metadata\['plan'\]:'([^']+)'/.exec(query)?.[1];
        return { data: state.products.filter((p) => p.active !== false && p.metadata?.plan === plan) };
      },
      async create(params) {
        state.calls.push({ op: 'products.create', params });
        const product = { id: 'prod_' + ++seq, active: true, name: params.name, metadata: params.metadata };
        state.products.push(product);
        return product;
      }
    }
  };
  return { api, state };
}

const writes = (state) => state.calls.filter((c) => c.op.endsWith('.create') || c.op.endsWith('.update'));
const activeFor = (state, key) => state.prices.filter((p) => p.active && p.lookup_key === key);
const quiet = () => {};

async function seeded() {
  const fake = makeFake();
  await syncCatalog(fake.api, { log: quiet });
  return fake;
}

test('first run on an empty account: one product per plan, one price per lookup key', async () => {
  const { api, state } = makeFake();
  const counts = await syncCatalog(api, { log: quiet });

  assert.deepEqual(counts, { created: SPECS.length, unchanged: 0, replaced: 0 });
  assert.equal(state.products.length, PLAN_COUNT, 'one product per plan, not one per price');
  assert.equal(state.prices.length, SPECS.length);

  for (const spec of SPECS) {
    const held = activeFor(state, spec.lookupKey);
    assert.equal(held.length, 1, spec.lookupKey + ' must be held by exactly one active price');
    const price = held[0];
    assert.equal(price.unit_amount, spec.amountCents, spec.lookupKey + ' amount');
    assert.equal(price.currency, 'usd');
    // Metadata is what the webhook reads back off the session to build the record.
    assert.deepEqual(price.metadata, spec.metadata, spec.lookupKey + ' metadata');
    if (spec.mode === 'subscription') {
      assert.equal(price.recurring.interval, 'month', spec.lookupKey + ' must recur');
      assert.equal(price.recurring.interval_count, 1);
    } else {
      assert.equal(price.recurring, null, spec.lookupKey + ' must be one-off');
    }
    const product = state.products.find((p) => p.id === price.product);
    assert.equal(product.metadata.plan, spec.plan, spec.lookupKey + ' product carries its plan key');
  }
});

test('both pay options of a plan share one product, so checkout names the plan once', async () => {
  const { state } = await seeded();
  const byPlan = new Map();
  for (const spec of SPECS) {
    const price = activeFor(state, spec.lookupKey)[0];
    if (!byPlan.has(spec.plan)) byPlan.set(spec.plan, new Set());
    byPlan.get(spec.plan).add(price.product);
  }
  for (const [plan, productIds] of byPlan) {
    assert.equal(productIds.size, 1, plan + ' must map to a single product');
  }
});

test('a second run is idempotent: everything unchanged, nothing written', async () => {
  const { api, state } = await seeded();
  state.calls.length = 0;

  const counts = await syncCatalog(api, { log: quiet });

  assert.deepEqual(counts, { created: 0, unchanged: SPECS.length, replaced: 0 });
  assert.deepEqual(writes(state), [], 'a re-run must not write to a live Stripe account');
  assert.equal(state.prices.length, SPECS.length, 'and must not leave duplicate prices behind');
});

test('a changed amount: the replacement is created before the old price is archived', async () => {
  const { api, state } = await seeded();
  const key = 'group-6m-1x-monthly';
  const stale = activeFor(state, key)[0];
  stale.unit_amount = 12345; // the owner raised the price in plans.mjs
  state.calls.length = 0;

  const counts = await syncCatalog(api, { log: quiet });

  assert.deepEqual(counts, { created: 0, unchanged: SPECS.length - 1, replaced: 1 });

  const created = state.calls.findIndex((c) => c.op === 'prices.create');
  const archived = state.calls.findIndex((c) => c.op === 'prices.update' && c.params.active === false);
  assert.ok(created !== -1 && archived !== -1, 'both calls must happen');
  assert.ok(created < archived, 'archiving first would leave the lookup key unresolvable');
  assert.equal(state.calls[created].params.transfer_lookup_key, true, 'the new price must claim the key');

  // The end state is what matters: exactly one active price, at the catalog amount, on the
  // same product, and the old price still exists so live subscriptions keep billing.
  const held = activeFor(state, key);
  assert.equal(held.length, 1);
  assert.equal(held[0].unit_amount, SPECS.find((s) => s.lookupKey === key).amountCents);
  assert.equal(held[0].product, stale.product, 'a price change must not orphan the product');
  assert.equal(state.prices.find((p) => p.id === stale.id).active, false, 'the old price is archived');
});

test('a price of the wrong billing type is replaced, not left in place', async () => {
  const { api, state } = await seeded();
  const key = 'group-3m-1x-monthly';
  // A plan that used to be sold outright and is now sold monthly: same amount, no recurring.
  activeFor(state, key)[0].recurring = null;
  state.calls.length = 0;

  const counts = await syncCatalog(api, { log: quiet });

  assert.equal(counts.replaced, 1, 'a one-off price cannot satisfy a subscription spec');
  assert.equal(activeFor(state, key)[0].recurring.interval, 'month');
});

test('a dry run reports the work and writes nothing', async () => {
  const { api, state } = makeFake();
  const counts = await syncCatalog(api, { dryRun: true, log: quiet });

  assert.deepEqual(counts, { created: SPECS.length, unchanged: 0, replaced: 0 });
  assert.deepEqual(writes(state), [], 'a dry run must not touch the account');
  assert.equal(state.prices.length, 0);
  assert.equal(state.products.length, 0);
});

test('an existing product with no active price is reused rather than duplicated', async () => {
  // Every price archived by hand in the dashboard: the products survive, so a re-run has to
  // find them by metadata instead of creating a second product with the same name.
  const { state: first } = await seeded();
  for (const p of first.prices) p.active = false;
  const { api, state } = makeFake({ products: first.products, prices: first.prices });

  const counts = await syncCatalog(api, { log: quiet });

  assert.equal(counts.created, SPECS.length);
  assert.equal(state.products.length, PLAN_COUNT, 'products must be reused, not recreated');
});
