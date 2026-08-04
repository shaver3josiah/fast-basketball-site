import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync, statSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { validateSuburbs, formatErrors } from './src/lib/validate-suburbs.mjs';
import { generateResponsiveImages, generateOgImage } from './scripts/responsive-images.mjs';
import { loadData, loadSections, assembleHomepage, buildSimplePage, applyTextEdits, fixContactForm, fixPlaybookForm, trimToFirstSectionClose, escapeHtml } from './src/render.mjs';
import { renderSuburbPage } from './src/lib/suburb-page.mjs';
import { renderCoachPage } from './src/lib/coach-page.mjs';
import { breadcrumbList } from './src/lib/structured-data.mjs';
import { SITE_URL } from './src/lib/site-config.mjs';

const ROOT = process.cwd();
const DIST = resolve(ROOT, 'dist');

const TRAINING_PAGES = [
  {
    slug: 'first-look', textKey: 'prog.1', title: 'Free First Look Session | Fast Basketball Miami', label: 'First Look Session',
    features: ['Full movement and shooting form screen', 'Live one on one reads against Coach Blake', 'Written strengths and gaps report, yours to keep', 'Open slots offered within one business day'],
    next: 'Bring your player, their shoes, and sixty minutes. Coach Blake watches them move, puts them through live reads, and writes down exactly where they stand. You leave with the report whether or not you ever book again.'
  },
  {
    slug: 'private', textKey: 'prog.2', title: 'Private Basketball Training in Miami | Fast Basketball', label: 'Private One on One',
    features: ['Custom plan updated every four sessions', 'Footwork, handle, and finishing blocks', 'Shot chart and progress log', 'Packages of 5 and 10 available'],
    next: 'Every session is built around the three things standing between your player and the next level. The plan updates every four sessions, and the shot chart shows the change before anyone has to take our word for it.'
  },
  {
    slug: 'small-group', textKey: 'prog.3', title: 'Small Group Basketball Training in Miami | Fast Basketball', label: 'Small Group',
    features: ['Level matched groups only', 'Live one on one and two on two', 'Great for teammates and siblings', 'Weekly recurring slots'],
    next: 'Two to four players at the same level, going at each other every week. Skills get tested against a live defender the day they are taught, because that is the only version of a skill that shows up in a game.'
  },
  {
    slug: 'college-track', textKey: 'prog.4', title: 'College Track Basketball Program Miami | Fast Basketball', label: 'College Track Program',
    features: ['Two private sessions per week', 'Monthly film review session', 'Highlight reel guidance', 'Recruiting profile and outreach help'],
    next: 'Twelve weeks for juniors and seniors who are serious about hearing from college programs. Coach Blake evaluated recruiting film from the college side of the table — the same eye now reviews your film, your reel, and your outreach.'
  }
];

function writeHtml(path, html) {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, html);
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

async function step4_responsiveImages() {
  const contentPath = resolve(ROOT, 'src/data/content.json');
  const sourceDirs = [resolve(ROOT, 'src/images/source'), resolve(ROOT, 'src/images/uploads')];
  const outDir = resolve(DIST, 'images');
  const content = JSON.parse(readFileSync(contentPath, 'utf8'));
  const result = await generateResponsiveImages({ contentPath, sourceDirs, outDir });
  await generateOgImage({ heroImage: content.images['hero.nets'], sourceDirs, outDir });
  writeFileSync(resolve(ROOT, 'src/data/responsive-manifest.json'), JSON.stringify(result, null, 2) + '\n');
  console.log('Generated responsive image variants for ' + Object.keys(result).length + ' images.');
  return result;
}

function step5_homepage(sections, prelude, content, responsiveManifest, playbookTemplates) {
  const html = assembleHomepage({ sections, prelude, content, responsiveManifest, playbookTemplates });
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
    body += '<a href="/contact" class="btn btn-primary" data-program="' + escapeHtml(page.label) + '">Book This Program</a>\n';
    body += '</div>\n</header>\n';
    body += '<section class="band band-ink">\n<div class="shell">\n';
    body += '<h2>What you get</h2>\n<ul class="prog-list">\n';
    for (const f of page.features) body += '<li>' + escapeHtml(f) + '</li>\n';
    body += '</ul>\n';
    body += '<h2>How it works</h2>\n<p style="max-width:70ch;">' + escapeHtml(page.next) + '</p>\n';
    body += '<p>Sessions run at partner gyms and courts across Miami Dade and Broward. See the <a href="/#areas">service areas</a> for your neighborhood, or <a href="/contact">ask about open slots</a>.</p>\n';
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
    title: 'Free Custom Basketball Playbook | Fast Basketball Miami',
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
  body = '<main id="main">\n' + promoteFirstH2(body) + '</main>\n';
  const jsonLd = [breadcrumbList([{ name: 'Home', path: '/' }, { name: 'Contact', path: '/contact' }])];
  const html = buildSimplePage({
    title: 'Contact Fast Basketball | Book a Session in Miami',
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
  body += '<p>Email <a href="mailto:coach@fastbasketball.com">coach@fastbasketball.com</a> and we delete your information. One message, done.</p>\n';
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
    title: 'Blog | Fast Basketball Miami',
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
  allPaths.push(...step5_homepage(sections, prelude, content, responsiveManifest, playbookTemplates));
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
