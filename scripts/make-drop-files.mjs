// Generates _redirects and _headers for a MANUAL (drag-and-drop) Netlify deploy.
//
// Why this exists: a manual deploy runs no build. If netlify.toml is present in the
// uploaded folder, Netlify reads its [build] block and tries to run `npm run build`
// — which fails, because the uploaded folder is dist/ and has no package.json.
// _redirects and _headers are the file-based equivalents and trigger no build.
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';

const toml = readFileSync(new URL('../netlify.toml', import.meta.url), 'utf8');
const DIST = new URL('../dist/', import.meta.url);

// ---- redirects ----------------------------------------------------------
// Function proxies are dropped: there are no functions on a manual deploy, so a
// rule pointing at one would 404 more confusingly than no rule at all.
const blocks = toml.split('[[redirects]]').slice(1);
const rules = [];
for (const b of blocks) {
  const head = b.split(/\n\[/)[0];
  const pick = (k) => (head.match(new RegExp(`^\\s*${k}\\s*=\\s*"([^"]+)"`, 'm')) || [])[1];
  const from = pick('from');
  const to = pick('to');
  const status = (head.match(/^\s*status\s*=\s*(\d+)/m) || [])[1] || '301';
  const force = /^\s*force\s*=\s*true/m.test(head);
  if (!from || !to || to.includes('/.netlify/functions/')) continue;
  rules.push(`${from}  ${to}  ${status}${force ? '!' : ''}`);
}

// ---- headers ------------------------------------------------------------
// Skip /.netlify/functions/* — nothing serves that path on a manual deploy.
const hBlocks = toml.split('[[headers]]').slice(1);
const out = [];
for (const b of hBlocks) {
  const forMatch = b.match(/^\s*for\s*=\s*"([^"]+)"/m);
  if (!forMatch || forMatch[1].includes('/.netlify/')) continue;
  const valsSection = b.split('[headers.values]')[1];
  if (!valsSection) continue;
  const vals = valsSection.split(/\n\s*\[\[/)[0];
  const pairs = [...vals.matchAll(/^\s*([A-Za-z0-9-]+)\s*=\s*"([\s\S]*?)"\s*$/gm)]
    .map((p) => `  ${p[1]}: ${p[2].replace(/\s*\n\s*/g, ' ')}`);
  if (pairs.length) out.push(`${forMatch[1]}\n${pairs.join('\n')}`);
}

writeFileSync(new URL('_redirects', DIST), rules.join('\n') + '\n');
writeFileSync(new URL('_headers', DIST), out.join('\n\n') + '\n');
const stale = new URL('netlify.toml', DIST);
if (existsSync(stale)) rmSync(stale);

console.log('redirect rules :', rules.length);
console.log('header blocks  :', out.length);
console.log('netlify.toml in dist:', existsSync(stale));
console.log('\n--- _redirects ---\n' + rules.join('\n'));
