// /api/admin-packages: the Prices tab. Session-gated.
//   GET                    -> every training package: price, published price, state
//   POST {action:'price',  key, prices:{full?,monthly?}}   change a price
//   POST {action:'reset',  key}                            back to the published price
//   POST {action:'add',    program, kind, ...}             a new package
//   POST {action:'retire' | 'restore', key}                hide it from the site / show it again
//
// A change is live the moment it is made: no draft, no Publish. The order is the whole design.
// Stripe is written FIRST, from the catalog the change WOULD make; only when Stripe has accepted
// it is the document stored, and only then does any page or checkout see it. If Stripe refuses,
// nothing changes anywhere and Blake is told. Hiding a package touches no price, so it is only a
// store write.
import { verifyRequestSession } from './lib/auth.mjs';
import { stripeClient, json } from './lib/stripe.mjs';
import { syncSpecs } from './lib/catalog-sync.mjs';
import { effectivePlans, setStoredPackages } from '../../src/lib/plans.mjs';
import { readDoc, writeDoc, applyChange, specsFor, adminView, refreshPackages } from './lib/packages.mjs';

export default (request) => handle(request, stripeClient());

// The Stripe client is a parameter so the tests can hand in a fake and check every call.
export async function handle(request, stripe) {
  if (!verifyRequestSession(request)) return json(401, { error: 'not authenticated' });
  // Always the stored truth, never an instance's cached copy: this is the one request that
  // reads in order to write.
  await refreshPackages({ force: true });

  if (request.method === 'GET') return json(200, { ...adminView(), stripe: !!stripe });
  if (request.method !== 'POST') return json(405, { error: 'method not allowed' });

  let body;
  try { body = await request.json(); } catch { body = null; }
  if (!body || typeof body !== 'object') return json(400, { error: 'invalid request body' });

  const change = applyChange(await readDoc(), body);
  if (change.error) return json(422, { error: change.error });

  let warning = null;
  if (change.keys.length) {
    if (stripe) {
      try {
        await syncSpecs(stripe, specsFor(effectivePlans(change.doc), change.keys), { log: () => {} });
      } catch (err) {
        console.error('[packages] stripe refused ' + body.action + ': ' + err.message);
        return json(502, { error: 'Stripe did not accept that, so nothing changed: ' + err.message });
      }
    } else {
      warning = 'Stripe is not connected here, so the site will show this price but a card cannot be charged it.';
    }
  }
  const saved = await writeDoc(change.doc);
  setStoredPackages(saved);
  return json(200, { ...adminView(), stripe: !!stripe, warning, changed: change.keys });
}
