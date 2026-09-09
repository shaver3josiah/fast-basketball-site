// Reads and writes src/data/site.json — the canvas document.
//
// SAVING NEVER COMMITS. In production a save writes a draft to Netlify Blobs, which
// costs nothing; only admin-publish commits to GitHub, and only a commit spends one of
// the twenty monthly production deploys the free tier allows. Locally there is no
// deploy to spend, so a save writes the real file and the dev server rebuilds — see
// lib/draft.mjs for why the split is production-only.

import { verifyRequestSession } from './lib/auth.mjs';
import { getFile, putFile, isLocal } from './lib/store.mjs';
import { getDraft, putDraft, usesDraft, publishCount } from './lib/draft.mjs';
import { validateSite } from '../../src/lib/site-schema.mjs';

const SITE_PATH = 'src/data/site.json';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' }
});

export default async (request) => {
  if (!verifyRequestSession(request)) return json({ error: 'not authenticated' }, 401);

  if (request.method === 'GET') {
    // A draft, when one exists, is what the owner was last working on — always prefer
    // it over the published copy, or reopening the editor would silently discard it.
    const draft = usesDraft ? await getDraft(SITE_PATH) : null;
    const body = draft || (await getFile(SITE_PATH)).content;
    if (!body) return json({ error: 'site.json not found' }, 404);
    const deploys = await publishCount();
    return new Response(JSON.stringify({
      site: JSON.parse(body),
      hasDraft: !!draft,
      local: isLocal,
      deploys
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
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
    const body = JSON.stringify(payload, null, 2) + '\n';

    if (usesDraft) {
      await putDraft(SITE_PATH, body);
      return json({ ok: true, updated: payload.updated, draft: true });
    }

    // Local: straight to disk. The watcher rebuilds and the page is live in seconds.
    const { sha } = await getFile(SITE_PATH);
    try {
      await putFile(SITE_PATH, body, 'editor: update canvas', sha);
    } catch (err) {
      if (err.status === 409) {
        return json({ error: 'This page was changed somewhere else since you opened it. Reload before saving, or your changes will overwrite theirs.' }, 409);
      }
      throw err;
    }
    return json({ ok: true, updated: payload.updated, draft: false });
  }

  return json({ error: 'method not allowed' }, 405);
};
