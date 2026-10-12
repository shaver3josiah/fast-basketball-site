// GET /api/packages: what the public pages need to show the catalog as it is NOW, which can be
// newer than the last build. js/packages.js reads it on / and /enroll and patches the page; the
// stripe scripts read `doc` so they sync the catalog the site really sells.
//
// Public on purpose and read-only. Everything in it is already printed on the page; nothing it
// says is trusted back, because checkout prices from Stripe by lookup key, never from the browser.
import { json } from './lib/stripe.mjs';
import { refreshPackages, publicView } from './lib/packages.mjs';

export default async (request) => {
  if (request.method !== 'GET') return json(405, { error: 'method not allowed' });
  await refreshPackages();
  const res = json(200, publicView());
  // Ten seconds at the CDN: a change is on the pages almost at once, and a page-view spike does
  // not become a function-invocation spike.
  res.headers.set('Cache-Control', 'public, max-age=10, s-maxage=10');
  return res;
};
