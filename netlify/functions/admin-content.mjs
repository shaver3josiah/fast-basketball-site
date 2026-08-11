// Reads and writes src/data/content.json — every hand-built section's text and photos.
//
// SAVING NEVER COMMITS, the same rule admin-site.mjs already follows for the canvas.
// This file used to commit to GitHub and fire the build hook on EVERY post, which was
// survivable when a handful of fields lived here. It stopped being survivable when the
// whole site became editable: 327 fields now save through this endpoint, and at 15
// credits a deploy against 300 a month, an afternoon of editing text would have taken
// the site offline. Drafts cost nothing; only admin-publish spends a deploy.

import { verifyRequestSession } from './lib/auth.mjs';
import { getFile, putFile, isLocal } from './lib/store.mjs';
import { getDraft, putDraft, usesDraft, publishCount } from './lib/draft.mjs';
import { validateContentShape } from '../../src/lib/content-schema.mjs';

const CONTENT_PATH = 'src/data/content.json';

export default async (request) => {
  if (!verifyRequestSession(request)) {
    return new Response(JSON.stringify({ error: 'not authenticated' }), { status: 401 });
  }

  if (request.method === 'GET') {
    // A draft, when one exists, is what the owner was last working on — prefer it over
    // the published copy or reopening the editor would silently discard their edits.
    const draft = usesDraft ? await getDraft(CONTENT_PATH) : null;
    const content = draft || (await getFile(CONTENT_PATH)).content;
    if (!content) return new Response(JSON.stringify({ error: 'content.json not found in repository' }), { status: 404 });
    // The body stays a bare content.json so every existing caller keeps working; the
    // draft/deploy state rides along in headers for the editor that wants it.
    const deploys = await publishCount();
    return new Response(content, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-FB-Has-Draft': draft ? '1' : '0',
        'X-FB-Local': isLocal ? '1' : '0',
        'X-FB-Deploys-Used': String(deploys.used)
      }
    });
  }

  if (request.method === 'POST') {
    let payload;
    try {
      payload = await request.json();
    } catch (err) {
      return new Response(JSON.stringify({ error: 'invalid request body' }), { status: 400 });
    }

    const errors = validateContentShape(payload);
    if (errors.length > 0) {
      return new Response(JSON.stringify({ error: 'save rejected', details: errors }), { status: 422 });
    }

    payload.version = 1;
    payload.updated = new Date().toISOString();
    if (!Array.isArray(payload.resumeExtra)) payload.resumeExtra = [];

    const body = JSON.stringify(payload, null, 2) + '\n';

    if (usesDraft) {
      await putDraft(CONTENT_PATH, body);
      return new Response(JSON.stringify({ ok: true, updated: payload.updated, draft: true }), {
        status: 200, headers: { 'Content-Type': 'application/json' }
      });
    }

    // Local: straight to disk. There is no deploy to spend and the watcher rebuilds in
    // about five seconds, which is the whole point of the local demo.
    const { sha } = await getFile(CONTENT_PATH);
    await putFile(CONTENT_PATH, body, 'admin: update site content', sha);

    return new Response(JSON.stringify({ ok: true, updated: payload.updated, draft: false }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405 });
};
