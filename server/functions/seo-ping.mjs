// POST /api/seo-ping: the deploy workflow calls this after a publish that changed pages, and
// the function submits the sitemap to Google Search Console as its own service account.
//
// This is the authenticated replacement for Google's sitemap "ping" URL, retired in 2023. It is
// open (the workflow holds no admin session) because all it can ever do is ask Google to read
// a public sitemap that already exists, and it does that at most once every ten minutes
// however often it is called. Every answer is a quiet 200 with a status; a deploy never fails
// on it.
import { json } from './lib/stripe.mjs';
import { searchConsole } from './lib/searchconsole.mjs';
import { getSeo, putSeo, SITE } from './lib/seo-research.mjs';

const EVERY_MS = 10 * 60 * 1000;

export default (request) => handle(request, { now: Date.now() });

export async function handle(request, { now, gsc = searchConsole() } = {}) {
  if (request.method !== 'POST') return json(405, { error: 'method not allowed' });
  const last = await getSeo('ping');
  if (last && now - Date.parse(last.at) < EVERY_MS) return json(200, { submitted: false, reason: 'submitted recently', last: last.at });
  // Record the attempt before making it, so a burst of calls cannot all get past the check.
  await putSeo('ping', { at: new Date(now).toISOString(), ok: null });
  try {
    const property = await gsc.submitSitemap(SITE + '/sitemap.xml');
    await putSeo('ping', { at: new Date(now).toISOString(), ok: true, property });
    return json(200, { submitted: true, property });
  } catch (err) {
    await putSeo('ping', { at: new Date(now).toISOString(), ok: false, error: err.message.slice(0, 200) });
    return json(200, { submitted: false, reason: err.message.slice(0, 200) });
  }
}
