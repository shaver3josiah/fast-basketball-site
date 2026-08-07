// Golden-output test. The safety net for the canvas migration.
//
// The nine section templates in src/templates/sections/ are hand-tuned HTML that
// survived four rounds of design critique. Moving page structure out of code and
// into site.json risks changing that output in ways nobody notices until the site
// is live and a heading has quietly lost its class. This snapshots every text
// artefact the build emits so the migration has to prove it changed nothing it
// did not mean to change.
//
//   node scripts/golden.mjs snapshot   record current dist/ as the baseline
//   node scripts/golden.mjs check      compare current dist/ against the baseline
//   node scripts/golden.mjs check --diff <path>   print the first differing lines
//
// Images are excluded on purpose: sharp regenerates them from untouched source on
// every build, they are large, and they are not what a structural migration puts
// at risk. Text output is.

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const DIST = resolve(ROOT, 'dist');
const BASELINE = resolve(ROOT, 'scripts/golden-baseline.json');
const TEXT_EXT = new Set(['.html', '.css', '.js', '.json', '.xml', '.txt', '.svg']);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (TEXT_EXT.has(entry.name.slice(entry.name.lastIndexOf('.')))) out.push(full);
  }
  return out;
}

// Forward slashes so a baseline recorded on Windows still matches on Netlify's Linux
// builders. Without this every path differs and the check is noise.
function key(file) {
  return relative(DIST, file).split(sep).join('/');
}

function snapshotDist() {
  if (!existsSync(DIST)) {
    console.error('No dist/ directory. Run `npm run build` first.');
    process.exit(1);
  }
  const files = {};
  for (const file of walk(DIST).sort()) {
    const body = readFileSync(file);
    files[key(file)] = { sha: createHash('sha256').update(body).digest('hex').slice(0, 16), bytes: body.length };
  }
  return files;
}

function cmdSnapshot(force) {
  const files = snapshotDist();
  const count = Object.keys(files).length;

  // Guard the guard. The dev server rebuilds on every source change, and build.mjs
  // starts by wiping dist/ — so a manual `npm run build` running alongside the watcher
  // can snapshot a half-written tree. That happened: a 52-file baseline was silently
  // replaced with 31 files, which would have masked every regression in the missing
  // ones. A baseline that shrinks sharply is far more likely to be a race than a real
  // deletion, so it has to be asked for out loud.
  if (existsSync(BASELINE) && !force) {
    const previous = Object.keys(JSON.parse(readFileSync(BASELINE, 'utf8')).files).length;
    if (count < previous * 0.8) {
      console.error('Refusing to snapshot: dist/ has ' + count + ' text file(s), down from ' + previous + '.');
      console.error('That usually means the build was interrupted or two builds raced on dist/.');
      console.error('Re-run `npm run build` and check dist/ looks right, then use --force if the drop is real.');
      process.exit(1);
    }
  }

  writeFileSync(BASELINE, JSON.stringify({ recorded: new Date().toISOString(), files }, null, 2) + '\n');
  console.log('Baseline recorded: ' + count + ' text file(s) in dist/.');
  console.log('Wrote ' + relative(ROOT, BASELINE));
}

function firstDiff(path) {
  console.log('\n--- first difference in ' + path + ' ---');
  console.log('The baseline stores hashes, not content, so this shows the current');
  console.log('file only. Compare against git: `git show HEAD:dist/' + path + '`');
  const current = readFileSync(resolve(DIST, path), 'utf8').split('\n');
  console.log(current.slice(0, 40).join('\n'));
}

function cmdCheck(diffTarget) {
  if (!existsSync(BASELINE)) {
    console.error('No baseline. Run `node scripts/golden.mjs snapshot` on known-good output first.');
    process.exit(1);
  }
  const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')).files;
  const current = snapshotDist();

  const missing = Object.keys(baseline).filter((k) => !current[k]);
  const added = Object.keys(current).filter((k) => !baseline[k]);
  const changed = Object.keys(baseline).filter((k) => current[k] && current[k].sha !== baseline[k].sha);

  for (const k of missing) console.log('GONE     ' + k);
  for (const k of added) console.log('NEW      ' + k);
  for (const k of changed) {
    const delta = current[k].bytes - baseline[k].bytes;
    console.log('CHANGED  ' + k + '  (' + (delta >= 0 ? '+' : '') + delta + ' bytes)');
  }

  if (diffTarget) firstDiff(diffTarget);

  const total = missing.length + added.length + changed.length;
  if (total === 0) {
    console.log('Identical to baseline: ' + Object.keys(current).length + ' text file(s) unchanged.');
    return;
  }
  console.log('\n' + total + ' difference(s). Every one has to be a change you meant to make.');
  console.log('If they are all intended, re-record with `node scripts/golden.mjs snapshot`.');
  process.exitCode = 1;
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'snapshot') cmdSnapshot(rest.includes('--force'));
else if (cmd === 'check') cmdCheck(rest.includes('--diff') ? rest[rest.indexOf('--diff') + 1] : null);
else {
  console.error('Usage: node scripts/golden.mjs <snapshot|check> [--diff <path>] [--force]');
  process.exit(1);
}
