// Deals: a private price Blake agrees with one family, sold through the ordinary /enroll form.
//
// A deal is NOT a catalog plan. The catalog (src/lib/plans.mjs) is the public price list and
// resolves prices by lookup_key; a deal is one-off, so it gets its own Stripe product and price
// the moment Blake creates it (admin-deals.mjs), and the price id is stored on the deal. Checkout
// reads the deal from THIS store, server-side, so the amount can never come from the browser:
// the page only ever sends the deal's id.
//
// The link is /enroll?deal=<id>. enroll.js fetches the public view from /api/deal and shows that
// one offer instead of the plan cards; the rest of the registration is unchanged, so a deal
// family is a normal enrollment row with `deal` on it, and the webhook, the welcome email and
// the commission ledger treat it as the training revenue it is.
//
// One family per link: once a deal is paid it is marked used and checkout refuses it, so a
// forwarded link cannot sell the same discount twice. Blake cuts another in ten seconds.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { dollars, monthlyCents, validPriceCents } from '../../../src/lib/plans.mjs';

// The expiry choices the admin offers, for deals and coupons alike: a day, then a day at a time
// to a week, then whole weeks to a month. Anything else is refused, not clamped.
export const EXPIRY_HOURS = [24, 48, 72, 96, 120, 144, 168, 336, 504, 720];

export const MAX_PAYMENTS = 12;
const ID_RE = /^[A-Za-z0-9_-]{8,40}$/;

const str = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * Admin input to a deal, or errors. Cents are integers from the panel, which converts dollars
 * once; the bounds are the catalog's own (validPriceCents), so a deal cannot be free or absurd.
 */
export function validateDeal(input, now = Date.now()) {
  const errors = {};
  const b = input && typeof input === 'object' ? input : {};
  const title = str(b.title);
  const forName = str(b.forName);
  const details = str(b.details);
  if (title.length < 2 || title.length > 80) errors.title = 'Say what they get, in 2 to 80 characters.';
  if (forName.length > 80) errors.forName = 'Keep the name under 80 characters.';
  if (details.length > 400) errors.details = 'Keep the details under 400 characters.';

  let full = null;
  if (b.fullCents != null && b.fullCents !== '') {
    if (validPriceCents(b.fullCents)) full = b.fullCents;
    else errors.fullCents = 'Pay-in-full price must be between $1 and $20,000.';
  }
  let monthly = null;
  if (b.monthlyTotalCents != null && b.monthlyTotalCents !== '') {
    const payments = Number(b.payments);
    if (!validPriceCents(b.monthlyTotalCents)) errors.monthlyTotalCents = 'Payment plan total must be between $1 and $20,000.';
    else if (!Number.isInteger(payments) || payments < 2 || payments > MAX_PAYMENTS) errors.payments = 'Pick 2 to ' + MAX_PAYMENTS + ' payments.';
    else {
      const eachCents = monthlyCents(b.monthlyTotalCents, payments);
      if (eachCents < 100) errors.monthlyTotalCents = 'Each payment has to be at least $1.';
      else monthly = { payments, eachCents };
    }
  }
  if (!full && !monthly && !errors.fullCents && !errors.monthlyTotalCents && !errors.payments) {
    errors.fullCents = 'Give a pay-in-full price, a payment plan, or both.';
  }

  // Absent or 0 means "until closed". Anything else must be on the list; a junk value is an
  // error, never a silent "no expiry".
  const none = b.expiresHours == null || b.expiresHours === '' || b.expiresHours === 0 || b.expiresHours === '0';
  const hours = none ? 0 : Number(b.expiresHours);
  if (!none && !EXPIRY_HOURS.includes(hours)) errors.expiresHours = 'Pick one of the listed times.';

  if (Object.keys(errors).length) return { errors, deal: null };
  return {
    errors,
    deal: {
      id: randomBytes(8).toString('base64url'),
      createdAt: new Date(now).toISOString(),
      title, forName: forName || null, details: details || null,
      full, monthly,
      expiresAt: hours ? new Date(now + hours * 3600e3).toISOString() : null,
      closedAt: null, paidAt: null
    }
  };
}

export function dealState(deal, now = Date.now()) {
  if (deal.closedAt) return 'closed';
  if (deal.paidAt) return 'paid';
  if (deal.expiresAt && Date.parse(deal.expiresAt) <= now) return 'expired';
  return 'open';
}

// What a parent is told when a deal cannot be bought. Null when it can.
export function dealProblem(deal, now = Date.now()) {
  if (!deal) return 'That offer link is not right. Ask Coach Blake to send it again.';
  const state = dealState(deal, now);
  if (state === 'paid') return 'This offer has already been used. Ask Coach Blake if you need a new link.';
  if (state !== 'open') return 'This offer has ended. Ask Coach Blake for a new link.';
  return null;
}

export const dealPayOptions = (deal) => [deal.full ? 'full' : null, deal.monthly ? 'monthly' : null].filter(Boolean);

// The same sentences /enroll prints for a catalog plan, so a deal card reads like the others.
export function dealLine(deal, pay) {
  if (pay === 'full') return dollars(deal.full) + ' today';
  const { eachCents, payments } = deal.monthly;
  return dollars(eachCents) + ' a month for ' + payments + ' months, ' + dollars(eachCents * payments) + ' in total';
}

/** What the enroll page may know. No Stripe ids, no dates beyond expiry. */
export function publicDeal(deal) {
  const lines = {};
  for (const pay of dealPayOptions(deal)) lines[pay] = dealLine(deal, pay);
  return {
    id: deal.id, title: deal.title, forName: deal.forName, details: deal.details, expiresAt: deal.expiresAt,
    full: deal.full, monthly: deal.monthly, lines
  };
}

/**
 * The checkout spec for a deal, the same shape checkoutSpec() returns for a catalog plan, so
 * sessionParams and the records need no second path. `plan` is 'deal' and `deal` is the id:
 * that is what the webhook keys on. There is no lookupKey: the price id lives on the deal.
 *
 * A payment plan ENDS ('cancel'), unlike a membership's 'release'. A deal is a fixed thing
 * Blake agreed, and it must stop billing when it is paid for.
 */
export function dealSpec(deal, pay) {
  if (!dealPayOptions(deal).includes(pay)) throw new Error('this offer does not include ' + pay);
  const base = {
    plan: 'deal', deal: deal.id, pay, label: deal.title,
    page: '/enroll', cancelPath: '/enroll?deal=' + encodeURIComponent(deal.id),
    description: deal.details || deal.title
  };
  if (pay === 'full') {
    return {
      ...base, metadata: { plan: 'deal', pay, deal: deal.id, totalCents: String(deal.full) },
      mode: 'payment', amountCents: deal.full, termTotalCents: deal.full,
      interval: null, iterations: null, endBehavior: null
    };
  }
  const { eachCents, payments } = deal.monthly;
  return {
    ...base,
    metadata: { plan: 'deal', pay, deal: deal.id, payments: String(payments), totalCents: String(eachCents * payments) },
    mode: 'subscription', amountCents: eachCents, termTotalCents: eachCents * payments,
    interval: 'month', iterations: payments, endBehavior: 'cancel'
  };
}

// ---------------------------------------------------------------- Stripe objects

/** One product per deal, one price per pay option. Returns what to store on the deal. */
export async function createDealStripe(stripe, deal) {
  const product = await stripe.products.create({
    name: deal.title,
    ...(deal.details ? { description: deal.details } : {}),
    metadata: { deal: deal.id, forName: deal.forName || '' }
  });
  const prices = {};
  if (deal.full) {
    prices.full = (await stripe.prices.create({
      product: product.id, currency: 'usd', unit_amount: deal.full, metadata: { deal: deal.id, pay: 'full' }
    })).id;
  }
  if (deal.monthly) {
    prices.monthly = (await stripe.prices.create({
      product: product.id, currency: 'usd', unit_amount: deal.monthly.eachCents,
      recurring: { interval: 'month' }, metadata: { deal: deal.id, pay: 'monthly' }
    })).id;
  }
  return { productId: product.id, prices };
}

/** Archive a closed deal's prices and product. Best effort: the store is what checkout reads. */
export async function closeDealStripe(stripe, deal) {
  await expireDealSessions(stripe, deal, null);
  for (const id of Object.values(deal.prices || {})) await stripe.prices.update(id, { active: false });
  if (deal.productId) await stripe.products.update(deal.productId, { active: false });
}

/**
 * Expire every checkout session this deal opened, except `keep`.
 *
 * THE LINK IS ONLY ONE-FAMILY BECAUSE OF THIS. Checkout refuses a deal once it is marked used,
 * but a session opened before that (a forwarded link, a second tab, a return from Stripe's cancel
 * link) stays payable for up to 23 hours. So when one pays, or Blake closes the deal, the rest are
 * expired. A session already complete or expired refuses the call, which is the answer we wanted.
 */
export async function expireDealSessions(stripe, deal, keep) {
  for (const id of deal.sessions || []) {
    if (id === keep) continue;
    try { await stripe.checkout.sessions.expire(id); } catch { /* already complete or expired */ }
  }
}

/**
 * Note a checkout session this deal opened, so it can be expired later.
 * ponytail: read-modify-write, so two sessions opened in the same instant can lose one id. At one
 * family per deal that is a near-impossible race, and the deal's own expiry still caps it.
 */
export async function recordDealSession(dealId, sessionId) {
  const deal = await getDeal(dealId);
  if (!deal) return;
  await putDeal({ ...deal, sessions: [...(deal.sessions || []), sessionId].slice(-50) });
}

/** The session's own expiry: 23 hours, or sooner if the deal ends sooner (Stripe's floor is 30 minutes). */
export function dealSessionExpiry(deal, nowSeconds, ttlSeconds) {
  const cap = nowSeconds + ttlSeconds;
  if (!deal?.expiresAt) return cap;
  const end = Math.floor(Date.parse(deal.expiresAt) / 1000);
  return Math.max(nowSeconds + 30 * 60 + 60, Math.min(cap, end));
}

/**
 * The Stripe price checkout may charge for this deal, or null. Retrieved and checked rather than
 * trusted, so a price archived or edited in the dashboard can never be charged at a figure the
 * page did not show.
 */
export async function dealPrice(stripe, deal, spec) {
  const id = deal.prices?.[spec.pay];
  if (!id) return null;
  const price = await stripe.prices.retrieve(id);
  const recurring = spec.mode === 'subscription';
  if (!price?.active || price.unit_amount !== spec.amountCents || !!price.recurring !== recurring) return null;
  return price;
}

// ---------------------------------------------------------------- store
//
// Its own collection, never `leads`: leads-list returns that collection unfiltered, so a deal
// stored there would show in the Leads tab as a family. Same local-file-in-dev pattern as
// leads.mjs and ledger.mjs.

const LOCAL = process.env.FB_LOCAL === 'true';
const LOCAL_PATH = () => resolve(process.cwd(), '.local/deals.json');

async function store() {
  const { getStore } = await import('./blobs.mjs');
  return getStore('deals');
}

function readLocal() {
  if (!existsSync(LOCAL_PATH())) return [];
  try {
    const parsed = JSON.parse(readFileSync(LOCAL_PATH(), 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export const validDealId = (id) => typeof id === 'string' && ID_RE.test(id);

export async function getDeal(id) {
  if (!validDealId(id)) return null;
  if (LOCAL) return readLocal().find((d) => d.id === id) || null;
  return (await store()).get(id, { type: 'json' });
}

export async function putDeal(deal) {
  if (LOCAL) {
    const all = readLocal().filter((d) => d.id !== deal.id);
    all.push(deal);
    mkdirSync(dirname(LOCAL_PATH()), { recursive: true });
    writeFileSync(LOCAL_PATH(), JSON.stringify(all, null, 2) + '\n');
    return;
  }
  await (await store()).setJSON(deal.id, deal);
}

export async function listDeals() {
  if (LOCAL) return readLocal();
  const out = [];
  for (const { value } of await (await store()).entries()) {
    try { if (value) out.push(JSON.parse(value)); } catch { /* unreadable row: skipped */ }
  }
  return out;
}
