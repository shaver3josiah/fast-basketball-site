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

/**
 * A typed coupon code resolved to the promotion code Stripe will honour, or null.
 *
 * The code string lives ONLY in Stripe. Nothing in this repo, which is public, knows what any
 * coupon is called, so one can be created, retargeted, capped or killed in the dashboard with
 * no deploy. Stripe matches `code` case insensitively, so a parent typing priority25 is fine.
 *
 * The coupon is expanded because couponCoversPlan has to read its metadata: without the expand
 * `promotion.coupon` comes back as a bare id.
 */
export async function promotionCodeByCode(stripe, code) {
  const { data } = await stripe.promotionCodes.list({
    code, active: true, limit: 1, expand: ['data.promotion.coupon']
  });
  return data[0] || null;
}

/**
 * Does this promotion code cover this plan?
 *
 * Stripe's own applies_to[products] is the right home for this and it does not work: on this
 * account the parameter is accepted and silently dropped, at every API version (probed against
 * live on 20 September 2026, with the SDK and with raw form posts). So the restriction rides on
 * the coupon's `metadata.plans`, a comma separated list of plan KEYS, readable and editable in
 * the dashboard, and is enforced here. No such key means the coupon is unrestricted, which is
 * what an unrestricted coupon should do.
 *
 * This is what stops a $25 off evaluation code taking $25 off a $450 membership.
 */
export function couponCoversPlan(promo, planKey) {
  const plans = promo?.promotion?.coupon?.metadata?.plans;
  if (typeof plans !== 'string' || !plans.trim()) return true;
  return plans.split(',').some((p) => p.trim() === planKey);
}
