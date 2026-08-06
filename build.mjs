import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync, statSync, readdirSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { validateSuburbs, formatErrors } from './src/lib/validate-suburbs.mjs';
import { generateResponsiveImages } from './scripts/responsive-images.mjs';
import { loadData, loadSections, assembleHomepage, buildSimplePage, applyTextEdits, fixContactForm, fixPlaybookForm, trimToFirstSectionClose, escapeHtml, renderImage } from './src/render.mjs';
import { compilePage, scalePx } from './src/lib/canvas-compile.mjs';
import { renderSuburbPage } from './src/lib/suburb-page.mjs';
import { renderCoachPage } from './src/lib/coach-page.mjs';
import { breadcrumbList } from './src/lib/structured-data.mjs';
import { SITE_URL } from './src/lib/site-config.mjs';
import { TEXT_GROUPS, TEXT_LABELS, IMAGE_LABELS } from './src/lib/content-schema.mjs';
import { ELEMENT_TYPES, FONT_FAMILIES, THEME_COLORS, BREAKPOINTS, DESIGN_WIDTH } from './src/lib/canvas-schema.mjs';

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

// The admin panel used to carry its own hand-typed copies of TEXT_GROUPS, TEXT_LABELS
// and IMAGE_LABELS. Two copies of one schema drift, and they did: the testimonial keys
// were dropped from content.json but stayed in content-schema.mjs, which made
// validateContentShape fail and turned every admin save into a 422. Generating the
// panel's copy from the module means there is exactly one place to edit again.
function step3b_emitAdminSchema() {
  const body = 'window.FB_SCHEMA = ' + JSON.stringify({
    textGroups: TEXT_GROUPS,
    textLabels: TEXT_LABELS,
    imageLabels: IMAGE_LABELS
  }, null, 2) + ';\n';
  writeFileSync(resolve(DIST, 'admin/schema.js'),
    '/* GENERATED by build.mjs from src/lib/content-schema.mjs. Do not edit. */\n' + body);

  // The editor's inspector is generated from this, exactly as the build's renderer is
  // generated from the same module. render() and css() are functions and cannot cross
  // into the browser, but they are not needed there — the canvas is rendered by the
  // real compiler over an endpoint, so the editor only needs to know what the fields
  // ARE, never how they draw. That is what keeps one renderer instead of two.
  const types = {};
  for (const [type, def] of Object.entries(ELEMENT_TYPES)) {
    types[type] = { label: def.label, icon: def.icon, fields: def.fields, defaults: def.defaults };
  }
  const canvas = 'window.FB_CANVAS = ' + JSON.stringify({
    types, fontFamilies: FONT_FAMILIES, themeColors: THEME_COLORS,
    breakpoints: BREAKPOINTS, designWidth: DESIGN_WIDTH
  }, null, 2) + ';\n';
  writeFileSync(resolve(DIST, 'admin/canvas-schema.js'),
    '/* GENERATED by build.mjs from src/lib/canvas-schema.mjs. Do not edit. */\n' + canvas);
  console.log('Emitted admin/schema.js and admin/canvas-schema.js.');
}

// The editor's two libraries, self-hosted. They are devDependencies, so they never
// reach a visitor; copying them into dist keeps `script-src 'self'` intact rather than
// punching a CDN hole in the CSP for an admin-only page.
function step3c_copyVendor() {
  const vendorDir = resolve(DIST, 'admin/vendor');
  mkdirSync(vendorDir, { recursive: true });
  const files = [
    ['node_modules/moveable/dist/moveable.min.js', 'moveable.min.js'],
    ['node_modules/selecto/dist/selecto.min.js', 'selecto.min.js']
  ];
  for (const [from, to] of files) {
    const src = resolve(ROOT, from);
    if (!existsSync(src)) {
      console.error('Build failed: missing ' + from + '. Run `npm install`.');
      process.exit(1);
    }
    cpSync(src, resolve(vendorDir, to));
  }
  console.log('Copied ' + files.length + ' editor libraries into admin/vendor/.');
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

// NOT LEGAL ADVICE, AND WRITTEN BY SOMEONE WHO IS NOT A LAWYER. /privacy and /terms are an
// honest description of what this site and this business actually do — every claim on both
// pages was checked against the code that makes it true (netlify.toml, netlify/functions/,
// src/js/) rather than copied from a template. That is not the same as being legally
// sufficient. Both pages carry a visible owner note saying a Florida attorney should read
// them before launch; do not delete that note, and do not let either page make a claim the
// code does not back.
// The children's section on /privacy is the point of the whole exercise: the site invites
// players "roughly 11 through 18" and the forms take a name and an email, so a 12-year-old
// can submit for themselves today. If the forms ever gain a real parent gate, this page is
// the first thing that has to be rewritten to match.
const LEGAL_EFFECTIVE = 'August 2026';

const OWNER_NOTE_PRIVACY = '<p class="rcp-note"><b>Note for the site owner:</b> this page is a starting point, ' +
  'written in good faith by someone who is not a lawyer. It is not legal advice and it is not a promise that ' +
  'the site is compliant with anything. Have a Florida attorney read this page and the <a href="/terms">terms</a> ' +
  'before launch — the section about players under 13 most of all.</p>\n';

const OWNER_NOTE_TERMS = '<p class="rcp-note"><b>Note for the site owner:</b> this page is a starting point, ' +
  'written in good faith by someone who is not a lawyer. It is not legal advice and it is not a waiver. ' +
  'Have a Florida attorney read this page and the <a href="/privacy">privacy page</a> before launch, and have ' +
  'them draw up the real waiver and medical form you hand parents in person.</p>\n';

function step11b_privacyPage(content, prelude) {
  let body = '<main id="main">\n<header class="band band-dark suburb-hero">\n<div class="shell">\n';
  body += '<div class="eyebrow">The Fine Print</div>\n<h1>Privacy</h1>\n';
  body += '<p class="lede">Straight answers about what we collect and what we do with it. No legal maze.</p>\n';
  body += '<p class="trust-line">In effect ' + LEGAL_EFFECTIVE + '</p>\n';
  body += '</div>\n</header>\n';
  body += '<section class="band band-ink">\n<div class="shell">\n';

  body += '<h2>Who is asking</h2>\n';
  body += '<p>Fast Basketball is Coach Blake Kingsley, training players one on one and in small groups across Coral Springs, Parkland, Coconut Creek, Margate and Tamarac. He is the person who reads what you send. Anything on this page, including a request to delete what we hold, goes to <a href="mailto:coach@kingfastbasketball.com">coach@kingfastbasketball.com</a>.</p>\n';

  body += '<h2>What we collect</h2>\n';
  body += '<p>Only what you type into a form. The contact form asks for a name, an email, a phone number, your area, which program you are asking about, and whatever you want to tell us about the player. The playbook form asks for a name, an email, and the player\'s grade, position and skill focus. The Locker asks for an email so we can send you the resource you unlocked.</p>\n';
  body += '<p>One thing gets recorded that you did not type: a playbook request is saved along with the internet address it came from, which is how we stop the form being hammered by a bot. Netlify, which hosts the site, also keeps its own standard server logs, the way every web host does.</p>\n';

  body += '<h2>What we do with it</h2>\n';
  body += '<p>We use it to reply with open slots, send the playbook or resource you requested, and follow up once. That is the whole list. We do not sell it, rent it, or hand it to anyone else, and we do not add you to anything you did not ask for.</p>\n';

  body += '<h2>Parents, and players under 18</h2>\n';
  body += '<p>These forms are meant for a parent or guardian. We train players from roughly 11 through 18, and the questions that come next — cost, scheduling, health, whether this is even the right fit — are yours to answer. If your player is under 18, please send the form yourself so the conversation starts with you.</p>\n';
  body += '<p>We do not knowingly collect personal information from a child under 13. If a child under 13 fills in one of these forms without you, we are not going to use it and we will delete it as soon as we know.</p>\n';
  body += '<p>If you think your under-13 child submitted something here, email <a href="mailto:coach@kingfastbasketball.com">coach@kingfastbasketball.com</a> and tell us the email address they used. We will find it, delete it, and write back to confirm it is gone. No form to fill in, no reason needed, and nothing you have to explain.</p>\n';

  body += '<h2>Who else touches it</h2>\n';
  body += '<p>Two companies, and only because the site cannot work without them.</p>\n';
  body += '<ul class="prog-list">\n';
  body += '<li><b>Netlify</b> hosts this site, receives what the contact and playbook forms send, and stores playbook requests where Coach Blake can read them.</li>\n';
  body += '<li><b>Resend</b> sends the playbook email. It gets the email address you gave and the playbook itself. Nothing else.</li>\n';
  body += '</ul>\n';
  body += '<p>That is the complete list. No mailing list tool, no advertising platform, no data broker, nobody else in the middle.</p>\n';

  body += '<h2>What stays on your own device</h2>\n';
  body += '<p>A few small things your browser keeps for you. None of them are sent anywhere.</p>\n';
  body += '<ul class="prog-list">\n';
  body += '<li>The email you used to open the Locker, so your unlocked resources stay unlocked next time. Hit "Log out" in the Locker and it is gone.</li>\n';
  body += '<li>A count of the shots you have made in the little night court on the homepage. It is a number. That is genuinely all it is.</li>\n';
  body += '<li>Which program you clicked, so the contact form arrives already knowing what you wanted to ask about. It clears when you close the tab.</li>\n';
  body += '<li>A note that you have already seen the opening animation, so it does not replay on every page. That clears when you close the tab too.</li>\n';
  body += '</ul>\n';
  body += '<p>There is no analytics on this site, no advertising pixel, no session recording and no third-party script of any kind. Every script and font a page here loads is served from this site. Clearing your browser storage removes everything in that list.</p>\n';

  body += '<h2>How long we keep it</h2>\n';
  body += '<p>As long as it is useful for the reason you gave it to us: answering your question, sending what you asked for, running your player\'s sessions. There is no fixed clock on it. If you are not training with us and you would rather we did not hold it, say so and we will not.</p>\n';

  body += '<h2>Want it gone?</h2>\n';
  body += '<p>Email <a href="mailto:coach@kingfastbasketball.com">coach@kingfastbasketball.com</a> and we delete what we hold on you. One message, done, no reason owed. You can also just ask what is on file and we will tell you.</p>\n';

  body += '<h2>If this page changes</h2>\n';
  body += '<p>The date at the top changes with it. This version is in effect as of ' + LEGAL_EFFECTIVE + '.</p>\n';
  body += '<p>The <a href="/terms">terms</a> cover booking, cancellations, photos, and what training does and does not promise. Anything else, <a href="/contact">just ask</a>.</p>\n';

  body += OWNER_NOTE_PRIVACY;
  body += '</div>\n</section>\n</main>\n';
  const html = buildSimplePage({
    title: 'Privacy | Fast Basketball',
    description: 'What Fast Basketball collects, who touches it, how children under 13 are handled, and how to have it removed. Straight answers, no legal maze.',
    canonicalPath: '/privacy',
    bodyHtml: body,
    content,
    prelude
  });
  writeHtml(resolve(DIST, 'privacy', 'index.html'), html);
  return ['/privacy'];
}

// Rates here must match TRAINING_PAGES above and src/templates/sections/programs.html.
// The scheduling policy is a bracketed owner placeholder on purpose: nobody but the owner
// knows what it is, and a made-up cancellation window is a promise the business would have
// to keep. It is written to be impossible to mistake for finished copy.
// OWNER TODO before launch: write the real cancellation policy into the 'Scheduling,
// cancelling and no shows' section below -- notice required to reschedule without a
// charge, what happens on a no-show, what happens if Coach Blake cancels, and how a
// missed session counts against the ten-session package and monthly College Track
// billing. The visitor-facing copy currently says it is handled case by case, which is
// true for a new program but is not a policy. Do not ship a bracketed placeholder here.
function step11c_termsPage(content, prelude) {
  let body = '<main id="main">\n<header class="band band-dark suburb-hero">\n<div class="shell">\n';
  body += '<div class="eyebrow">The Fine Print</div>\n<h1>Terms</h1>\n';
  body += '<p class="lede">What you are agreeing to when you book a session. Same as the privacy page: plain English, no legal maze.</p>\n';
  body += '<p class="trust-line">In effect ' + LEGAL_EFFECTIVE + '</p>\n';
  body += '</div>\n</header>\n';
  body += '<section class="band band-ink">\n<div class="shell">\n';

  body += '<h2>Who books</h2>\n';
  body += '<p>If the player is under 18, a parent or guardian books, is the person we talk to about scheduling and health, and is responsible for payment. Players 18 and over can book for themselves.</p>\n';
  body += '<p>If your player emails us first because they are keen, no problem at all. We will just bring you into it before anything gets scheduled.</p>\n';

  body += '<h2>Training is physical</h2>\n';
  body += '<p>Basketball training is exercise. Players run, cut, jump, land, and go live against another player. Injuries happen in every sport — a rolled ankle, a jammed finger, occasionally worse — and good coaching lowers that risk without removing it. You should know that going in.</p>\n';
  body += '<p>Before the first session, tell Coach Blake anything that changes how your player can train: asthma, a heart condition, a concussion history, a knee still coming back, allergies, medication, anything a coach would want to know quickly. It stays between you and him, and it changes how he runs the hour.</p>\n';
  body += '<p>A written waiver and medical form is handled separately, signed in person before the first session. This page is not that form and does not stand in for it.</p>\n';

  body += '<h2>What training promises, and what it cannot</h2>\n';
  body += '<p>Coach Blake will make your player better. That is the work, and the shot chart and the progress log are there so you do not have to take our word for it.</p>\n';
  body += '<p>Nobody can promise the rest. Not playing time, not a starting spot, not a roster place, not a college offer, not a scholarship, not a coach returning a call. Those calls belong to high school coaches, club coaches and college staffs, and they are not ours to make. The College Track Program buys the work, the film review and honest guidance on how recruiting actually runs. It does not buy an outcome, and anyone who tells you otherwise is selling you something.</p>\n';

  body += '<h2>What it costs</h2>\n';
  body += '<ul class="prog-list">\n';
  body += '<li>First Look session: free, 60 minutes, no obligation.</li>\n';
  body += '<li>Private one on one: $75 per 60 minute session. Ten sessions $675, which is $67.50 a session.</li>\n';
  body += '<li>Small group: $45 per player per session.</li>\n';
  body += '<li>College Track Program: $349 per month.</li>\n';
  body += '</ul>\n';
  body += '<p>Coach Blake tells you how to pay when you book. If a rate changes, the new rate applies to sessions booked after the change, never to sessions you have already paid for.</p>\n';

  body += '<h2>Scheduling, cancelling and no shows</h2>\n';
  body += '<p>Sessions are booked directly with Coach Blake. Weather, school and travel happen, and we would always rather move a session than lose it.</p>\n';
  body += '<p><b>Tell him as early as you can and he will work with you. A session moved is better than a session lost. While the program is new, missed sessions inside a package are sorted out case by case rather than by a rule, and when that policy is set it will be written here.</b></p>\n';

  body += '<h2>Photos and video</h2>\n';
  body += '<p>No photo or video of your player goes anywhere public without your explicit permission. Not on Instagram, not on this site, not anywhere else. Coach Blake will ask, and asking means a real yes from you — silence is a no.</p>\n';
  body += '<p>Say yes today and change your mind next year and that is fine. Email <a href="mailto:coach@kingfastbasketball.com">coach@kingfastbasketball.com</a> and it comes down. You do not need a reason.</p>\n';
  body += '<p>Coach Blake may film during a session for coaching, because showing a player their own footwork is half the value of film. That footage stays between him and you unless you have said otherwise.</p>\n';

  body += '<h2>If these terms change</h2>\n';
  body += '<p>The date at the top changes with them, and the version in effect when you booked is the one that applies to that booking. This version is in effect as of ' + LEGAL_EFFECTIVE + '.</p>\n';

  body += '<h2>Which state\'s law applies</h2>\n';
  body += '<p>Florida.</p>\n';
  body += '<p>The <a href="/privacy">privacy page</a> covers what we collect and how to have it deleted. If anything here is unclear, <a href="/contact">ask us</a> before you book — that is a much better outcome for everyone than reading it afterwards.</p>\n';

  body += OWNER_NOTE_TERMS;
  body += '</div>\n</section>\n</main>\n';
  const html = buildSimplePage({
    title: 'Terms | Fast Basketball',
    description: 'Who books, what training costs, what it promises, how photos are handled, and what to know about physical risk. Plain English, no legal maze.',
    canonicalPath: '/terms',
    bodyHtml: body,
    content,
    prelude
  });
  writeHtml(resolve(DIST, 'terms', 'index.html'), html);
  return ['/terms'];
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

// Canvas pages: the free-positioning half of the site, compiled from src/data/site.json.
// The generated geometry goes into one stylesheet that only these pages load, so the
// nine hand-built sections and their 16 pages keep their exact current output.
//
// A page marked "draft" is noindex and stays out of the sitemap. That is what makes a
// proving ground safe to keep in the repo: it can never be found by accident.
function step12_canvasPages(content, responsiveManifest, prelude) {
  const sitePath = resolve(ROOT, 'src/data/site.json');
  if (!existsSync(sitePath)) return [];
  const site = JSON.parse(readFileSync(sitePath, 'utf8'));

  const warnings = [];
  const ctx = {
    scalePx,
    warn: (msg) => warnings.push(msg),
    legacy: () => '',
    // The element carries its own alt text, so the shared image record is cloned with
    // that alt rather than the one stored against the photo. One photo can appear in
    // two places and honestly need two different descriptions.
    renderImage: (key, alt) => {
      const image = content.images[key];
      const responsive = responsiveManifest[key];
      if (!image || !responsive) return null;
      const local = { images: { [key]: { ...image, alt: alt || image.alt } } };
      return renderImage(key, local, responsiveManifest, { loading: 'lazy', fetchpriority: 'auto', sizes: '(max-width: 750px) 92vw, 45vw' });
    }
  };

  const paths = [];
  let allCss = '';
  const errors = [];

  for (const page of site.pages || []) {
    const out = compilePage(page, ctx);
    errors.push(...out.errors);
    allCss += '/* ' + page.path + ' */\n' + out.css + '\n';
    const html = buildSimplePage({
      title: page.title,
      description: page.description,
      canonicalPath: page.path,
      bodyHtml: '<main id="main">\n' + out.html + '</main>\n',
      content,
      prelude,
      robots: page.draft ? 'noindex, nofollow' : 'index, follow',
      extraStyles: ['/styles/canvas.css', '/styles/canvas-generated.css']
    });
    writeHtml(resolve(DIST, page.path.replace(/^\//, ''), 'index.html'), html);
    if (!page.draft) paths.push(page.path);
  }

  // Rule 3 from the plan: the build refuses to compile a page it knows is broken.
  // A guard that lets it through and flags it afterwards is not a guard.
  if (errors.length > 0) {
    console.error('Build failed: ' + errors.length + ' canvas error(s).');
    for (const e of errors) console.error('  - ' + e);
    process.exit(1);
  }
  for (const w of warnings) console.warn('  warning: ' + w);

  writeFileSync(resolve(DIST, 'styles/canvas-generated.css'),
    '/* GENERATED by build.mjs from src/data/site.json. Do not edit. */\n' + allCss);
  console.log('Compiled ' + (site.pages || []).length + ' canvas page(s).');
  return paths;
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

// The editor must never reach a visitor. The whole design rests on the public site
// staying static HTML with no editor runtime, and the way that promise usually dies is
// quietly: one <script> added to a shared template and suddenly every page ships a
// transform library. This fails the build instead of letting it ship.
//
// Patterns are path-anchored on purpose. Matching a bare "selecto" also matches the
// word "selector", which appears in ordinary page copy — a guard that cries wolf gets
// switched off, and then it is not a guard.
function step13_assertNoEditorLeak() {
  const patterns = [/\/admin\/vendor\//, /\/admin\/editor\./, /\/admin\/canvas-frame/, /\bCanvasFrame\b/, /\bnew Moveable\b/];
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (full.endsWith('admin')) continue;
        walk(full);
      } else if (entry.name.endsWith('.html')) {
        const body = readFileSync(full, 'utf8');
        const hit = patterns.find((p) => p.test(body));
        if (hit) offenders.push(relative(DIST, full) + ' matches ' + hit);
      }
    }
  };
  walk(DIST);
  if (offenders.length > 0) {
    console.error('Build failed: editor assets leaked onto public pages.');
    for (const o of offenders) console.error('  - ' + o);
    process.exit(1);
  }
  console.log('Verified no editor code reaches a public page.');
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
  step3b_emitAdminSchema();
  step3c_copyVendor();
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
  allPaths.push(...step11c_termsPage(content, prelude));
  allPaths.push(...step12_canvasPages(content, responsiveManifest, prelude));

  writeSitemap(allPaths, SITE_URL);
  writeRobots(SITE_URL);
  step13_assertNoEditorLeak();

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
