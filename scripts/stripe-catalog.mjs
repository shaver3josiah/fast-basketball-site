// Pushes the catalog in src/lib/plans.mjs into Stripe: one Product per plan key, one
// Price per lookup key. Run once per mode with that mode's key in the shell, never in
// the repo:
//
//   STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-catalog.mjs [--dry-run]
//
// Idempotent: a second run prints "unchanged" once per lookup key. The sync itself lives in
// server/functions/lib/catalog-sync.mjs, shared with the admin's Prices tab.
//
// It syncs the catalog AS THE LIVE SITE HAS IT, including any package or price Blake changed in
// the admin: run on plans.mjs alone it would put every admin repricing back to the published
// figure. `--static` skips that and syncs plans.mjs as committed.
import { pathToFileURL } from 'node:url';
import Stripe from 'stripe';
import { catalog } from '../src/lib/plans.mjs';
import { syncSpecs, keyMode, pricesByLookupKey, loadLiveStore } from '../server/functions/lib/catalog-sync.mjs';

export { pricesByLookupKey };

export const syncCatalog = (stripe, opts) => syncSpecs(stripe, catalog(), opts);

async function main() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    console.error('STRIPE_SECRET_KEY is not set. Put the restricted key for the mode you want (test or live) in the shell and run again.');
    process.exit(1);
  }
  const dryRun = process.argv.includes('--dry-run');
  if (!process.argv.includes('--static')) {
    const note = await loadLiveStore();
    console.log(note);
  }
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
