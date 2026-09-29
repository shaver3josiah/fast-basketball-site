// SEO research: what the live data says each page should do next.
//
// Three live sources feed it, gathered by lib/seo-research.mjs: the site's own Google Search
// Console numbers (which searches showed each page, clicks, average position), Google's live
// autocomplete for the phrases families type, and the pages' current titles and descriptions
// read off the live site. This module turns those into findings and judges any proposed new
// title or description against the site's own rules.
//
// Pure: no I/O, no clock. Everything is a function of its arguments, so the same data always
// gives the same advice and the tests need nothing.

// ---------------------------------------------------------------- brand vs not
//
// Section 7 of the website agreement: a search is "non-branded" if it did not include
// "FAST Basketball", "FAST", Blake Kingsley's name, or another FAST brand term. "fast" alone
// is too common to count on its own ("how to dribble fast" is not a brand search), so it is a
// brand term only as the whole query or beside basketball.
const BRAND_RE = /\bfast[\s-]*(basketball|bball|b-?ball|hoops)\b|fastbasketball|fast-basketball|\bblake\b|\bkingsley\b|\bkingsly\b/i;
export const isBranded = (q) => BRAND_RE.test(String(q)) || /^\s*fast\s*$/i.test(String(q));

// ---------------------------------------------------------------- click-through
//
// What share of searchers typically click a result at each position. A page far below its
// position's usual rate is being shown and passed over: the title and description are the
// part of it a searcher reads, so they are the lever. Rounded from published CTR studies
// (Advanced Web Ranking, Backlinko); the exact figures matter less than the shape.
const EXPECTED_CTR = [0.28, 0.15, 0.10, 0.07, 0.053, 0.042, 0.034, 0.028, 0.023, 0.02];
export function expectedCtr(position) {
  const p = Math.max(1, Math.round(Number(position) || 99));
  return p <= 10 ? EXPECTED_CTR[p - 1] : p <= 20 ? 0.01 : 0.003;
}

// Enough data to say anything. Below these a finding is noise, and a small local site sees
// small numbers, so they are low but not zero.
export const MIN_IMPRESSIONS_PAGE = 30;
export const MIN_IMPRESSIONS_QUERY = 10;

// Search Console reports URLs; the site's own paths are the join key everywhere else.
export function pathOf(url) {
  try {
    const u = new URL(url);
    return u.pathname.length > 1 ? u.pathname.replace(/\/$/, '') || '/' : '/';
  } catch {
    return String(url || '');
  }
}

const words = (s) => String(s || '').toLowerCase().match(/[a-z0-9]+/g) || [];
const STOP = new Set(['the', 'a', 'an', 'for', 'in', 'of', 'and', 'to', 'near', 'me', 'my', 'with', 'on', 'at', 'fl', 'florida']);
/** Does the page's title or description already speak to this phrase's meaningful words? */
export function covers(text, phrase) {
  const have = new Set(words(text));
  const need = words(phrase).filter((w) => !STOP.has(w));
  if (!need.length) return true;
  const hit = need.filter((w) => have.has(w) || have.has(w.replace(/s$/, '')) || have.has(w + 's'));
  return hit.length / need.length >= 0.75;
}

function sum(rows, key) { return rows.reduce((s, r) => s + (Number(r[key]) || 0), 0); }
function weightedPosition(rows) {
  const imp = sum(rows, 'impressions');
  return imp ? rows.reduce((s, r) => s + (Number(r.position) || 0) * (Number(r.impressions) || 0), 0) / imp : 0;
}

/**
 * The findings. `rows` and `prevRows` are Search Console rows with keys [page, query] (this
 * window and the one before), `pages` the live site's pages with their current title and
 * description, `phrases` live autocomplete phrases each already tied to a page.
 */
export function analyze({ rows = [], prevRows = [], pages = [], phrases = [] }) {
  const byPath = new Map(pages.map((p) => [p.path, { ...p, rows: [] }]));
  for (const r of rows) {
    const path = pathOf(r.keys ? r.keys[0] : r.page);
    const query = r.keys ? r.keys[1] : r.query;
    const row = { query, clicks: r.clicks || 0, impressions: r.impressions || 0, ctr: r.ctr || 0, position: r.position || 0, branded: isBranded(query) };
    if (!byPath.has(path)) byPath.set(path, { path, url: '', title: '', description: '', rows: [] });
    byPath.get(path).rows.push(row);
  }
  const all = [...byPath.values()].flatMap((p) => p.rows.map((r) => ({ ...r, path: p.path })));
  const prevAll = prevRows.map((r) => ({ clicks: r.clicks || 0, impressions: r.impressions || 0, query: r.keys ? r.keys[1] : r.query }));

  const totals = {
    clicks: sum(all, 'clicks'),
    impressions: sum(all, 'impressions'),
    position: Math.round(weightedPosition(all) * 10) / 10,
    brandedClicks: sum(all.filter((r) => r.branded), 'clicks'),
    nonBrandedClicks: sum(all.filter((r) => !r.branded), 'clicks'),
    prevClicks: prevRows.length ? sum(prevAll, 'clicks') : null,
    prevImpressions: prevRows.length ? sum(prevAll, 'impressions') : null
  };
  totals.ctr = totals.impressions ? totals.clicks / totals.impressions : 0;

  // Top searches across the site, merged over pages.
  const qMap = new Map();
  for (const r of all) {
    const q = qMap.get(r.query) || { query: r.query, clicks: 0, impressions: 0, posW: 0, branded: r.branded, path: r.path, best: 0 };
    q.clicks += r.clicks; q.impressions += r.impressions; q.posW += r.position * r.impressions;
    if (r.impressions > q.best) { q.best = r.impressions; q.path = r.path; }
    qMap.set(r.query, q);
  }
  const queries = [...qMap.values()]
    .map((q) => ({ query: q.query, clicks: q.clicks, impressions: q.impressions, position: q.impressions ? Math.round(q.posW / q.impressions * 10) / 10 : 0, branded: q.branded, path: q.path }))
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
    .slice(0, 30);

  const pageOut = [];
  const opportunities = [];
  for (const p of byPath.values()) {
    const clicks = sum(p.rows, 'clicks');
    const impressions = sum(p.rows, 'impressions');
    const position = weightedPosition(p.rows);
    const ctr = impressions ? clicks / impressions : 0;
    const top = p.rows.slice().sort((a, b) => b.impressions - a.impressions).slice(0, 8);
    const nonBrand = top.filter((r) => !r.branded);
    const pagePhrases = phrases.filter((x) => x.path === p.path && !covers(p.title + ' ' + p.description, x.phrase)).map((x) => x.phrase).slice(0, 8);
    pageOut.push({ path: p.path, url: p.url, title: p.title, description: p.description, clicks, impressions, ctr, position: Math.round(position * 10) / 10, topQueries: top, phrases: pagePhrases });

    // 1. Seen, not clicked: the title and description are the fix.
    if (impressions >= MIN_IMPRESSIONS_PAGE && position > 0 && position <= 20) {
      const expected = expectedCtr(position);
      if (ctr < expected * 0.6) {
        const missed = Math.round(impressions * (expected - ctr));
        opportunities.push({
          path: p.path, kind: 'low-ctr', weight: missed * 3,
          text: 'Shown ' + impressions + ' times at about position ' + Math.round(position) + ', clicked ' + clicks + '. Pages at that position usually get about ' +
            Math.round(expected * 100) + '% of clicks; a sharper title and description could bring about ' + missed + ' more visits.',
          queries: nonBrand.slice(0, 4).map((r) => r.query)
        });
      }
    }
    // 2. Almost on page one: say the words people searched.
    for (const r of p.rows) {
      if (r.branded || r.impressions < MIN_IMPRESSIONS_QUERY || r.position < 8 || r.position > 20) continue;
      if (covers(p.title + ' ' + p.description, r.query)) continue;
      opportunities.push({
        path: p.path, kind: 'striking', weight: r.impressions,
        text: '“' + r.query + '” showed this page ' + r.impressions + ' times at position ' + Math.round(r.position) +
          ', just off the top results. The title and description never say it; saying it plainly is the cheapest way up.',
        queries: [r.query]
      });
    }
    // 3. What families are typing right now that the page does not answer yet.
    if (pagePhrases.length) {
      opportunities.push({
        path: p.path, kind: 'live-phrases', weight: 5 * pagePhrases.length,
        text: 'People are searching ' + pagePhrases.slice(0, 3).map((x) => '“' + x + '”').join(', ') + ' right now, and this page’s title and description do not mention it.',
        queries: pagePhrases.slice(0, 5)
      });
    }
    // 4. Lengths Google cuts off or ignores.
    if (p.title && (p.title.length > 60 || p.title.length < 25)) {
      opportunities.push({ path: p.path, kind: 'title-length', weight: 4, text: 'The title is ' + p.title.length + ' characters; Google shows about 50 to 60. ' + (p.title.length > 60 ? 'The end gets cut off in results.' : 'There is room to say more.'), queries: [] });
    }
    if (p.description && (p.description.length > 160 || p.description.length < 70)) {
      opportunities.push({ path: p.path, kind: 'desc-length', weight: 3, text: 'The description is ' + p.description.length + ' characters; about 120 to 155 shows in full.', queries: [] });
    }
  }
  opportunities.sort((a, b) => b.weight - a.weight);
  pageOut.sort((a, b) => b.impressions - a.impressions || (a.path < b.path ? -1 : 1));
  return { totals, queries, pages: pageOut, opportunities: opportunities.slice(0, 20) };
}

// ---------------------------------------------------------------- guardrails
//
// A proposal is shown to Blake, and applied, only if it passes these. They are the site's own
// standing rules (CLAUDE.md) turned into checks: no public price, no training anywhere but the
// gym, no em dashes, none of the banned marketing words, no claim nobody can verify.
const BANNED = [
  [/\$|\bdollars?\b|\bprice[sd]?\b|\bcost\b/i, 'mentions a price (only the group ladder is ever priced publicly, and not in search snippets)'],
  [/—|–/, 'uses a long dash (the site uses none in visible copy)'],
  [/\bwatch\b|\beyes?\b|next level/i, 'uses a word the site’s copy rules ban (watch, eye, next level)'],
  [/\bparks?\b/i, 'names a park (sessions happen only at the Fort Lauderdale gym)'],
  [/\bbest\b|#\s*1\b|\bnumber one\b|\btop[- ]rated\b|\bguarantee/i, 'makes a claim nobody can check (best, #1, top-rated, guaranteed)'],
  [/<|>|https?:\/\//i, 'contains markup or a web address']
];

export function checkProposal(p, page = {}) {
  const problems = [];
  const title = typeof p?.title === 'string' ? p.title.trim() : '';
  const description = typeof p?.description === 'string' ? p.description.trim() : '';
  if (title.length < 25 || title.length > 60) problems.push('title is ' + title.length + ' characters (25 to 60)');
  if (description.length < 70 || description.length > 160) problems.push('description is ' + description.length + ' characters (70 to 160)');
  if (!/fast basketball/i.test(title)) problems.push('title does not name Fast Basketball');
  for (const [re, why] of BANNED) if (re.test(title) || re.test(description)) problems.push(why);
  // A city page has to keep saying its city: that is what it ranks for.
  if (page.city && !new RegExp('\\b' + page.city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(title + ' ' + description)) {
    problems.push('does not name ' + page.city);
  }
  return { ok: problems.length === 0, problems, title, description };
}

// ---------------------------------------------------------------- live phrases
//
// Seeds for Google autocomplete, per page: what the page is about, in the words a parent
// would start typing. The completions that come back are the live data.
export const TOPICS = ['basketball training', 'basketball lessons', 'basketball trainer', 'youth basketball'];
export function seedsFor(page) {
  if (page.city) return TOPICS.slice(0, 3).map((t) => t + ' ' + page.city.toLowerCase());
  if (page.path === '/') return ['basketball training fort lauderdale', 'youth basketball training', 'basketball trainer near me', 'basketball lessons for kids'];
  if (page.path === '/training/private') return ['private basketball lessons', 'one on one basketball training'];
  if (page.path === '/training/group-training') return ['group basketball training', 'basketball training program for kids'];
  if (page.path === '/training/evaluation') return ['basketball skills evaluation'];
  return [];
}
/**
 * Keep a completion only if every word it adds to the seed is one a family looking for a coach
 * in these towns would use. An allow-list, because the live data proved a block-list leaks:
 * "private basketball lessons pittsburgh" (another city), "... equipment", "... evaluation
 * sheet" (someone wanting a template, not a coach) and "how much does a trainer cost" (a price
 * question the site deliberately does not answer publicly) all came back on the first run.
 */
const SERVED = 'fort lauderdale miami hollywood coral springs parkland coconut creek margate tamarac broward south florida fl plantation sunrise weston davie pompano beach boca raton deerfield pembroke pines';
const ALLOWED_EXTRAS = new Set((SERVED + ' near me nearby local area for kids kid children youth teens teen girls boys beginners beginner advanced elite' +
  ' private group one on 1 program programs classes class camp camps clinic clinics summer winter spring fall weekend after school' +
  ' lessons lesson training trainer trainers coach coaches coaching skills skill development academy personal individual small' +
  ' middle high elementary schoolers year years old olds age ages and the a in with best').split(/\s+/));
export function usefulPhrase(phrase, seed) {
  const s = String(phrase || '').toLowerCase().trim();
  if (!s || s === String(seed).toLowerCase() || s.length > 70) return false;
  if (!/basketball|hoops/.test(s)) return false;
  const seedWords = new Set(words(seed));
  const extras = words(s).filter((w) => !seedWords.has(w));
  return extras.every((w) => ALLOWED_EXTRAS.has(w) || /^\d{1,2}(u|th)?$/.test(w));
}
