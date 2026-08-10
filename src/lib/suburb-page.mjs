import { readFileSync } from 'node:fs';
import { renderCredentialBlock } from './credential.mjs';
import { renderResumeCards } from './coach-page.mjs';
import { schoolsProse, venuesProse, drivingProse, landmarksProse, neighborsProse, whyHereProse, slugToName } from './suburb-copy.mjs';
import { suburbService, breadcrumbList, jsonLdScript } from './structured-data.mjs';
import { PROGRAM_PAGES } from './site-config.mjs';
import { buildHead, buildNav, buildFooter, renderImage, escapeHtml, scriptsBlock } from '../render.mjs';

// build.mjs regenerates responsive-manifest.json mid-build and does not hand it
// to this renderer, so read it at call time (after that regeneration) rather
// than at import time. Passing responsiveManifest in skips the read.
function loadResponsiveManifest() {
  return JSON.parse(readFileSync(new URL('../data/responsive-manifest.json', import.meta.url), 'utf8'));
}

// Visible trail mirrors the BreadcrumbList JSON-LD on the same page. The bare
// <div> wrapper exists only to give the inline-flex .eyebrow its own line; no
// new CSS is involved.
function breadcrumbTrail(suburb) {
  return '<div><nav class="eyebrow" aria-label="Breadcrumb">' +
    '<a href="/">Home</a><span aria-hidden="true">/</span>' +
    '<a href="/#areas">Service Areas</a><span aria-hidden="true">/</span>' +
    '<span aria-current="page">' + escapeHtml(suburb.name) + '</span>' +
    '</nav></div>\n';
}

export function suburbWordCount(suburb) {
  const text = [
    suburb.local_paragraph,
    schoolsProse(suburb),
    venuesProse(suburb),
    drivingProse(suburb),
    landmarksProse(suburb),
    whyHereProse(suburb),
    neighborsProse(suburb)
  ].join(' ').replace(/<[^>]+>/g, ' ');
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function renderSuburbPage({ suburb, content, prelude, responsiveManifest = loadResponsiveManifest() }) {
  const title = suburb.meta_title;
  const description = suburb.meta_description;
  const canonicalPath = '/basketball-training/' + suburb.slug;

  const jsonLd = [
    // No per-city LocalBusiness: that declared one business per city, each with a
    // fabricated PostalAddress. The Service now points at the single real entity.
    suburbService(suburb),
    breadcrumbList([
      { name: 'Home', path: '/' },
      { name: 'Service Areas', path: '/#areas' },
      { name: suburb.name, path: canonicalPath }
    ])
  ];

  // Hero borrows the homepage/coach .coach grid. Copy comes first in source so
  // the <h1> still leads on mobile, where .coach collapses to one column.
  let body = '<main id="main">\n';
  body += '<header class="band band-dark suburb-hero">\n<div class="shell coach">\n';
  body += '<div class="coach-body">\n';
  body += breadcrumbTrail(suburb);
  body += '<div class="eyebrow">' + escapeHtml(suburb.county) + ' Service Area</div>\n';
  body += '<h1>Basketball Training in <span class="hollow">' + escapeHtml(suburb.name) + '</span></h1>\n';
  body += '<p class="lede">' + escapeHtml(suburb.local_paragraph) + '</p>\n';
  body += '<a href="/training/first-look" class="btn btn-primary">Book a First Look in ' + escapeHtml(suburb.name) + '</a>\n';
  body += '</div>\n';
  body += '<div class="coach-img">' + renderImage('hero.nets', content, responsiveManifest, { loading: 'eager', fetchpriority: 'high', sizes: '(max-width: 760px) 90vw, 640px' }) + '</div>\n';
  body += '</div>\n</header>\n';

  body += '<section class="band band-ink">\n<div class="shell">\n<div class="eyebrow rise">Local Schools</div>\n<h2 class="zr">Schools and programs in ' + escapeHtml(suburb.name) + '</h2>\n';
  body += '<p class="rise">' + schoolsProse(suburb) + '</p>\n</div>\n</section>\n';

  body += '<section class="band band-light">\n<div class="shell">\n<div class="eyebrow rise">The Courts</div>\n<h2 class="zr">Where we train in ' + escapeHtml(suburb.name) + '</h2>\n';
  body += '<p class="rise">' + venuesProse(suburb) + '</p>\n';
  const driving = drivingProse(suburb);
  if (driving) body += '<p class="rise">' + driving + '</p>\n';
  const landmarks = landmarksProse(suburb);
  if (landmarks) body += '<p class="rise">' + landmarks + '</p>\n';
  body += '</div>\n</section>\n';

  body += '<section class="band band-ink">\n<div class="shell">\n<div class="eyebrow rise">Why Here</div>\n<h2 class="zr">Why ' + escapeHtml(suburb.name) + ' families choose Fast Basketball</h2>\n';
  body += '<p class="rise">' + whyHereProse(suburb) + '</p>\n</div>\n</section>\n';

  // Portrait left, copy right — same shape as the homepage #coach section. No
  // .rise on .coach-img (base.css hides its <img> until JS adds .in) and so no
  // .coach-badge either, which base.css only reveals on .coach-img.in.
  body += '<section class="band band-dark">\n<div class="shell coach">\n';
  body += '<div class="coach-img">' + renderImage('coach.portrait', content, responsiveManifest, { loading: 'lazy', fetchpriority: 'auto', sizes: '(max-width: 760px) 90vw, 500px' }) + '</div>\n';
  body += '<div class="coach-body">\n<div class="eyebrow rise">Meet Your Coach</div>\n<h2 class="zr">The coach</h2>\n';
  body += renderCredentialBlock() + '\n</div>\n</div>\n</section>\n';

  body += '<section class="band band-ink">\n<div class="shell">\n<div class="head">\n<div class="eyebrow rise">The Résumé</div>\n<h2 class="zr">The record</h2>\n</div>\n';
  body += renderResumeCards(content, responsiveManifest);
  body += '</div>\n</section>\n';

  body += '<section class="band band-light">\n<div class="shell">\n<div class="eyebrow rise">Programs</div>\n<h2 class="zr">Programs available in ' + escapeHtml(suburb.name) + '</h2>\n<ul class="suburb-programs">\n';
  for (const p of PROGRAM_PAGES) {
    body += '<li><a href="' + p.path + '">' + escapeHtml(p.label) + '</a></li>\n';
  }
  body += '</ul>\n</div>\n</section>\n';

  const neighbors = neighborsProse(suburb);
  if (neighbors) {
    body += '<section class="band band-ink">\n<div class="shell">\n<div class="eyebrow rise">Close By</div>\n<h2 class="zr">Nearby areas we also serve</h2>\n<p class="rise">' + neighbors + '</p>\n</div>\n</section>\n';
  }

  body += '<section class="band band-dark">\n<div class="shell">\n<div class="eyebrow rise">First Step</div>\n<h2 class="zr">Start with a First Look in ' + escapeHtml(suburb.name) + '</h2>\n';
  body += '<p class="lede rise">One free hour on court. A straight read on where your player stands, and a written plan for what comes next.</p>\n';
  body += '<p><a href="/contact" class="btn btn-primary">Contact Coach Blake</a></p>\n</div>\n</section>\n';
  body += '</main>\n';

  let page = buildHead({ title, description, canonicalPath, includeHeroPreload: false, content, jsonLd });
  page += '<body>\n';
  page += buildNav(prelude);
  page += body;
  page += buildFooter({ content });
  page += scriptsBlock();
  page += '</body>\n</html>\n';
  return page;
}

export { slugToName };
