import { renderCredentialBlock } from './credential.mjs';
import { schoolsProse, venuesProse, drivingProse, landmarksProse, neighborsProse, whyHereProse, slugToName } from './suburb-copy.mjs';
import { suburbLocalBusiness, suburbService, breadcrumbList, jsonLdScript } from './structured-data.mjs';
import { PROGRAM_PAGES } from './site-config.mjs';
import { buildHead, buildNav, buildFooter, escapeHtml } from '../render.mjs';

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

export function renderSuburbPage({ suburb, content, prelude }) {
  const title = suburb.meta_title;
  const description = suburb.meta_description;
  const canonicalPath = '/basketball-training/' + suburb.slug;

  const jsonLd = [
    suburbLocalBusiness(suburb),
    suburbService(suburb),
    breadcrumbList([
      { name: 'Home', path: '/' },
      { name: 'Service Areas', path: '/#areas' },
      { name: suburb.name, path: canonicalPath }
    ])
  ];

  let body = '<main>\n';
  body += '<header class="band band-dark suburb-hero">\n<div class="shell">\n';
  body += '<div class="eyebrow">' + escapeHtml(suburb.county) + ' Service Area</div>\n';
  body += '<h1>Basketball Training in <span class="hollow">' + escapeHtml(suburb.name) + '</span></h1>\n';
  body += '<p class="lede">' + escapeHtml(suburb.local_paragraph) + '</p>\n';
  body += '<a href="/training/first-look" class="btn btn-primary">Book a First Look in ' + escapeHtml(suburb.name) + '</a>\n';
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

  body += '<section class="band band-dark">\n<div class="shell">\n<div class="eyebrow rise">Meet Your Coach</div>\n<h2 class="zr">The coach</h2>\n';
  body += renderCredentialBlock() + '\n</div>\n</section>\n';

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
  page += buildFooter();
  page += '<script src="/js/main.js" defer></script>\n';
  page += '</body>\n</html>\n';
  return page;
}

export { slugToName };
