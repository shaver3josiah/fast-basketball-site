// Is Stripe actually ready to take an enrollment? Run this before telling a family it is:
//
//   STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-check.mjs
//   npm run stripe:check
//
// It reads. The one thing it writes is a Checkout Session it immediately expires, and that
// is deliberate: three of the four ways this goes wrong are invisible to a read-only check.
//
//   - The catalog was never pushed for THIS mode, so a lookup key resolves to nothing and
//     every checkout is a 503. Test mode and live mode have separate products and prices,
//     and running the catalog script in one does nothing for the other.
//   - A price drifted from src/lib/plans.mjs, so the page promises one number and Stripe
//     charges another.
//   - The account has no Terms of service URL. Every session asks for the consent box
//     (consent_collection), and Stripe refuses to create one without that URL, so /enroll
//     fails on every plan. Nothing on the account object says so; the only honest way to
//     find out is to ask Stripe for a session and read the error. LAUNCH.md Step 5.2.
//   - The webhook endpoint is missing or subscribed to the wrong events, so payments
//     succeed and nothing is ever recorded.
//
// Exits non-zero when anything fails, so CI or a pre-cutover script can gate on it.

import { pathToFileURL } from 'node:url';
import Stripe from 'stripe';
import { catalog, dollars } from '../src/lib/plans.mjs';
import { SITE_URL } from '../src/lib/site-config.mjs';

// Every event server/functions/stripe-webhook.mjs acts on. checkout.session.expired is the
// one people forget: without it a family who registered and never paid is a row nobody sees.
export const REQUIRED_EVENTS = [
  'checkout.session.completed',
  'checkout.session.expired',
  'invoice.payment_failed',
  'customer.subscription.deleted'
];

export const WEBHOOK_PATH = '/api/stripe-webhook';

const abs = (siteUrl, path) => siteUrl.replace(/\/$/, '') + path;

export function keyMode(key) {
  if (/^[sr]k_live_/.test(key)) return 'live';
  if (/^[sr]k_test_/.test(key)) return 'test';
  return 'unknown';
}

function priceMatches(price, spec) {
  if (price.unit_amount !== spec.amountCents || price.currency !== 'usd') return false;
  if (spec.mode !== 'subscription') return !price.recurring;
  return !!price.recurring && price.recurring.interval === spec.interval && price.recurring.interval_count === 1;
}

// Pure enough to test: everything it touches comes from the injected client. Returns one
// row per check rather than throwing, so a single run reports every problem at once instead
// of making the owner fix them one deploy at a time.
export async function auditStripe(stripe, { siteUrl = SITE_URL, probeSession = true } = {}) {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });
  const specs = catalog();

  // ---- prices
  const { data: prices } = await stripe.prices.list({
    lookup_keys: specs.map((s) => s.lookupKey), active: true, limit: 100
  });
  const byKey = new Map(prices.map((p) => [p.lookup_key, p]));
  const missing = [];
  const wrong = [];
  for (const spec of specs) {
    const price = byKey.get(spec.lookupKey);
    if (!price) { missing.push(spec.lookupKey); continue; }
    if (!priceMatches(price, spec)) {
      wrong.push(spec.lookupKey + ' is ' + dollars(price.unit_amount ?? 0) + ' in Stripe, ' + dollars(spec.amountCents) + ' on the site');
    }
  }
  add('prices', missing.length === 0 && wrong.length === 0,
    missing.length ? 'no active price for: ' + missing.join(', ') + '. Run npm run stripe:catalog in THIS mode.'
      : wrong.length ? wrong.join('; ') + '. Run npm run stripe:catalog to move the lookup key onto a corrected price.'
        : specs.length + ' lookup keys, all present and matching plans.mjs');

  // ---- terms of service, by asking for the session the site would actually create
  const firstPriced = specs.find((s) => byKey.has(s.lookupKey));
  if (!probeSession) {
    add('terms of service', true, 'skipped');
  } else if (!firstPriced) {
    add('terms of service', false, 'not checked: no price exists to build a session with. Fix prices first.');
  } else {
    try {
      const session = await stripe.checkout.sessions.create({
        mode: firstPriced.mode,
        line_items: [{ price: byKey.get(firstPriced.lookupKey).id, quantity: 1 }],
        consent_collection: { terms_of_service: 'required' },
        custom_text: { terms_of_service_acceptance: { message: 'Preflight check, expired immediately.' } },
        success_url: abs(siteUrl, '/enroll/thanks'),
        cancel_url: abs(siteUrl, '/enroll'),
        metadata: { preflight: 'stripe-check' }
      });
      // Leave nothing payable behind. A failure to expire is not a readiness problem.
      try { await stripe.checkout.sessions.expire(session.id); } catch (err) { /* harmless */ }
      add('terms of service', true, 'the consent box works: a session with consent_collection was created and expired.');
    } catch (err) {
      const msg = String(err && err.message || err);
      const isTos = /terms.of.service/i.test(msg);
      add('terms of service', false, isTos
        ? 'Stripe refused the consent box. Set the Terms of service URL to ' + abs(siteUrl, '/terms') +
          ' in Settings, Business, Public details. Until then EVERY enrollment fails.'
        : 'could not create a test session: ' + msg);
    }
  }

  // ---- webhook
  let endpoints = [];
  try {
    const res = await stripe.webhookEndpoints.list({ limit: 100 });
    endpoints = res.data || [];
  } catch (err) {
    endpoints = null;
    add('webhook', false, 'could not list webhook endpoints: ' + err.message);
  }
  if (endpoints) {
    const wanted = abs(siteUrl, WEBHOOK_PATH);
    const mine = endpoints.filter((e) => (e.url || '').endsWith(WEBHOOK_PATH));
    const enabled = mine.find((e) => e.status !== 'disabled');
    if (!enabled) {
      add('webhook', false, 'no enabled endpoint ending in ' + WEBHOOK_PATH +
        '. Add ' + wanted + ' in Developers, Webhooks, subscribed to: ' + REQUIRED_EVENTS.join(', '));
    } else {
      const events = enabled.enabled_events || [];
      const all = events.includes('*');
      const absent = all ? [] : REQUIRED_EVENTS.filter((e) => !events.includes(e));
      add('webhook', absent.length === 0,
        absent.length ? enabled.url + ' is missing events: ' + absent.join(', ')
          : enabled.url + ' is enabled and subscribed to all four events.' +
            (enabled.url !== wanted ? ' NOTE: it points at ' + enabled.url + ', not ' + wanted + '.' : ''));
    }
  }

  return { ok: checks.every((c) => c.ok), checks };
}

async function main() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    console.error('STRIPE_SECRET_KEY is not set in this shell. Set it to the key for the mode you want to check.');
    process.exit(2);
  }
  const mode = keyMode(key);
  console.log('Checking Stripe in ' + mode.toUpperCase() + ' mode, against ' + SITE_URL);
  if (mode === 'unknown') console.log('  (that key is neither sk_test_ nor sk_live_; continuing anyway)');

  const { ok, checks } = await auditStripe(new Stripe(key));
  console.log('');
  for (const c of checks) console.log((c.ok ? '  OK   ' : '  FAIL ') + c.name.padEnd(18) + c.detail);
  console.log('');
  console.log(ok
    ? 'Ready. ' + mode.toUpperCase() + ' mode can take an enrollment.'
    : 'NOT ready. Fix the FAIL lines above, then run this again.');
  process.exit(ok ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('stripe-check failed: ' + (err && err.message ? err.message : err));
    process.exit(2);
  });
}
