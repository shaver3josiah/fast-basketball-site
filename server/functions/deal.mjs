// GET /api/deal?id=<id>: the public view of one deal, for /enroll?deal=<id>. Read-only and
// holding nothing a parent could not see on the page anyway; the id is the only key, and it is
// random. Checkout re-reads the deal itself, so nothing this returns is ever trusted back.
import { getDeal, dealProblem, publicDeal } from './lib/deals.mjs';
import { json } from './lib/stripe.mjs';

export default async (request) => {
  if (request.method !== 'GET') return json(405, { error: 'method not allowed' });
  const id = new URL(request.url).searchParams.get('id');
  const deal = await getDeal(id);
  const problem = dealProblem(deal);
  if (problem) return json(deal ? 410 : 404, { error: problem });
  return json(200, { deal: publicDeal(deal) });
};
