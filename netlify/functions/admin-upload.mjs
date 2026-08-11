import { verifyRequestSession } from './lib/auth.mjs';
import { getFile, putFile, putBinary, isLocal } from './lib/store.mjs';
import { getMediaIndex, putMediaIndex, putMediaBlob, getDraft, putDraft, usesDraft } from './lib/draft.mjs';
import { readDimensions, sniffMime } from '../../src/lib/image-dimensions.mjs';
import { IMAGE_KEYS, IMAGE_ASPECT_RULES, IMAGE_LABELS } from '../../src/lib/content-schema.mjs';
import { extFor, imagePathFor } from './lib/media-merge.mjs';
import { randomUUID } from 'node:crypto';

const CONTENT_PATH = 'src/data/content.json';
const MAX_BYTES = 15 * 1024 * 1024;

export default async (request) => {
  if (!verifyRequestSession(request)) {
    return new Response(JSON.stringify({ error: 'not authenticated' }), { status: 401 });
  }
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405 });
  }

  let payload;
  try {
    payload = await request.json();
  } catch (err) {
    return new Response(JSON.stringify({ error: 'invalid request body' }), { status: 400 });
  }

  const { key, alt, caption, source, dataUrl, isNewResumeCard } = payload;

  if (!key || (!IMAGE_KEYS.includes(key) && !isNewResumeCard)) {
    return new Response(JSON.stringify({ error: 'unknown image key "' + key + '"' }), { status: 422 });
  }
  if (!alt || alt.trim() === '') {
    return new Response(JSON.stringify({ error: 'alt text is required so every photo works for screen readers and search' }), { status: 422 });
  }
  if (!dataUrl || !dataUrl.startsWith('data:')) {
    return new Response(JSON.stringify({ error: 'no photo data received' }), { status: 422 });
  }

  const match = /^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) {
    return new Response(JSON.stringify({ error: 'that file is not a readable image' }), { status: 422 });
  }
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > MAX_BYTES) {
    return new Response(JSON.stringify({ error: 'that photo is too large. Keep uploads under 15MB.' }), { status: 422 });
  }

  const mime = sniffMime(buffer) || match[1];
  const ext = extFor(mime);
  if (!ext) {
    return new Response(JSON.stringify({ error: 'use a JPEG, PNG, or WebP photo.' }), { status: 422 });
  }

  const dims = readDimensions(buffer, mime);
  if (!dims) {
    return new Response(JSON.stringify({ error: 'could not read that photo. Try a different file.' }), { status: 422 });
  }

  const rules = IMAGE_ASPECT_RULES[key] || { ratio: 0.8, tolerance: 0.35 };
  const actualRatio = dims.width / dims.height;
  const diff = Math.abs(actualRatio - rules.ratio) / rules.ratio;
  if (diff > rules.tolerance) {
    const shape = actualRatio > rules.ratio ? 'wider' : 'taller';
    return new Response(JSON.stringify({
      error: 'This photo is much ' + shape + ' than ' + (IMAGE_LABELS[key] || 'this spot') + ' needs and will look stretched or cropped oddly. Try a photo closer to a ' + (rules.ratio >= 1 ? 'landscape' : 'portrait') + ' crop, or crop it before uploading.'
    }), { status: 422 });
  }

  const timestamp = Date.now();

  // Resume-extra cards live in contentData.resumeExtra, an array outside content.images
  // entirely, and the media staging model has nowhere to put them — so the bytes are
  // still committed here rather than staged.
  //
  // The JSON is not. content.json now has a draft layer, and committing the published
  // copy from here would be overwritten by that draft at the next publish, silently
  // losing the card the owner just added. So the card is appended to the DRAFT when one
  // is in play, and publish flushes it with everything else.
  if (!IMAGE_KEYS.includes(key)) {
    const filename = key.replace('.', '-') + '-' + timestamp + '.' + ext;
    const imagePath = 'src/images/uploads/' + filename;
    await putBinary(imagePath, buffer, 'admin: upload photo for ' + key);

    const existingDraft = usesDraft ? await getDraft(CONTENT_PATH) : null;
    const { content, sha } = await getFile(CONTENT_PATH);
    const contentData = JSON.parse(existingDraft || content);
    const imageRecord = {
      src: '/images/' + filename,
      alt: alt.trim(),
      caption: caption && caption.trim() ? caption.trim() : null,
      source: source && source.trim() ? source.trim() : null,
      width: dims.width,
      height: dims.height
    };
    if (!Array.isArray(contentData.resumeExtra)) contentData.resumeExtra = [];
    contentData.resumeExtra.push({ id: 'extra-' + timestamp, ...imageRecord });
    contentData.version = 1;
    contentData.updated = new Date().toISOString();
    const body = JSON.stringify(contentData, null, 2) + '\n';
    if (usesDraft) {
      await putDraft(CONTENT_PATH, body);
    } else {
      await putFile(CONTENT_PATH, body, 'admin: attach uploaded photo to content.json', sha);
    }

    return new Response(JSON.stringify({ ok: true, image: imageRecord, draft: !!usesDraft }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // One of the 6 fixed slots: stage it. Publish flushes every staged photo into one
  // commit, so uploading here never spends a deploy on its own.
  const record = {
    id: randomUUID(), key, filename: null, alt: alt.trim(), mime,
    width: dims.width, height: dims.height, bytes: buffer.length, uploadedAt: timestamp,
    caption: caption && caption.trim() ? caption.trim() : null,
    source: source && source.trim() ? source.trim() : null
  };

  if (isLocal) {
    // No deploy to save locally — write straight through like every other local save.
    const { path, src } = imagePathFor(record);
    await putBinary(path, buffer, 'admin: upload photo for ' + key);
    const { content, sha } = await getFile(CONTENT_PATH);
    const contentData = JSON.parse(content);
    contentData.images[key] = { src, alt: record.alt, caption: record.caption, source: record.source, width: dims.width, height: dims.height };
    contentData.version = 1;
    contentData.updated = new Date().toISOString();
    await putFile(CONTENT_PATH, JSON.stringify(contentData, null, 2) + '\n', 'admin: attach uploaded photo to content.json', sha);
    return new Response(JSON.stringify({ ok: true, image: contentData.images[key] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  await putMediaBlob(record.id, match[2]);
  const index = await getMediaIndex();
  index.push(record);
  await putMediaIndex(index);

  const image = {
    src: '/.netlify/functions/admin-media?raw=' + record.id,
    alt: record.alt, caption: record.caption, source: record.source,
    width: dims.width, height: dims.height
  };
  return new Response(JSON.stringify({ ok: true, image, staged: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
};
