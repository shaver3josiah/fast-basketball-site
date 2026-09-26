// /api/admin-coupons: coupon codes Blake makes himself. Session-gated.
//   GET                          -> the live promotion codes, newest first
//   POST {action:'create', ...}  -> a Stripe coupon plus a promotion code with that name
//   POST {action:'off', id}      -> deactivate a promotion code
//
// The codes live ONLY in Stripe, exactly like the hand-made PRIORITY25: the repo is public, and
// the /enroll coupon box already resolves a typed code against Stripe (promotionCodeByCode) and
// checks it against the plan (couponCoversPlan). So a code made here works the moment it exists,
// with no Publish, and turning it off in Stripe's dashboard works too.
//
// Every code made here is limited to TRAINING plans by metadata.plans, never "everything":
// an unrestricted coupon would also come off the tool purchases on /appbuy, which are a 50/50
// product and not Blake's alone to discount.
import { verifyRequestSession } from './lib/auth.mjs';
import { stripeClient, json } from './lib/stripe.mjs';
import { EXPIRY_HOURS } from './lib/deals.mjs';
import { PLANS } from '../../src/lib/plans.mjs';

const keysOf = (kind) => Object.keys(PLANS).filter((k) => !kind || PLANS[k].kind === kind);
export const COUPON_SCOPES = {
  all: { label: 'Any training plan', plans: keysOf(null) },
  eval: { label: 'Evaluation sessions only', plans: keysOf('once') },
  membership: { label: 'Group memberships only', plans: keysOf('membership') }
};
const CODE_RE = /^[A-Z0-9-]{3,30}$/;

/** Admin input to Stripe's two create calls, or errors. Pure, so it is tested without Stripe. */
export function couponParams(input, nowSeconds = Math.floor(Date.now() / 1000)) {
  const b = input && typeof input === 'object' ? input : {};
  const errors = {};
  const code = typeof b.code === 'string' ? b.code.trim().toUpperCase() : '';
  if (!CODE_RE.test(code)) errors.code = 'Use 3 to 30 letters, numbers or dashes. No spaces.';
  const value = Number(b.value);
  let off = null;
  if (b.kind === 'percent') {
    if (!Number.isInteger(value) || value < 1 || value > 100) errors.value = 'A percent from 1 to 100.';
    else off = { percent_off: value };
  } else if (b.kind === 'amount') {
    if (!Number.isInteger(value) || value < 100 || value > 200000) errors.value = 'An amount from $1 to $2,000.';
    else off = { amount_off: value, currency: 'usd' };
  } else errors.value = 'Pick dollars off or percent off.';
  const scope = Object.hasOwn(COUPON_SCOPES, b.scope) ? b.scope : null;
  if (!scope) errors.scope = 'Pick what it works on.';
  const hours = Number(b.hours);
  if (!EXPIRY_HOURS.includes(hours)) errors.hours = 'Pick one of the listed times.';
  if (Object.keys(errors).length) return { errors };

  const expires = nowSeconds + hours * 3600;
  const metadata = { plans: COUPON_SCOPES[scope].plans.join(','), madeIn: 'admin' };
  return {
    errors,
    code,
    // 'once': on a monthly plan it comes off the first payment only, which the panel says.
    coupon: { name: code, duration: 'once', redeem_by: expires, metadata, ...off },
    promo: (couponId) => ({ promotion: { type: 'coupon', coupon: couponId }, code, expires_at: expires, metadata })
  };
}

function scopeOf(plans) {
  if (typeof plans !== 'string' || !plans.trim()) return 'Anything';
  const set = plans.split(',').map((p) => p.trim()).sort().join(',');
  for (const s of Object.values(COUPON_SCOPES)) if ([...s.plans].sort().join(',') === set) return s.label;
  return 'Only: ' + plans;
}

function view(p) {
  const c = p.promotion?.coupon && typeof p.promotion.coupon === 'object' ? p.promotion.coupon : {};
  return {
    id: p.id, code: p.code, active: p.active,
    expiresAt: p.expires_at ? new Date(p.expires_at * 1000).toISOString() : null,
    timesRedeemed: p.times_redeemed || 0,
    maxRedemptions: p.max_redemptions || null,
    amountOff: c.amount_off || null, percentOff: c.percent_off || null,
    worksOn: scopeOf(c.metadata?.plans),
    created: p.created ? new Date(p.created * 1000).toISOString() : null
  };
}

export default (request) => handle(request, stripeClient());

export async function handle(request, stripe) {
  if (!verifyRequestSession(request)) return json(401, { error: 'not authenticated' });
  if (!stripe) return json(503, { error: 'Stripe is not connected here, so coupons cannot be made or listed.' });

  if (request.method === 'GET') {
    const { data } = await stripe.promotionCodes.list({ active: true, limit: 100, expand: ['data.promotion.coupon'] });
    return json(200, { coupons: data.map(view).sort((a, b) => (a.created < b.created ? 1 : -1)) });
  }
  if (request.method !== 'POST') return json(405, { error: 'method not allowed' });

  let body;
  try { body = await request.json(); } catch { body = null; }
  if (!body || typeof body !== 'object') return json(400, { error: 'invalid request body' });

  if (body.action === 'off') {
    if (typeof body.id !== 'string' || !/^promo_[A-Za-z0-9]+$/.test(body.id)) return json(400, { error: 'bad id' });
    const p = await stripe.promotionCodes.update(body.id, { active: false });
    return json(200, { coupon: view(p) });
  }
  if (body.action !== 'create') return json(400, { error: 'unknown action' });

  const params = couponParams(body);
  const keys = Object.keys(params.errors);
  if (keys.length) return json(422, { error: params.errors[keys[0]], errors: params.errors });

  // Stripe refuses a second ACTIVE code with the same name, but only at the promotion code step,
  // after the coupon exists. Asking first keeps a refused name from leaving an orphan coupon.
  const clash = await stripe.promotionCodes.list({ code: params.code, active: true, limit: 1 });
  if (clash.data.length) return json(422, { error: params.code + ' is already a live code. Pick another name, or turn that one off first.', errors: { code: 'taken' } });

  let coupon;
  try {
    coupon = await stripe.coupons.create(params.coupon);
    const promo = await stripe.promotionCodes.create(params.promo(coupon.id));
    promo.promotion = { ...(promo.promotion || {}), coupon };
    return json(200, { coupon: view(promo) });
  } catch (err) {
    console.error('[coupons] create failed: ' + err.message);
    if (coupon) { try { await stripe.coupons.del(coupon.id); } catch { /* orphan is harmless: no code points at it */ } }
    return json(502, { error: 'Stripe did not accept it: ' + err.message });
  }
}
