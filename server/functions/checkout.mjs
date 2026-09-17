// POST /api/checkout: the athlete registration in, a hosted Stripe Checkout
// URL out. The registration is written to the leads store and emailed to Blake BEFORE
// Stripe is asked for anything: a family that pays must never be a family whose form was
// lost, and a family Stripe cannot take yet (no key, no price) is still a registration he
// can follow up by hand. Amounts never come from the client; checkoutSpec() resolves the
// plan and the price is looked up by lookup_key server-side (STRIPE-PLAN.md, security notes).
//
// Two callers. src/js/enroll.js sends JSON and reads JSON back. A browser with JavaScript
// off posts the form itself and gets a 303, to Stripe or back to the page. That second path
// was disabled between the registration form shipping and the signature pad being removed,
// because a canvas cannot be drawn on without scripting; nothing else about it changed.
import { randomUUID } from 'node:crypto';
import { checkoutSpec, getPlan, totalCents, dollars, isAppPlan, leadKey, PAY_LABELS } from '../../src/lib/plans.mjs';
import { validateRegistration } from '../../src/lib/registration.mjs';
import { validateAppOrder } from '../../src/lib/apporder.mjs';
import { approvedCampaign } from '../../src/lib/commission.mjs';
import { SITE_URL, absoluteUrl } from '../../src/lib/site-config.mjs';
import { checkRateLimit, clientIp } from './lib/rate-limit.mjs';
import { addLead, getLead } from './lib/leads.mjs';
import { sendEmail, ownerEmail, escapeHtml, recordTable } from './lib/notify.mjs';
import { stripeClient, priceByLookupKey, json } from './lib/stripe.mjs';

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 10;
// Stripe caps expires_at at 24 hours after the session's own created time, so an hour of
// slack keeps our clock running slightly ahead of theirs from failing every checkout.
const SESSION_TTL_SECONDS = 23 * 60 * 60;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const redirect = (location) => new Response(null, { status: 303, headers: { Location: location } });

// The no-JS failure. It keeps the plan and pay the buyer picked so the page comes back with
// their choice still made, and #enErr:target is what reveals the error paragraph. Both forms
// ship that paragraph under the same id, so the only thing that differs is which page to
// return to, which the catalog already knows.
function backToForm(body) {
  const plan = encodeURIComponent(String(body?.plan ?? ''));
  const pay = encodeURIComponent(String(body?.pay ?? ''));
  const page = isAppPlan(body?.plan) ? '/appbuy' : '/enroll';
  return redirect(page + '?plan=' + plan + '&pay=' + pay + '&err=1#enErr');
}

// Pure so the parameter shape is testable without a Stripe account. siteUrl is a
// parameter for the same reason; the handler passes SITE_URL from site-config.
export function sessionParams(spec, { email, priceId, siteUrl, nowSeconds, registrationId }) {
  const abs = (path) => siteUrl.replace(/\/$/, '') + path;
  // The registration id rides on the session so the webhook can find the record it belongs
  // to, and on the dashboard's reference field so Blake can too.
  const metadata = registrationId ? { ...spec.metadata, registrationId } : spec.metadata;
  const params = {
    mode: spec.mode,
    line_items: [{ price: priceId, quantity: 1 }],
    customer_email: email,
    phone_number_collection: { enabled: true },
    billing_address_collection: 'auto',
    // The agreement's step 2 ("click the I agree box", "type your full name") lives on the
    // Stripe session, which is Blake's evidence in a dispute. The player's name used to be
    // asked here as well; the registration carries it now, so the parent types it once.
    consent_collection: { terms_of_service: 'required' },
    custom_text: {
      terms_of_service_acceptance: {
        // A tool purchase is not the training agreement, and pointing an app buyer at a
        // document about court sessions, 60 days written notice and health insurance would be
        // asking them to agree to something that is not their deal. What they are agreeing to
        // is the sentence they ticked on /appbuy, so that is what Stripe repeats back.
        message: spec.page === '/appbuy'
          ? 'I agree to the [Fast Basketball tool purchase terms](' + abs('/appbuy') + '). This purchase is final and non-refundable, including every payment in a payment plan.'
          : 'I have read and agree to the Fast Basketball [training agreement](' + abs('/terms') + ').'
      }
    },
    custom_fields: [
      { key: 'agree_name', label: { type: 'custom', custom: 'Type your full name to agree to the terms' }, type: 'text' }
    ],
    metadata,
    success_url: abs(spec.page + '/thanks'),
    cancel_url: abs(spec.page + '?plan=' + spec.plan + '&pay=' + spec.pay),
    expires_at: nowSeconds + SESSION_TTL_SECONDS
  };
  if (registrationId) params.client_reference_id = registrationId;
  // Metadata is copied onto the object the webhook and the dashboard actually look at:
  // the subscription for installment plans, the PaymentIntent for one-off payments.
  // customer_creation is a payment-mode-only parameter; subscriptions always make one.
  if (spec.mode === 'subscription') {
    params.subscription_data = { metadata };
  } else {
    params.payment_intent_data = { metadata };
    params.customer_creation = 'always';
  }
  return params;
}

// The registration as the leads store keeps it: type 'enrollment' from the first save, so
// the admin panel shows one row per family, and paymentStatus 'pending' until the webhook
// hears from Stripe. name/email/phone/playerName are the columns every lead type shares.
export function registrationRecord({ id, timestamp, values, spec }) {
  const plan = getPlan(spec.plan);
  return {
    type: 'enrollment',
    registrationId: id,
    timestamp,
    ...values,
    name: values.parentFirst + ' ' + values.parentLast,
    playerName: values.athleteFirst + ' ' + values.athleteLast,
    plan: spec.plan,
    planLabel: spec.label,
    pay: spec.pay,
    amountCents: spec.amountCents,
    amount: dollars(spec.amountCents),
    months: plan.months || null,
    noticeDays: plan.noticeDays || null,
    termTotalCents: totalCents(spec.plan, spec.pay),
    paymentStatus: 'pending',
    termsAccepted: true,
    reviewed: true,
    notified: false
  };
}

// The /appbuy order as the leads store keeps it. Same shared columns as every other lead type
// (name/email/phone), its own `type` so the admin Leads tab can chip it and so a tool purchase
// is never counted as an enrollment, and paymentStatus 'pending' until the webhook hears from
// Stripe. There is no playerName: buying a tool does not enroll an athlete in anything.
export function appOrderRecord({ id, timestamp, values, spec }) {
  const months = spec.iterations || null;
  return {
    type: 'apporder',
    orderId: id,
    timestamp,
    ...values,
    name: values.firstName + ' ' + values.lastName,
    product: spec.plan,
    productLabel: spec.label,
    pay: spec.pay,
    payLabel: PAY_LABELS[spec.pay] || spec.pay,
    amountCents: spec.amountCents,
    amount: dollars(spec.amountCents),
    months,
    // What the card is actually charged in total, which for an instalment plan is a cent or two
    // under the published price (monthlyCents floors, deliberately). The published figure is
    // what the page promises; this is what Blake will see land in Stripe.
    priceCents: totalCents(spec.plan, spec.pay),
    collectedCents: spec.amountCents * (months || 1),
    paymentStatus: 'pending',
    termsAccepted: true,
    nonRefundableAccepted: true,
    notified: false
  };
}

export default async (request, context) => {
  if (request.method !== 'POST') return json(405, { error: 'method not allowed' });

  // Two callers. enroll.js sends JSON and reads JSON back. A browser with JavaScript off
  // posts the form itself and gets a 303: to Stripe when the session is created, back to the
  // page with ?err=1#enErr otherwise, where :target reveals the error paragraph the page
  // already ships. That second path was dead while the form demanded a drawn signature.
  const isForm = (request.headers.get('content-type') || '').includes('application/x-www-form-urlencoded');
  let body;
  if (isForm) {
    const form = new URLSearchParams(await request.text());
    body = Object.fromEntries(form.entries());
    // Checkboxes arrive as the string "yes" or not at all; the validators want real booleans.
    // Both forms' boxes are mapped here rather than after the plan is known, because a box the
    // other form does not ask for is simply false and its validator never looks at it.
    body.reviewed = form.get('reviewed') === 'yes';
    body.terms = form.get('terms') === 'yes';
    body.norefund = form.get('norefund') === 'yes';
  } else {
    try {
      body = await request.json();
    } catch (err) {
      body = null;
    }
    if (!body || typeof body !== 'object') return json(400, { error: 'invalid request body' });
  }

  // Every failure below has two shapes, decided once here.
  const fail = (status, payload) => (isForm ? backToForm(body) : json(status, payload));

  // Which form this is. The plan key decides, because the catalog is the one thing that knows
  // what a key means: an /appbuy post and an /enroll post arrive on the same endpoint, and
  // nothing the client says about itself is trusted to pick a validator or a store prefix.
  const isApp = isAppPlan(body.plan);
  const thanksPath = (isApp ? '/appbuy' : '/enroll') + '/thanks';

  // Honeypot, same as the contact and playbook forms: a bot gets the thanks page and
  // neither the store nor Stripe ever hears about it.
  if (body['en-hp']) {
    return isForm ? redirect(thanksPath) : json(200, { url: thanksPath });
  }

  const ip = clientIp(request, context);
  const allowed = await checkRateLimit('checkout:' + ip, { windowMs: RATE_LIMIT_WINDOW_MS, max: RATE_LIMIT_MAX });
  if (!allowed) return fail(429, { error: 'too many requests, try again later' });

  const { errors, values } = isApp ? validateAppOrder(body) : validateRegistration(body);
  let spec = null;
  try {
    spec = checkoutSpec(body.plan, body.pay);
  } catch (err) {
    errors.plan = err.message;
  }
  const keys = Object.keys(errors);
  if (keys.length) return fail(422, { error: errors[keys[0]], errors });

  // A parent back from Stripe's cancel link resubmits with the id enroll.js kept, and the
  // pending record is rewritten rather than doubled. Anything else gets a fresh id: a value
  // that is not one of our own pending registrations is never reused, whatever the client says.
  let id = null;
  let reused = false;
  if (typeof body.registrationId === 'string' && UUID_RE.test(body.registrationId)) {
    // leadKey, so an id borrowed from the other form's tab cannot reach across and rewrite a
    // pending record of the wrong kind.
    const prior = await getLead(leadKey(spec.plan, body.registrationId));
    if (prior && prior.paymentStatus === 'pending') {
      id = body.registrationId;
      reused = true;
    }
  }
  if (!id) id = randomUUID();

  const timestamp = new Date().toISOString();
  const record = isApp
    ? appOrderRecord({ id, timestamp, values, spec })
    : registrationRecord({ id, timestamp, values, spec });
  // The campaign tag off the link (`?camp=`), and the one place an untrusted one is filtered.
  // Deliberately NOT a FIELDS answer: it is a fact about the link, not something the parent
  // typed, so it is not in `values` and validateRegistration never sees it. Only an APPROVED
  // slug is stored, in its canonical spelling; anything else is dropped silently, because an
  // invented tag is a stranger's guess at a query parameter, not a registration error.
  // A campaign can only ever move a TRAINING family from 2.5% to 8%. App products pay a flat
  // 50/50 whatever the link said, so the tag is not read on that path at all: storing one would
  // put a campaign name on a row it can never have priced.
  const campaign = isApp ? null : approvedCampaign(body.campaign);
  if (campaign) record.campaign = campaign;
  try {
    await addLead(leadKey(spec.plan, id), record);
  } catch (err) {
    console.error((isApp ? 'app order ' : 'registration ') + id + ' not saved: ' + err.message);
    return fail(500, { error: isApp ? 'order not saved' : 'registration not saved' });
  }
  if (isApp) await notifyAppOrder(record, reused);
  else await notifyRegistration(record, reused);

  // From here on every answer carries the id, so a retry from the same tab updates this
  // record. 503 means "saved, but Stripe cannot take this plan yet": no key, or a price the
  // catalog script has not created. enroll.js tells the parent Blake will send the link.
  const stripe = stripeClient();
  // No key yet: the record is saved and Blake has been emailed, so a no-JS visitor is sent to
  // the thanks page rather than an error. enroll.js and appbuy.js say the same thing in words.
  if (!stripe) return isForm ? redirect(thanksPath) : json(503, { error: 'payments not configured', registrationId: id });

  let session;
  try {
    const price = await priceByLookupKey(stripe, spec.lookupKey);
    if (!price) {
      console.error('no active Stripe price for ' + spec.lookupKey + ': scripts/stripe-catalog.mjs has not been run for this mode (test or live)');
      return isForm ? redirect(thanksPath) : json(503, { error: 'price not configured: ' + spec.lookupKey, registrationId: id });
    }
    session = await stripe.checkout.sessions.create(sessionParams(spec, {
      email: values.email, priceId: price.id, siteUrl: SITE_URL, nowSeconds: Math.floor(Date.now() / 1000), registrationId: id
    }));
  } catch (err) {
    console.error('stripe checkout failed: ' + err.message);
    return fail(502, { error: 'checkout unavailable', registrationId: id });
  }

  return isForm ? redirect(session.url) : json(200, { url: session.url, registrationId: id });
};

// Blake hears about a registration the moment it is saved, paid or not: this is the Jotform
// submission email he is used to. The enrollment email from the webhook follows once Stripe
// confirms the money. Never throws; a lost email is logged and the record still stands.
async function notifyRegistration(record, reused) {
  const sent = await sendEmail({
    to: ownerEmail(),
    subject: (reused ? 'Updated registration' : 'New registration') + ', payment pending: ' + record.playerName + ' (' + record.planLabel + ')',
    html: '<h2>' + (reused ? 'Registration updated' : 'New registration') + '</h2>' +
      '<p>' + escapeHtml(record.name) + ' registered ' + escapeHtml(record.playerName) + ' and is on the way to Stripe to pay ' +
      escapeHtml(record.amount) + (record.pay === 'monthly' ? ' a month' : '') + '. The spot is not reserved until the enrollment email arrives.</p>' +
      recordTable(record)
  });
  if (!sent) console.error('registration email not sent for ' + record.registrationId + '; the record is saved');
}

// Same idea for a tool purchase: Blake hears about it the moment it is saved, paid or not. The
// paid confirmation, and the buyer's own access email, follow from the webhook.
async function notifyAppOrder(record, reused) {
  const plan = getPlan(record.product);
  const howPaid = record.months
    ? record.amount + ' a month for ' + record.months + ' months (' + dollars(record.collectedCents) + ' in total)'
    : record.amount + ' once';
  const sent = await sendEmail({
    to: ownerEmail(),
    subject: (reused ? 'Updated tool order' : 'New tool order') + ', payment pending: ' + record.productLabel + ' - ' + record.name,
    html: '<h2>' + (reused ? 'Tool order updated' : 'New tool order') + '</h2>' +
      '<p>' + escapeHtml(record.name) + ' is on the way to Stripe to buy <b>' + escapeHtml(record.productLabel) +
      '</b>, paying ' + escapeHtml(howPaid) + '. Nothing is sent until the paid email arrives.</p>' +
      '<p>Access link once paid: ' + escapeHtml(absoluteUrl(plan.url)) + '</p>' +
      recordTable(record)
  });
  if (!sent) console.error('tool order email not sent for ' + record.orderId + '; the record is saved');
}
