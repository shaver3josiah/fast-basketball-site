// Run: node --test server/functions/tests/seo.test.mjs
//
// Offline. Search Console, the live site, Google autocomplete and Claude are all fakes; FB_LOCAL
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
const { parseDraft, claudeDrafter } = await import('../lib/seo-drafter.mjs');
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

// ---------------------------------------------------------------- Claude, faked

test('a draft is read from the final JSON, and its sources from the searches actually made', async () => {
  assert.deepEqual(parseDraft([{ type: 'text', text: 'Here it is.\n{"title": "T | Fast Basketball", "description": "D", "why": "W"}' }]), { title: 'T | Fast Basketball', description: 'D', why: 'W' });
  assert.throws(() => parseDraft([{ type: 'text', text: 'no json' }]));

  const calls = [];
  const fake = { beta: { messages: { create: async (p) => {
    calls.push(p);
    if (calls.length === 1) return { stop_reason: 'pause_turn', content: [{ type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://rival.example/coral-springs', title: 'Rival' }] }] };
    return { stop_reason: 'end_turn', content: [
      { type: 'text', text: 'Families searching here compare group and private options.', citations: [{ type: 'web_search_result_location', url: 'https://cited.example/', title: 'Cited' }] },
      { type: 'text', text: '{"title": "Basketball Training in Coral Springs | Fast Basketball", "description": "Group and private basketball training for Coral Springs players, all at one Fort Lauderdale gym with Coach Blake Kingsley.", "why": "Top results lead with the city."}' }
    ] };
  } } } };
  const drafter = await claudeDrafter({ client: fake });
  const d = await drafter({ url: 'https://fast-basketball.com/basketball-training/coral-springs', city: 'Coral Springs', title: 'Old', description: 'Old' }, { queries: [{ query: 'basketball training coral springs', impressions: 400, position: 5 }] });
  assert.equal(calls.length, 2, 'the paused turn was resumed');
  assert.equal(calls[1].messages.length, 2, 'by resending it, with no extra user message');
  assert.equal(calls[0].model, 'claude-opus-5');
  assert.equal(calls[0].tools[0].type, 'web_search_20260209');
  assert.equal(calls[0].fallbacks, 'default');
  assert.deepEqual(d.sources.map((s) => s.url), ['https://cited.example/', 'https://rival.example/coral-springs'], 'cited first, then searched, across the pause');
  assert.equal(await claudeDrafter({ apiKey: '' }), null, 'no key, no drafter');
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
