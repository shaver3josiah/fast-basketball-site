import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync, statSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { validateSuburbs, formatErrors } from './src/lib/validate-suburbs.mjs';
import { generateResponsiveImages } from './scripts/responsive-images.mjs';
import { loadData, loadSections, assembleHomepage, buildSimplePage, applyTextEdits, fixContactForm, fixPlaybookForm, trimToFirstSectionClose, escapeHtml } from './src/render.mjs';
import { renderSuburbPage } from './src/lib/suburb-page.mjs';
import { renderCoachPage } from './src/lib/coach-page.mjs';
import { breadcrumbList } from './src/lib/structured-data.mjs';
import { SITE_URL } from './src/lib/site-config.mjs';

const ROOT = process.cwd();
const DIST = resolve(ROOT, 'dist');

// Each page states its own price: a search lands a parent on /training/<slug>, not on the
// homepage cards, so that page has to answer "what does it cost" by itself. `unit` renders
// inside .prog-price, which is white-space:nowrap — keep it to about two short words.
// Amounts must match the homepage cards in src/templates/sections/programs.html.
const TRAINING_PAGES = [
  {
    slug: 'first-look', textKey: 'prog.1', title: 'Free First Look Session | Fast Basketball', label: 'First Look Session',
    price: { amount: 'Free', unit: '60 Minutes', line: 'No obligation. The report is yours either way.' },
    features: ['Full movement and shooting form screen', 'Live one on one reads against Coach Blake', 'Written strengths and gaps report, yours to keep', 'Open slots offered within one business day'],
    next: 'Bring your player, their shoes, and sixty minutes. Coach Blake watches them move, puts them through live reads, and writes down exactly where they stand. You leave with the report whether or not you ever book again.'
  },
  {
    slug: 'private', textKey: 'prog.2', title: 'Private Basketball Training in Coral Springs | Fast Basketball', label: 'Private One on One',
    price: { amount: '$75', unit: 'Per 60 Min', line: '$75 for a full 60 minute session. Your First Look before it is free.' },
    features: ['Custom plan updated every four sessions', 'Footwork, handle, and finishing blocks', 'Shot chart and progress log', 'Packages of 5 and 10 available, 10 sessions $675 ($67.50 a session)'],
    next: 'Every session is built around the three things standing between your player and the next level. The plan updates every four sessions, and the shot chart shows the change before anyone has to take our word for it.'
  },
  {
    slug: 'small-group', textKey: 'prog.3', title: 'Small Group Basketball Training in North Broward | Fast Basketball', label: 'Small Group',
    price: { amount: '$45', unit: 'Per Player', line: '$45 per player per session. Your First Look before it is free.' },
    features: ['Level matched groups only', 'Live one on one and two on two', 'Great for teammates and siblings', 'Weekly recurring slots'],
    next: 'Two to four players at the same level, going at each other every week. Skills get tested against a live defender the day they are taught, because that is the only version of a skill that shows up in a game.'
  },
  {
    slug: 'college-track', textKey: 'prog.4', title: 'College Track Basketball Program | Fast Basketball', label: 'College Track Program',
    price: { amount: '$349', unit: 'Per Month', line: '$349 per month. Your First Look before it is free.' },
    features: ['Two private sessions per week', 'Monthly film review session', 'Highlight reel guidance', 'Recruiting profile and outreach help'],
    next: 'Twelve weeks for juniors and seniors who are serious about hearing from college programs. Coach Blake evaluated recruiting film from the college side of the table — the same eye now reviews your film, your reel, and your outreach.'
  }
];

// Footer column labels ("Training / Areas / More") ship as <h5> from buildFooter, so every
// page's outline ended H2 > H5 > H5 > H5 — a skipped level on all 20+ pages. Both the markup
// (src/render.mjs) and its only styling hook (the element selector `.ft-col h5` in
// src/styles/base.css) sit outside this slice, and swapping the tag without the CSS would
// resize the labels. aria-level raises the exposed level for assistive tech and audits while
// leaving the rendered pixels identical.
// ponytail: collapse to a plain <h2> the day buildFooter and `.ft-col h5` can change together.
function fixFooterHeadingLevels(html) {
  return html.replace(/<div class="ft-col"><h5>/g, '<div class="ft-col"><h5 role="heading" aria-level="2">');
}

// Single funnel: every page in this build is written through here.
function writeHtml(path, html) {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, fixFooterHeadingLevels(html));
}

// Standalone pages built from homepage section fragments start at <h2>;
// promote the first one so every page has exactly one <h1>.
function promoteFirstH2(html) {
  const open = html.indexOf('<h2');
  if (open === -1) return html;
  const close = html.indexOf('</h2>', open);
  if (close === -1) return html;
  return html.slice(0, open) + '<h1' + html.slice(open + 3, close) + '</h1>' + html.slice(close + 5);
}

function copyDir(src, dest) {
  if (!existsSync(src)) return;
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true });
}

function step1_validate() {
  const suburbsPath = resolve(ROOT, 'src/data/suburbs.json');
  const suburbs = JSON.parse(readFileSync(suburbsPath, 'utf8'));
  const errors = validateSuburbs(suburbs);
  if (errors.length > 0) {
    console.error('Build failed: suburbs.json did not pass validation.');
    console.error(formatErrors(errors));
    process.exit(1);
  }
  console.log('suburbs.json valid: ' + suburbs.length + ' record(s).');
}

function step2_cleanDist() {
  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(DIST, { recursive: true });
}

function step3_copyStatic() {
  copyDir(resolve(ROOT, 'src/styles'), resolve(DIST, 'styles'));
  copyDir(resolve(ROOT, 'src/fonts'), resolve(DIST, 'fonts'));
  copyDir(resolve(ROOT, 'src/js'), resolve(DIST, 'js'));
  copyDir(resolve(ROOT, 'admin'), resolve(DIST, 'admin'));
  copyDir(resolve(ROOT, 'src/images/source'), resolve(DIST, 'images'));
  copyDir(resolve(ROOT, 'src/images/uploads'), resolve(DIST, 'images'));
  copyDir(resolve(ROOT, 'src/brand'), resolve(DIST, 'brand'));
  cpSync(resolve(ROOT, 'src/brand/favicon.ico'), resolve(DIST, 'favicon.ico'));
  const notFoundSrc = resolve(ROOT, '404.html');
  if (existsSync(notFoundSrc)) cpSync(notFoundSrc, resolve(DIST, '404.html'));
  console.log('Copied static assets into dist/.');
}

// SOCIAL CARD: /brand/og-image-1200x630.png wins, so the og-cover.jpg build step is gone.
// og-cover.jpg was sharp's automatic "attention" crop of the hero photo: it lopped the top of
// Coach Blake's head off, carried no logo and no wordmark, and gave a third of the frame to a
// ladder brand's logo. The brand card is drawn at exactly 1200x630, is legible at thumbnail
// size, and is what src/render.mjs buildHead already points every page at. One card, one path.
async function step4_responsiveImages() {
  const contentPath = resolve(ROOT, 'src/data/content.json');
  const sourceDirs = [resolve(ROOT, 'src/images/source'), resolve(ROOT, 'src/images/uploads')];
  const outDir = resolve(DIST, 'images');
  const result = await generateResponsiveImages({ contentPath, sourceDirs, outDir });
  writeFileSync(resolve(ROOT, 'src/data/responsive-manifest.json'), JSON.stringify(result, null, 2) + '\n');
  console.log('Generated responsive image variants for ' + Object.keys(result).length + ' images.');
  return result;
}

function step5_homepage(sections, prelude, content, responsiveManifest, playbookTemplates, suburbs) {
  const html = assembleHomepage({ sections, prelude, content, responsiveManifest, playbookTemplates, suburbs });
  writeHtml(resolve(DIST, 'index.html'), html);
  return ['/'];
}

function step6_suburbPages(suburbs, content, prelude) {
  const paths = [];
  for (const suburb of suburbs) {
    const html = renderSuburbPage({ suburb, content, prelude });
    writeHtml(resolve(DIST, 'basketball-training', suburb.slug, 'index.html'), html);
    paths.push('/basketball-training/' + suburb.slug);
  }
  console.log('Rendered ' + suburbs.length + ' suburb page(s).');
  return paths;
}

function step7_coachPage(content, responsiveManifest, prelude) {
  const html = renderCoachPage({ content, responsiveManifest, prelude });
  writeHtml(resolve(DIST, 'coach-blake-kingsley', 'index.html'), html);
  return ['/coach-blake-kingsley'];
}

function step8_trainingPages(content, prelude) {
  const paths = [];
  for (const page of TRAINING_PAGES) {
    const canonicalPath = '/training/' + page.slug;
    let body = '<main id="main">\n<header class="band band-dark suburb-hero">\n<div class="shell">\n';
    body += '<div class="eyebrow">Fast Basketball Program</div>\n';
    body += '<h1>' + escapeHtml(page.label) + '</h1>\n';
    body += '<p class="lede">' + escapeHtml(content.text[page.textKey]) + '</p>\n';
    // Same .prog-price block the homepage cards use. The inline colour is the value base.css
    // already gives this caption on a dark surface (.prog-c.flag .prog-price small); the hero
    // band is dark and there is no dark-band rule for a bare .prog-price, hence it inline.
    const price = page.price;
    body += '<div class="prog-price" style="margin:22px 0 20px;">' + escapeHtml(price.amount) +
      '<small style="color:#8A8A96;">' + escapeHtml(price.unit) + '</small></div>\n';
    body += '<a href="/contact" class="btn btn-primary" data-program="' + escapeHtml(page.label) + '">Book This Program</a>\n';
    body += '<p class="trust-line">' + escapeHtml(price.line) + '</p>\n';
    body += '</div>\n</header>\n';
    body += '<section class="band band-ink">\n<div class="shell">\n';
    body += '<h2>What you get</h2>\n<ul class="prog-list">\n';
    for (const f of page.features) body += '<li>' + escapeHtml(f) + '</li>\n';
    body += '</ul>\n';
    body += '<h2>How it works</h2>\n<p style="max-width:70ch;">' + escapeHtml(page.next) + '</p>\n';
    body += '<p>Sessions run at city parks and partner courts across north Broward County. See the <a href="/#areas">service areas</a> for your neighborhood, or <a href="/contact">ask about open slots</a>.</p>\n';
    body += '</div>\n</section>\n</main>\n';
    const jsonLd = [breadcrumbList([{ name: 'Home', path: '/' }, { name: page.label, path: canonicalPath }])];
    const html = buildSimplePage({
      title: page.title,
      description: content.text[page.textKey],
      canonicalPath,
      bodyHtml: body,
      content,
      prelude,
      jsonLd
    });
    writeHtml(resolve(DIST, 'training', page.slug, 'index.html'), html);
    paths.push(canonicalPath);
  }
  console.log('Rendered ' + TRAINING_PAGES.length + ' training page(s).');
  return paths;
}

function step9_playbookPage(sections, content, playbookTemplates, prelude) {
  let body = trimToFirstSectionClose(sections.playbook);
  body = applyTextEdits(body, { 'pb.lede': content.text['pb.lede'] });
  body = fixPlaybookForm(body, playbookTemplates);
  body = '<main id="main">\n' + promoteFirstH2(body) + '</main>\n';
  const jsonLd = [breadcrumbList([{ name: 'Home', path: '/' }, { name: 'Free Playbook', path: '/playbook' }])];
  const html = buildSimplePage({
    title: 'Free Custom Basketball Playbook | Fast Basketball',
    description: content.text['pb.lede'],
    canonicalPath: '/playbook',
    bodyHtml: body,
    content,
    prelude,
    jsonLd,
    extraScripts: ['/js/playbook-form.js']
  });
  writeHtml(resolve(DIST, 'playbook', 'index.html'), html);
  return ['/playbook'];
}

// The six item FAQ lives in areas.html for the homepage. Slice that same <section> in rather
// than copying it, so the two pages can never drift. Behaviour needs nothing extra: /js/main.js
// wires every .faq-q it finds and already ships on every page, and it assigns the faqA<n> ids
// per document, so the two pages cannot collide.
function faqSection(areasHtml) {
  const anchor = areasHtml.indexOf('<div class="faq">');
  const start = anchor === -1 ? -1 : areasHtml.lastIndexOf('<section', anchor);
  const end = anchor === -1 ? -1 : areasHtml.indexOf('</section>', anchor);
  if (start === -1 || end === -1) {
    throw new Error('could not locate the FAQ <section> in areas.html — /contact/ would ship without it');
  }
  return areasHtml.slice(start, end + '</section>'.length) + '\n';
}

function step10_contactPage(sections, content, prelude) {
  let body = trimToFirstSectionClose(sections.contact);
  body = applyTextEdits(body, {
    'ct.lede': content.text['ct.lede'],
    'ct.phone': content.text['ct.phone'],
    'ct.email': content.text['ct.email'],
    'ct.ig': content.text['ct.ig'],
    'ct.area': content.text['ct.area']
  });
  body = fixContactForm(body);
  // FAQ is appended after promoteFirstH2 so the contact heading stays the page's only <h1>.
  body = '<main id="main">\n' + promoteFirstH2(body) + faqSection(sections.areas) + '</main>\n';
  const jsonLd = [breadcrumbList([{ name: 'Home', path: '/' }, { name: 'Contact', path: '/contact' }])];
  const html = buildSimplePage({
    title: 'Contact Fast Basketball | Book a Session in North Broward',
    description: content.text['ct.lede'],
    canonicalPath: '/contact',
    bodyHtml: body,
    content,
    prelude,
    jsonLd,
    extraScripts: ['/js/contact-form.js']
  });
  writeHtml(resolve(DIST, 'contact', 'index.html'), html);
  return ['/contact'];
}

function step11b_privacyPage(content, prelude) {
  let body = '<main id="main">\n<header class="band band-dark suburb-hero">\n<div class="shell">\n';
  body += '<div class="eyebrow">The Fine Print</div>\n<h1>Privacy</h1>\n';
  body += '<p class="lede">Straight answers about what we collect and what we do with it. No legal maze.</p>\n';
  body += '</div>\n</header>\n';
  body += '<section class="band band-ink">\n<div class="shell">\n';
  body += '<h2>What we collect</h2>\n';
  body += '<p>What you type into our forms: a name, a phone number or email, your area, and whatever you tell us about the player. The playbook and Locker forms collect an email so we can send you the training material you asked for.</p>\n';
  body += '<h2>What we do with it</h2>\n';
  body += '<p>We use it to reply with open slots, send the playbook or resource you requested, and follow up once. That is the whole list. We do not sell it, rent it, or hand it to anyone else, and we do not add you to anything you did not ask for.</p>\n';
  body += '<h2>Where it lives</h2>\n';
  body += '<p>Form submissions are processed by Netlify, the service that hosts this site, and are visible only to Coach Blake. The Locker remembers your email on your own device so your unlocked resources stay unlocked.</p>\n';
  body += '<h2>Want it gone?</h2>\n';
  body += '<p>Email <a href="mailto:coach@kingfastbasketball.com">coach@kingfastbasketball.com</a> and we delete your information. One message, done.</p>\n';
  body += '</div>\n</section>\n</main>\n';
  const html = buildSimplePage({
    title: 'Privacy | Fast Basketball',
    description: 'What Fast Basketball collects, what we do with it, and how to have it removed. Straight answers, no legal maze.',
    canonicalPath: '/privacy',
    bodyHtml: body,
    content,
    prelude
  });
  writeHtml(resolve(DIST, 'privacy', 'index.html'), html);
  return ['/privacy'];
}

function step11_blogIndex(content, prelude) {
  const body = '<main id="main">\n<header class="band band-dark suburb-hero">\n<div class="shell">\n' +
    '<div class="eyebrow">Fast Basketball</div>\n<h1>Blog</h1>\n' +
    '<p class="lede">Training notes and recruiting guidance are on the way. Check back soon, or follow along on <a href="https://www.instagram.com/blakekingsleyjr/" target="_blank" rel="noopener">Instagram</a>.</p>\n' +
    '</div>\n</header>\n</main>\n';
  const html = buildSimplePage({
    title: 'Blog | Fast Basketball North Broward',
    description: 'Training notes and recruiting guidance from Coach Blake Kingsley.',
    canonicalPath: '/blog/',
    bodyHtml: body,
    content,
    prelude
  });
  writeHtml(resolve(DIST, 'blog', 'index.html'), html);
  return ['/blog/'];
}

function writeSitemap(allPaths, siteUrl) {
  const urls = allPaths.map((p) => '<url><loc>' + siteUrl.replace(/\/$/, '') + p + '</loc></url>').join('\n');
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls + '\n</urlset>\n';
  writeFileSync(resolve(DIST, 'sitemap.xml'), xml);
}

function writeRobots(siteUrl) {
  const allowIndexing = process.env.ROBOTS_ALLOW === 'true';
  const robots = allowIndexing
    ? 'User-agent: *\nAllow: /\nDisallow: /admin/\n\nSitemap: ' + siteUrl.replace(/\/$/, '') + '/sitemap.xml\n'
    : 'User-agent: *\nDisallow: /\n';
  writeFileSync(resolve(DIST, 'robots.txt'), robots);
}

function dirSize(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) total += dirSize(full);
    else total += statSync(full).size;
  }
  return total;
}

async function main() {
  console.log('Building Fast Basketball site...');
  step1_validate();
  step2_cleanDist();
  step3_copyStatic();
  const responsiveManifest = await step4_responsiveImages();

  const { content, suburbs, playbookTemplates } = loadData(ROOT);
  const { sections, prelude } = loadSections(ROOT);

  const allPaths = [];
  allPaths.push(...step5_homepage(sections, prelude, content, responsiveManifest, playbookTemplates, suburbs));
  allPaths.push(...step6_suburbPages(suburbs, content, prelude));
  allPaths.push(...step7_coachPage(content, responsiveManifest, prelude));
  allPaths.push(...step8_trainingPages(content, prelude));
  allPaths.push(...step9_playbookPage(sections, content, playbookTemplates, prelude));
  allPaths.push(...step10_contactPage(sections, content, prelude));
  allPaths.push(...step11_blogIndex(content, prelude));
  allPaths.push(...step11b_privacyPage(content, prelude));

  writeSitemap(allPaths, SITE_URL);
  writeRobots(SITE_URL);

  if (process.env.SITE_ENV === 'production' && SITE_URL.includes('SITE-DOMAIN-PENDING')) {
    console.error('Build failed: SITE_URL still holds the placeholder domain. Set SITE_URL in the Netlify environment.');
    process.exit(1);
  }

  const totalBytes = dirSize(DIST);
  console.log('Build complete. ' + allPaths.length + ' page(s) written to dist/.');
  console.log('Total dist size: ' + (totalBytes / 1024 / 1024).toFixed(2) + ' MB.');
}

main().catch((err) => {
  console.error('Build failed: ' + err.stack);
  process.exit(1);
});
