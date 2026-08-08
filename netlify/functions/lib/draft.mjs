// Unpublished edits, and a count of the deploys we have caused.
//
// WHY THIS EXISTS: Netlify bills in credits — 15 per production deploy, 300/month on
// the free tier — and when they run out "all of your web projects are paused and
// visitors will find a Site not available page". Every commit to GitHub triggers one
// deploy. So an editor that commits on save takes the site offline on the owner's
// twentieth edit of the month.
//
// WHY IT IS PRODUCTION-ONLY: locally there is no deploy and no cost. A save writes
// straight to src/data/site.json and the dev server rebuilds in about five seconds,
// which is the whole point of the local demo. Putting a draft layer in front of that
// would add a publish step to a loop that has nothing to publish to. So local mode
// keeps writing the real file, and `usesDraft` is false there.
//
// Drafts live in Netlify Blobs, which costs nothing per write and is already a
// dependency. Only Publish commits.

import { isLocal } from './store.mjs';

const STORE = 'editor-drafts';
const PUBLISH_LOG = '__publishes';

// 15 credits a deploy against 300 a month. The cap is Netlify's, not ours.
export const DEPLOYS_PER_MONTH = 20;

export const usesDraft = !isLocal;

async function store() {
  const { getStore } = await import('@netlify/blobs');
  // Strong consistency is not optional here: the default is eventual with up to 60s of
  // edge propagation, so a save-then-reload could hand back the PREVIOUS draft and the
  // owner would watch their work disappear.
  return getStore({ name: STORE, consistency: 'strong' });
}

export async function getDraft(path) {
  if (isLocal) return null;
  const s = await store();
  return s.get(path, { type: 'text' });
}

export async function putDraft(path, content) {
  if (isLocal) return;
  const s = await store();
  await s.set(path, content);
}

export async function clearDraft(path) {
  if (isLocal) return;
  const s = await store();
  await s.delete(path);
}

// Our own tally of deploys we caused, this calendar month. It cannot see deploys
// triggered by a git push or by Netlify's UI, so it is a floor rather than a truth —
// which is why the editor reports it as "publishes this month" and warns rather than
// blocking. A wrong block would be worse than a warning: it would stop the owner
// fixing a typo on a live page.
export async function publishCount() {
  if (isLocal) return { used: 0, limit: DEPLOYS_PER_MONTH, local: true };
  const s = await store();
  const log = (await s.get(PUBLISH_LOG, { type: 'json' })) || [];
  const month = new Date().toISOString().slice(0, 7);
  return { used: log.filter((t) => String(t).startsWith(month)).length, limit: DEPLOYS_PER_MONTH, local: false };
}

export async function recordPublish() {
  if (isLocal) return;
  const s = await store();
  const log = (await s.get(PUBLISH_LOG, { type: 'json' })) || [];
  log.push(new Date().toISOString());
  // Keep the tail bounded; nothing older than the current month is ever read.
  await s.setJSON(PUBLISH_LOG, log.slice(-100));
}

// Staged photo uploads. Same store as the site draft, same reason: a write here costs
// nothing, and only Publish turns it into a commit. Each guards isLocal itself so a
// caller never needs to branch on it before asking — locally there is nothing staged,
// there never was, and there never will be.
const MEDIA_INDEX_KEY = 'media/__index';

export async function getMediaIndex() {
  if (isLocal) return [];
  const s = await store();
  return (await s.get(MEDIA_INDEX_KEY, { type: 'json' })) || [];
}

export async function putMediaIndex(index) {
  if (isLocal) return;
  const s = await store();
  await s.setJSON(MEDIA_INDEX_KEY, index);
}

export async function getMediaBlob(id) {
  if (isLocal) return null;
  const s = await store();
  return s.get('media/' + id, { type: 'text' });
}

export async function putMediaBlob(id, base64) {
  if (isLocal) return;
  const s = await store();
  await s.set('media/' + id, base64);
}

export async function deleteMediaBlob(id) {
  if (isLocal) return;
  const s = await store();
  await s.delete('media/' + id);
}

// Only after the commit succeeds: every blob is the owner's only copy of that photo
// until then, same rule as the site draft above.
export async function clearStagedMedia(index) {
  if (isLocal) return;
  const s = await store();
  await Promise.all((index || []).map((r) => s.delete('media/' + r.id)));
  await s.delete(MEDIA_INDEX_KEY);
}
