// The admin's Prices tab: change a package's price, hide it, or add a new one, live, with no
// deploy. The state is ONE document (`catalog` in the `packages` store) shaped by plans.mjs:
//   { overrides, added, retired }. plans.mjs turns it into the catalog; this file reads and
// writes it, keeps each running instance's copy fresh, and works out what a change touches.
//
// Why a document and not content.json: content.json is baked into the Cloud Function at deploy
// time and into the pages at build time, so a change there reaches nobody until a developer
// ships. Checkout resolves its prices from Stripe by lookup key, so a price only really changes
// when the Stripe price does. The admin therefore writes Stripe FIRST and the document second:
// the store never advertises a price Stripe cannot charge.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  PLANS, PACKAGE_PROGRAMS, PACKAGE_FREQUENCIES, PACKAGE_MAX_TERM_MONTHS,
  normalizeDoc, effectivePlans, setStoredPackages, storedDoc, planFromDef,
  catalogView, payOptionsFor, checkoutSpec, priceFigure, validPriceCents
} from '../../../src/lib/plans.mjs';
import { cardAttrs, cardInner, keysIn, programTiles } from '../../../src/lib/enroll-cards.mjs';

const isLocal = () => process.env.FB_LOCAL === 'true';
const LOCAL_PATH = () => resolve(process.cwd(), '.local/packages.json');
const DOC_KEY = 'catalog';
export const MAX_ADDED = 30;

// ---------------------------------------------------------------- store

export async function readDoc() {
  if (isLocal()) {
    if (!existsSync(LOCAL_PATH())) return normalizeDoc(null);
    try { return normalizeDoc(JSON.parse(readFileSync(LOCAL_PATH(), 'utf8'))); } catch { return normalizeDoc(null); }
  }
  const { getStore } = await import('./blobs.mjs');
  return normalizeDoc(await (await getStore('packages')).get(DOC_KEY, { type: 'json' }));
}

export async function writeDoc(doc) {
  const clean = normalizeDoc(doc);
  if (isLocal()) {
    mkdirSync(dirname(LOCAL_PATH()), { recursive: true });
    writeFileSync(LOCAL_PATH(), JSON.stringify(clean, null, 2) + '\n');
  } else {
    const { getStore } = await import('./blobs.mjs');
    await (await getStore('packages')).setJSON(DOC_KEY, clean);
  }
  return clean;
}

// Each instance keeps its own copy for a few seconds. A price Blake just changed reaches the
// other instances within TTL; the instance that took the change is current at once. Never throws:
// a store that cannot be read leaves the last known catalog in place (the published prices on a
// cold start), because checkout must not go down with Firestore.
const TTL_MS = 10_000;
let loadedAt = 0;

export async function refreshPackages({ force = false } = {}) {
  if (!force && Date.now() - loadedAt < TTL_MS) return;
  try {
    setStoredPackages(await readDoc());
    loadedAt = Date.now();
  } catch (err) {
    console.error('[packages] could not read the store, keeping the catalog in memory: ' + err.message);
    loadedAt = Date.now() - TTL_MS + 2000;
  }
}

// ---------------------------------------------------------------- changes

const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');
const trim = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * One admin action applied to a document: the new document and the plan keys whose Stripe prices
 * it touches, or an error in Blake's words. Pure, so it is tested without Stripe or a store.
 */
export function applyChange(current, body) {
  const doc = normalizeDoc(current);
  const plans = effectivePlans(doc);
  const known = (key) => typeof key === 'string' && Object.hasOwn(plans, key);
  const fail = (error) => ({ error });

  if (body.action === 'retire' || body.action === 'restore') {
    if (!known(body.key)) return fail('No package with that key.');
    const retired = new Set(doc.retired);
    if (body.action === 'retire') retired.add(body.key); else retired.delete(body.key);
    return { doc: { ...doc, retired: [...retired] }, keys: [] };
  }

  if (body.action === 'reset') {
    if (!known(body.key)) return fail('No package with that key.');
    const overrides = { ...doc.overrides };
    delete overrides[body.key];
    return { doc: { ...doc, overrides }, keys: [body.key] };
  }

  if (body.action === 'price') {
    if (!known(body.key)) return fail('No package with that key.');
    const offered = payOptionsFor(body.key, plans);
    const given = body.prices && typeof body.prices === 'object' ? body.prices : {};
    const entries = Object.entries(given);
    if (!entries.length) return fail('Type a price.');
    // Published = the catalog with no overrides, so a price typed back to the published figure
    // removes the override instead of leaving a redundant one behind.
    const published = effectivePlans({ added: doc.added });
    const next = { ...(doc.overrides[body.key] || {}) };
    for (const [pay, cents] of entries) {
      if (!offered.includes(pay)) return fail('This package has no "' + pay + '" price.');
      if (!validPriceCents(cents)) return fail('A price has to be between $1 and $20,000.');
      const base = published[body.key].kind === 'once' ? published[body.key].cents : published[body.key].totals[pay];
      if (cents === base) delete next[pay]; else next[pay] = cents;
    }
    const overrides = { ...doc.overrides };
    if (Object.keys(next).length) overrides[body.key] = next; else delete overrides[body.key];
    return { doc: { ...doc, overrides }, keys: [body.key] };
  }

  if (body.action === 'add') {
    if (Object.keys(doc.added).length >= MAX_ADDED) return fail('That is the most packages the panel will hold. Hide one you no longer sell.');
    const program = body.program;
    if (!Object.hasOwn(PACKAGE_PROGRAMS, program)) return fail('Pick Individual or Group.');
    const kind = body.kind;
    if (!['term', 'recurring', 'once'].includes(kind)) return fail('Pick how it is paid.');
    if (!validPriceCents(body.cents)) return fail('A price has to be between $1 and $20,000.');
    const name = trim(body.name);
    if (name.length > 60) return fail('Keep the name under 60 characters.');
    const programName = PACKAGE_PROGRAMS[program];
    const def = { program, kind, cents: body.cents };
    if (kind !== 'once') {
      if (!PACKAGE_FREQUENCIES.includes(body.frequency)) return fail('Pick how many sessions a week.');
      def.frequency = body.frequency;
    }
    if (kind === 'term') {
      const months = Number(body.termMonths);
      if (!Number.isInteger(months) || months < 1 || months > PACKAGE_MAX_TERM_MONTHS) return fail('Pick 1 to ' + PACKAGE_MAX_TERM_MONTHS + ' months.');
      def.termMonths = months;
    }
    if (kind === 'once') {
      if (name.length < 2) return fail('Name a single session package, like "Skills clinic".');
      const description = trim(body.description);
      if (description.length > 160) return fail('Keep the description under 160 characters.');
      if (description) def.description = description;
    }
    def.label = programName + ', ' + (name || (kind === 'term' ? plural(def.termMonths, 'month') + ', ' + def.frequency : def.frequency));
    if (!planFromDef(def)) return fail('That package is not valid.');
    // The same package twice is a mistake, not a choice: the cards would be indistinguishable.
    if (!name && kind !== 'once') {
      const twin = Object.entries(plans).find(([, p]) => p.program === program && p.frequency === def.frequency &&
        (kind === 'term' ? (p.kind === 'term' && p.termMonths === def.termMonths) : p.kind === 'recurring'));
      if (twin) return fail('That package already exists' + (doc.retired.includes(twin[0]) ? ' (hidden). Show it again instead.' : '. Change its price instead.'));
    }
    const key = 'pk-' + randomBytes(5).toString('hex');
    return { doc: { ...doc, added: { ...doc.added, [key]: def } }, keys: [key] };
  }

  return fail('Unknown action.');
}

/** The specs a change puts into Stripe: every pay option of every touched plan, as it WILL be. */
export function specsFor(plansAfter, keys) {
  return keys.flatMap((k) => payOptionsFor(k, plansAfter).map((pay) => checkoutSpec(k, pay, plansAfter)));
}

// ---------------------------------------------------------------- views

/** What the admin tab shows: every training package with its price, its published price and its state. */
export function adminView() {
  const doc = storedDoc();
  const published = Object.fromEntries(catalogView(effectivePlans({ added: doc.added }), []).map((p) => [p.key, p]));
  const plans = catalogView(PLANS, doc.retired).map((p) => ({
    ...p,
    payOptions: p.payOptions.map((o) => ({
      ...o,
      publishedTotalCents: published[p.key]?.payOptions.find((q) => q.pay === o.pay)?.totalCents ?? o.totalCents
    }))
  }));
  return {
    plans,
    options: { programs: PACKAGE_PROGRAMS, frequencies: PACKAGE_FREQUENCIES, maxTermMonths: PACKAGE_MAX_TERM_MONTHS }
  };
}

/**
 * What the public pages may know, for js/packages.js: the figures every data-price hook prints,
 * the markup of every card on /enroll that is not retired, and the tile wording. Nothing here is
 * secret (it is all on the page already); nothing here is ever trusted back, because checkout
 * prices from Stripe by lookup key.
 */
export function publicView() {
  const doc = storedDoc();
  const retired = doc.retired;
  const figures = { range: priceFigure('range'), 'range-to': priceFigure('range-to') };
  const cards = {};
  for (const key of Object.keys(PLANS)) {
    for (const pay of payOptionsFor(key)) figures[key + ':' + pay] = priceFigure(key + ':' + pay);
    if (retired.includes(key) || !['evaluation', 'individual', 'group'].includes(PLANS[key].program)) continue;
    cards[key] = { program: PLANS[key].program, attrs: Object.fromEntries(payOptionsFor(key).map((pay) => [pay, null])), inner: cardInner(key), custom: !!PLANS[key].custom };
    // The lines enroll.js's syncPay reads off a card, as plain strings (the markup helper builds
    // them as attributes; the page sets them with setAttribute, which needs no escaping).
    for (const pay of payOptionsFor(key)) cards[key].attrs[pay] = attrOf(key, pay);
  }
  const plans = catalogView(PLANS, retired);
  return {
    doc,
    retired,
    figures,
    cards,
    tiles: programTiles(PLANS, retired),
    plans,
    // Which keys each program lists, in page order, so the page can put a new card where it belongs.
    order: Object.fromEntries(['evaluation', 'individual', 'group'].map((p) => [p, keysIn(p, PLANS, retired)]))
  };
}

function attrOf(key, pay) {
  const m = new RegExp(' data-' + pay + '="([^"]*)"').exec(cardAttrs(key));
  return m ? m[1].replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&') : null;
}
