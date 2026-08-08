// The only thing in this codebase that spends a Netlify deploy.
//
// Takes whatever the owner has saved as a draft and commits it to GitHub, which is what
// triggers the production build. Everything else — every save, every keystroke, every
// drag — costs nothing.

import { verifyRequestSession } from './lib/auth.mjs';
import { getFile, putFile, isLocal } from './lib/store.mjs';
import { getDraft, clearDraft, usesDraft, publishCount, recordPublish } from './lib/draft.mjs';
import { validateSite } from '../../src/lib/site-schema.mjs';

const SITE_PATH = 'src/data/site.json';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' }
});

export default async (request) => {
  if (!verifyRequestSession(request)) return json({ error: 'not authenticated' }, 401);
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  if (!usesDraft) {
    // Nothing to do: a local save already wrote the real file and the site rebuilt.
    return json({ ok: true, local: true, message: 'Local edits are already live — publishing only applies once the site is hosted.' });
  }

  const draft = await getDraft(SITE_PATH);
  if (!draft) return json({ error: 'Nothing to publish. Save a change first.' }, 409);

  // Validate again at the boundary. The save path already checked, but this is the one
  // request that reaches the public site, and a draft can outlive a schema change.
  let payload;
  try {
    payload = JSON.parse(draft);
  } catch {
    return json({ error: 'The saved draft is not readable. Reload the editor and save again.' }, 422);
  }
  const errors = validateSite(payload);
  if (errors.length > 0) return json({ error: 'publish rejected', details: errors }, 422);

  const { sha } = await getFile(SITE_PATH);
  try {
    await putFile(SITE_PATH, draft, 'editor: publish canvas', sha);
  } catch (err) {
    if (err.status === 409 || /409/.test(String(err.message))) {
      return json({ error: 'Someone else published since you started. Reload the editor, check your changes are still what you want, and publish again.' }, 409);
    }
    throw err;
  }

  // Only after the commit succeeded: the draft is the owner's only copy until then.
  await clearDraft(SITE_PATH);
  await recordPublish();

  const deploys = await publishCount();
  return json({
    ok: true,
    deploys,
    message: 'Published. The site rebuilds in about a minute.'
  });
};
