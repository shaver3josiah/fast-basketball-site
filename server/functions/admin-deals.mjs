// /api/admin-deals: the "Cut a Deal" tab. Session-gated.
//   GET                          -> every deal, newest first, with its state and link
//   POST {action:'create', ...}  -> validate, create the Stripe product and prices, store
//   POST {action:'close', id}    -> stop the link working and archive its Stripe prices
//
// A deal is live the moment it is created. There is no draft and no Publish: the link reads the
// deal store directly, which is the whole point of doing this outside content.json.
import { verifyRequestSession } from './lib/auth.mjs';
import { stripeClient, json } from './lib/stripe.mjs';
import { validateDeal, dealState, createDealStripe, closeDealStripe, getDeal, putDeal, listDeals } from './lib/deals.mjs';
import { SITE_URL } from '../../src/lib/site-config.mjs';

const linkFor = (id) => SITE_URL.replace(/\/$/, '') + '/enroll?deal=' + encodeURIComponent(id);
const view = (d) => ({ ...d, state: dealState(d), link: linkFor(d.id) });

export default (request) => handle(request, stripeClient());

// The Stripe client is a parameter so the tests can hand in a fake and check every call.
export async function handle(request, stripe) {
  if (!verifyRequestSession(request)) return json(401, { error: 'not authenticated' });

  if (request.method === 'GET') {
    const deals = (await listDeals()).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return json(200, { deals: deals.map(view), stripe: !!stripe });
  }
  if (request.method !== 'POST') return json(405, { error: 'method not allowed' });

  let body;
  try { body = await request.json(); } catch { body = null; }
  if (!body || typeof body !== 'object') return json(400, { error: 'invalid request body' });

  if (body.action === 'close') {
    const deal = await getDeal(body.id);
    if (!deal) return json(404, { error: 'No deal with that id.' });
    if (deal.closedAt) return json(200, { deal: view(deal) });
    deal.closedAt = new Date().toISOString();
    // The store is what checkout reads, so it is written first: the link is dead from here on
    // even if Stripe is unreachable. Re-read so a payment recorded a moment ago is not overwritten.
    Object.assign(deal, { ...(await getDeal(deal.id)), closedAt: deal.closedAt });
    await putDeal(deal);
    if (stripe) {
      try { await closeDealStripe(stripe, deal); } catch (err) { console.error('[deals] archive ' + deal.id + ': ' + err.message); }
    }
    return json(200, { deal: view(deal) });
  }

  if (body.action !== 'create') return json(400, { error: 'unknown action' });
  const { errors, deal } = validateDeal(body);
  const keys = Object.keys(errors);
  if (keys.length) return json(422, { error: errors[keys[0]], errors });

  // No key only ever happens on a laptop. The deal still works as a registration form there:
  // checkout saves it and answers 503, which is what every plan does without Stripe.
  let warning = null;
  if (stripe) {
    try {
      Object.assign(deal, await createDealStripe(stripe, deal));
    } catch (err) {
      console.error('[deals] stripe create failed: ' + err.message);
      return json(502, { error: 'Stripe did not accept it: ' + err.message });
    }
  } else {
    warning = 'Stripe is not connected here, so this link saves the registration but cannot take payment.';
  }
  await putDeal(deal);
  return json(200, { deal: view(deal), warning });
}
