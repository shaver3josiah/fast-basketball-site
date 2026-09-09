// Unpublished edits, and a count of the deploys we have caused.
//
// WHY THIS EXISTS: Netlify billed in credits — 15 per production deploy, 300/month on the
// free tier — and when they ran out every site was paused. An editor that committed on save
// would have taken the site offline on the owner's twentieth edit of the month.
//
// THAT CAP IS GONE. Firebase Hosting deploys are free and unmetered (September 2026), so
// nothing here can take the site down any more. The draft layer stays anyway, for the two
// reasons that were always true underneath the billing one: every commit is a build and a
// deploy that takes a minute to land, and a git history with one commit per keystroke is a
// history nobody can read. Save is cheap and instant; Publish is deliberate.
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

// Informational since the move to Firebase Hosting, where deploys cost nothing: the panel
// reports the count and warns, and has never blocked a publish on it.
export const DEPLOYS_PER_MONTH = 20;

export const usesDraft = !isLocal;

async function store() {
  const { getStore } = await import('./blobs.mjs');
  // Netlify Blobs defaulted to eventual consistency with up to 60s of edge propagation,
  // so this call had to ask for 'strong' by name or a save-then-reload could hand back the
  // PREVIOUS draft and the owner would watch their work disappear. Firestore is strongly
  // consistent by default, so the guarantee is kept without asking for it.
  return getStore({ name: STORE });
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

// The photo bytes themselves go to Cloud Storage, not Firestore: admin-media.mjs accepts
// 8MB and hands them here base64 encoded, and a Firestore document stops at 1MB. The index
// above is small JSON and stays in Firestore beside the site draft. Storage has to be
// enabled once in the Firebase console; until it is, these throw, the upload reports a
// failure, and nothing else on the site is affected.
export async function getMediaBlob(id) {
  if (isLocal) return null;
  const { getMediaObject } = await import('./blobs.mjs');
  return getMediaObject(id);
}

export async function putMediaBlob(id, base64) {
  if (isLocal) return;
  const { putMediaObject } = await import('./blobs.mjs');
  await putMediaObject(id, base64);
}

export async function deleteMediaBlob(id) {
  if (isLocal) return;
  const { deleteMediaObject } = await import('./blobs.mjs');
  await deleteMediaObject(id);
}

// Only after the commit succeeds: every staged object is the owner's only copy of that
// photo until then, same rule as the site draft above.
export async function clearStagedMedia(index) {
  if (isLocal) return;
  const { deleteMediaObject } = await import('./blobs.mjs');
  await Promise.all((index || []).map((r) => deleteMediaObject(r.id)));
  const s = await store();
  await s.delete(MEDIA_INDEX_KEY);
}
