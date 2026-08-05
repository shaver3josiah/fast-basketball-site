import { buildHead, buildNav, buildFooter, renderImage, escapeHtml } from '../render.mjs';
import { founderPerson, breadcrumbList, jsonLdScript } from './structured-data.mjs';

const RESUME_KEYS = ['rcp.trophy', 'rcp.team', 'rcp.juco', 'rcp.work'];

// Same card body copy the homepage receipts section ships, verbatim from
// src/templates/sections/receipts.html. Cards without an entry (resumeExtra)
// render caption-only, exactly as they do on the homepage.
const RESUME_BODY = {
  'rcp.trophy': "Robert Morris beat Youngstown State 89 to 78 for the program's first Horizon League title.",
  'rcp.team': 'Development is the point. RMU placed multiple players on the All-Tournament Team.',
  'rcp.juco': 'Moberly Area went 25 and 7 and won the region, sending players on to four year programs.',
  'rcp.work': 'The standard he asks for is the one he holds himself to. That is why players buy in.'
};

// The suburb landing pages shipped with no imagery at all, and they make the
// same championship claims this grid is the proof for. One renderer, two
// callers, so the cards and their copy never drift apart.
export function renderResumeCards(content, responsiveManifest) {
  const extraImages = {};
  for (const image of content.resumeExtra || []) extraImages[image.id] = image;
  const cardSource = { images: { ...content.images, ...extraImages } };
  const cardKeys = RESUME_KEYS.concat((content.resumeExtra || []).map((image) => image.id));

  let out = '<div class="rcp stg">\n';
  cardKeys.forEach((key, i) => {
    const image = cardSource.images[key];
    if (!image || !responsiveManifest[key]) return;
    // No .rise on the card: base.css hides .rcp-c.rise:not(.in) .rcp-shot img,
    // and the <noscript> fallback only unhides .rise itself, not the image.
    out += '<article class="rcp-c" style="--i:' + i + '">\n<div class="rcp-shot">' + renderImage(key, cardSource, responsiveManifest) + '</div>\n';
    out += '<div class="rcp-txt">';
    if (image.source) out += '<span class="rcp-yr">' + escapeHtml(image.source) + '</span>';
    out += '<h3>' + escapeHtml(image.caption || image.alt) + '</h3>';
    if (RESUME_BODY[key]) out += '<p>' + escapeHtml(RESUME_BODY[key]) + '</p>';
    out += '</div>\n</article>\n';
  });
  return out + '</div>\n';
}

export function renderCoachPage({ content, responsiveManifest, prelude }) {
  const title = 'Coach Blake Kingsley | Founder, Fast Basketball Miami';
  const description = 'Coach Blake Kingsley was on staff for the 2025 Horizon League champion Robert Morris Colonials and the 2024 NJCAA Region 16 champion Moberly Area. Now training players in Miami.';
  const canonicalPath = '/coach-blake-kingsley';

  const jsonLd = [
    { '@context': 'https://schema.org', ...founderPerson() },
    breadcrumbList([{ name: 'Home', path: '/' }, { name: 'Coach Blake Kingsley', path: canonicalPath }])
  ];

  let body = '<main id="main">\n';
  // .coach is the two-column grid and belongs on .shell ONLY. With it also on the
  // band, the band grid-split with a single child, stranding 1.12fr of empty black
  // and squeezing the bio to ~26 characters per line at desktop.
  body += '<header class="band band-dark">\n<div class="shell coach">\n';
  body += '<div class="coach-img">' + renderImage('coach.portrait', content, responsiveManifest, { loading: 'eager', fetchpriority: 'high', sizes: '(max-width: 760px) 90vw, 420px' }) + '</div>\n';
  body += '<div class="coach-body">\n<div class="eyebrow">Meet Your Coach</div>\n';
  body += '<h1>' + escapeHtml(content.text['coach.name']) + '</h1>\n<p class="lede">' + escapeHtml(content.text['coach.title']) + '</p>\n';
  body += '<p>' + escapeHtml(content.text['coach.p1']) + '</p>\n';
  body += '<p>' + escapeHtml(content.text['coach.p2']) + '</p>\n';
  body += '<p>' + escapeHtml(content.text['coach.p3']) + '</p>\n';
  body += '<a href="/training/first-look" class="btn btn-primary">Book a First Look Session</a>\n';
  body += '</div>\n</div>\n</header>\n';

  body += '<section class="band band-light">\n<div class="shell">\n<div class="eyebrow rise">The Résumé</div>\n<h2 class="zr">The record</h2>\n';
  body += renderResumeCards(content, responsiveManifest);
  body += '<p class="rcp-note">Verify the Robert Morris title at <a href="https://rmucolonials.com/news/2025/3/12/mens-basketball-horizon-league-champions.aspx" target="_blank" rel="noopener">rmucolonials.com</a> and the Moberly Area title at <a href="https://moberlygreyhounds.com/" target="_blank" rel="noopener">moberlygreyhounds.com</a>.</p>\n';
  body += '</div>\n</section>\n';

  body += '<section class="band band-dark">\n<div class="shell">\n<div class="eyebrow rise">Instagram</div>\n<h2 class="zr">Follow the work</h2>\n<p class="rise">Coach Blake posts training clips and recruiting notes on Instagram at <a href="https://www.instagram.com/blakekingsleyjr/" target="_blank" rel="noopener">@blakekingsleyjr</a>.</p>\n</div>\n</section>\n';

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
