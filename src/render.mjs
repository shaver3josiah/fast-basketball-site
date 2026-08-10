import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { absoluteUrl, AREA_SERVED, PROGRAM_PAGES } from './lib/site-config.mjs';
import { faqPage, jsonLdScript, breadcrumbList, businessEntity } from './lib/structured-data.mjs';
import { CONTENT_GROUPS } from './lib/content-groups.mjs';

// Exported so the editor can list the hand-built sections without keeping its own copy
// of this order — the drift that has already bitten twice in this codebase.
export const SECTION_IDS = ['receipts', 'programs', 'method', 'coach', 'nights', 'playbook', 'resources', 'areas', 'contact'];

// Single source for the footer's editable keys: buildFooter reads these with fallbacks,
// and build.mjs's footer pseudo-section reports the same list as its hooks, so the two
// can never drift into naming a field the other does not know about.
export const FOOTER_TEXT_KEYS = ['ft.tagline', 'ft.col1h', 'ft.col2h', 'ft.col3h', 'ft.bot', 'ft.city', 'ft.mob1', 'ft.mob2'];

const IMAGE_RENDER_RULES = {
  'hero.nets': { loading: 'eager', fetchpriority: 'high', sizes: '(max-width: 760px) 88vw, 460px' },
  'rcp.trophy': { loading: 'lazy', fetchpriority: 'auto', sizes: '(max-width: 760px) 45vw, 280px' },
  'rcp.team': { loading: 'lazy', fetchpriority: 'auto', sizes: '(max-width: 760px) 45vw, 280px' },
  'rcp.juco': { loading: 'lazy', fetchpriority: 'auto', sizes: '(max-width: 760px) 45vw, 280px' },
  'rcp.work': { loading: 'lazy', fetchpriority: 'auto', sizes: '(max-width: 760px) 45vw, 280px' },
  'coach.portrait': { loading: 'lazy', fetchpriority: 'auto', sizes: '(max-width: 760px) 90vw, 420px' }
};

const FAQ_PAIRS = [
  { question: 'What ages do you train?', answer: 'Players from roughly 11 through 18, from first year middle school through senior year. Younger players get more habit building, older players get more decision work and recruiting support.' },
  { question: 'Where do sessions actually happen?', answer: 'City parks and partner courts across north Broward County. When you book, you get the exact location for your area. If you have access to a court through a school or community center, we can often train there.' },
  { question: 'How fast will we see a difference?', answer: 'Form changes show up in two to three weeks. Game changes usually take six to eight, because a skill has to survive speed, contact, and fatigue before it shows up on a Friday night.' },
  { question: 'Do you help with college recruiting?', answer: 'Yes, inside the College Track Program. Coach Blake spent the last two seasons on college staffs at the NJCAA and NCAA Division I levels, so he has evaluated high school film from the recruiting side.' },
  { question: 'Is the First Look session really free?', answer: 'Yes. It is a full evaluation. You leave with a written summary of strengths and gaps whether or not you book anything after.' },
  { question: 'Do you train girls teams and players?', answer: 'Yes. Every program listed is open to any player. Skill work does not change by gender.' }
];

// Areas tiles (areas.html) name themselves area.1.name … area.5.name. The footer's Areas
// column and the contact form's Area <select> both read the SAME keys — one place a
// service area is renamed, not two — falling back to AREA_SERVED (in its existing order)
// when a slot is absent so an un-seeded content.json renders exactly what it always has.
// `count` caps how many slots the caller wants; the footer has only ever shown 4.
function deriveAreaNames(content, count) {
  const text = (content && content.text) || {};
  const names = [];
  for (let i = 1; i <= count; i++) {
    names.push(text['area.' + i + '.name'] || AREA_SERVED[i - 1]);
  }
  return names;
}

// FAQ_PAIRS is the fallback, per-pair: faq.N.q / faq.N.a override individually so a
// partially-filled-in FAQ (some questions edited, some not) still renders sensibly
// instead of falling back to nothing the moment one pair is touched.
// Exported for render.test.mjs — the JSON-LD it feeds is otherwise only reachable
// through assembleHomepage, which needs a full section/prelude fixture to call at all.
export function deriveFaqPairs(content) {
  const text = (content && content.text) || {};
  return FAQ_PAIRS.map((pair, i) => {
    const n = i + 1;
    return {
      question: text['faq.' + n + '.q'] || pair.question,
      answer: text['faq.' + n + '.a'] || pair.answer
    };
  });
}

export function loadData(root) {
  const dataDir = resolve(root, 'src/data');
  return {
    content: JSON.parse(readFileSync(resolve(dataDir, 'content.json'), 'utf8')),
    suburbs: JSON.parse(readFileSync(resolve(dataDir, 'suburbs.json'), 'utf8')),
    playbookTemplates: JSON.parse(readFileSync(resolve(dataDir, 'playbook-templates.json'), 'utf8')),
    responsiveManifest: JSON.parse(readFileSync(resolve(dataDir, 'responsive-manifest.json'), 'utf8'))
  };
}

export function loadSections(root) {
  const dir = resolve(root, 'src/templates/sections');
  const sections = {};
  for (const id of SECTION_IDS) {
    sections[id] = readFileSync(resolve(dir, id + '.html'), 'utf8');
  }
  const prelude = readFileSync(resolve(dir, '_prelude.html'), 'utf8');
  return { sections, prelude };
}

// Cache-busting, keyed on the file's own content.
//
// netlify.toml serves /styles/* and /js/* with `max-age=31536000, immutable`. That is
// correct and fast, and it also means a returning visitor keeps the cached copy for a
// YEAR — so without a changing URL, a CSS or JS fix never reaches anyone who has
// already visited. The preview6 build solved this with a hand-typed `?v=20260805d`,
// which works exactly until somebody forgets to bump it.
//
// A content hash cannot be forgotten: the URL changes when, and only when, the bytes
// change, so an unchanged file keeps its cached copy and a changed one always busts.
const assetHashes = new Map();

export function asset(path) {
  if (assetHashes.has(path)) return assetHashes.get(path);
  const file = resolve(process.cwd(), 'src' + path);
  let out = path;
  if (existsSync(file)) {
    const hash = createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 8);
    out = path + '?v=' + hash;
  }
  assetHashes.set(path, out);
  return out;
}

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function applyTextEdits(html, textMap) {
  let out = html;
  for (const key of Object.keys(textMap)) {
    const marker = 'data-edit="' + key + '"';
    const replacement = escapeHtml(textMap[key]);
    let searchFrom = 0;
    // Every occurrence of this key gets substituted, not just the first — the ticker
    // repeats its items twice in the DOM for the marquee loop, and both copies have to
    // move together or the loop visibly seams.
    while (true) {
      const markerIndex = out.indexOf(marker, searchFrom);
      if (markerIndex === -1) break;
      const tagOpenEnd = out.indexOf('>', markerIndex);
      const closeStart = out.indexOf('</', tagOpenEnd);
      if (tagOpenEnd === -1 || closeStart === -1) { searchFrom = markerIndex + marker.length; continue; }
      out = out.slice(0, tagOpenEnd + 1) + replacement + out.slice(closeStart);
      // Resume scanning after the text we just spliced in (not from 0), so the next
      // occurrence is found without ever re-matching this one — the loop always moves
      // forward and can never spin forever.
      searchFrom = tagOpenEnd + 1 + replacement.length;
    }
  }
  return out;
}

// Attribute-safe: escapeHtml already covers & < >, and an attribute value also needs
// its own delimiter escaped or a value containing a literal " would close the
// attribute early and spill into the markup.
export function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, '&quot;');
}

// data-edit-attr="attrname:key" substitutes one attribute's value on the same element —
// used for things like a form placeholder, where the editable text is not the element's
// content. Every marker is located up front (matchAll over the ORIGINAL, unmodified
// html), then splices are applied last-to-first: attrname="..." can sit before or after
// the marker in the tag, and processing back to front means a splice earlier in the tag
// never shifts a marker position this loop has not reached yet, so no offset bookkeeping
// is needed and the loop is trivially finite (one pass over a fixed list of matches).
export function applyAttrEdits(html, textMap) {
  const markers = [...html.matchAll(/data-edit-attr="([^":]+):([^"]+)"/g)];
  let out = html;
  for (let i = markers.length - 1; i >= 0; i--) {
    const [, attrName, key] = markers[i];
    // Only substitute when the key exists in the map — an unedited attr-hook must keep
    // its template default rather than being blanked out.
    if (!(key in textMap)) continue;
    const markerStart = markers[i].index;
    const tagStart = out.lastIndexOf('<', markerStart);
    const tagEnd = out.indexOf('>', markerStart);
    if (tagStart === -1 || tagEnd === -1) continue;
    const attrMarker = ' ' + attrName + '="';
    const attrStart = out.indexOf(attrMarker, tagStart);
    if (attrStart === -1 || attrStart > tagEnd) continue;
    const valueStart = attrStart + attrMarker.length;
    const valueEnd = out.indexOf('"', valueStart);
    if (valueEnd === -1 || valueEnd > tagEnd) continue;
    out = out.slice(0, valueStart) + escapeAttr(textMap[key]) + out.slice(valueEnd);
  }
  return out;
}

// The responsive manifest is keyed by CONTENT KEY, not by file, and it is only
// regenerated by a build. So the moment the owner points a key at a different photo, the
// manifest still describes the photo that key used to hold — and a <picture> built from
// it would show the OLD image while the inspector shows the new one. The editor swap
// looked like it had silently failed.
//
// When the manifest does not describe the file the key now points at, fall back to a
// plain <img> at the real src: correct immediately, and the next build regenerates the
// variants and restores the full srcset on its own.
function manifestMatches(image, responsive) {
  if (!responsive || !responsive.variants || !responsive.variants.jpeg || !responsive.variants.jpeg.length) return false;
  const base = String(image.src || '').split('/').pop().replace(/\.[^.]+$/, '');
  if (!base) return false;
  return responsive.variants.jpeg.every((v) => v.file.startsWith(base + '-'));
}

function buildPlainImg(image, rules) {
  return '<img src="' + escapeAttr(image.src) + '"' +
    ' width="' + image.width + '" height="' + image.height + '"' +
    ' alt="' + escapeAttr(image.alt || '') + '" loading="' + rules.loading + '"' +
    ' fetchpriority="' + rules.fetchpriority + '" decoding="async">';
}

function buildPicture(key, image, responsive, rules) {
  if (!manifestMatches(image, responsive)) return buildPlainImg(image, rules);
  const alt = escapeHtml(image.alt);
  const webpSrcset = responsive.variants.webp.map((v) => '/images/' + v.file + ' ' + v.width + 'w').join(', ');
  const jpegSrcset = responsive.variants.jpeg.map((v) => '/images/' + v.file + ' ' + v.width + 'w').join(', ');
  const fallbackFile = responsive.variants.jpeg[responsive.variants.jpeg.length - 1].file;
  return '<picture>' +
    '<source type="image/webp" srcset="' + webpSrcset + '" sizes="' + rules.sizes + '">' +
    '<img src="/images/' + fallbackFile + '" srcset="' + jpegSrcset + '" sizes="' + rules.sizes + '"' +
    ' width="' + image.width + '" height="' + image.height + '"' +
    ' alt="' + alt + '" loading="' + rules.loading + '" fetchpriority="' + rules.fetchpriority + '" decoding="async">' +
    '</picture>';
}

export function renderImage(key, content, responsiveManifest, rulesOverride) {
  const rules = rulesOverride || IMAGE_RENDER_RULES[key] || { loading: 'lazy', fetchpriority: 'auto', sizes: '100vw' };
  return buildPicture(key, content.images[key], responsiveManifest[key], rules);
}

export function applyImageEdits(html, imagesMap, responsiveManifest) {
  let out = html;
  for (const key of Object.keys(imagesMap)) {
    const marker = 'data-img="' + key + '"';
    const markerIndex = out.indexOf(marker);
    if (markerIndex === -1) continue;
    const imgStart = out.indexOf('<img', markerIndex);
    if (imgStart === -1) continue;
    const imgEnd = out.indexOf('>', imgStart) + 1;
    const rules = IMAGE_RENDER_RULES[key] || { loading: 'lazy', fetchpriority: 'auto', sizes: '100vw' };
    const picture = buildPicture(key, imagesMap[key], responsiveManifest[key], rules);
    out = out.slice(0, imgStart) + picture + out.slice(imgEnd);
  }
  return out;
}

export function injectResumeExtras(html, resumeExtra, responsiveManifest) {
  if (!resumeExtra || resumeExtra.length === 0) return html;
  const marker = '<p class="rcp-note">';
  const markerIndex = html.indexOf(marker);
  if (markerIndex === -1) return html;
  const rules = { loading: 'lazy', fetchpriority: 'auto', sizes: '(max-width: 760px) 45vw, 280px' };
  let cardsHtml = '';
  resumeExtra.forEach((image, i) => {
    if (!responsiveManifest[image.id]) return;
    const title = image.caption || image.alt;
    const picture = renderImage(image.id, { images: { [image.id]: image } }, responsiveManifest, rules);
    cardsHtml += '<article class="rcp-c rise" style="--i:' + (4 + i) + '">\n<div class="rcp-shot">' + picture + '</div>\n';
    cardsHtml += '<div class="rcp-txt">';
    if (image.source) cardsHtml += '<span class="rcp-yr">' + escapeHtml(image.source) + '</span>';
    cardsHtml += '<h3>' + escapeHtml(title) + '</h3></div>\n</article>\n';
  });
  return html.slice(0, markerIndex) + cardsHtml + html.slice(markerIndex);
}

export function fixAreaLinks(html) {
  let out = html;
  for (const name of AREA_SERVED) {
    const slug = name.toLowerCase().replace(/\s+/g, '-');
    const anchorMarker = '<b>' + name + '</b>';
    const anchorIndex = out.indexOf(anchorMarker);
    if (anchorIndex === -1) continue;
    const hrefStart = out.lastIndexOf('href="#contact"', anchorIndex);
    if (hrefStart === -1) continue;
    out = out.slice(0, hrefStart) + 'href="/basketball-training/' + slug + '"' + out.slice(hrefStart + 'href="#contact"'.length);
  }
  return out;
}

export function trimContactSection(contactHtml) {
  const end = contactHtml.indexOf('</section>');
  if (end === -1) return contactHtml;
  return contactHtml.slice(0, end + '</section>'.length) + '\n';
}

export function fixContactForm(html) {
  let out = html;
  out = out.replace(
    '<form id="ctForm" novalidate>',
    '<form id="ctForm" name="contact" method="POST" data-netlify="true" netlify-honeypot="ct-hp" novalidate><input type="hidden" name="form-name" value="contact"><p class="ct-hp-wrap" style="position:absolute;left:-9999px;"><label>Leave this field blank<input type="text" name="ct-hp" tabindex="-1" autocomplete="off"></label></p>'
  );
  return out;
}

// The Area <select> lives in the contact template, which is out of bounds for this
// change (a leaf hook can't drive an <option> list). Rewriting it at build time, the
// same way fixPlaybookForm rewrites #pbPos/#pbFocus below, keeps one source — area.N.name
// — for the tiles, the footer and this form instead of a fourth hand-typed copy.
export function fixContactAreaSelect(html, content) {
  const options = deriveAreaNames(content, 5).map((name) => '<option>' + escapeHtml(name) + '</option>').join('') + '<option>Other</option>';
  return html.replace(/<select id="cArea" name="area">[\s\S]*?<\/select>/, '<select id="cArea" name="area">' + options + '</select>');
}

export function fixPlaybookForm(html, playbookTemplates) {
  let out = html.replace(
    '<form id="pbForm" novalidate>',
    '<form id="pbForm" novalidate><p style="position:absolute;left:-9999px;"><label>Leave this field blank<input type="text" name="pb-hp" id="pbHp" tabindex="-1" autocomplete="off"></label></p>'
  );
  const posOptions = playbookTemplates.positions.map((p) => '<option value="' + escapeHtml(p.id) + '">' + escapeHtml(p.label) + '</option>').join('');
  const focusOptions = playbookTemplates.skill_gaps.map((g) => '<option value="' + escapeHtml(g.id) + '">' + escapeHtml(g.label) + '</option>').join('');
  out = out.replace(/<select id="pbPos" name="position">[\s\S]*?<\/select>/, '<select id="pbPos" name="position">' + posOptions + '</select>');
  out = out.replace(/<select id="pbFocus" name="focus">[\s\S]*?<\/select>/, '<select id="pbFocus" name="focus">' + focusOptions + '</select>');
  return out;
}

// ---------------------------------------------------------------------------
// Group reordering (content.order). See src/lib/content-groups.mjs for the registry
// of reorderable groups — which section each lives in and the container/item CLASS
// names to match on.
// ---------------------------------------------------------------------------

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

// Finds the full extent of the element opening at `openStart` (the index of its '<'),
// counting nested same-name open/close tags so a wrapper holding another element of the
// SAME tag name (a <div> containing another <div>) resolves to the right close tag.
// A regex alone cannot do this: /<\/div>/ matches the FIRST </div> in the string, which
// belongs to the INNER element, not the one this scan started from.
export function scanBalancedElement(html, openStart) {
  const nameMatch = /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(html.slice(openStart));
  if (!nameMatch) return null;
  const tagName = nameMatch[1];
  const openTagEnd = html.indexOf('>', openStart);
  if (openTagEnd === -1) return null;
  // Void elements (<img>, <br>...) and an explicit self-close (<foo/>) never open a
  // nested scope, so they resolve immediately with no scan.
  if (VOID_TAGS.has(tagName.toLowerCase()) || html[openTagEnd - 1] === '/') {
    return { start: openStart, openTagEnd, contentStart: openTagEnd + 1, closeStart: openTagEnd + 1, end: openTagEnd + 1, tagName };
  }
  const openRe = new RegExp('<' + tagName + '(?=[\\s/>])', 'gi');
  const closeRe = new RegExp('</' + tagName + '\\s*>', 'gi');
  let depth = 1;
  let cursor = openTagEnd + 1;
  let closeStart = -1;
  while (depth > 0) {
    closeRe.lastIndex = cursor;
    const nextClose = closeRe.exec(html);
    if (!nextClose) return null; // unbalanced markup — callers fall back rather than throw.
    openRe.lastIndex = cursor;
    const nextOpen = openRe.exec(html);
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth += 1;
      cursor = nextOpen.index + 1;
    } else {
      depth -= 1;
      closeStart = nextClose.index;
      cursor = nextClose.index + nextClose[0].length;
    }
  }
  return { start: openStart, openTagEnd, contentStart: openTagEnd + 1, closeStart, end: cursor, tagName };
}

// Direct children only: each child's own scanBalancedElement span is consumed whole
// before the walk looks for the next '<', so an item-classed element nested INSIDE a
// non-item wrapper is never mistaken for a direct child.
function walkChildren(html, start, end) {
  const children = [];
  let i = start;
  while (i < end) {
    const lt = html.indexOf('<', i);
    if (lt === -1 || lt >= end) break;
    if (html.startsWith('<!--', lt)) {
      const commentEnd = html.indexOf('-->', lt);
      i = (commentEnd === -1 || commentEnd > end) ? end : commentEnd + 3;
      continue;
    }
    if (html[lt + 1] === '/') break; // reached the container's own close tag
    const el = scanBalancedElement(html, lt);
    if (!el) { i = lt + 1; continue; }
    children.push(el);
    i = el.end;
  }
  return children;
}

const TAG_OPEN_RE = /<([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g;

function classTokens(tagAttrs) {
  const m = /\bclass\s*=\s*"([^"]*)"/.exec(tagAttrs);
  return m ? m[1].split(/\s+/).filter(Boolean) : [];
}

// First element anywhere in `html` whose class attribute carries `token` as a whole
// whitespace-delimited class — never a substring match, so "area" can never match "areas".
function findContainer(html, token) {
  TAG_OPEN_RE.lastIndex = 0;
  let m;
  while ((m = TAG_OPEN_RE.exec(html))) {
    if (classTokens(m[2]).includes(token)) return m.index;
  }
  return -1;
}

function hasClassToken(html, el, token) {
  return classTokens(html.slice(el.start, el.openTagEnd + 1)).includes(token);
}

// A bad or absent order always resolves to natural (identity) order rather than
// throwing — a typo'd content.json order array must never take the build down.
function normalizeOrder(rawOrder, n, groupId) {
  const natural = Array.from({ length: n }, (_, i) => i);
  if (!Array.isArray(rawOrder) || rawOrder.length !== n) {
    if (rawOrder !== undefined) console.warn('content.order.' + groupId + ': expected a ' + n + '-item permutation, got ' + JSON.stringify(rawOrder) + ' — using natural order.');
    return natural;
  }
  const seen = new Set();
  for (const v of rawOrder) {
    if (!Number.isInteger(v) || v < 0 || v >= n || seen.has(v)) {
      console.warn('content.order.' + groupId + ': ' + JSON.stringify(rawOrder) + ' is not a permutation of 0..' + (n - 1) + ' — using natural order.');
      return natural;
    }
    seen.add(v);
  }
  return rawOrder;
}

function injectGroupMarker(itemHtml, tagName, groupId, originalIndex) {
  const insertAt = 1 + tagName.length; // right after '<tagName'
  return itemHtml.slice(0, insertAt) + ' data-group="' + groupId + '" data-gi="' + originalIndex + '"' + itemHtml.slice(insertAt);
}

function renumberVarIndex(itemHtml, visualIndex) {
  const openTagEnd = itemHtml.indexOf('>');
  return itemHtml.slice(0, openTagEnd + 1).replace(/(--i:)-?\d+/, '$1' + visualIndex) + itemHtml.slice(openTagEnd + 1);
}

// Reorders one group's items within `html` per an explicit order array (or falls back to
// natural order — see normalizeOrder). Exported alongside applyGroupOrder so the "non-item
// siblings inside a container are never moved" scoping proof can run against a shape (the
// playbook sample sheet) that is deliberately NOT in the CONTENT_GROUPS registry.
export function reorderGroup(html, group, rawOrder) {
  const containerStart = findContainer(html, group.container);
  if (containerStart === -1) return html;
  const containerEl = scanBalancedElement(html, containerStart);
  if (!containerEl) return html;

  const children = walkChildren(html, containerEl.contentStart, containerEl.closeStart);
  const items = children.filter((c) => hasClassToken(html, c, group.item));
  if (items.length === 0) return html;

  const order = normalizeOrder(rawOrder, items.length, group.id);
  const originalTexts = items.map((it) => html.slice(it.start, it.end));
  const pieces = order.map((originalIndex, visualIndex) => {
    let text = injectGroupMarker(originalTexts[originalIndex], items[originalIndex].tagName, group.id, originalIndex);
    if (group.renumberVar) text = renumberVarIndex(text, visualIndex);
    return text;
  });

  let rebuilt = '';
  let cursor = containerEl.contentStart;
  let slot = 0;
  for (const child of children) {
    rebuilt += html.slice(cursor, child.start);
    rebuilt += hasClassToken(html, child, group.item) ? pieces[slot++] : html.slice(child.start, child.end);
    cursor = child.end;
  }
  rebuilt += html.slice(cursor, containerEl.closeStart);

  return html.slice(0, containerEl.contentStart) + rebuilt + html.slice(containerEl.closeStart);
}

// The build-time reorder engine's public entry point (Slice P / Slice E contract). Runs
// every registered group over `html` in one pass; a group whose container is not present
// in this particular HTML fragment (e.g. the contact page's own body, before the FAQ
// section is appended) is simply left untouched. Called LAST, after every text/attr/image
// edit, in every path that assembles page HTML — so the editor's preview and the real
// build reorder identically.
export function applyGroupOrder(html, order) {
  let out = html;
  for (const group of CONTENT_GROUPS) {
    out = reorderGroup(out, group, order && order[group.id]);
  }
  return out;
}

export function trimToFirstSectionClose(html) {
  const end = html.indexOf('</section>');
  if (end === -1) return html;
  return html.slice(0, end + '</section>'.length) + '\n';
}

function fontPreloadLinks() {
  return '<link rel="preload" href="/fonts/anton-400-normal.woff2" as="font" type="font/woff2" crossorigin>';
}

export function stylesheetLinks() {
  return '<link rel="stylesheet" href="' + asset('/styles/tokens.css') + '">' +
    '<link rel="stylesheet" href="' + asset('/styles/fonts.css') + '">' +
    '<link rel="stylesheet" href="' + asset('/styles/base.css') + '">' +
    '<link rel="stylesheet" href="' + asset('/styles/site.css') + '">' +
    '<link rel="stylesheet" href="' + asset('/styles/features.css') + '">' +
    // fb-polish.css carries the light theme and the night-court styling, and it must
    // load LAST so it can override the base cascade. It went missing from the repo
    // entirely — it existed only inside the preview6 build output.
    '<link rel="stylesheet" href="' + asset('/styles/fb-polish.css') + '">';
}

// theme.js is the one script that cannot be deferred. It reads localStorage and puts
// .fb-light on <html> before first paint; loading it any later means every visitor in
// light mode gets a black flash first.
function themeScript() {
  return '<script src="' + asset('/js/theme.js') + '"></script>';
}

function heroPreload(content, responsiveManifest) {
  const image = content.images['hero.nets'];
  const responsive = responsiveManifest && responsiveManifest['hero.nets'];
  const rules = IMAGE_RENDER_RULES['hero.nets'];
  if (!responsive) {
    return '<link rel="preload" as="image" href="' + image.src + '" fetchpriority="high">';
  }
  const jpegSrcset = responsive.variants.jpeg.map((v) => '/images/' + v.file + ' ' + v.width + 'w').join(', ');
  const fallback = '/images/' + responsive.variants.jpeg[0].file;
  return '<link rel="preload" as="image" href="' + fallback + '" imagesrcset="' + jpegSrcset + '" imagesizes="' + rules.sizes + '" fetchpriority="high">';
}

// Motion settings ride content.json's top-level `motion` object (owner-editable through
// the admin panel). Every field defaults to "fully on" so an un-seeded content.json
// renders exactly the animation the site always has — defaults must be inert.
const MOTION_DEFAULTS = { enabled: true, speed: 1, intro: true, ticker: true, tickerSeconds: 38, reveals: true, countUp: true, nightAmbient: true };

function deriveMotion(content) {
  const m = (content && content.motion) || {};
  return {
    enabled: m.enabled !== false,
    speed: typeof m.speed === 'number' ? m.speed : MOTION_DEFAULTS.speed,
    intro: m.intro !== false,
    ticker: m.ticker !== false,
    tickerSeconds: typeof m.tickerSeconds === 'number' ? m.tickerSeconds : MOTION_DEFAULTS.tickerSeconds,
    reveals: m.reveals !== false,
    countUp: m.countUp !== false,
    nightAmbient: m.nightAmbient !== false
  };
}

// Attributes are only emitted for a system that is actually OFF. At the default (every
// system on) this returns '', so a page's <html> tag is untouched and the golden diff
// stays limited to the style/script tags below.
function motionHtmlAttrs(motion) {
  let attrs = '';
  if (!motion.enabled) attrs += ' data-motion="off"';
  if (!motion.intro) attrs += ' data-intro="off"';
  if (!motion.ticker) attrs += ' data-ticker="off"';
  if (!motion.reveals) attrs += ' data-reveals="off"';
  if (!motion.nightAmbient) attrs += ' data-night="off"';
  return attrs;
}

// The motion object is owner data, not visitor data, but it still reaches a <script>
// tag verbatim — JSON.stringify already quotes everything, so the only character that
// could break out of the tag is a literal "<" (as in "</script>"), which < defuses
// without touching the JSON's meaning.
function motionScriptTag(motion) {
  const json = JSON.stringify(motion).replace(/</g, '\\u003c');
  return '<script>window.__FB_MOTION=' + json + ';</script>';
}

// robots and extraStyles both default to today's behaviour so no existing page's
// output moves. Canvas pages are the only callers that pass them: draft pages set
// robots to noindex, and only canvas pages pull in the two canvas stylesheets, which
// keeps those bytes off the 16 pages that do not use them.
export function buildHead({ title, description, canonicalPath, ogImage, includeHeroPreload, content, responsiveManifest, jsonLd = [], robots = 'index, follow', extraStyles = [] }) {
  const canonical = absoluteUrl(canonicalPath);
  const ogImagePath = ogImage ? absoluteUrl(ogImage) : absoluteUrl('/brand/og-image-1200x630.png');
  const motion = deriveMotion(content);
  let head = '<!DOCTYPE html>\n<html lang="en"' + motionHtmlAttrs(motion) + '>\n<head>\n';
  head += '<meta charset="UTF-8">\n';
  head += '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n';
  head += '<title>' + escapeHtml(title) + '</title>\n';
  head += '<meta name="description" content="' + escapeHtml(description) + '">\n';
  head += '<meta name="robots" content="' + robots + '">\n';
  head += '<link rel="canonical" href="' + canonical + '">\n';
  head += '<meta property="og:type" content="website">\n';
  head += '<meta property="og:title" content="' + escapeHtml(title) + '">\n';
  head += '<meta property="og:description" content="' + escapeHtml(description) + '">\n';
  head += '<meta property="og:url" content="' + canonical + '">\n';
  head += '<meta property="og:image" content="' + ogImagePath + '">\n';
  head += '<meta name="twitter:card" content="summary_large_image">\n';
  head += '<meta name="theme-color" content="#0A0A0C">\n';
  head += '<link rel="icon" href="/favicon.ico" sizes="48x48">\n';
  head += '<link rel="icon" type="image/png" sizes="32x32" href="/brand/favicon-32.png">\n';
  head += '<link rel="icon" type="image/png" sizes="16x16" href="/brand/favicon-16.png">\n';
  head += '<link rel="apple-touch-icon" href="/brand/apple-touch-icon-180.png">\n';
  if (includeHeroPreload) head += heroPreload(content, responsiveManifest) + '\n';
  head += fontPreloadLinks() + '\n';
  head += stylesheetLinks() + extraStyles.map((href) => '<link rel="stylesheet" href="' + asset(href) + '">').join('') + '\n';
  head += themeScript() + '\n';
  // Emitted on every page, at every setting: the CSS vars have to exist before any
  // animation reads them, and the script has to run before main.js (deferred, so it
  // always executes after every plain <script> in <head>) so window.__FB_MOTION is
  // never read as undefined.
  head += '<style id="fb-motion">:root{--motion-speed:' + motion.speed + ';--t-ticker:' + motion.tickerSeconds + 's}</style>\n';
  head += motionScriptTag(motion) + '\n';
  // The second selector is not redundant: .rcp-c.rise:not(.in) .rcp-shot img and
  // .coach-img.rise:not(.in) img hide the DESCENDANT image, so unhiding .rise alone
  // left the resume photos, the portrait and the badge invisible without JS.
  head += '<noscript><style>.zr,.rise{opacity:1 !important;transform:none !important;filter:none !important}'
    + '.rcp-c .rcp-shot img,.coach-img img,.coach-badge{opacity:1 !important;animation:none !important}</style></noscript>\n';
  for (const data of jsonLd) head += jsonLdScript(data) + '\n';
  head += '</head>\n';
  return head;
}

// Exported because suburb-page.mjs and coach-page.mjs each hand-wrote their own copy
// of this tag. When asset() added content-hash cache-busting, those two copies did not
// get it — so six pages would have served a stale main.js to returning visitors for a
// year, which is the exact bug the hashing exists to prevent. One definition now.
export function scriptsBlock() {
  return '<script src="' + asset('/js/main.js') + '" defer></script>\n';
}

// The night-court slingshot. type="module" is deliberate — it is deferred by default
// and gets its own scope, and main.js calls into it through window.fbNiteMade.
export function nightCourtScript() {
  return '<script type="module" src="' + asset('/js/night-court.js') + '"></script>\n';
}

export function assembleHomepage({ sections, prelude, content, responsiveManifest, playbookTemplates, suburbs = [] }) {
  // Anchor past </head> first: the head carries comments that mention <body>/<nav>
  // literally, and a bare indexOf('<body') matches the comment instead of the tag,
  // which ships the comment tail as visible copy and wraps the page in a phantom <nav>.
  const bodyStart = prelude.indexOf('<body', prelude.indexOf('</head>'));
  const bodyMarkup = prelude.slice(bodyStart);

  // One string for the meta description and the entity description, so the two
  // cannot describe the business differently. meta.desc can override the page's own
  // description, but the JSON-LD business entity keeps this exact constant — the
  // contract only asks the <title>/meta description/og tags to read from content.text.
  const HOMEPAGE_DESCRIPTION = 'Private basketball training in north Broward County with Coach Blake Kingsley, on staff for two championship programs in two years including the 2025 Horizon League champion Robert Morris Colonials. Serving Coral Springs, Parkland, Coconut Creek, Margate and Tamarac.';
  const HOMEPAGE_TITLE = 'Fast Basketball | Private Basketball Training in Coral Springs, FL | Coach Blake Kingsley';

  let page = '';
  page += buildHead({
    title: content.text['meta.title'] || HOMEPAGE_TITLE,
    description: content.text['meta.desc'] || HOMEPAGE_DESCRIPTION,
    canonicalPath: '/',
    includeHeroPreload: true,
    content,
    responsiveManifest,
    jsonLd: [
      // The canonical business entity. It lived in _prelude.html's <head>, which the
      // build never emits, so the homepage shipped no business identity at all.
      businessEntity({ description: HOMEPAGE_DESCRIPTION, email: 'coach@kingfastbasketball.com', suburbs }),
      faqPage(deriveFaqPairs(content)),
      breadcrumbList([{ name: 'Home', path: '/' }])
    ]
  });

  let body = bodyMarkup;
  for (const id of SECTION_IDS) {
    if (id === 'contact') {
      body += trimContactSection(sections[id]);
    } else {
      body += sections[id];
    }
  }
  body = applyTextEdits(body, content.text);
  body = applyAttrEdits(body, content.text);
  body = applyImageEdits(body, content.images, responsiveManifest);
  body = fixAreaLinks(body);
  body = fixContactForm(body);
  body = fixContactAreaSelect(body, content);
  body = injectResumeExtras(body, content.resumeExtra, responsiveManifest);
  if (playbookTemplates) body = fixPlaybookForm(body, playbookTemplates);
  body = applyGroupOrder(body, content.order);
  body += buildFooter({ content, anchors: true });
  // night-court.js first: it is a module, so it is deferred anyway, and main.js
  // reaches into it via window.fbNiteMade once both have run.
  body += nightCourtScript();
  body += scriptsBlock();
  body += '<script src="' + asset('/js/playbook-form.js') + '" defer></script>\n';
  body += '<script src="' + asset('/js/locker.js') + '" defer></script>\n';
  body += '<script src="' + asset('/js/contact-form.js') + '" defer></script>\n';
  body += '</body>\n</html>\n';

  return page + body;
}

export function buildFooter({ content, anchors = false } = {}) {
  const contactHref = anchors ? '#contact' : '/contact';
  const playbookHref = anchors ? '#playbook' : '/playbook';
  const text = (content && content.text) || {};
  const tagline = escapeHtml(text['ft.tagline'] || 'Private basketball training in north Broward. Built by a college coach for players chasing the next level.');
  const col1h = escapeHtml(text['ft.col1h'] || 'Training');
  const col2h = escapeHtml(text['ft.col2h'] || 'Areas');
  const col3h = escapeHtml(text['ft.col3h'] || 'More');
  const bot = escapeHtml(text['ft.bot'] || 'Fast Basketball. Elevate to Execute.');
  const city = escapeHtml(text['ft.city'] || 'Coral Springs, Florida');
  const mob1 = escapeHtml(text['ft.mob1'] || 'Free First Look');
  const mob2 = escapeHtml(text['ft.mob2'] || 'Free Playbook');
  const areaNames = deriveAreaNames(content, 4);
  return '<footer class="ft">\n' +
    '<div class="shell">\n' +
    '<div class="ft-top">\n' +
    '<div><a href="/" class="brand ft-brand" aria-label="Fast Basketball home">' +
    '<img class="only-dark" src="/brand/logo-white.svg" alt="Fast Basketball" width="250" height="106" loading="lazy" decoding="async">' +
    '<img class="only-light" src="/brand/logo.svg" alt="Fast Basketball" width="250" height="106" loading="lazy" decoding="async"></a>' +
    '<p style="color:#7E7E8A;font-size:.9rem;max-width:32ch;" data-edit="ft.tagline">' + tagline + '</p></div>\n' +
    '<div class="ft-nav">\n' +
    // Training stays PROGRAM_PAGES, not an owner-editable derivation: these labels are
    // the real <title>/H1 of the four /training/<slug> pages this column links to, so
    // editing them here without renaming those pages would make the footer lie.
    '<div class="ft-col"><h3 data-edit="ft.col1h">' + col1h + '</h3>' + PROGRAM_PAGES.map((p) => '<a href="' + p.path + '">' + escapeHtml(p.label) + '</a>').join('') + '</div>\n' +
    '<div class="ft-col"><h3 data-edit="ft.col2h">' + col2h + '</h3>' + areaNames.map((name) => '<a href="/basketball-training/' + name.toLowerCase().replace(/\s+/g, '-') + '">' + escapeHtml(name) + '</a>').join('') + '</div>\n' +
    '<div class="ft-col"><h3 data-edit="ft.col3h">' + col3h + '</h3><a href="/#receipts">The Résumé</a><a href="/coach-blake-kingsley">About Coach Blake</a><a href="/playbook">Free Playbook</a><a href="/#resources">The Locker</a></div>\n' +
    '</div>\n</div>\n' +
    // OWNER NOTE: the old line here claimed copyright and "all rights reserved".
    // Fast Basketball is pre-launch with no verified entity and no registered marks,
    // so that claim was removed. The name and tagline below assert nothing. Do not
    // put back a ©, a ™, or "all rights reserved" until a Florida attorney says so.
    // The Privacy and Terms pages are a good-faith starting point, not legal advice,
    // and should be reviewed by a Florida attorney before launch.
    '<div class="ft-bot"><span><span data-edit="ft.bot">' + bot + '</span> <a href="/privacy">Privacy</a> &middot; <a href="/terms">Terms</a></span><span data-edit="ft.city">' + city + '</span></div>\n' +
    '</div>\n</footer>\n' +
    '<div class="mob-bar" id="mobBar">\n' +
    '<a href="' + contactHref + '" class="btn btn-primary" data-edit="ft.mob1">' + mob1 + '</a>\n' +
    '<a href="' + playbookHref + '" class="btn btn-ghost" data-edit="ft.mob2">' + mob2 + '</a>\n' +
    '</div>\n' +
    '<div class="toast" id="toast" role="status" aria-live="polite"></div>\n';
}

export function buildNav(prelude) {
  const navStart = prelude.indexOf('<nav class="nav"');
  // Search the close tag from navStart, not from 0, so a </nav> mentioned in an
  // earlier head comment can never truncate the nav to an empty slice.
  const navEnd = prelude.indexOf('</nav>', navStart);
  if (navStart === -1 || navEnd === -1) return '';
  const raw = prelude.slice(navStart, navEnd + '</nav>'.length) + '\n';
  return '<a class="skip-link" href="#main">Skip to content</a>\n' + raw.replace(/href="#/g, 'href="/#');
}

export function buildSimplePage({ title, description, canonicalPath, bodyHtml, content, prelude, jsonLd = [], extraScripts = [], robots, extraStyles }) {
  let page = buildHead({ title, description, canonicalPath, includeHeroPreload: false, content, jsonLd, robots, extraStyles });
  page += '<body>\n';
  page += buildNav(prelude);
  page += bodyHtml;
  page += buildFooter({ content });
  page += scriptsBlock();
  for (const src of extraScripts) page += '<script src="' + asset(src) + '" defer></script>\n';
  page += '</body>\n</html>\n';
  return page;
}
