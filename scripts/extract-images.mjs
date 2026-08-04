import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { readDimensions } from '../src/lib/image-dimensions.mjs';

const KEY_TO_FILENAME = {
  'hero.nets': 'hero-nets.jpg',
  'rcp.trophy': 'resume-trophy.jpg',
  'rcp.team': 'resume-team.jpg',
  'rcp.juco': 'resume-juco.jpg',
  'rcp.work': 'resume-work.jpg',
  'coach.portrait': 'coach-portrait.jpg'
};

function parseArgs(argv) {
  const out = { src: null, imagesDir: null, manifest: null, preparedHtml: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--src') out.src = argv[++i];
    else if (a === '--images-dir') out.imagesDir = argv[++i];
    else if (a === '--manifest') out.manifest = argv[++i];
    else if (a === '--prepared-html') out.preparedHtml = argv[++i];
    else if (!out.src) out.src = a;
  }
  return out;
}

function extExt(mime) {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return 'bin';
}

const MARKER_PREFIX = 'src="data:';
const BASE64_MARKER = ';base64,';

export function extractImages(html) {
  const results = [];
  const dataImgPattern = /data-img="([^"]+)"/g;
  let match;
  while ((match = dataImgPattern.exec(html)) !== null) {
    const key = match[1];
    const searchFrom = match.index;
    const srcStart = html.indexOf(MARKER_PREFIX, searchFrom);
    if (srcStart === -1 || srcStart - searchFrom > 20000) continue;
    const mimeStart = srcStart + MARKER_PREFIX.length;
    const base64MarkerIndex = html.indexOf(BASE64_MARKER, mimeStart);
    if (base64MarkerIndex === -1 || base64MarkerIndex - mimeStart > 60) continue;
    const mime = html.slice(mimeStart, base64MarkerIndex);
    const base64Start = base64MarkerIndex + BASE64_MARKER.length;
    const base64End = html.indexOf('"', base64Start);
    if (base64End === -1) continue;
    const base64 = html.slice(base64Start, base64End);
    const buffer = Buffer.from(base64, 'base64');
    const dims = readDimensions(buffer, mime);
    const sha256 = createHash('sha256').update(buffer).digest('hex').slice(0, 16);
    const filename = KEY_TO_FILENAME[key] || (key.replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.' + extExt(mime));
    results.push({
      key,
      filename,
      mime,
      bytes: buffer.length,
      width: dims ? dims.width : null,
      height: dims ? dims.height : null,
      sha256,
      buffer,
      sourceStart: srcStart,
      sourceEnd: base64End + 1,
      replacement: `src="/images/${filename}"`
    });
  }
  return results;
}

export function replaceDataUris(html, extracted) {
  const ordered = [...extracted].sort((a, b) => a.sourceStart - b.sourceStart);
  let out = '';
  let cursor = 0;
  for (const item of ordered) {
    out += html.slice(cursor, item.sourceStart);
    out += item.replacement;
    cursor = item.sourceEnd;
  }
  out += html.slice(cursor);
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.src) {
    console.error('Usage: node extract-images.mjs --src <preview.html> --images-dir <dir> --manifest <file.json> [--prepared-html <file.html>]');
    process.exit(1);
  }
  const srcPath = resolve(args.src);
  const imagesDir = resolve(args.imagesDir || 'src/images/source');
  const manifestPath = resolve(args.manifest || 'src/data/image-manifest.json');
  const html = readFileSync(srcPath, 'utf8');
  const extracted = extractImages(html);

  if (extracted.length === 0) {
    console.error('No data-img elements with an inline base64 image were found in ' + srcPath);
    process.exit(1);
  }

  mkdirSync(imagesDir, { recursive: true });
  mkdirSync(dirname(manifestPath), { recursive: true });

  const manifest = extracted.map((item) => {
    const outPath = resolve(imagesDir, item.filename);
    writeFileSync(outPath, item.buffer);
    return {
      key: item.key,
      file: item.filename,
      mime: item.mime,
      width: item.width,
      height: item.height,
      bytes: item.bytes,
      sha256: item.sha256
    };
  });

  writeFileSync(manifestPath, JSON.stringify({ generatedFrom: srcPath, count: manifest.length, images: manifest }, null, 2) + '\n');

  if (args.preparedHtml) {
    const prepared = replaceDataUris(html, extracted);
    mkdirSync(dirname(resolve(args.preparedHtml)), { recursive: true });
    writeFileSync(resolve(args.preparedHtml), prepared);
  }

  console.log('Extracted ' + manifest.length + ' images from ' + srcPath);
  for (const item of manifest) {
    console.log('  ' + item.key + ' -> ' + item.file + ' (' + item.width + 'x' + item.height + ', ' + item.bytes + ' bytes)');
  }
}

main();
