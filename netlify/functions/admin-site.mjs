// Reads and writes src/data/site.json — the canvas document.
//
// NOTE ON WHAT IS DELIBERATELY MISSING: there is no publish path here, and that is
// not an oversight. Every commit to GitHub triggers a Netlify production deploy, and
// Netlify's free tier pauses the site after twenty of them in a month. Until the
// save/publish split exists, saving is a local write and nothing else. The guard has
// to be built before the thing it guards, so this function refuses to run at all
// outside local mode rather than relying on nobody making a mistake later.

import { verifyRequestSession } from './lib/auth.mjs';
import { getFile, putFile, isLocal } from './lib/store.mjs';
import { validateSite } from '../../src/lib/site-schema.mjs';

const SITE_PATH = 'src/data/site.json';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' }
});

export default async (request) => {
  if (!verifyRequestSession(request)) return json({ error: 'not authenticated' }, 401);

  if (!isLocal) {
    return json({
      error: 'The canvas editor only runs locally for now. Saving here would commit to ' +
        'GitHub, and every commit spends one of twenty monthly Netlify deploys. The ' +
        'draft-and-publish split has to land before this is safe online.'
    }, 503);
  }

  if (request.method === 'GET') {
    const { content } = await getFile(SITE_PATH);
    if (!content) return json({ error: 'site.json not found' }, 404);
    return new Response(content, { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  if (request.method === 'POST') {
    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: 'invalid request body' }, 400);
    }

    const errors = validateSite(payload);
    if (errors.length > 0) return json({ error: 'save rejected', details: errors }, 422);

    payload.updated = new Date().toISOString();

    // Same optimistic-concurrency contract the content endpoint uses: read the current
    // hash, send it back with the write, and let the store reject a stale one. Two
    // editor tabs is a real way to lose an afternoon of work.
    const { sha } = await getFile(SITE_PATH);
    try {
      await putFile(SITE_PATH, JSON.stringify(payload, null, 2) + '\n', 'editor: update canvas', sha);
    } catch (err) {
      if (err.status === 409) {
        return json({ error: 'This page was changed somewhere else since you opened it. Reload before saving, or your changes will overwrite theirs.' }, 409);
      }
      throw err;
    }

    return json({ ok: true, updated: payload.updated });
  }

  return json({ error: 'method not allowed' }, 405);
};
