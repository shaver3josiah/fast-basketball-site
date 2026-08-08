// Pure logic for the media library — no I/O, no Blobs, no fetch, no fs.
//
// Staging (netlify/functions/lib/draft.mjs) only runs in production, so anything that
// touches a blob store can never be exercised by the local dev server. Keeping the
// actual merge/usage/slug rules in here, taking and returning plain data, is what makes
// them testable at all — see media-merge.test.mjs.

import { IMAGE_KEYS } from '../../../src/lib/content-schema.mjs';

const EXT_BY_MIME = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export function extFor(mime) {
  return EXT_BY_MIME[mime] || null;
}

// A library key already carries its own slug + timestamp (see libraryKeyFor), so the
// filename falls straight out of it. A fixed-slot key (e.g. "hero.nets") carries
// neither, so it needs the record's own upload timestamp to stay unique across re-uploads
// to the same slot — matching the filename shape admin-upload.mjs has always produced.
export function imagePathFor(record) {
  const ext = extFor(record.mime);
  const base = record.key.startsWith('lib.')
    ? record.key.slice(4)
    : record.key.replace(/\./g, '-') + '-' + record.uploadedAt;
  const filename = base + '.' + ext;
  return { filename, path: 'src/images/uploads/' + filename, src: '/images/' + filename };
}

// Key: "lib." + slug of the original filename + "-" + Date.now(). Lowercase,
// [a-z0-9-], capped at 40 chars so a verbose camera filename can't produce an
// unwieldy path on disk.
export function libraryKeyFor(filename, timestamp) {
  const base = String(filename || '').replace(/\.[^.]+$/, '');
  let slug = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  slug = slug.slice(0, 40).replace(/-+$/g, '');
  if (!slug) slug = 'photo';
  return 'lib.' + slug + '-' + timestamp;
}

// Folds staged records into content.json.images: additions land under their key,
// deletions remove an already-published key. Returns a new object so a caller that
// still needs the pre-merge content (e.g. to compute a deleted key's old file path)
// isn't handed a mutated copy of its own input.
export function mergeStagedMedia(contentData, stagedIndex) {
  const content = { ...contentData, images: { ...(contentData?.images || {}) } };
  const addedKeys = [];
  const removedKeys = [];
  const updatedKeys = [];

  for (const record of stagedIndex || []) {
    if (record.deleted) {
      delete content.images[record.key];
      removedKeys.push(record.key);
      continue;
    }
    // Alt text is the one field worth changing without re-uploading the photo, and it is
    // the field a screen reader depends on — so it stages like everything else rather
    // than taking the committing path and spending a deploy on a typo fix.
    if (record.altUpdate !== undefined) {
      const existing = content.images[record.key];
      if (existing) {
        content.images[record.key] = { ...existing, alt: record.altUpdate };
        updatedKeys.push(record.key);
      }
      continue;
    }
    const { src } = imagePathFor(record);
    const image = {
      src,
      alt: record.alt,
      caption: record.caption ?? null,
      source: record.source ?? null,
      width: record.width,
      height: record.height
    };
    if (record.key.startsWith('lib.')) image.library = true;
    content.images[record.key] = image;
    addedKeys.push(record.key);
  }

  return { content, addedKeys, removedKeys, updatedKeys };
}

// A key is "in use" if a canvas element points at it directly, or if one of the 6 fixed
// slots happens to be showing the exact same file (e.g. a library photo that was also
// set as a slot's image). Either way, deleting it out from under content.json would
// break something already on the page.
export function findKeyUsage(key, siteData, contentData) {
  const usage = [];

  for (const page of siteData?.pages || []) {
    for (const section of page.sections || []) {
      for (const el of section.elements || []) {
        if (el.props && el.props.key === key) {
          usage.push((section.name || section.id) + ' — ' + (el.name || el.id));
        }
      }
    }
  }

  const src = contentData?.images?.[key]?.src;
  if (src) {
    for (const slotKey of IMAGE_KEYS) {
      if (slotKey === key) continue;
      if (contentData.images[slotKey]?.src === src) usage.push(slotKey);
    }
  }

  return usage;
}
