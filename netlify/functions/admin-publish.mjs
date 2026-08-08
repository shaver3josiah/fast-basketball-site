// The only thing in this codebase that spends a Netlify deploy.
//
// Takes whatever the owner has saved as a draft — a canvas edit, staged photo uploads,
// or both — and commits it to GitHub in a single commit, which is what triggers the
// production build. Everything else — every save, every keystroke, every drag, every
// upload — costs nothing until this runs.

import { verifyRequestSession } from './lib/auth.mjs';
import { getFile, putFiles } from './lib/store.mjs';
import { getDraft, clearDraft, usesDraft, publishCount, recordPublish, getMediaIndex, getMediaBlob, clearStagedMedia } from './lib/draft.mjs';
import { validateSite } from '../../src/lib/site-schema.mjs';
import { validateContentShape } from '../../src/lib/content-schema.mjs';
import { mergeStagedMedia, imagePathFor } from './lib/media-merge.mjs';

const SITE_PATH = 'src/data/site.json';
const CONTENT_PATH = 'src/data/content.json';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' }
});

export default async (request) => {
  if (!verifyRequestSession(request)) return json({ error: 'not authenticated' }, 401);
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  if (!usesDraft) {
    // Nothing to do: a local save already wrote the real files and the site rebuilt.
    return json({ ok: true, local: true, message: 'Local edits are already live — publishing only applies once the site is hosted.' });
  }

  const draft = await getDraft(SITE_PATH);
  const mediaIndex = await getMediaIndex();
  if (!draft && mediaIndex.length === 0) {
    return json({ error: 'Nothing to publish. Save a change or upload a photo first.' }, 409);
  }

  const files = [];
  const messageParts = [];

  if (draft) {
    // Validate again at the boundary. The save path already checked, but this is the
    // one request that reaches the public site, and a draft can outlive a schema change.
    let sitePayload;
    try {
      sitePayload = JSON.parse(draft);
    } catch {
      return json({ error: 'The saved draft is not readable. Reload the editor and save again.' }, 422);
    }
    const siteErrors = validateSite(sitePayload);
    if (siteErrors.length > 0) return json({ error: 'publish rejected', details: siteErrors }, 422);
    files.push({ path: SITE_PATH, content: draft });
    messageParts.push('canvas');
  }

  if (mediaIndex.length > 0) {
    const { content } = await getFile(CONTENT_PATH);
    const contentData = JSON.parse(content);
    const { content: merged } = mergeStagedMedia(contentData, mediaIndex);
    merged.version = 1;
    merged.updated = new Date().toISOString();

    const contentErrors = validateContentShape(merged);
    if (contentErrors.length > 0) return json({ error: 'publish rejected', details: contentErrors }, 422);

    files.push({ path: CONTENT_PATH, content: JSON.stringify(merged, null, 2) + '\n' });

    let photoCount = 0;
    for (const record of mediaIndex) {
      // A deletion has no bytes to write, and an alt correction changes only the JSON
      // above — neither carries a blob.
      if (record.deleted || record.altUpdate !== undefined) continue;
      const base64 = await getMediaBlob(record.id);
      if (!base64) continue; // should never happen — blob and index entry are written together
      files.push({ path: imagePathFor(record).path, content: Buffer.from(base64, 'base64') });
      photoCount += 1;
    }
    messageParts.push(photoCount > 0 ? photoCount + ' photo' + (photoCount === 1 ? '' : 's') : 'photo details');
  }

  try {
    await putFiles(files, 'editor: publish ' + messageParts.join(' + '));
  } catch (err) {
    if (err.status === 409 || /409/.test(String(err.message))) {
      return json({ error: 'Someone else published since you started. Reload the editor, check your changes are still what you want, and publish again.' }, 409);
    }
    throw err;
  }

  // Only after the commit succeeded: the draft and the staged blobs are the owner's
  // only copy until then.
  if (draft) await clearDraft(SITE_PATH);
  if (mediaIndex.length > 0) await clearStagedMedia(mediaIndex);
  await recordPublish();

  const deploys = await publishCount();
  return json({
    ok: true,
    deploys,
    message: 'Published. The site rebuilds in about a minute.'
  });
};
