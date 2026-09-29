// The weekly SEO research run, and the store its report lives in.
//
// Runs as a scheduled Cloud Function every Monday, and on demand from the admin panel (which
// writes a request document that a Firestore-triggered function picks up: a research run with
// paced autocomplete takes minutes, and Firebase Hosting cuts a request off at 60 seconds).
//
// Every input is live, gathered at run time, never remembered from a previous guess:
//   1. The live site: its sitemap, and each page's current <title> and meta description.
//   2. Google Search Console: which searches showed each page in the last 28 days, and the 28
//      before (lib/searchconsole.mjs). Needs the one owner step described there.
//   3. Google autocomplete: what people are typing right now, seeded per page (lib/seo.mjs).
//   4. The site's own writer (lib/seo-writer.mjs, no AI service, no key) drafts a title and
//      description from the above. A draft is kept only if it passes lib/seo.mjs checkProposal.
// Nothing here changes the public site. A draft reaches the site only when someone presses
// "Put in my draft" in the admin panel and then publishes, the same path as any edit.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { analyze, checkProposal, seedsFor, usefulPhrase, isBranded } from './seo.mjs';
import { searchConsole, NotConnected, accountEmail } from './searchconsole.mjs';
import { NothingBetter } from './seo-writer.mjs';

export const SITE = 'https://fast-basketball.com';
// Search Console data settles about two days behind; the window ends three days ago.
const LAG_DAYS = 3;
const WINDOW_DAYS = 28;
// How many pages get a draft per run: the ones with the most to gain, so the panel stays short.
export const DRAFTS_PER_RUN = 4;

// ---------------------------------------------------------------- store

const LOCAL = process.env.FB_LOCAL === 'true';
const LOCAL_PATH = () => resolve(process.cwd(), '.local/seo.json');
async function store() {
  const { getStore } = await import('./blobs.mjs');
  return getStore('seo');
}
function readLocal() {
  try { return existsSync(LOCAL_PATH()) ? JSON.parse(readFileSync(LOCAL_PATH(), 'utf8')) : {}; } catch { return {}; }
}
export async function getSeo(key) {
  if (LOCAL) return readLocal()[key] || null;
  return (await store()).get(key, { type: 'json' });
}
export async function putSeo(key, value) {
  if (LOCAL) {
    const all = readLocal(); all[key] = value;
    mkdirSync(dirname(LOCAL_PATH()), { recursive: true });
    writeFileSync(LOCAL_PATH(), JSON.stringify(all, null, 2) + '\n');
    return;
  }
  await (await store()).setJSON(key, value);
}

// ---------------------------------------------------------------- the live site

const decode = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
export function readHead(html) {
  const title = decode((html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1]);
  const description = decode((html.match(/<meta\s+name="description"\s+content="([^"]*)"/i) || [])[1]);
  return { title, description };
}
// A suburb page's city, from its path: /basketball-training/coral-springs -> Coral Springs.
export function cityOf(path) {
  const m = /^\/basketball-training\/([a-z-]+)$/.exec(path);
  return m ? m[1].split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') : '';
}

async function livePages(fetchImpl, site) {
  const xml = await (await fetchImpl(site + '/sitemap.xml')).text();
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).slice(0, 40);
  const pages = [];
  for (const url of urls) {
    try {
      const res = await fetchImpl(url);
      if (!res.ok) continue;
      const path = new URL(url).pathname.replace(/\/$/, '') || '/';
      pages.push({ url, path, city: cityOf(path), ...readHead(await res.text()) });
    } catch { /* one unreadable page does not stop the run */ }
  }
  return pages;
}

// ---------------------------------------------------------------- live autocomplete

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function autocomplete(seed, fetchImpl) {
  const url = 'https://suggestqueries.google.com/complete/search?client=firefox&hl=en&gl=us&q=' + encodeURIComponent(seed);
  const res = await fetchImpl(url, { headers: { 'User-Agent': 'Mozilla/5.0 (fast-basketball.com weekly SEO check)' } });
  if (!res.ok) return [];
  const body = await res.json().catch(() => null);
  return Array.isArray(body) && Array.isArray(body[1]) ? body[1].filter((p) => usefulPhrase(p, seed)) : [];
}
async function livePhrases(pages, fetchImpl) {
  const out = [];
  const seen = new Set();
  let asked = 0;
  for (const page of pages) {
    for (const seed of seedsFor(page)) {
      if (asked >= 30) break;
      asked += 1;
      let got = [];
      try { got = await autocomplete(seed, fetchImpl); } catch { /* skipped */ }
      for (const phrase of got) {
        const key = page.path + '|' + phrase;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ path: page.path, phrase, seed });
      }
      await sleep(250);
    }
  }
  return { phrases: out, asked };
}

// ---------------------------------------------------------------- dates

const day = (ms) => new Date(ms).toISOString().slice(0, 10);
export function windows(now) {
  const end = now - LAG_DAYS * 864e5;
  const start = end - (WINDOW_DAYS - 1) * 864e5;
  const prevEnd = start - 864e5;
  const prevStart = prevEnd - (WINDOW_DAYS - 1) * 864e5;
  return { start: day(start), end: day(end), prevStart: day(prevStart), prevEnd: day(prevEnd) };
}

// ---------------------------------------------------------------- the run

/**
 * One research run. Every dependency is a parameter so the tests can drive it offline:
 * `fetchImpl` for the live site and autocomplete, `gsc` for Search Console, `drafter` for the
 * drafts (lib/seo-writer.mjs siteWriter in production; null drafts nothing).
 */
export async function runResearch({ now = Date.now(), fetchImpl = fetch, gsc = searchConsole({ fetchImpl }), drafter = null, site = SITE, reason = 'weekly' } = {}) {
  const started = Date.now();
  const pages = await livePages(fetchImpl, site);

  const w = windows(now);
  let rows = [];
  let prevRows = [];
  const gscStatus = { connected: false, message: '', email: null, property: null, sitemap: null };
  try {
    rows = await gsc.rows(w.start, w.end);
    prevRows = await gsc.rows(w.prevStart, w.prevEnd);
    gscStatus.connected = true;
    gscStatus.property = await gsc.property();
    try {
      await gsc.submitSitemap(site + '/sitemap.xml');
      gscStatus.sitemap = new Date(now).toISOString();
    } catch (err) {
      gscStatus.message = 'Search data read; the sitemap could not be submitted (' + err.message + ').';
    }
  } catch (err) {
    gscStatus.message = err.message;
    gscStatus.email = err instanceof NotConnected ? err.email || (await accountEmail(fetchImpl)) : null;
  }

  const { phrases, asked } = await livePhrases(pages, fetchImpl);
  const analysis = analyze({ rows, prevRows, pages, phrases });

  // Drafts, for the pages with the most to gain. Kept only if they pass the
  // site's rules; a rejected draft is recorded with why, so a bad week is visible, not silent.
  const drafts = {};
  const rejected = [];
  if (drafter) {
    const targets = [];
    for (const o of analysis.opportunities) if (!targets.includes(o.path)) targets.push(o.path);
    for (const path of targets.slice(0, DRAFTS_PER_RUN)) {
      const page = analysis.pages.find((p) => p.path === path);
      if (!page || !page.title) continue;
      const findings = analysis.opportunities.filter((o) => o.path === path);
      try {
        const d = await drafter(page, { findings, queries: page.topQueries.filter((q) => !isBranded(q.query)), phrases: page.phrases });
        const check = checkProposal(d, page);
        if (check.ok) drafts[path] = { title: check.title, description: check.description, why: d.why || '', sources: d.sources || [], at: new Date(now).toISOString() };
        else rejected.push({ path, problems: check.problems, title: d.title || '', description: d.description || '' });
      } catch (err) {
        // "Nothing better to suggest" is the writer declining, not a rule broken: skip it.
        if (!(err instanceof NothingBetter)) rejected.push({ path, problems: ['drafting failed: ' + err.message] });
      }
    }
  }

  const report = {
    at: new Date(now).toISOString(),
    reason,
    tookMs: Date.now() - started,
    window: w,
    sources: { pages: pages.length, searchConsole: gscStatus, autocomplete: { asked, phrases: phrases.length }, research: drafter ? 'site-writer' : null },
    ...analysis,
    drafts,
    rejected
  };
  await putSeo('latest', report);
  return report;
}
