// Run: node --test server/functions/tests/seo.test.mjs
//
// Offline. Search Console, the live site and Google autocomplete are all fakes; FB_LOCAL
// sends the seo store and content.json to a scratch directory.
process.env.FB_LOCAL = 'true';
process.env.ADMIN_SESSION_SECRET = 'test-secret-1234567890';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), 'fb-seo-')));
const { analyze, checkProposal, isBranded, covers, expectedCtr, pathOf, usefulPhrase } = await import('../lib/seo.mjs');
const { runResearch, readHead, cityOf, windows, getSeo } = await import('../lib/seo-research.mjs');
const { writeDraft, siteWriter, NothingBetter } = await import('../lib/seo-writer.mjs');
const { handle: adminSeo } = await import('../admin-seo.mjs');
const { handle: ping } = await import('../seo-ping.mjs');
const { createSessionCookie } = await import('../lib/auth.mjs');
const { buildHead } = await import('../../../src/render.mjs');

const cookie = () => createSessionCookie(60_000).split(';')[0];
const req = (method, body) => new Request('http://localhost/api/admin-seo', {
  method, headers: { 'content-type': 'application/json', cookie: cookie() }, body: body ? JSON.stringify(body) : undefined
});

// ---------------------------------------------------------------- the pure half

test('brand searches are the ones with FAST, Blake or Kingsley in them, and not every "fast"', () => {
  for (const q of ['fast basketball', 'Fast Basketball Fort Lauderdale', 'fast-basketball.com', 'blake kingsley basketball', 'fast']) assert.equal(isBranded(q), true, q);
  for (const q of ['basketball training coral springs', 'how to dribble fast', 'fast break drills']) assert.equal(isBranded(q), false, q);
});

test('coverage, click-through benchmarks and paths', () => {
  assert.equal(covers('Basketball Training in Coral Springs | Fast Basketball', 'basketball training coral springs'), true);
  assert.equal(covers('Basketball Training in Coral Springs', 'private basketball lessons coral springs'), false);
  assert.ok(expectedCtr(1) > expectedCtr(5) && expectedCtr(5) > expectedCtr(15));
  assert.equal(pathOf('https://fast-basketball.com/basketball-training/parkland/'), '/basketball-training/parkland');
  assert.equal(pathOf('https://fast-basketball.com/'), '/');
  assert.equal(usefulPhrase('basketball training coral springs for kids', 'basketball training coral springs'), true);
  assert.equal(usefulPhrase('private basketball lessons near me', 'private basketball lessons'), true);
  assert.equal(usefulPhrase('youth basketball training 10 year olds', 'youth basketball training'), true);
  // Every one of these came back from live autocomplete on the first real run.
  for (const [phrase, seed] of [
    ['private basketball lessons pittsburgh', 'private basketball lessons'],
    ['how much does a basketball trainer cost', 'basketball trainer coral springs'],
    ['youth basketball training equipment', 'youth basketball training'],
    ['basketball skills evaluation sheet', 'basketball skills evaluation'],
    ['basketball trainer jobs coral springs', 'basketball trainer coral springs']
  ]) assert.equal(usefulPhrase(phrase, seed), false, phrase);
});

test('analyze finds the page that is seen and not clicked, and the search it almost ranks for', () => {
  const row = (page, query, impressions, clicks, position) => ({ keys: ['https://fast-basketball.com' + page, query], impressions, clicks, ctr: clicks / impressions, position });
  const r = analyze({
    rows: [
      row('/basketball-training/coral-springs', 'basketball training coral springs', 400, 2, 5),
      row('/basketball-training/coral-springs', 'youth basketball lessons coral springs', 60, 0, 12),
      row('/', 'fast basketball', 50, 30, 1)
    ],
    prevRows: [row('/', 'fast basketball', 40, 20, 1)],
    pages: [
      { path: '/basketball-training/coral-springs', url: 'https://fast-basketball.com/basketball-training/coral-springs', city: 'Coral Springs', title: 'Basketball Training in Coral Springs | Fast Basketball', description: 'Coach Blake Kingsley trains players from Coral Springs at the Salvation Army gym in Fort Lauderdale.' },
      { path: '/', url: 'https://fast-basketball.com/', title: 'Basketball Training in South Florida | Fast Basketball', description: 'x'.repeat(100) }
    ],
    phrases: [{ path: '/', phrase: 'basketball camps near me' }]
  });
  assert.equal(r.totals.clicks, 32);
  assert.equal(r.totals.brandedClicks, 30);
  assert.equal(r.totals.nonBrandedClicks, 2);
  assert.equal(r.totals.prevClicks, 20);
  const kinds = r.opportunities.map((o) => o.path + ':' + o.kind);
  assert.ok(kinds.includes('/basketball-training/coral-springs:low-ctr'), kinds.join());
  assert.ok(kinds.includes('/basketball-training/coral-springs:striking'), 'position 12 and never said in the title');
  assert.ok(kinds.includes('/:live-phrases'));
  assert.equal(r.opportunities[0].path, '/basketball-training/coral-springs', 'the biggest miss comes first');
  assert.equal(r.queries[0].query, 'fast basketball');
  assert.equal(r.queries[0].branded, true);
});

test('a proposal is held to the site’s rules', () => {
  const good = { title: 'Basketball Training in Parkland | Fast Basketball', description: 'Coach Blake Kingsley trains Parkland players at one Fort Lauderdale gym. Group memberships and private sessions. Enroll online.' };
  assert.equal(checkProposal(good, { city: 'Parkland' }).ok, true);
  const bad = (over, why) => {
    const c = checkProposal({ ...good, ...over }, { city: 'Parkland' });
    assert.equal(c.ok, false, why);
    return c.problems.join(' | ');
  };
  assert.match(bad({ description: good.description.replace('Enroll online.', 'Sessions from $50.') }), /price/);
  assert.match(bad({ title: 'Basketball Training — Parkland | Fast Basketball' }), /dash/);
  assert.match(bad({ description: good.description.replace('Enroll online.', 'Sessions at Pine Trails Park.') }), /park/);
  assert.match(bad({ title: 'The Best Basketball Training | Fast Basketball' }), /claim/);
  assert.match(bad({ title: 'Basketball Training in Parkland' }), /name Fast Basketball/);
  assert.match(bad({ title: 'Basketball Training in Florida | Fast Basketball', description: good.description.replace(/Parkland/g, 'local') }), /Parkland/);
  assert.match(bad({ title: 'x'.repeat(70) + ' | Fast Basketball' }), /characters/);
});

test('reading a live page head, a city from a path, and the date windows', () => {
  assert.deepEqual(readHead('<html><head><title>A &amp; B | Fast Basketball</title><meta name="description" content="It&#39;s here"></head>'), { title: 'A & B | Fast Basketball', description: "It's here" });
  assert.equal(cityOf('/basketball-training/coconut-creek'), 'Coconut Creek');
  assert.equal(cityOf('/contact'), '');
  const w = windows(Date.parse('2026-12-31T12:00:00Z'));
  assert.deepEqual(w, { start: '2026-12-01', end: '2026-12-28', prevStart: '2026-11-03', prevEnd: '2026-11-30' });
});

// ---------------------------------------------------------------- the site's own writer

test('the writer leads with the real search, keeps each page on its own subject, and always names the gym', () => {
  const old = { title: 'Old', description: 'Old' };
  const gym = /Every session is at one Fort Lauderdale gym\./;

  // Search Console beats autocomplete, and small words stay small.
  let d = writeDraft({ path: '/training/private', ...old }, {
    queries: [{ query: 'private basketball lessons for kids', impressions: 80, position: 9 }],
    phrases: ['one on one basketball training near me']
  });
  assert.equal(d.title, 'Private Basketball Lessons for Kids | Fast Basketball');
  assert.match(d.description, /^Private basketball lessons for kids with Coach Blake Kingsley/, 'sentence case mid-description');
  assert.match(d.description, gym);
  assert.match(d.why, /search that showed this page most/);

  // A private-lessons search is not about the group page, so it keeps its own subject.
  d = writeDraft({ path: '/training/group-training', ...old }, { queries: [{ query: 'private basketball lessons', impressions: 500, position: 6 }] });
  assert.doesNotMatch(d.title + d.description, /private/i);
  assert.match(d.title, /^Group Basketball Training/);

  // A city page keeps its city in the title, even when the searched wording would not fit with it.
  d = writeDraft({ path: '/basketball-training/coconut-creek', city: 'Coconut Creek', ...old }, {
    queries: [{ query: 'one on one basketball training coconut creek', impressions: 40, position: 12 }]
  });
  assert.equal(d.title, 'Basketball Training in Coconut Creek | Fast Basketball');
  assert.match(d.description, /1-on-1 basketball training in Coconut Creek/);
  assert.match(d.description, gym, 'the gym survives a long lead');

  // Branded searches are never a lead, and every draft passes the site's rules.
  d = writeDraft({ path: '/', ...old }, { queries: [{ query: 'fast basketball training', impressions: 900, position: 1 }], phrases: ['youth basketball training'] });
  assert.equal(d.title, 'Youth Basketball Training in South Florida | Fast Basketball');
  assert.equal(checkProposal(d, {}).ok, true);

  // Nothing better than what is there, or a page with no profile: no draft.
  const same = writeDraft({ path: '/training/evaluation', ...old }, {});
  assert.equal(writeDraft({ path: '/training/evaluation', title: same.title, description: same.description }, {}), null);
  assert.equal(writeDraft({ path: '/contact', ...old }, { phrases: ['basketball training'] }), null);
});

test('the run skips a page the writer has nothing for, and does not call that a broken rule', async () => {
  await assert.rejects(siteWriter({ path: '/contact', title: 'x', description: 'x' }, {}), NothingBetter);
  const gsc = { rows: async () => [], property: async () => null, submitSitemap: async () => null };
  const r = await runResearch({ now: Date.parse('2026-12-31T12:00:00Z'), fetchImpl: fakeFetch, gsc, drafter: async () => { throw new NothingBetter('nothing'); } });
  assert.deepEqual(r.rejected, []);
  assert.equal(r.sources.research, 'site-writer');
});

// ---------------------------------------------------------------- a whole run, faked

const LIVE = {
  'https://fast-basketball.com/sitemap.xml': '<urlset><url><loc>https://fast-basketball.com/</loc></url><url><loc>https://fast-basketball.com/basketball-training/coral-springs</loc></url></urlset>',
  'https://fast-basketball.com/': '<title>Basketball Training in South Florida | Fast Basketball</title><meta name="description" content="Coach Blake Kingsley trains players 11 to 18 at one Fort Lauderdale gym. Group memberships, private training, enroll online.">',
  'https://fast-basketball.com/basketball-training/coral-springs': '<title>Coral Springs</title><meta name="description" content="Short.">'
};
function fakeFetch(url) {
  if (LIVE[url]) return Promise.resolve(new Response(LIVE[url]));
  if (url.startsWith('https://suggestqueries.google.com/')) {
    const q = decodeURIComponent(url.split('q=')[1]);
    return Promise.resolve(new Response(JSON.stringify([q, [q + ' for kids', q + ' jobs', 'nba scores']])));
  }
  return Promise.resolve(new Response('nope', { status: 404 }));
}

test('a research run gathers every live source, drafts, and keeps only drafts that pass', async () => {
  const gsc = {
    property: async () => 'sc-domain:fast-basketball.com',
    // The current window for 31 December is 1 to 28 December; the previous one is empty.
    rows: async (start) => start.startsWith('2026-12') ? [
      { keys: ['https://fast-basketball.com/basketball-training/coral-springs', 'basketball training coral springs'], impressions: 300, clicks: 1, ctr: 0.003, position: 6 }
    ] : [],
    submitSitemap: async () => 'sc-domain:fast-basketball.com'
  };
  const drafts = [];
  const drafter = async (page) => {
    drafts.push(page.path);
    return page.path === '/'
      ? { title: 'The Best Basketball Training | Fast Basketball', description: 'x'.repeat(100) }
      : { title: 'Basketball Training in Coral Springs | Fast Basketball', description: 'Group and private basketball training for Coral Springs players, all at one Fort Lauderdale gym with Coach Blake Kingsley.', sources: [{ url: 'https://a.example/', title: 'A' }] };
  };
  const r = await runResearch({ now: Date.parse('2026-12-31T12:00:00Z'), fetchImpl: fakeFetch, gsc, drafter });
  assert.equal(r.sources.pages, 2);
  assert.equal(r.sources.searchConsole.connected, true);
  assert.ok(r.sources.searchConsole.sitemap, 'the sitemap was submitted');
  assert.ok(r.sources.autocomplete.phrases > 0);
  assert.ok(r.pages.every((p) => p.phrases.every((x) => !/jobs|nba/.test(x))), 'job and NBA completions are dropped');
  assert.equal(r.opportunities[0].path, '/basketball-training/coral-springs');
  assert.ok(r.drafts['/basketball-training/coral-springs'], 'the good draft is kept');
  assert.equal(r.drafts['/'], undefined, 'the one saying "best" is not');
  assert.equal(r.rejected[0].path, '/');
  assert.deepEqual(await getSeo('latest'), r, 'and the report is stored');
});

test('without Search Console access the run still works, and says which account to add', async () => {
  const { NotConnected } = await import('../lib/searchconsole.mjs');
  const gsc = { rows: async () => { throw new NotConnected('refused (403)', 'api-sa@example.iam.gserviceaccount.com'); }, property: async () => null, submitSitemap: async () => null };
  const r = await runResearch({ now: Date.parse('2026-12-31T12:00:00Z'), fetchImpl: fakeFetch, gsc });
  assert.equal(r.sources.searchConsole.connected, false);
  assert.equal(r.sources.searchConsole.email, 'api-sa@example.iam.gserviceaccount.com');
  assert.ok(r.opportunities.length > 0, 'the live site and autocomplete still produce findings');
  assert.deepEqual(r.drafts, {});
});

test('a refusal carries Google’s own reason, because a disabled API and a missing user both say 403', async () => {
  const { searchConsole, NotConnected } = await import('../lib/searchconsole.mjs');
  const disabled = 'Google Search Console API has not been used in project 606495868698 before or it is disabled.';
  const fetchImpl = async (url) => {
    if (url.includes('/token')) return new Response(JSON.stringify({ access_token: 't' }));
    if (url.endsWith('/email')) return new Response('sa@example.iam.gserviceaccount.com');
    return new Response(JSON.stringify({ error: { code: 403, message: disabled } }), { status: 403 });
  };
  const err = await searchConsole({ fetchImpl }).property().catch((e) => e);
  assert.ok(err instanceof NotConnected);
  assert.match(err.message, /has not been used in project/);
  assert.equal(err.email, 'sa@example.iam.gserviceaccount.com');
  // No body to read: the old hint stands.
  const bare = await searchConsole({ fetchImpl: async (url) => url.includes('/token') ? new Response('{"access_token":"t"}') : new Response('', { status: 403 }) }).property().catch((e) => e);
  assert.match(bare.message, /Add it as a user/);
});

// ---------------------------------------------------------------- applying, and the head

test('apply puts a checked title in the draft, a later text save keeps it, and the page head uses it', async () => {
  fs.mkdirSync('src/data', { recursive: true });
  fs.writeFileSync('src/data/content.json', JSON.stringify({ text: {}, images: {} }));
  const title = 'Basketball Training in Coral Springs | Fast Basketball';
  const description = 'Group and private basketball training for Coral Springs players, all at one Fort Lauderdale gym with Coach Blake Kingsley.';

  let res = await adminSeo(req('POST', { action: 'apply', path: '/basketball-training/coral-springs', title: 'Cheap $50 training | Fast Basketball', description }), { now: Date.now() });
  assert.equal(res.status, 422, 'the server re-checks whatever the page sent');

  res = await adminSeo(req('POST', { action: 'apply', path: '/basketball-training/coral-springs', title, description }), { now: Date.now() });
  assert.equal(res.status, 200);
  let content = JSON.parse(fs.readFileSync('src/data/content.json', 'utf8'));
  assert.equal(content.seo['/basketball-training/coral-springs'].title, title);

  // The Content tab posts back the object it loaded, which has no seo key. It must survive.
  const { default: adminContent } = await import('../admin-content.mjs');
  const { validateContentShape } = await import('../../../src/lib/content-schema.mjs');
  const loaded = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../../../src/data/content.json'), 'utf8'));
  assert.deepEqual(validateContentShape(loaded), []);
  await adminContent(new Request('http://localhost/api/admin-content', { method: 'POST', headers: { 'content-type': 'application/json', cookie: cookie() }, body: JSON.stringify(loaded) }));
  content = JSON.parse(fs.readFileSync('src/data/content.json', 'utf8'));
  assert.equal(content.seo['/basketball-training/coral-springs'].title, title, 'a text save does not drop it');

  const head = buildHead({ title: 'Old title', description: 'Old description that is long enough to be a description.', canonicalPath: '/basketball-training/coral-springs', content });
  assert.match(head, new RegExp('<title>' + title.replace(/[|]/g, '\\|') + '</title>'));
  assert.match(head, /og:title" content="Basketball Training in Coral Springs/);
  const other = buildHead({ title: 'Untouched | Fast Basketball', description: 'x'.repeat(60), canonicalPath: '/contact', content });
  assert.match(other, /<title>Untouched \| Fast Basketball<\/title>/);

  res = await adminSeo(req('POST', { action: 'remove', path: '/basketball-training/coral-springs' }), { now: Date.now() });
  assert.deepEqual((await res.json()).applied, {});
  assert.equal((await adminSeo(req('POST', { action: 'apply', path: 'https://evil/', title, description }), { now: Date.now() })).status, 422);
});

test('the deploy ping submits the sitemap at most once every ten minutes', async () => {
  let submitted = 0;
  const gsc = { submitSitemap: async () => { submitted += 1; return 'sc-domain:fast-basketball.com'; } };
  const post = () => new Request('http://localhost/api/seo-ping', { method: 'POST' });
  const t = Date.parse('2027-01-01T00:00:00Z');
  assert.equal((await (await ping(post(), { now: t, gsc })).json()).submitted, true);
  assert.equal((await (await ping(post(), { now: t + 60000, gsc })).json()).submitted, false);
  assert.equal((await (await ping(post(), { now: t + 11 * 60000, gsc })).json()).submitted, true);
  assert.equal(submitted, 2);
});
