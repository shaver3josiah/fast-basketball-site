// The Stripe half of the catalog: one Product per plan key, one Price per lookup key. Shared by
// scripts/stripe-catalog.mjs (a developer, the whole catalog) and server/functions/admin-packages.mjs
// (Blake, one package at a time). It lives under server/ because that is what the Cloud Function
// bundle carries; scripts/ is not deployed.
//
// Idempotent. A changed amount creates a new price, moves the lookup key onto it
// (transfer_lookup_key) and archives the old one, so existing subscriptions keep their price and
// new checkouts get the new one.
import { dollars } from '../../../src/lib/plans.mjs';

export function keyMode(key) {
  if (/^[sr]k_live_/.test(key)) return 'LIVE';
  if (/^[sr]k_test_/.test(key)) return 'test';
  return 'unknown';
}

// STRIPE CAPS `lookup_keys` AT TEN PER CALL. The catalog was eight keys for a year and then the
// /appbuy products took it to eighteen, at which point a single list call answers
// invalid_request_error ("You can specify up to 10 lookup_keys") and the whole script dies
// before touching anything. So the keys are asked for ten at a time and the pages concatenated.
// Keep this whenever the catalog grows again; the cap is Stripe's, not ours.
const LOOKUP_KEYS_PER_CALL = 10;

export async function pricesByLookupKey(stripe, lookupKeys, extra = {}) {
  const out = [];
  for (let i = 0; i < lookupKeys.length; i += LOOKUP_KEYS_PER_CALL) {
    const { data } = await stripe.prices.list({
      lookup_keys: lookupKeys.slice(i, i + LOOKUP_KEYS_PER_CALL),
      active: true,
      limit: 100,
      ...extra
    });
    out.push(...data);
  }
  return out;
}

function priceMatches(price, spec) {
  if (price.unit_amount !== spec.amountCents || price.currency !== 'usd') return false;
  if (spec.mode !== 'subscription') return price.recurring === null;
  return !!price.recurring && price.recurring.interval === spec.interval && price.recurring.interval_count === 1;
}

function priceParams(spec, productId) {
  const params = {
    product: productId,
    unit_amount: spec.amountCents,
    currency: 'usd',
    lookup_key: spec.lookupKey,
    nickname: spec.description,
    metadata: spec.metadata
  };
  if (spec.mode === 'subscription') params.recurring = { interval: spec.interval };
  return params;
}

// Exported so the sync logic can run against a fake client offline. Two real callers: the CLI
// (scripts/stripe-catalog.mjs, the whole catalog) and the admin's Prices tab (only the specs a
// change touches).
export async function syncSpecs(stripe, specs, { dryRun = false, log = console.log } = {}) {
  const write = (fn, placeholder) => (dryRun ? Promise.resolve(placeholder) : fn());

  // The list calls bring each price's product along, which is how a plan's product is found
  // without storing its ID anywhere. Ten lookup keys per call: see LOOKUP_KEYS_PER_CALL above.
  const prices = await pricesByLookupKey(stripe, specs.map((s) => s.lookupKey), { expand: ['data.product'] });
  const priceByKey = new Map(prices.map((p) => [p.lookup_key, p]));
  const productByPlan = new Map();
  for (const spec of specs) {
    const price = priceByKey.get(spec.lookupKey);
    if (price && typeof price.product === 'object' && !price.product.deleted) productByPlan.set(spec.plan, price.product);
  }

  async function ensureProduct(spec) {
    let product = productByPlan.get(spec.plan);
    if (!product) {
      // Only reached when a plan has a product but no active price (first run, or every
      // price archived by hand). Search lags writes by up to a minute, which is fine here:
      // a product created in this run is remembered in productByPlan, not searched for.
      const found = await stripe.products.search({ query: `active:'true' AND metadata['plan']:'${spec.plan}'`, limit: 1 });
      product = found.data[0] || null;
    }
    if (!product) {
      product = await write(() => stripe.products.create({ name: spec.label, metadata: { plan: spec.plan } }), { id: 'prod_(dry run)' });
      log('  product ' + (dryRun ? 'would create' : 'created') + ' ' + spec.plan + ' -> ' + product.id);
    }
    productByPlan.set(spec.plan, product);
    return product;
  }

  const counts = { created: 0, unchanged: 0, replaced: 0 };
  for (const spec of specs) {
    const existing = priceByKey.get(spec.lookupKey);
    const money = dollars(spec.amountCents) + (spec.mode === 'subscription' ? '/' + spec.interval : '');
    let action;
    if (existing && priceMatches(existing, spec)) {
      action = 'unchanged';
    } else {
      const product = await ensureProduct(spec);
      const params = priceParams(spec, product.id);
      if (existing) params.transfer_lookup_key = true;
      await write(() => stripe.prices.create(params), null);
      // Archive only after the replacement exists, so the lookup key is never unresolvable.
      if (existing) await write(() => stripe.prices.update(existing.id, { active: false }), null);
      action = existing ? 'replaced' : 'created';
    }
    counts[action] += 1;
    const verb = dryRun ? { created: 'would create', replaced: 'would replace' }[action] || action : action;
    log(verb.padEnd(13) + '  ' + spec.lookupKey.padEnd(22) + money);
  }
  return counts;
}

// A developer's script has to see the same catalog the site sells. The admin's changes live in the
// site's store, not in plans.mjs, so a script that read plans.mjs alone would price Stripe as it
// was before the last admin edit. The public endpoint is the one door that needs no credentials.
// Throws when it cannot be read: syncing against a guess is how a price gets reverted by accident.
export async function loadLiveStore(url = 'https://fast-basketball.com/api/packages') {
  const { setStoredPackages } = await import('../../../src/lib/plans.mjs');
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('could not read the live package store (' + url + ' answered ' + res.status + '). Pass --static to use plans.mjs alone.');
  const { doc } = await res.json();
  setStoredPackages(doc);
  const n = Object.keys(doc?.added || {}).length, o = Object.keys(doc?.overrides || {}).length;
  return 'Using the live site\'s catalog: ' + n + ' added package(s), ' + o + ' repriced plan(s), ' + (doc?.retired?.length || 0) + ' hidden.';
}
