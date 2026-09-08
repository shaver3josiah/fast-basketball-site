// POST /.netlify/functions/checkout: a plan key and a payment option in, a hosted Stripe
// Checkout URL out. Amounts never come from the client; checkoutSpec() resolves the plan
// and the price is looked up by lookup_key server-side (STRIPE-PLAN.md, security notes).
//
// Two callers share it. src/js/enroll.js sends JSON and gets JSON back. The no-JS form
// on /enroll posts urlencoded fields and gets a 303: to Stripe on success, back to the
// form with ?err=1 on any failure.
import { checkoutSpec } from '../../src/lib/plans.mjs';
import { SITE_URL } from '../../src/lib/site-config.mjs';
import { checkRateLimit, clientIp } from './lib/rate-limit.mjs';
import { stripeClient, priceByLookupKey, json } from './lib/stripe.mjs';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 10;
const SESSION_TTL_SECONDS = 24 * 60 * 60;

// Pure so the parameter shape is testable without a Stripe account. siteUrl is a
// parameter for the same reason; the handler passes SITE_URL from site-config.
export function sessionParams(spec, { email, priceId, siteUrl, nowSeconds }) {
  const abs = (path) => siteUrl.replace(/\/$/, '') + path;
  const params = {
    mode: spec.mode,
    line_items: [{ price: priceId, quantity: 1 }],
    customer_email: email,
    phone_number_collection: { enabled: true },
    billing_address_collection: 'auto',
    // The agreement's step 2 ("click the I agree box", "type your full name") lives on the
    // Stripe session, which is Blake's evidence in a dispute. No form of our own.
    consent_collection: { terms_of_service: 'required' },
    custom_text: {
      terms_of_service_acceptance: {
        message: 'I have read and agree to the Fast Basketball [training agreement](' + abs('/terms') + ').'
      }
    },
    custom_fields: [
      { key: 'player_name', label: { type: 'custom', custom: "Player's full name" }, type: 'text' },
      { key: 'agree_name', label: { type: 'custom', custom: 'Type your full name to agree to the terms' }, type: 'text' }
    ],
    metadata: spec.metadata,
    success_url: abs('/enroll/thanks'),
    cancel_url: abs('/enroll?plan=' + spec.plan + '&pay=' + spec.pay),
    expires_at: nowSeconds + SESSION_TTL_SECONDS
  };
  // Metadata is copied onto the object the webhook and the dashboard actually look at:
  // the subscription for installment plans, the PaymentIntent for one-off payments.
  // customer_creation is a payment-mode-only parameter; subscriptions always make one.
  if (spec.mode === 'subscription') {
    params.subscription_data = { metadata: spec.metadata };
  } else {
    params.payment_intent_data = { metadata: spec.metadata };
    params.customer_creation = 'always';
  }
  return params;
}

function redirect(location) {
  return new Response(null, { status: 303, headers: { Location: location } });
}

export default async (request, context) => {
  if (request.method !== 'POST') return json(405, { error: 'method not allowed' });

  const isForm = (request.headers.get('content-type') || '').includes('application/x-www-form-urlencoded');
  let body;
  if (isForm) {
    const form = new URLSearchParams(await request.text());
    body = {
      plan: form.get('plan'), pay: form.get('pay'), email: form.get('email'),
      guardianConfirmed: form.get('guardian-confirmed') === 'yes', 'en-hp': form.get('en-hp')
    };
  } else {
    try {
      body = await request.json();
    } catch (err) {
      body = null;
    }
    if (!body || typeof body !== 'object') return json(400, { error: 'invalid request body' });
  }

  // Every failure below has two shapes, decided once here.
  const fail = (status, error) => isForm
    ? redirect('/enroll?plan=' + encodeURIComponent(body.plan || '') + '&pay=' + encodeURIComponent(body.pay || '') + '&err=1')
    : json(status, { error });

  // Honeypot, same as the contact and playbook forms: a bot gets the thanks page and
  // Stripe never hears about it.
  if (body['en-hp']) return isForm ? redirect('/enroll/thanks') : json(200, { url: '/enroll/thanks' });

  const ip = clientIp(request, context);
  const allowed = await checkRateLimit('checkout:' + ip, { windowMs: RATE_LIMIT_WINDOW_MS, max: RATE_LIMIT_MAX });
  if (!allowed) return fail(429, 'too many requests, try again later');

  const email = String(body.email || '').trim();
  if (!EMAIL_RE.test(email)) return fail(422, 'a valid email is required');
  if (body.guardianConfirmed !== true) return fail(422, 'guardian confirmation is required');

  let spec;
  try {
    spec = checkoutSpec(body.plan, body.pay);
  } catch (err) {
    return fail(422, err.message);
  }

  const stripe = stripeClient();
  if (!stripe) return fail(503, 'payments not configured');

  let session;
  try {
    const price = await priceByLookupKey(stripe, spec.lookupKey);
    if (!price) {
      console.error('no active Stripe price for ' + spec.lookupKey + ': scripts/stripe-catalog.mjs has not been run for this mode (test or live)');
      return fail(500, 'price not found: ' + spec.lookupKey);
    }
    session = await stripe.checkout.sessions.create(sessionParams(spec, {
      email, priceId: price.id, siteUrl: SITE_URL, nowSeconds: Math.floor(Date.now() / 1000)
    }));
  } catch (err) {
    console.error('stripe checkout failed: ' + err.message);
    return fail(502, 'checkout unavailable');
  }

  return isForm ? redirect(session.url) : json(200, { url: session.url });
};
