// The media library: browse, upload, and delete "lib.*" photos.
//
// Uploads stage in Netlify Blobs (see lib/draft.mjs) exactly like a canvas save does —
// nothing here ever commits. Only admin-publish.mjs commits, and it flushes every staged
// photo into one deploy instead of one deploy per photo. Locally there is no deploy to
// save, so writes go straight to disk and content.json, same as every other local save.

import { verifyRequestSession } from './lib/auth.mjs';
import { getFile, putFile, putBinary, isLocal } from './lib/store.mjs';
import { getDraft, getMediaIndex, putMediaIndex, getMediaBlob, putMediaBlob, deleteMediaBlob } from './lib/draft.mjs';
import { sniffMime, readDimensions } from '../../src/lib/image-dimensions.mjs';
import { validateContentShape } from '../../src/lib/content-schema.mjs';
import { libraryKeyFor, imagePathFor, findKeyUsage } from './lib/media-merge.mjs';
import { randomUUID } from 'node:crypto';

const CONTENT_PATH = 'src/data/content.json';
const SITE_PATH = 'src/data/site.json';
const MAX_BYTES = 8 * 1024 * 1024;

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' }
});

function rawUrl(id) {
  return '/.netlify/functions/admin-media?raw=' + id;
}

// Both published lib.* entries and staged ones sort by the timestamp already embedded
// in their key, so listing "newest first" needs no extra field on either side.
function keyTimestamp(key) {
  const match = /-(\d+)$/.exec(key);
  return match ? Number(match[1]) : 0;
}

async function handleGet(request) {
  const url = new URL(request.url);
  const rawId = url.searchParams.get('raw');

  if (rawId) {
    const index = await getMediaIndex();
    const record = index.find((r) => r.id === rawId && !r.deleted);
    const base64 = record ? await getMediaBlob(rawId) : null;
    if (!record || !base64) return json({ error: 'not found' }, 404);
    return new Response(Buffer.from(base64, 'base64'), {
      status: 200,
      headers: { 'Content-Type': record.mime, 'Cache-Control': 'no-store' }
    });
  }

  const { content } = await getFile(CONTENT_PATH);
  const contentData = content ? JSON.parse(content) : { images: {} };
  const index = await getMediaIndex();
  const deletedKeys = new Set(index.filter((r) => r.deleted).map((r) => r.key));
  // A pending alt change is not a photo of its own — it is a correction to one already
  // listed, so it shows up as that photo's new wording rather than as a second entry.
  const pendingAlt = new Map(index.filter((r) => r.altUpdate !== undefined).map((r) => [r.key, r.altUpdate]));

  const items = [];
  for (const [key, image] of Object.entries(contentData.images || {})) {
    if (!key.startsWith('lib.') || deletedKeys.has(key)) continue;
    const alt = pendingAlt.has(key) ? pendingAlt.get(key) : image.alt;
    items.push({ key, src: image.src, alt, width: image.width, height: image.height, staged: false });
  }
  for (const record of index) {
    if (record.deleted || record.altUpdate !== undefined || !record.key.startsWith('lib.')) continue;
    items.push({ key: record.key, src: rawUrl(record.id), alt: record.alt, width: record.width, height: record.height, staged: true });
  }
  items.sort((a, b) => keyTimestamp(b.key) - keyTimestamp(a.key));

  return json({ items, staged: index.length, local: isLocal });
}

async function handlePost(request) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'invalid request body' }, 400);
  }

  const { filename, alt, dataUrl } = payload;

  if (!alt || alt.trim() === '') {
    return json({ error: 'alt text is required so every photo works for screen readers and search' }, 422);
  }
  if (!dataUrl || !dataUrl.startsWith('data:')) {
    return json({ error: 'no photo data received' }, 422);
  }
  const match = /^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return json({ error: 'that file is not a readable image' }, 422);

  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > MAX_BYTES) {
    return json({ error: 'that photo is too large. Keep library uploads under 8MB.' }, 422);
  }

  const mime = sniffMime(buffer);
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) {
    return json({ error: 'use a JPEG, PNG, or WebP photo.' }, 422);
  }
  const dims = readDimensions(buffer, mime);
  if (!dims) return json({ error: 'could not read that photo. Try a different file.' }, 422);

  const timestamp = Date.now();
  const key = libraryKeyFor(filename, timestamp);
  const record = {
    id: randomUUID(), key, filename: filename || null, alt: alt.trim(), mime,
    width: dims.width, height: dims.height, bytes: buffer.length, uploadedAt: timestamp
  };

  if (isLocal) {
    const { path, src } = imagePathFor(record);
    await putBinary(path, buffer, 'admin: add library photo');
    const { content, sha } = await getFile(CONTENT_PATH);
    const contentData = content ? JSON.parse(content) : { text: {}, images: {} };
    contentData.images[key] = { src, alt: record.alt, caption: null, source: null, width: dims.width, height: dims.height, library: true };
    contentData.version = 1;
    contentData.updated = new Date().toISOString();
    const errors = validateContentShape(contentData);
    if (errors.length > 0) return json({ error: 'save rejected', details: errors }, 422);
    await putFile(CONTENT_PATH, JSON.stringify(contentData, null, 2) + '\n', 'admin: add library photo', sha);
    return json({ ok: true, item: { key, src, alt: record.alt, width: dims.width, height: dims.height, staged: false } });
  }

  // Blob first, index second — a crash between the two leaves an orphan blob rather
  // than an index entry pointing at nothing.
  await putMediaBlob(record.id, match[2]);
  const index = await getMediaIndex();
  index.push(record);
  await putMediaIndex(index);

  return json({ ok: true, item: { key, src: rawUrl(record.id), alt: record.alt, width: dims.width, height: dims.height, staged: true } });
}

async function handleDelete(request) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'invalid request body' }, 400);
  }
  const { key } = payload;
  if (!key) return json({ error: 'key is required' }, 422);

  // An unpublished upload just gets dropped — nothing has referenced it anywhere yet.
  const index = await getMediaIndex();
  const stagedAdd = index.find((r) => r.key === key && !r.deleted && r.altUpdate === undefined);
  if (stagedAdd) {
    await deleteMediaBlob(stagedAdd.id);
    await putMediaIndex(index.filter((r) => r.id !== stagedAdd.id));
    return json({ ok: true });
  }

  const { content, sha } = await getFile(CONTENT_PATH);
  const contentData = content ? JSON.parse(content) : { images: {} };
  if (!contentData.images || !contentData.images[key]) return json({ error: 'no photo found for that key' }, 404);

  // A draft in progress is the freshest picture of what the canvas actually uses —
  // preferring it over the published copy is the same rule admin-site.mjs applies.
  const draftBody = await getDraft(SITE_PATH);
  const siteBody = draftBody || (await getFile(SITE_PATH)).content;
  const siteData = siteBody ? JSON.parse(siteBody) : { pages: [] };

  const usedBy = findKeyUsage(key, siteData, contentData);
  if (usedBy.length > 0) {
    return json({ error: 'That photo is still in use: ' + usedBy.join(', ') + '. Remove it there first.', usedBy }, 409);
  }

  if (isLocal) {
    delete contentData.images[key];
    contentData.updated = new Date().toISOString();
    await putFile(CONTENT_PATH, JSON.stringify(contentData, null, 2) + '\n', 'admin: remove library photo', sha);
    return json({ ok: true });
  }

  await putMediaIndex([...index, { id: randomUUID(), key, deleted: true }]);
  return json({ ok: true });
}

// Alt text is the only thing here that can change without a new upload. It routes through
// staging like every other write in this file: admin-content.mjs would commit it and fire
// the build hook, which would mean a deploy every time the owner fixes a word.
async function handlePut(request) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'invalid request body' }, 400);
  }
  const { key, alt } = payload;
  if (!key) return json({ error: 'key is required' }, 422);
  if (!alt || alt.trim() === '') {
    return json({ error: 'alt text is required so every photo works for screen readers and search' }, 422);
  }
  const next = alt.trim();

  // Still unpublished: edit the staged record in place so publishing writes it once,
  // rather than writing the photo and then correcting it.
  const index = await getMediaIndex();
  const staged = index.find((r) => r.key === key && !r.deleted && r.altUpdate === undefined);
  if (staged) {
    staged.alt = next;
    await putMediaIndex(index);
    return json({ ok: true, staged: true });
  }

  const { content, sha } = await getFile(CONTENT_PATH);
  const contentData = content ? JSON.parse(content) : { images: {} };
  if (!contentData.images || !contentData.images[key]) return json({ error: 'no photo found for that key' }, 404);

  if (isLocal) {
    contentData.images[key].alt = next;
    contentData.updated = new Date().toISOString();
    await putFile(CONTENT_PATH, JSON.stringify(contentData, null, 2) + '\n', 'admin: update photo alt text', sha);
    return json({ ok: true, staged: false });
  }

  // One pending alt change per key, so repeated edits don't pile up in the index.
  const withoutPrior = index.filter((r) => !(r.key === key && r.altUpdate !== undefined));
  await putMediaIndex([...withoutPrior, { id: randomUUID(), key, altUpdate: next }]);
  return json({ ok: true, staged: true });
}

export default async (request) => {
  if (!verifyRequestSession(request)) return json({ error: 'not authenticated' }, 401);

  if (request.method === 'GET') return handleGet(request);
  if (request.method === 'POST') return handlePost(request);
  if (request.method === 'PUT') return handlePut(request);
  if (request.method === 'DELETE') return handleDelete(request);
  return json({ error: 'method not allowed' }, 405);
};
