import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync, statSync, readdirSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { validateSuburbs, formatErrors } from './src/lib/validate-suburbs.mjs';
import { generateResponsiveImages } from './scripts/responsive-images.mjs';
import { loadData, loadSections, assembleHomepage, buildSimplePage, applyTextEdits, applyAttrEdits, applyGroupOrder, fixContactForm, fixContactAreaSelect, fixPlaybookForm, trimToFirstSectionClose, escapeHtml, renderImage, stylesheetLinks, asset, SECTION_IDS, FOOTER_TEXT_KEYS } from './src/render.mjs';
import { compilePage, scalePx } from './src/lib/canvas-compile.mjs';
import { renderSuburbPage } from './src/lib/suburb-page.mjs';
import { renderCoachPage } from './src/lib/coach-page.mjs';
import { breadcrumbList } from './src/lib/structured-data.mjs';
import { SITE_URL, CONTACT } from './src/lib/site-config.mjs';
import { TEXT_GROUPS, TEXT_LABELS, IMAGE_LABELS } from './src/lib/content-schema.mjs';
import { CONTENT_GROUPS } from './src/lib/content-groups.mjs';
import { ELEMENT_TYPES, FONT_FAMILIES, THEME_COLORS, BREAKPOINTS, DESIGN_WIDTH } from './src/lib/canvas-schema.mjs';

const ROOT = process.cwd();
const DIST = resolve(ROOT, 'dist');

// Each page states its own price: a search lands a parent on /training/<slug>, not on the
// homepage cards, so that page has to answer "what does it cost" by itself. `unit` renders
// inside .prog-price, which is white-space:nowrap — keep it to about two short words.
// Amounts must match the homepage cards in src/templates/sections/programs.html.
const TRAINING_PAGES = [
  {
    slug: 'evaluation', textKey: 'prog.1', title: 'Evaluation Session | Fast Basketball', label: 'Evaluation Session',
    description: 'A 60 minute on-court evaluation with Coach Blake Kingsley in north Broward. $50, or $35 within 48 hours of your intro call. The step before any commitment.',
    price: { amount: '$50', unit: '60 Minutes', line: '$35 if you book within 48 hours of your intro call. The call itself is free.' },
    features: ['Movement, handle, and shooting form screen', 'Live reads against a defender', 'Coach Blake gets to know your player and their goals', 'Enrollment call within 24 hours: what he saw, and the plan'],
    next: 'Bring your player, their shoes, a ball, water, and sixty minutes. Coach Blake watches them move, puts them through live reads, and talks to them about what they want. Then you both decide whether the program fits.'
  },
  {
    slug: 'group-training', textKey: 'prog.2', title: 'Group Training Membership | Fast Basketball', label: 'Group Training Membership',
    description: 'Weekly group basketball training in north Broward on a 3 or 12 month term, once or twice a week, $25 to $40 a session. Every price listed, no quotes over text.',
    price: { amount: '$25\u2013$40', unit: 'Per Session', line: '3 months: $480 once a week or $840 twice a week. 12 months: $1,380 once a week or $2,300 twice a week. Pay in full, split in two, or monthly.' },
    features: ['Weekly 60 minute sessions with level matched players', 'Journal, homework, and daily check-ins in the members area', 'Weekly game evaluations and quarterly progress reports', 'Rained out? The session moves to Zoom that evening'],
    next: 'Three months is the minimum because that is how long it takes a new habit to survive speed, contact, and a Friday night. Twelve months is for players who already know they are all in. Memberships auto-renew unless you cancel in writing 7 days before the end of a 3 month term or 60 days before the end of a 12 month term.'
  },
  {
    slug: 'private', textKey: 'prog.3', title: 'Private Basketball Training in Coral Springs | Fast Basketball', label: 'Private One on One',
    description: 'Private one on one basketball training in Coral Springs and north Broward with Coach Blake Kingsley, $100 an hour, scheduled directly with the coach.',
    price: { amount: '$100', unit: 'Per Hour', line: '$100 for a full hour on one player, scheduled directly with Coach Blake.' },
    features: ['Footwork, handle, finishing, and shooting blocks', 'Same journal and homework standard as the membership', 'Film review and college coaching advice on request', 'Scheduled directly with Coach Blake'],
    next: 'Every hour is built around the two or three things standing between your player and the next level. The journal and the homework are the same as the membership, because the standard does not change with the format.'
  },
  {
    slug: 'small-group', textKey: 'prog.4', title: 'Small Group Basketball Training | Fast Basketball', label: 'Private Small Group',
    description: 'Private small group basketball training in north Broward, $75 per player per hour. Level matched groups for teammates and siblings; drop-in sessions $50.',
    price: { amount: '$75', unit: 'Per Player, Hour', line: '$75 per player per hour. Drop-in sessions are $50 if you cannot commit to a term yet.' },
    features: ['Level matched groups only', 'Live one on one and two on two', 'Great for a team\'s guards or a family with two players', 'Drop-in sessions at $50 if you cannot commit to a term yet'],
    next: 'Two to four players at the same level, going at each other. Skills get tested against a live defender the day they are taught, because that is the only version of a skill that shows up in a game.'
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
    // stackBehaviour has to cross over: the editor uses it to know which types must
    // keep a height (a shape renders nothing, an image has no box to fill, so clearing
    // theirs makes them vanish on phones). Leaving it out of this projection meant the
    // editor's guard read undefined and never fired.
    types[type] = {
      label: def.label,
      icon: def.icon,
      fields: def.fields,
      defaults: def.defaults,
      stackBehaviour: def.stackBehaviour || 'auto'
    };
  }
  // Which hand-built sections carry editable hooks, worked out from the templates
  // themselves rather than hand-listed. A section with no data-edit/data-img hooks is
  // hardcoded HTML and genuinely cannot be edited yet, and the editor has to be able
  // to say so instead of offering a section that does nothing when you click it.
  // data-edit-attr carries its key after a colon (attrname:key) rather than as the
  // whole attribute value, so it needs its own capture instead of the edit/img pattern.
  const scanHooks = (raw) => {
    const keys = new Set();
    for (const m of raw.matchAll(/data-edit="([^"]+)"/g)) keys.add(m[1]);
    for (const m of raw.matchAll(/data-img="([^"]+)"/g)) keys.add(m[1]);
    for (const m of raw.matchAll(/data-edit-attr="[^:"]+:([^"]+)"/g)) keys.add(m[1]);
    return [...keys];
  };
  const sectionDir = resolve(ROOT, 'src/templates/sections');
  const preludeFile = resolve(sectionDir, '_prelude.html');
  const preludeBody = existsSync(preludeFile) ? readFileSync(preludeFile, 'utf8') : '';
  // Which reorder-registry groups live in a given legacy section, worked out from
  // CONTENT_GROUPS rather than hand-listed a second time — same drift risk the hooks scan
  // above already avoids. Neither hero nor footer host a registered group.
  const groupsForSection = (id) => CONTENT_GROUPS.filter((g) => g.section === id).map((g) => g.id);
  const legacySections = [
    // Hero, nav and ticker live in _prelude.html rather than a section file — the editor
    // needs a way in without pretending it is one of the nine SECTION_IDS.
    { id: 'hero', label: 'Hero, nav & ticker', hooks: scanHooks(preludeBody), groups: [] },
    ...SECTION_IDS.map((id) => {
      const file = resolve(sectionDir, id + '.html');
      const body = existsSync(file) ? readFileSync(file, 'utf8') : '';
      return { id, label: id.charAt(0).toUpperCase() + id.slice(1), hooks: scanHooks(body), groups: groupsForSection(id) };
    }),
    // The footer is generated by buildFooter, not a template file, so its hooks are the
    // fixed FOOTER_TEXT_KEYS list rather than a scan — same list buildFooter itself reads.
    { id: 'footer', label: 'Footer', hooks: FOOTER_TEXT_KEYS, groups: [] }
  ];

  // The editor names the group it is reordering ("Résumé card 2 of 4") and needs the same
  // label and count the build reorders by. Emitting the registry rather than letting the
  // editor keep its own copy is the same drift guard as the hooks scan and the section
  // list: add a fifth program card and the panel counts to 5 without anyone remembering to.
  const groupInfo = {};
  for (const g of CONTENT_GROUPS) groupInfo[g.id] = { label: g.label, count: g.count };

  const canvas = 'window.FB_CANVAS = ' + JSON.stringify({
    types, fontFamilies: FONT_FAMILIES, themeColors: THEME_COLORS,
    breakpoints: BREAKPOINTS, designWidth: DESIGN_WIDTH, legacySections, groupInfo
  }, null, 2) + ';\n';
  writeFileSync(resolve(DIST, 'admin/canvas-schema.js'),
    '/* GENERATED by build.mjs from src/lib/canvas-schema.mjs. Do not edit. */\n' + canvas);
  console.log('Emitted admin/schema.js and admin/canvas-schema.js.');
}

// The editor's canvas iframe has to load EXACTLY the stylesheets a published canvas
// page loads, or the preview is quietly lying about what will ship. Generating the
// list from the same function the pages use means it cannot drift again.
function step3d_syncFrameStyles() {
  const framePath = resolve(DIST, 'admin/canvas-frame.html');
  if (!existsSync(framePath)) return;
  const links = stylesheetLinks() + '<link rel="stylesheet" href="' + asset('/styles/canvas.css') + '">';
  const html = readFileSync(framePath, 'utf8');
  if (!html.includes('<!--SITE_STYLES-->')) {
    console.error('Build failed: admin/canvas-frame.html lost its <!--SITE_STYLES--> marker, so the editor would preview the wrong cascade.');
    process.exit(1);
  }
  writeFileSync(framePath, html.replace('<!--SITE_STYLES-->', links));
  console.log('Synced the editor canvas frame to the site stylesheets.');
}

// The editor's two libraries, self-hosted. They are devDependencies, so they never
// reach a visitor; copying them into dist keeps `script-src 'self'` intact rather than
// punching a CDN hole in the CSP for an admin-only page.
function step3c_copyVendor() {
  const vendorDir = resolve(DIST, 'admin/vendor');
  mkdirSync(vendorDir, { recursive: true });
  // selecto was copied here for a multi-select feature that is not built yet, and
  // nothing loaded it — 40KB shipped to the admin for nothing. It comes back the day
  // marquee selection does, not before.
  const files = [
    ['node_modules/moveable/dist/moveable.min.js', 'moveable.min.js']
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
      description: page.description || content.text[page.textKey],
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
  // Full content.text rather than a hand-picked {pb.lede} map: applyTextEdits/applyAttrEdits
  // only touch markers that are actually present, so this also picks up any pb.* attr hooks
  // (e.g. a placeholder) without this call site needing to know their names in advance.
  body = applyTextEdits(body, content.text);
  body = applyAttrEdits(body, content.text);
  body = fixPlaybookForm(body, playbookTemplates);
  body = applyGroupOrder(body, content.order);
  body = '<main id="main">\n' + promoteFirstH2(body) + '</main>\n';
  const jsonLd = [breadcrumbList([{ name: 'Home', path: '/' }, { name: 'Free Playbook', path: '/playbook' }])];
  const html = buildSimplePage({
    title: 'Free Custom Basketball Playbook | Fast Basketball',
    description: 'A free four week basketball workout block built for your player and sent to a parent inbox. From Coach Blake Kingsley, Fast Basketball, north Broward.',
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
  // Full content.text (was a hand-picked {ct.lede, ct.phone, ...} map): applyTextEdits
  // only touches markers actually present, so this also reaches any ct.* attr hooks with
  // no need to keep this list in step with contact.html.
  body = applyTextEdits(body, content.text);
  body = applyAttrEdits(body, content.text);
  body = fixContactForm(body);
  body = fixContactAreaSelect(body, content);
  // FAQ is appended after promoteFirstH2 so the contact heading stays the page's only <h1>.
  // applyTextEdits here too: faqSection slices the RAW areas.html, so without this the
  // homepage FAQ would pick up faq.N.q/a edits and /contact/'s copy would not.
  const faq = applyTextEdits(faqSection(sections.areas), content.text);
  body = '<main id="main">\n' + promoteFirstH2(body) + faq + '</main>\n';
  // FAQ is the only registry group that can appear on this page (sliced in from
  // areas.html above) — applyGroupOrder runs over the whole assembled body so it reorders
  // exactly as the homepage does, from the same content.order.faq.
  body = applyGroupOrder(body, content.order);
  const jsonLd = [breadcrumbList([{ name: 'Home', path: '/' }, { name: 'Contact', path: '/contact' }])];
  const html = buildSimplePage({
    title: 'Contact Fast Basketball | Book a Call, North Broward',
    description: 'Book a 15 to 20 minute call with Coach Blake Kingsley about your player. Fast Basketball, north Broward. Replies within one business day.',
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
const LEGAL_EFFECTIVE = 'September 2026';

const OWNER_NOTE_PRIVACY = '<!-- OWNER NOTE (not rendered): this page is a starting point written in good faith ' +
  'by someone who is not a lawyer. It is not legal advice and not a promise of compliance. Have a Florida ' +
  'attorney read it and the terms before launch, the section about players under 13 most of all. -->\n';

// Emitted as an HTML comment, never as visible copy: a "not a lawyer" note on a public legal
// page reads as a disclaimer of the page itself. The owner sees it in view-source and here.
const OWNER_NOTE_TERMS = '<!-- OWNER NOTE (not rendered): this page reproduces the signed training agreement ' +
  '(docs/source-of-truth/agreement-form-terms.md). Keep it in sync with the Google Doc linked from the ' +
  'enrollment email, and resolve the contradictions listed in docs/source-of-truth/terms-qa-report.md ' +
  'in the signed document first. Not legal advice; have a Florida attorney review the agreement. -->\n';

function step11b_privacyPage(content, prelude) {
  let body = '<main id="main">\n<header class="band band-dark suburb-hero">\n<div class="shell">\n';
  body += '<div class="eyebrow">The Fine Print</div>\n<h1>Privacy</h1>\n';
  body += '<p class="lede">Straight answers about what we collect and what we do with it. No legal maze.</p>\n';
  body += '<p class="trust-line">In effect ' + LEGAL_EFFECTIVE + '</p>\n';
  body += '</div>\n</header>\n';
  body += '<section class="band band-ink">\n<div class="shell">\n';

  body += '<h2>Who is asking</h2>\n';
  body += '<p>Fast Basketball is Coach Blake Kingsley, training players one on one and in small groups across Coral Springs, Parkland, Coconut Creek, Margate and Tamarac. He is the person who reads what you send. Anything on this page, including a request to delete what we hold, goes to <a href="mailto:blake.kingsley@gmail.com">blake.kingsley@gmail.com</a>.</p>\n';

  body += '<h2>What we collect</h2>\n';
  body += '<p>Only what you type into a form. The contact form asks for a name, an email, a phone number, your area, which program you are asking about, and whatever you want to tell us about the player. The playbook form asks for a name, an email, and the player\'s grade, position and skill focus. The Locker asks for an email so we can send you the resource you unlocked.</p>\n';
  body += '<p>One thing gets recorded that you did not type: a playbook request is saved along with the internet address it came from, which is how we stop the form being hammered by a bot. Netlify, which hosts the site, also keeps its own standard server logs, the way every web host does.</p>\n';

  body += '<h2>What we do with it</h2>\n';
  body += '<p>We use it to reply with open slots, send the playbook or resource you requested, and follow up once. That is the whole list. We do not sell it, rent it, or hand it to anyone else, and we do not add you to anything you did not ask for.</p>\n';

  body += '<h2>Parents, and players under 18</h2>\n';
  body += '<p>These forms are meant for a parent or guardian. We train players from roughly 11 through 18, and the questions that come next — cost, scheduling, health, whether this is even the right fit — are yours to answer. If your player is under 18, please send the form yourself so the conversation starts with you.</p>\n';
  body += '<p>We do not knowingly collect personal information from a child under 13. If a child under 13 fills in one of these forms without you, we are not going to use it and we will delete it as soon as we know.</p>\n';
  body += '<p>If you think your under-13 child submitted something here, email <a href="mailto:blake.kingsley@gmail.com">blake.kingsley@gmail.com</a> and tell us the email address they used. We will find it, delete it, and write back to confirm it is gone. No form to fill in, no reason needed, and nothing you have to explain.</p>\n';

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
  body += '<p>Email <a href="mailto:blake.kingsley@gmail.com">blake.kingsley@gmail.com</a> and we delete what we hold on you. One message, done, no reason owed. You can also just ask what is on file and we will tell you.</p>\n';

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

// Rates here must match TRAINING_PAGES above, src/templates/sections/programs.html and OFFERS
// in src/lib/site-config.mjs. Policy text mirrors the signed agreement (docs/source-of-truth).
function step11c_termsPage(content, prelude) {
  // The text below is the Player and Parent Training Agreement Blake sends every family,
  // reproduced so it can be read before the enrollment call. Policy wording is kept as
  // written in docs/source-of-truth/agreement-form-terms.md; only headings and the
  // short lead-ins are the site's. Do not "improve" a policy sentence here without
  // changing the signed agreement to match.
  const li = (items) => '<ul class="prog-list">\n' + items.map((s) => '<li>' + s + '</li>\n').join('') + '</ul>\n';
  let body = '<main id="main">\n<header class="band band-dark suburb-hero">\n<div class="shell">\n';
  body += '<div class="eyebrow">The Fine Print</div>\n<h1>Terms &amp; Training Agreement</h1>\n';
  body += '<p class="lede">This is the agreement every family agrees to when they enroll, reproduced in full so you can read it before your call rather than after. If you do not agree with it, do not enroll. Coach Blake would rather lose the sale than the standard.</p>\n';
  body += '<p class="trust-line">In effect ' + LEGAL_EFFECTIVE + '</p>\n';
  // <details open>: pills on desktop, folded on phones (main.js closes it under 641px).
  body += '<details class="toc-wrap" open><summary>On this page</summary>\n';
  body += '<nav class="toc" aria-label="On this page"><a href="#how-to-agree">How to agree</a><a href="#term-and-investment">Term and investment</a><a href="#player-expectations">Player expectations</a><a href="#parent-expectations-and-terms">Parent expectations and terms</a><a href="#social-media-release-policy">Social media release policy</a><a href="#health-and-wellness-policy">Health and wellness policy</a><a href="#injury-policy">Injury policy</a><a href="#missed-session-policy">Missed session policy</a><a href="#rainout-policy">Rainout policy</a><a href="#payment-policy">Payment policy</a><a href="#refund-policy">Refund policy</a><a href="#early-termination-policy">Early termination policy</a><a href="#end-of-contract-and-renewal-policy">End of contract and renewal policy</a></nav>\n</details>\n';
  body += '</div>\n</header>\n';
  body += '<section class="band band-ink">\n<div class="shell">\n';

  body += '<h2 id="how-to-agree">How to agree</h2>\n';
  body += '<p><b>Step 1.</b> Read the terms and training agreement entirely to understand FAST Basketball expectations. If you have any questions or concerns, text Coach Blake Kingsley Jr. at <a href="sms:' + CONTACT.tel + '">' + CONTACT.phone + '</a> to schedule a phone call.</p>\n';
  body += '<p><b>Step 2.</b> Once you have reviewed this document, you agree to the terms by entering your full name on the checkout form where it asks &ldquo;type name to agree to the terms&rdquo; and clicking the &ldquo;I agree to the terms and conditions&rdquo; box to complete your order.</p>\n';
  body += '<p>If you do not agree with our terms and player and parent expectations, we ask that you do not enroll into our program. Our terms are extremely clear and protect the integrity of our program. Our program is selective and certainly not for every family. We only want to work with families who truly buy into our culture at FAST Basketball.</p>\n';

  body += '<h2 id="term-and-investment">Term and investment</h2>\n';
  body += '<p>This agreement begins on the day you register and continues for 3 or 12 months, with 3 months as the minimum. The investment is $840.</p>\n';
  // The signed agreement names one figure. The rate card below is the site's, from the same
  // pricing Blake set in his Sales Mastery worksheet, and is labelled so nobody mistakes it
  // for agreement text.
  body += '<h3 class="terms-sub">Published rates</h3>\n';
  body += '<p>The $840 in the agreement is the 3 month, twice a week membership. Every rate this site publishes, so the number on your enrollment call matches the number here:</p>\n';
  body += li([
    'Evaluation session: $50 for 60 minutes. $35 if booked within 48 hours of your intro call.',
    'Group training membership, 3 months: $480 once a week (12 sessions) or $840 twice a week (24 sessions).',
    'Group training membership, 12 months: $1,380 once a week (46 sessions) or $2,300 twice a week (92 sessions).',
    'Private one on one: $100 per hour.',
    'Private small group: $75 per player per hour.',
    'Drop-in session: $50, for families who cannot commit to a term yet.'
  ]);
  body += '<p>If you choose to cancel after 6 or 12 months, you agree to provide Coach Blake Kingsley 60 days written notice at <a href="mailto:' + CONTACT.email + '">' + CONTACT.email + '</a> to cancel any future recurring payment after the contract is complete. If you do not follow our terms, you will be automatically enrolled into the same agreement for the next 12 months, no exceptions.</p>\n';
  body += '<p>By registering for the program, you agree to the terms and conditions below, the player expectations and the parent expectations, which state Coach Kingsley&rsquo;s refund, cancellation and early termination policies.</p>\n';

  body += '<h2 id="player-expectations">Player expectations</h2>\n';
  body += '<p>Every player agrees to the following, in their own name.</p>\n';
  body += li([
    'I agree to be on time (15 minutes early).',
    'I agree to be a positive player who is coachable.',
    'I agree to bring my journal to every session to document my progress.',
    'I agree to work hard in every session. I am here to develop and reach my goals as a player.',
    'I agree to complete each homework task that Coach Kingsley assigns me in a timely manner.',
    'I agree to be accountable to Coach Kingsley&rsquo;s program and not make excuses.',
    'I agree to bring water and my own basketball and wear proper basketball shoes to each session.',
    'I agree to work hard and achieve the personal goals that Coach Kingsley and I set.',
    'I agree to be committed every week and dedicate time to work on my own away from our sessions.',
    'I agree that I can communicate with Coach Kingsley daily about my progress inside the members area, where I have unlimited access to daily check-ins.',
    'I agree to fill out my quarterly reports so I can track my progress as a player.',
    'I agree to put in the work needed to become a better player. My results are my responsibility.',
    'I agree to fill out my weekly game evaluations so Coach Kingsley and I have a deep understanding of my performances throughout the season.',
    'I agree to be a positive player when I make mistakes at the sessions.',
    'I agree to respect my neighbor.',
    'I agree to speak respectfully.'
  ]);

  body += '<h2 id="parent-expectations-and-terms">Parent expectations and terms</h2>\n';
  body += li([
    'We have a very clear no refund policy. All sales are final once you enroll into our program.',
    'If you (as a parent) have questions during the week, you can email Coach Kingsley and you will receive a response within 12 hours, Monday to Friday.',
    'If practice is canceled due to weather, Coach Kingsley will notify the players and parents via email. <b>The session will be moved to Zoom that evening</b>, meaning we still train regardless of the weather. Practice updates and cancellations are communicated via email.',
    'I agree to bring my child to our scheduled weekly session 15 minutes early to warm up and stretch.',
    'I understand that if we are late to the session we forfeit the time. All sessions last 60 minutes.',
    'I agree with Coach Kingsley&rsquo;s reschedule policy: if you miss a session, we do not offer a private one on one makeup session.',
    'I understand that during the sessions I will not pressure my child or yell from the sidelines. We train in a non-pressured environment.',
    'I understand how to communicate with Coach Kingsley, and will set up a 10 minute scheduled call when there are conflicts or vacations, in advance, so we can better prepare for our sessions. Please communicate when you are going out of town so we can plan accordingly.',
    'Missed sessions do not roll over into the following year or term for any reason.',
    'I understand that Coach Kingsley&rsquo;s billing process is an automatic electronic funds transfer. If you choose the split payment option, half of the funds are collected on the first payment and the second half are collected 30 days later.',
    'I understand that if I have a failed credit or debit card payment I will need to register a new card within 12 hours of the failed payment. Sessions pause until the payment is collected.',
    'We offer three options for payment: pay in full at a discount, split payment (two payments), or monthly payments. All sales are final. If you enroll and do not use the sessions, there are no makeup sessions for missed sessions.',
    'Three month plan: if you want to cancel your membership, notify us in writing at <a href="mailto:' + CONTACT.email + '">' + CONTACT.email + '</a> at least 7 days before our final session and we will turn off the membership. If not, you are auto-renewed into the next training term automatically.',
    'Twelve month plan: if you want to cancel your membership, notify us in writing at <a href="mailto:' + CONTACT.email + '">' + CONTACT.email + '</a> at least 60 days before our final session and we will turn off the membership. If not, you are auto-renewed into the next training term automatically.',
    'I understand that FAST Basketball, Coach Kingsley and any assistant coach for FAST Basketball are not liable for any injuries.'
  ]);
  body += '<p>Our terms and conditions apply to any training program offered by FAST Basketball. By scheduling any session, you are agreeing to the following terms and conditions of our company.</p>\n';

  body += '<h2 id="social-media-release-policy">Social media release policy</h2>\n';
  body += '<p>&ldquo;I, the undersigned, do hereby grant permission to FAST Basketball to post my and/or my child&rsquo;s story, photo, videos, hereinafter referred to as &lsquo;Materials,&rsquo; taken by FAST Basketball during sessions or that I submit to and for the FAST Basketball website, Instagram and Facebook accounts. I hereby release you, your representative, employees, managers, members, officers, parent companies, subsidiaries, and directors, from all claims and demands arising out of or in connection with any use of said Materials, including, without limitation, all claims for invasion of privacy, infringement of my right of publicity, defamation and any other personal and/or property rights.&rdquo;</p>\n';

  body += '<h2 id="health-and-wellness-policy">Health and wellness policy</h2>\n';
  body += '<p>&ldquo;I have enrolled in the personalized health and fitness program offered through FAST Basketball. I recognize that the program may involve strenuous physical activity including, but not limited to, muscle strength and endurance training, cardiovascular conditioning and training, and other various fitness activities. I hereby affirm that my child is in good physical condition and does not suffer from any known disability or condition which would prevent or limit my participation in this exercise program. I acknowledge my enrollment and participation in FAST Basketball training.&rdquo;</p>\n';
  body += '<p>&ldquo;I fully understand that my child may injure myself as a result of my enrollment and participation in this program and I hereby Release and Forever Discharge FAST Basketball and its agents, employees, representatives, affiliates, successors, or assigns, from any and all liability now or in the future for any conditions, injuries, sickness, losses, expenses or damages that I may obtain or incur. These conditions may include, but are not limited to, heart attacks, muscle strains, muscle pulls, muscle tears, broken bones, shin splints, heat prostration, injuries to knees, injuries to back, injuries to foot, or any other soreness that I may incur, including death.&rdquo;</p>\n';

  body += '<h2 id="injury-policy">Injury policy</h2>\n';
  body += '<p>If injury occurs and a player is unable to participate in the training sessions, the recurring payments will continue until the last day of the training agreement.</p>\n';

  body += '<h2 id="missed-session-policy">Missed session policy</h2>\n';
  body += '<p>We have a zero-tolerance missed session policy. If you miss a session without notice, you forfeit the session. We respectfully request at least 24 hours advance notice for all rescheduling and cancellations.</p>\n';

  body += '<h2 id="rainout-policy">Rainout policy</h2>\n';
  body += '<p>If the courts are too wet or there is significant rain during the morning or evening of our scheduled session, the session may be rescheduled upon FAST Basketball staff decision. FAST Basketball staff check to ensure the court is safe before every session. If the court is playable, we resume the session. Parents do not determine whether a session is canceled. If a parent decides not to attend a session that has been deemed playable, that session counts as a cancellation of less than 24 hours and is not eligible for makeup.</p>\n';

  body += '<h2 id="payment-policy">Payment policy</h2>\n';
  body += '<p>By agreeing to our regular training agreement, you commit to the entire training period. You have the option of paying in full or paying monthly with our automated system, which charges your credit or debit card every 30 days. If your card fails, our system prompts you to replace it within a 24 hour period. If a new card is not registered within 48 hours, there is a late payment fee of $75.</p>\n';

  body += '<h2 id="refund-policy">Refund policy</h2>\n';
  body += '<p>Due to the demand for our programs, we do not offer refunds in any case for any program, including private training, small group training, camps, clinics or any program added to our training page. Once a player reserves a training spot, we hold the spot for the player for the specific program.</p>\n';

  body += '<h2 id="early-termination-policy">Early termination policy</h2>\n';
  body += '<p>You can opt out of and cancel your contract at any time by providing written notice of intent to cancel to FAST Basketball, and will incur an early termination fee of 75% of the remaining contract. Paying this fee cancels any upcoming payment, and once the fee is paid, all sessions come to a close.</p>\n';

  body += '<h2 id="end-of-contract-and-renewal-policy">End of contract and renewal policy</h2>\n';
  body += '<p>If you would like to stop training after our contract is complete, email <a href="mailto:' + CONTACT.email + '">' + CONTACT.email + '</a> to let Coach Kingsley know that you will be discontinuing the program. This email must be sent 7 days before the end of the agreement. If you do not communicate with Coach Kingsley by the notice date, you agree to continue in the program beyond the agreement (meaning we hold your spot in the program) and the agreement auto-renews for $420.</p>\n';
  body += '<p>By becoming a customer of FAST Basketball, you agree to the terms on this page. Your enrollment confirms that you have reviewed this page in depth and agree to the FAST Basketball terms and conditions.</p>\n';

  body += '<p>The <a href="/privacy">privacy page</a> covers what this website collects and how to have it deleted. If anything here is unclear, <a href="/contact">ask before you enroll</a>. That is a much better outcome for everyone than reading it afterwards.</p>\n';

  body += OWNER_NOTE_TERMS;
  body += '</div>\n</section>\n</main>\n';
  const html = buildSimplePage({
    title: 'Terms & Training Agreement | Fast Basketball',
    description: 'The FAST Basketball training agreement in full: pricing, the 3 month minimum, player and parent expectations, missed session, refund and renewal policies.',
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
    renderImage: (key, alt, opts = {}) => {
      const image = content.images[key];
      const responsive = responsiveManifest[key];
      if (!image || !responsive) return null;
      const local = { images: { [key]: { ...image, alt: alt || image.alt } } };
      return renderImage(key, local, responsiveManifest, {
        loading: opts.priority ? 'eager' : 'lazy',
        fetchpriority: opts.priority ? 'high' : 'auto',
        sizes: '(max-width: 750px) 92vw, 45vw'
      });
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
      bodyHtml: '<main id="main" class="cv-page">\n' + out.html + '</main>\n',
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
  step3d_syncFrameStyles();
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
