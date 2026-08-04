import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

export const SECTION_IDS = ['receipts', 'programs', 'method', 'coach', 'playbook', 'areas', 'contact'];

function parseArgs(argv) {
  const out = { src: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--src') out.src = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (!out.src) out.src = a;
  }
  return out;
}

function findTagStart(html, idPosition) {
  let i = idPosition;
  while (i > 0 && html[i] !== '<') i--;
  return html[i] === '<' ? i : null;
}

export function splitSections(html, ids = SECTION_IDS) {
  const boundaries = [];
  const missing = [];
  for (const id of ids) {
    const idAttr = `id="${id}"`;
    const idPosition = html.indexOf(idAttr);
    if (idPosition === -1) {
      missing.push(id);
      continue;
    }
    const tagStart = findTagStart(html, idPosition);
    if (tagStart === null) {
      missing.push(id);
      continue;
    }
    boundaries.push({ id, tagStart });
  }
  boundaries.sort((a, b) => a.tagStart - b.tagStart);

  const sections = {};
  for (let i = 0; i < boundaries.length; i++) {
    const start = boundaries[i].tagStart;
    const end = i + 1 < boundaries.length ? boundaries[i + 1].tagStart : html.length;
    sections[boundaries[i].id] = html.slice(start, end).trimEnd() + '\n';
  }

  const prelude = boundaries.length > 0 ? html.slice(0, boundaries[0].tagStart) : html;

  return { sections, prelude, missing, order: boundaries.map((b) => b.id) };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.src) {
    console.error('Usage: node split-sections.mjs --src <preview.html> --out <dir>');
    process.exit(1);
  }
  const srcPath = resolve(args.src);
  const outDir = resolve(args.out || 'src/templates/sections');
  const html = readFileSync(srcPath, 'utf8');
  const result = splitSections(html);

  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, '_prelude.html'), result.prelude);
  for (const id of Object.keys(result.sections)) {
    writeFileSync(resolve(outDir, id + '.html'), result.sections[id]);
  }

  console.log('Split ' + srcPath);
  console.log('Found ' + result.order.length + ' of ' + SECTION_IDS.length + ' target sections: ' + result.order.join(', '));
  if (result.missing.length > 0) {
    console.log('Missing section ids: ' + result.missing.join(', '));
  }
  for (const id of Object.keys(result.sections)) {
    console.log('  ' + id + '.html -> ' + result.sections[id].length + ' chars');
  }
  console.log('  _prelude.html -> ' + result.prelude.length + ' chars');
}

main();
