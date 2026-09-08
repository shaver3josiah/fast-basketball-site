// The one place a function meets Stripe. No key means no client, and callers turn that
// into a 503 rather than a stack trace: the site must build and serve before Blake's
// Stripe account exists (STRIPE-PLAN.md, Phase 0).
import Stripe from 'stripe';

let cached = null;

export function stripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  // Keyed on the secret so a key rotation in the same warm function picks up the new one.
  if (!cached || cached.key !== key) cached = { key, client: new Stripe(key) };
  return cached.client;
}

// Prices are resolved at request time by the lookup_key the catalog script stamped on
// them, so no price ID lives in the repo or the environment.
export async function priceByLookupKey(stripe, lookupKey) {
  const { data } = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
  return data[0] || null;
}

export function json(status, obj) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
