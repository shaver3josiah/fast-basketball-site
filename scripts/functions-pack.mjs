// Copies the server into functions/ so Firebase can upload it.
//
// Firebase uploads exactly one directory, the one firebase.json calls `functions.source`,
// and nothing above it. Our handlers live in server/functions/ and import shared modules
// from src/lib/ two directories up, which is outside that upload. Netlify solved the same
// problem with `included_files` in netlify.toml.
//
// The copy MIRRORS THE ORIGINAL LAYOUT rather than flattening it, and that is the whole
// trick: server/functions/checkout.mjs reaching "../../src/lib/plans.mjs" lands on
// functions/src/lib/plans.mjs once both trees sit under functions/, because the depth is
// identical. So not one import path changes, and no bundler is involved.
//
// Run by firebase.json's predeploy hook, so a deploy can never ship a stale copy. Also
// safe to run by hand: `npm run pack:functions`.

import { cpSync, rmSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = resolve(ROOT, 'functions');

// src/ carries images, fonts and styles that only the site build needs; shipping them
// would add megabytes to every cold start. These four are what the handlers actually read:
// lib/ and render.mjs for code, data/ and templates/ for the files they readFileSync.
const FROM_SRC = ['lib', 'data', 'templates', 'render.mjs'];

// A test never runs inside the function, and node:test is not a dependency there.
const skipTests = (path) => !/\.test\.mjs$/.test(path);

function packed(dir) {
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    n += statSync(full).isDirectory() ? packed(full) : 1;
  }
  return n;
}

for (const dir of ['server', 'src']) {
  rmSync(resolve(OUT, dir), { recursive: true, force: true });
}
mkdirSync(OUT, { recursive: true });

cpSync(resolve(ROOT, 'server'), resolve(OUT, 'server'), { recursive: true, filter: skipTests });

mkdirSync(resolve(OUT, 'src'), { recursive: true });
for (const entry of FROM_SRC) {
  const from = resolve(ROOT, 'src', entry);
  if (!existsSync(from)) throw new Error('functions-pack: src/' + entry + ' is missing, so the function would fail at runtime');
  cpSync(from, resolve(OUT, 'src', entry), { recursive: true, filter: skipTests });
}

console.log('packed ' + packed(resolve(OUT, 'server')) + ' server file(s) and ' +
  packed(resolve(OUT, 'src')) + ' src file(s) into functions/');
