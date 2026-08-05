import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { absoluteUrl, AREA_SERVED, PROGRAM_PAGES } from './lib/site-config.mjs';
import { faqPage, jsonLdScript, breadcrumbList, businessEntity } from './lib/structured-data.mjs';

const SECTION_IDS = ['receipts', 'programs', 'method', 'coach', 'nights', 'playbook', 'resources', 'areas', 'contact'];

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
    const markerIndex = out.indexOf(marker);
    if (markerIndex === -1) continue;
    const tagOpenEnd = out.indexOf('>', markerIndex);
    const closeStart = out.indexOf('</', tagOpenEnd);
    if (tagOpenEnd === -1 || closeStart === -1) continue;
    out = out.slice(0, tagOpenEnd + 1) + escapeHtml(textMap[key]) + out.slice(closeStart);
  }
  return out;
}

function buildPicture(key, image, responsive, rules) {
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

export function trimToFirstSectionClose(html) {
  const end = html.indexOf('</section>');
  if (end === -1) return html;
  return html.slice(0, end + '</section>'.length) + '\n';
}

function fontPreloadLinks() {
  return '<link rel="preload" href="/fonts/anton-400-normal.woff2" as="font" type="font/woff2" crossorigin>';
}

function stylesheetLinks() {
  return '<link rel="stylesheet" href="/styles/tokens.css">' +
    '<link rel="stylesheet" href="/styles/fonts.css">' +
    '<link rel="stylesheet" href="/styles/base.css">' +
    '<link rel="stylesheet" href="/styles/site.css">' +
    '<link rel="stylesheet" href="/styles/features.css">';
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

export function buildHead({ title, description, canonicalPath, ogImage, includeHeroPreload, content, responsiveManifest, jsonLd = [] }) {
  const canonical = absoluteUrl(canonicalPath);
  const ogImagePath = ogImage ? absoluteUrl(ogImage) : absoluteUrl('/brand/og-image-1200x630.png');
  let head = '<!DOCTYPE html>\n<html lang="en">\n<head>\n';
  head += '<meta charset="UTF-8">\n';
  head += '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n';
  head += '<title>' + escapeHtml(title) + '</title>\n';
  head += '<meta name="description" content="' + escapeHtml(description) + '">\n';
  head += '<meta name="robots" content="index, follow">\n';
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
  head += stylesheetLinks() + '\n';
  // The second selector is not redundant: .rcp-c.rise:not(.in) .rcp-shot img and
  // .coach-img.rise:not(.in) img hide the DESCENDANT image, so unhiding .rise alone
  // left the resume photos, the portrait and the badge invisible without JS.
  head += '<noscript><style>.zr,.rise{opacity:1 !important;transform:none !important;filter:none !important}'
    + '.rcp-c .rcp-shot img,.coach-img img,.coach-badge{opacity:1 !important;animation:none !important}</style></noscript>\n';
  for (const data of jsonLd) head += jsonLdScript(data) + '\n';
  head += '</head>\n';
  return head;
}

function scriptsBlock() {
  return '<script src="/js/main.js" defer></script>\n';
}

export function assembleHomepage({ sections, prelude, content, responsiveManifest, playbookTemplates, suburbs = [] }) {
  // Anchor past </head> first: the head carries comments that mention <body>/<nav>
  // literally, and a bare indexOf('<body') matches the comment instead of the tag,
  // which ships the comment tail as visible copy and wraps the page in a phantom <nav>.
  const bodyStart = prelude.indexOf('<body', prelude.indexOf('</head>'));
  const bodyMarkup = prelude.slice(bodyStart);

  // One string for the meta description and the entity description, so the two
  // cannot describe the business differently.
  const HOMEPAGE_DESCRIPTION = 'Private basketball training in north Broward County with Coach Blake Kingsley, on staff for two championship programs in two years including the 2025 Horizon League champion Robert Morris Colonials. Serving Coral Springs, Parkland, Coconut Creek, Margate and Tamarac.';

  let page = '';
  page += buildHead({
    title: 'Fast Basketball | Private Basketball Training in Coral Springs, FL | Coach Blake Kingsley',
    description: HOMEPAGE_DESCRIPTION,
    canonicalPath: '/',
    includeHeroPreload: true,
    content,
    responsiveManifest,
    jsonLd: [
      // The canonical business entity. It lived in _prelude.html's <head>, which the
      // build never emits, so the homepage shipped no business identity at all.
      businessEntity({ description: HOMEPAGE_DESCRIPTION, email: 'coach@fastbasketball.com', suburbs }),
      faqPage(FAQ_PAIRS),
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
  body = applyImageEdits(body, content.images, responsiveManifest);
  body = fixAreaLinks(body);
  body = fixContactForm(body);
  body = injectResumeExtras(body, content.resumeExtra, responsiveManifest);
  if (playbookTemplates) body = fixPlaybookForm(body, playbookTemplates);
  body += buildFooter({ anchors: true });
  body += scriptsBlock();
  body += '<script src="/js/playbook-form.js" defer></script>\n';
  body += '<script src="/js/locker.js" defer></script>\n';
  body += '<script src="/js/contact-form.js" defer></script>\n';
  body += '</body>\n</html>\n';

  return page + body;
}

export function buildFooter({ anchors = false } = {}) {
  const contactHref = anchors ? '#contact' : '/contact';
  const playbookHref = anchors ? '#playbook' : '/playbook';
  return '<footer class="ft">\n' +
    '<div class="shell">\n' +
    '<div class="ft-top">\n' +
    '<div><a href="/" class="brand ft-brand" aria-label="Fast Basketball home"><img src="/brand/logo-white.svg" alt="Fast Basketball" width="250" height="106" loading="lazy" decoding="async"></a>' +
    '<p style="color:#7E7E8A;font-size:.9rem;max-width:32ch;">Private basketball training in north Broward. Built by a college coach for players chasing the next level.</p></div>\n' +
    '<div class="ft-nav">\n' +
    '<div class="ft-col"><h3>Training</h3>' + PROGRAM_PAGES.map((p) => '<a href="' + p.path + '">' + escapeHtml(p.label) + '</a>').join('') + '</div>\n' +
    '<div class="ft-col"><h3>Areas</h3>' + AREA_SERVED.slice(0, 4).map((name) => '<a href="/basketball-training/' + name.toLowerCase().replace(/\s+/g, '-') + '">' + escapeHtml(name) + '</a>').join('') + '</div>\n' +
    '<div class="ft-col"><h3>More</h3><a href="/#receipts">The Résumé</a><a href="/coach-blake-kingsley">About Coach Blake</a><a href="/playbook">Free Playbook</a><a href="/#resources">The Locker</a></div>\n' +
    '</div>\n</div>\n' +
    '<div class="ft-bot"><span>&copy; 2026 Fast Basketball. All rights reserved. <a href="/privacy">Privacy</a></span><span>Coral Springs, Florida</span></div>\n' +
    '</div>\n</footer>\n' +
    '<div class="mob-bar" id="mobBar">\n' +
    '<a href="' + contactHref + '" class="btn btn-primary">Free First Look</a>\n' +
    '<a href="' + playbookHref + '" class="btn btn-ghost">Free Playbook</a>\n' +
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

export function buildSimplePage({ title, description, canonicalPath, bodyHtml, content, prelude, jsonLd = [], extraScripts = [] }) {
  let page = buildHead({ title, description, canonicalPath, includeHeroPreload: false, content, jsonLd });
  page += '<body>\n';
  page += buildNav(prelude);
  page += bodyHtml;
  page += buildFooter();
  page += scriptsBlock();
  for (const src of extraScripts) page += '<script src="' + src + '" defer></script>\n';
  page += '</body>\n</html>\n';
  return page;
}
