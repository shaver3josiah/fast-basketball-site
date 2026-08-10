// Scans src/templates/sections/*.html (+ _prelude.html) for data-edit / data-edit-attr
// markers and seeds any key missing from src/data/content.json ".text" with the value
// currently sitting in the template. Never overwrites an existing key. Run with:
//   node scripts/seed-content.mjs
// A second run should always report "0 seeded" (idempotent) once content.json has caught up.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const SECTIONS_DIR = resolve('src/templates/sections');
const CONTENT_PATH = resolve('src/data/content.json');
const LABELS_OUT = resolve('scripts/seed-content-labels.json');

function unescapeHtml(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// Mirrors applyTextEdits' own tag-boundary logic (src/render.mjs) so the value we
// capture here is exactly the value that mechanism would substitute back in.
function scanDataEdit(file, html, occurrences, violations) {
  const re = /data-edit="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    const key = m[1];
    const tagOpenEnd = html.indexOf('>', m.index);
    const closeStart = html.indexOf('</', tagOpenEnd);
    if (tagOpenEnd === -1 || closeStart === -1) continue;
    const inner = html.slice(tagOpenEnd + 1, closeStart);
    if (inner.includes('<')) {
      violations.push(file + ': data-edit="' + key + '" wraps a child tag (leaf-rule violation): "' + inner + '"');
      continue;
    }
    addOccurrence(occurrences, key, unescapeHtml(inner), file);
  }
}

function scanDataEditAttr(file, html, occurrences) {
  const re = /data-edit-attr="([a-zA-Z-]+):([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    const attrName = m[1];
    const key = m[2];
    const tagStart = html.lastIndexOf('<', m.index);
    const tagEnd = html.indexOf('>', m.index);
    const tag = html.slice(tagStart, tagEnd + 1);
    const valMatch = new RegExp(attrName + '="([^"]*)"').exec(tag);
    if (!valMatch) continue;
    addOccurrence(occurrences, key, unescapeHtml(valMatch[1]), file);
  }
}

function addOccurrence(occurrences, key, value, file) {
  if (!occurrences.has(key)) occurrences.set(key, []);
  occurrences.get(key).push({ value, file });
}

// --- label generation (rough-and-ready; good enough per the packet, hand-tune the rest) ---
const SECTION_NAMES = {
  hero: 'Hero', nav: 'Nav', intro: 'Intro', tick: 'Ticker',
  rcp: 'Résumé', aud: 'Audience', prog: 'Program', mth: 'Method',
  coach: 'Coach', sb: 'Scoreboard', nite: 'Night Court', pb: 'Playbook',
  lkr: 'Locker', area: 'Service area', fam: 'Families', faq: 'FAQ', ct: 'Contact'
};
const ITEM_NOUNS = { tick: 'item', rcp: 'card', aud: 'tile', mth: 'step', sb: 'stat', lkr: 'card' };
const ITEM_OVERRIDES = {
  cc: 'court card', ph: 'placeholder', lbl: 'field label', out: 'output panel', sheet: 'sample sheet',
  modal: 'login modal', sent: 'login-sent panel', in: 'logged-in panel', rev: 'reviews',
  done: 'success panel', cta: 'CTA block', gatenote: 'parent-gate note',
  cred1: 'credential 1', cred2: 'credential 2', cred3: 'credential 3', cred4: 'credential 4',
  row1: 'sample row 1', row2: 'sample row 2', row3: 'sample row 3',
  row4: 'sample row 4', row5: 'sample row 5', row6: 'sample row 6'
};
const FIELD_OVERRIDES = {
  eyebrow: 'eyebrow', lede: 'intro paragraph', trust: 'trust line', h2: 'heading', h3: 'subheading',
  h2a: 'heading line 1', h2b: 'heading line 2', h1a: 'headline line 1', h1b: 'headline line 2',
  title: 'title', body: 'body text', tag: 'tag', price: 'price', unit: 'price unit',
  badge: 'badge', meta: 'meta line', label: 'label', tier: 'tier', name: 'name',
  q: 'question', a: 'answer', n: 'number', l: 'label', year: 'year', src: 'source line',
  sub: 'subtitle', head: 'heading', consent: 'consent text', submit: 'submit button',
  cta: 'CTA button', cta1: 'CTA button 1', cta2: 'CTA button 2',
  brand: 'brand name', skiplink: 'skip link', skip: 'skip button', swish: 'swish flash text',
  counter: 'counter label', logout: 'log out button', goto: 'go-to button',
  date: 'date', cap1: 'caption line 1', cap2: 'caption line 2',
  stat1n: 'stat 1 number', stat1l: 'stat 1 label', stat2n: 'stat 2 number', stat2l: 'stat 2 label',
  stat3n: 'stat 3 number', stat3l: 'stat 3 label',
  note1: 'note 1', note2: 'note 2', note3: 'note 3', note2a: 'note lead-in', note2b: 'note middle', note2c: 'note trailing punctuation',
  notelink: 'note link text', body1: 'body line 1', body2: 'body line 2', p1: 'paragraph 1', p2a: 'paragraph 2 lead-in', p2b: 'paragraph 2 trailing',
  source: 'source label'
};
function fieldLabel(field) {
  if (FIELD_OVERRIDES[field]) return FIELD_OVERRIDES[field];
  const liMatch = /^li(\d)$/.exec(field);
  if (liMatch) return 'list item ' + liMatch[1];
  const linkMatch = /^link(\d)$/.exec(field);
  if (linkMatch) return 'link ' + linkMatch[1];
  return field.replace(/([a-z])(\d)/g, '$1 $2');
}
function itemPhrase(sectionKey, item) {
  if (/^\d+$/.test(item)) {
    const noun = ITEM_NOUNS[sectionKey];
    return noun ? noun + ' ' + item : item;
  }
  return ITEM_OVERRIDES[item] || item.replace(/([a-z])(\d)/g, '$1 $2');
}
function capitalize(s) { return s.length ? s[0].toUpperCase() + s.slice(1) : s; }
function generateLabel(key) {
  const parts = key.split('.');
  const sectionKey = parts[0];
  const sectionName = SECTION_NAMES[sectionKey] || capitalize(sectionKey);
  if (parts.length === 2) return capitalize(sectionName + ' ' + fieldLabel(parts[1]));
  if (parts.length === 3) return capitalize(sectionName + ' ' + itemPhrase(sectionKey, parts[1]) + ' ' + fieldLabel(parts[2]));
  return capitalize(sectionName + ' ' + parts.slice(1).join(' '));
}

function main() {
  const files = readdirSync(SECTIONS_DIR).filter((f) => f.endsWith('.html'));
  const occurrences = new Map();
  const violations = [];

  for (const file of files) {
    const html = readFileSync(resolve(SECTIONS_DIR, file), 'utf8');
    scanDataEdit(file, html, occurrences, violations);
    scanDataEditAttr(file, html, occurrences);
  }

  if (violations.length > 0) {
    console.error('Leaf-rule violations (' + violations.length + '):');
    for (const v of violations) console.error('  ' + v);
    process.exit(1);
  }

  const dupErrors = [];
  for (const [key, list] of occurrences) {
    const uniqueValues = new Set(list.map((o) => o.value));
    if (uniqueValues.size > 1) {
      dupErrors.push('Key "' + key + '" used with different text runs across: ' +
        list.map((o) => o.file + '=' + JSON.stringify(o.value)).join(', '));
    }
  }
  if (dupErrors.length > 0) {
    console.error('Duplicate-key conflicts (' + dupErrors.length + '):');
    for (const e of dupErrors) console.error('  ' + e);
    process.exit(1);
  }

  const content = JSON.parse(readFileSync(CONTENT_PATH, 'utf8'));
  if (!content.text) content.text = {};

  let seeded = 0;
  let alreadyPresent = 0;
  const newLabels = {};
  for (const [key, list] of occurrences) {
    if (Object.prototype.hasOwnProperty.call(content.text, key)) {
      alreadyPresent++;
      continue;
    }
    content.text[key] = list[0].value;
    newLabels[key] = generateLabel(key);
    seeded++;
  }

  if (seeded > 0) {
    writeFileSync(CONTENT_PATH, JSON.stringify(content, null, 2) + '\n');
  }
  if (Object.keys(newLabels).length > 0) {
    writeFileSync(LABELS_OUT, JSON.stringify(newLabels, null, 2) + '\n');
  }

  console.log(occurrences.size + ' keys found, ' + seeded + ' seeded, ' + alreadyPresent + ' already present.');
  if (seeded > 0) console.log('Label suggestions written to ' + LABELS_OUT);
}

main();
