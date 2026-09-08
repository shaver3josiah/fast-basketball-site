// Pushes the catalog in src/lib/plans.mjs into Stripe: one Product per plan key, one
// Price per lookup key. Run once per mode with that mode's key in the shell, never in
// the repo:
//
//   STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-catalog.mjs [--dry-run]
//
// Idempotent. A second run prints "unchanged" once per lookup key, eight times today. A changed amount creates a new
// price, moves the lookup key onto it (transfer_lookup_key) and archives the old one, so
// existing subscriptions keep their price and new checkouts get the new one.
import { pathToFileURL } from 'node:url';
import Stripe from 'stripe';
import { catalog, dollars } from '../src/lib/plans.mjs';

function keyMode(key) {
  if (/^[sr]k_live_/.test(key)) return 'LIVE';
  if (/^[sr]k_test_/.test(key)) return 'test';
  return 'unknown';
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

// Exported so the sync logic can run against a fake client offline; the CLI below is
// the only real caller.
export async function syncCatalog(stripe, { dryRun = false, log = console.log } = {}) {
  const specs = catalog();
  const write = (fn, placeholder) => (dryRun ? Promise.resolve(placeholder) : fn());

  // One list call covers every lookup key and brings each price's product along, which
  // is how a plan's product is found without storing its ID anywhere.
  const { data: prices } = await stripe.prices.list({
    lookup_keys: specs.map((s) => s.lookupKey), active: true, limit: 100, expand: ['data.product']
  });
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

async function main() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    console.error('STRIPE_SECRET_KEY is not set. Put the restricted key for the mode you want (test or live) in the shell and run again.');
    process.exit(1);
  }
  const dryRun = process.argv.includes('--dry-run');
  console.log('Stripe catalog sync, ' + keyMode(key) + ' mode key' + (dryRun ? ' (dry run, no writes)' : ''));

  const counts = await syncCatalog(new Stripe(key), { dryRun });
  console.log('created ' + counts.created + ', unchanged ' + counts.unchanged + ', replaced ' + counts.replaced);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
