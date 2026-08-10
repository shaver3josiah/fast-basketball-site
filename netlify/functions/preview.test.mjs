// Run: node --test netlify/functions/preview.test.mjs
//
// One bug, one guard. preview.mjs derived its repo root by taking .pathname off a file://
// URL, which is percent-encoded. On a checkout at "...\Fast Basketball\..." every space
// stayed %20, so loadData() opened a path that does not exist and the Preview button
// returned ENOENT on content.json while every other admin surface looked fine.
//
// This asserts the root resolves to something real rather than asserting the absence of
// "%", because a "%"-free check passes trivially on a path with no spaces and would not
// have caught the original bug on the machine it was reported from.

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from './preview.mjs';

for (const relative of ['src/data/content.json', 'src/data/suburbs.json', 'src/templates/sections']) {
  const full = resolve(ROOT, relative);
  assert.ok(existsSync(full), 'preview ROOT must resolve to the repo root; "' + relative + '" not found at ' + full);
}

assert.ok(!ROOT.includes('%2'), 'preview ROOT is still percent-encoded: ' + ROOT);

console.log('preview: ok');
