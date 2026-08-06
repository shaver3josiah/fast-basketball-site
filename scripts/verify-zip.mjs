// Parses the deploy zip's central directory directly and asserts the things that
// actually broke the first two attempts: backslash paths (Compress-Archive), a
// missing EOCD (tar wearing a .zip extension), and a stray netlify.toml whose
// [build] block makes Netlify attempt a build the folder cannot satisfy.
import { readFileSync } from 'node:fs';

const zipPath = process.argv[2];
const buf = readFileSync(zipPath);

const eo = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
if (eo < 0) {
  console.log('FAIL: no End of Central Directory record — this is not a zip');
  process.exit(1);
}
const count = buf.readUInt16LE(eo + 10);
const cdOff = buf.readUInt32LE(eo + 16);

const names = [];
let p = cdOff;
for (let i = 0; i < count; i++) {
  if (buf.readUInt32LE(p) !== 0x02014b50) {
    console.log(`FAIL: central directory corrupt at entry ${i}`);
    process.exit(1);
  }
  const nl = buf.readUInt16LE(p + 28);
  const el = buf.readUInt16LE(p + 30);
  const cl = buf.readUInt16LE(p + 32);
  names.push(buf.toString('utf8', p + 46, p + 46 + nl));
  p += 46 + nl + el + cl;
}

const BACKSLASH = String.fromCharCode(92);
const bad = names.filter((n) => n.includes(BACKSLASH));
const has = (n) => names.includes(n);

const checks = [
  ['valid EOCD + central directory walks', true],
  ['entries', count],
  ['backslash paths (must be 0)', bad.length],
  ['netlify.toml present (MUST be 0 — caused the failed build)', has('netlify.toml') ? 1 : 0],
  ['package.json present (0 expected, no build should run)', has('package.json') ? 1 : 0],
  ['index.html at root', has('index.html')],
  ['_redirects at root', has('_redirects')],
  ['_headers at root', has('_headers')],
  ['robots.txt at root', has('robots.txt')],
  ['READ-ME-FIRST.txt at root', has('READ-ME-FIRST.txt')],
  ['admin files (0 expected)', names.filter((n) => n.startsWith('admin/')).length],
  ['html pages', names.filter((n) => n.endsWith('.html')).length],
  ['size MB', (buf.length / 1024 / 1024).toFixed(2)],
];
for (const [k, v] of checks) console.log(String(k).padEnd(58), v);

const fatal = bad.length > 0 || has('netlify.toml') || !has('index.html') || !has('_redirects');
console.log('\n' + (fatal ? 'FAIL — do not ship this zip' : 'PASS — safe to drag onto Netlify'));
process.exit(fatal ? 1 : 0);
