// Run: node --test netlify/functions/lib/media-merge.test.mjs
//
// Staging only runs in production (isLocal === false), so nothing in draft.mjs's blob
// calls ever executes against the local dev server. This is the only place the merge,
// usage-check, and slug rules that back the media library actually get exercised.

import assert from 'node:assert/strict';
import { mergeStagedMedia, findKeyUsage, libraryKeyFor, imagePathFor, extFor } from './media-merge.mjs';

const baseContent = () => ({
  version: 1,
  images: {
    'hero.nets': { src: '/images/hero-nets.jpg', alt: 'Hero', width: 760, height: 1027 },
    'coach.portrait': { src: '/images/coach-portrait.jpg', alt: 'Coach', width: 880, height: 1100 }
  }
});

// ---------------------------------------------------------------- mergeStagedMedia

{
  const content = baseContent();
  const staged = [
    { key: 'lib.court-dusk-1700000000000', filename: 'Court Dusk.jpg', alt: 'Court at dusk', mime: 'image/jpeg', width: 2400, height: 1600, uploadedAt: 1700000000000 }
  ];
  const { content: out, addedKeys, removedKeys } = mergeStagedMedia(content, staged);
  assert.ok(out.images['lib.court-dusk-1700000000000'], 'staged add must land in content.images');
  assert.equal(out.images['lib.court-dusk-1700000000000'].src, '/images/court-dusk-1700000000000.jpg');
  assert.equal(out.images['lib.court-dusk-1700000000000'].library, true, 'library entries must carry library:true');
  assert.deepEqual(addedKeys, ['lib.court-dusk-1700000000000']);
  assert.deepEqual(removedKeys, []);
  assert.equal(content.images['lib.court-dusk-1700000000000'], undefined, 'input must not be mutated');
}

{
  const content = baseContent();
  const staged = [{ id: 'd1', key: 'hero.nets', deleted: true }];
  const { content: out, removedKeys } = mergeStagedMedia(content, staged);
  assert.equal(out.images['hero.nets'], undefined, 'a deleted record must remove an existing key');
  assert.deepEqual(removedKeys, ['hero.nets']);
  assert.ok(content.images['hero.nets'], 'input must not be mutated');
}

{
  // A fixed slot re-upload must overwrite the slot's own record, not gain library:true.
  const content = baseContent();
  const staged = [{ key: 'hero.nets', filename: null, alt: 'New hero', mime: 'image/png', width: 900, height: 1200, uploadedAt: 1700000000001, caption: 'Cap', source: 'Src' }];
  const { content: out } = mergeStagedMedia(content, staged);
  assert.equal(out.images['hero.nets'].src, '/images/hero-nets-1700000000001.png');
  assert.equal(out.images['hero.nets'].library, undefined, 'a fixed slot must never carry library:true');
  assert.equal(out.images['hero.nets'].caption, 'Cap');
}

{
  // An alt correction rewords an existing entry rather than adding a second one, and
  // leaves every other field of that entry alone.
  const content = baseContent();
  const staged = [{ id: 'a1', key: 'hero.nets', altUpdate: 'Coach cutting down the net' }];
  const { content: out, addedKeys, updatedKeys } = mergeStagedMedia(content, staged);
  assert.equal(out.images['hero.nets'].alt, 'Coach cutting down the net');
  assert.equal(out.images['hero.nets'].src, '/images/hero-nets.jpg', 'an alt change must not touch src');
  assert.deepEqual(updatedKeys, ['hero.nets']);
  assert.deepEqual(addedKeys, [], 'an alt change is not an addition');
  assert.equal(content.images['hero.nets'].alt, 'Hero', 'input must not be mutated');
}

{
  // Upload then reword, in one batch: the correction wins, and there is still one entry.
  const content = baseContent();
  const staged = [
    { key: 'lib.court-1700000000000', filename: 'court.jpg', alt: 'First guess', mime: 'image/jpeg', width: 800, height: 600, uploadedAt: 1700000000000 },
    { id: 'a2', key: 'lib.court-1700000000000', altUpdate: 'Better wording' }
  ];
  const { content: out } = mergeStagedMedia(content, staged);
  assert.equal(out.images['lib.court-1700000000000'].alt, 'Better wording');
  assert.equal(out.images['lib.court-1700000000000'].library, true);
}

{
  // An alt correction for a key that was deleted in the same batch must not resurrect it.
  const content = baseContent();
  const staged = [
    { id: 'd2', key: 'hero.nets', deleted: true },
    { id: 'a3', key: 'hero.nets', altUpdate: 'Too late' }
  ];
  const { content: out } = mergeStagedMedia(content, staged);
  assert.equal(out.images['hero.nets'], undefined, 'a deleted key must stay deleted');
}

{
  // admin-publish uses the CONTENT DRAFT as the merge base when one exists, then folds
  // staged photos on top. Both orders of work have to survive: text edited first then a
  // photo uploaded, or a photo uploaded first then text edited. If the base were the
  // published file instead of the draft, publishing after a photo upload would quietly
  // roll back every text edit, motion setting and reorder made since the last publish.
  const draft = {
    version: 1,
    text: { 'hero.eyebrow': 'EDITED IN THE DRAFT', 'mth.1.title': 'Also edited' },
    images: {
      'hero.nets': { src: '/images/hero-nets.jpg', alt: 'Hero', width: 760, height: 1027 },
      'coach.portrait': { src: '/images/coach-portrait.jpg', alt: 'Coach', width: 880, height: 1100 }
    },
    motion: { enabled: false, speed: 2 },
    order: { rcp: [3, 0, 1, 2] }
  };
  const staged = [
    { key: 'lib.new-1700000000009', filename: 'new.jpg', alt: 'A newly uploaded photo', mime: 'image/jpeg', width: 1200, height: 800, uploadedAt: 1700000000009 }
  ];
  const { content: out } = mergeStagedMedia(draft, staged);

  assert.equal(out.text['hero.eyebrow'], 'EDITED IN THE DRAFT', 'draft text must survive a photo merge');
  assert.equal(out.text['mth.1.title'], 'Also edited');
  assert.deepEqual(out.motion, { enabled: false, speed: 2 }, 'draft motion settings must survive');
  assert.deepEqual(out.order, { rcp: [3, 0, 1, 2] }, 'draft group order must survive');
  assert.ok(out.images['lib.new-1700000000009'], 'the staged photo must still land');
  assert.equal(out.images['hero.nets'].src, '/images/hero-nets.jpg', 'untouched slots stay put');
  assert.equal(draft.text['hero.eyebrow'], 'EDITED IN THE DRAFT', 'the draft object must not be mutated');
}

// ---------------------------------------------------------------- findKeyUsage

const siteWithReference = {
  pages: [{
    id: 'home',
    sections: [{
      id: 'sec_hero', name: 'Hero section',
      elements: [{ id: 'el1', name: 'Hero photo', type: 'image', props: { key: 'lib.court-dusk-1700000000000' } }]
    }]
  }]
};

{
  const usage = findKeyUsage('lib.court-dusk-1700000000000', siteWithReference, baseContent());
  assert.deepEqual(usage, ['Hero section — Hero photo'], 'a canvas reference must be reported by section + element name');
}

{
  // Same underlying file also sitting behind a fixed slot's src counts as in-use too.
  const content = baseContent();
  content.images['lib.shared-1700000000002'] = { src: '/images/coach-portrait.jpg', alt: 'x', width: 1, height: 1, library: true };
  const usage = findKeyUsage('lib.shared-1700000000002', { pages: [] }, content);
  assert.deepEqual(usage, ['coach.portrait'], 'a fixed slot sharing the same src must be reported by its plain key');
}

{
  const usage = findKeyUsage('lib.unused-1700000000003', siteWithReference, baseContent());
  assert.deepEqual(usage, [], 'an unreferenced key must report no usage');
}

// ---------------------------------------------------------------- libraryKeyFor

assert.equal(libraryKeyFor('Court Dusk.jpg', 1700000000000), 'lib.court-dusk-1700000000000');
assert.equal(libraryKeyFor('IMG_1234!!.PNG', 1700000000000), 'lib.img-1234-1700000000000', 'non [a-z0-9] runs collapse to one dash');
assert.equal(libraryKeyFor('.hidden', 1700000000000), 'lib.photo-1700000000000', 'a filename with nothing left after stripping falls back to "photo"');
{
  const longName = 'a'.repeat(60) + '.jpg';
  const key = libraryKeyFor(longName, 1700000000000);
  const slug = key.slice('lib.'.length, key.lastIndexOf('-1700000000000'));
  assert.ok(slug.length <= 40, 'slug must be capped at 40 chars, got ' + slug.length);
}

// ---------------------------------------------------------------- imagePathFor / extFor

assert.equal(extFor('image/jpeg'), 'jpg');
assert.equal(extFor('image/png'), 'png');
assert.equal(extFor('image/webp'), 'webp');
assert.equal(extFor('image/gif'), null);

assert.deepEqual(
  imagePathFor({ key: 'lib.court-dusk-1700000000000', mime: 'image/jpeg' }),
  { filename: 'court-dusk-1700000000000.jpg', path: 'src/images/uploads/court-dusk-1700000000000.jpg', src: '/images/court-dusk-1700000000000.jpg' }
);
assert.deepEqual(
  imagePathFor({ key: 'hero.nets', mime: 'image/png', uploadedAt: 1700000000001 }),
  { filename: 'hero-nets-1700000000001.png', path: 'src/images/uploads/hero-nets-1700000000001.png', src: '/images/hero-nets-1700000000001.png' }
);

console.log('media-merge: ok');
