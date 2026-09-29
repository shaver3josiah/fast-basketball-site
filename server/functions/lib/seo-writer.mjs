// Title and description drafts, written by the site itself from the week's live data.
//
// No AI service and no key: a deterministic writer. For each page it picks the search phrase
// the live data says matters most (Search Console: the searches that actually showed this page,
// weighted by how often and how close to the top; Google autocomplete: what people are typing
// now), turns it into a title in the page's own words, and builds a description from the
// site's standing facts. lib/seo.mjs checkProposal still judges every draft; this module only
// proposes. Same data in, same draft out, and the "why" line says exactly which data it used.
//
// Pure: no I/O, no clock.
import { isBranded, covers, checkProposal } from './seo.mjs';

// ---------------------------------------------------------------- what each page is
//
// A page is drafted only if it has a profile. `head` is the default subject when the data has
// nothing better; `fits` decides whether a searched phrase is about THIS page (a phrase about
// private lessons must not become the group page's title); `says` are the page's facts, in the
// order they are worth spending characters on; `ask` is what the page wants the reader to do.
// GYM is in none of them because it is in every description: sessions happen at one gym and
// nowhere else, and a draft that drops that line invites the old "trains at the park" misreading.
const GYM = 'Every session is at one Fort Lauderdale gym.';
const COACH = 'Coach Blake Kingsley';
const PROFILES = [
  { match: (p) => p === '/', head: 'Basketball Training', area: 'South Florida',
    fits: (q) => /training|trainer|lessons|coach|camp|program/.test(q) && !/private|1 on 1|one on one|group/.test(q),
    says: ['for players 11 to 18 with ' + COACH + '.', 'Group memberships and private training.'], ask: 'Book a call or enroll online.' },
  { match: (p) => /^\/basketball-training\/[a-z-]+$/.test(p), head: 'Basketball Training',
    fits: (q) => /training|trainer|lessons|coach|camp|program/.test(q),
    says: ['for players 11 to 18 with ' + COACH + '.', 'Group memberships and private training.'], ask: 'Book a call or enroll online.' },
  { match: (p) => p === '/training/private', head: 'Private Basketball Lessons', area: 'Fort Lauderdale',
    fits: (q) => /private|1 on 1|one on one|personal|individual/.test(q),
    says: ['with ' + COACH + ', built around one player.', 'Limited spots; pricing after a consultation.'], ask: 'Book a consultation.' },
  { match: (p) => p === '/training/group-training', head: 'Group Basketball Training', area: 'Fort Lauderdale',
    fits: (q) => /group|team|program|camp|class|clinic/.test(q),
    says: ['for players 11 to 18 with ' + COACH + '.', 'Pay in full or monthly.'], ask: 'Enroll online.' },
  { match: (p) => p === '/training/evaluation', head: 'Basketball Skills Evaluation', area: 'Fort Lauderdale',
    fits: (q) => /evaluation|assessment|tryout|skills/.test(q),
    says: ['with ' + COACH + ': where your player stands and what to work on.'], ask: 'Book an evaluation.' }
];
export const profileFor = (path) => PROFILES.find((pr) => pr.match(path)) || null;

// ---------------------------------------------------------------- phrases into words

const SMALL = new Set(['for', 'and', 'in', 'of', 'the', 'a', 'to', 'on', 'with']);
const CITY_WORDS = /\b(fort lauderdale|miami|hollywood|coral springs|parkland|coconut creek|margate|tamarac|broward|south florida|florida|fl|near me|nearby|local|in my area|best)\b/g;
function titleCase(s, lead = true) {
  return s.split(/\s+/).filter(Boolean).map((w, i) => {
    if (/^1-on-1$/i.test(w)) return '1-on-1';
    if ((i > 0 || !lead) && SMALL.has(w)) return w;
    return w[0].toUpperCase() + w.slice(1);
  }).join(' ');
}
/**
 * A search phrase as a title subject: place names and "near me" removed (the page adds its own
 * place), "one on one" written the way the site writes it, and at most one audience qualifier
 * ("for Kids") kept. Returns null for a phrase that is not a subject at all.
 */
export function subjectOf(phrase) {
  let s = ' ' + String(phrase || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ') + ' ';
  s = s.replace(CITY_WORDS, ' ').replace(/\b(1 on 1|one on one)\b/g, '1-on-1');
  const qual = (s.match(/\bfor (kids|youth|teens|beginners|girls|boys)\b/) || [])[0] || '';
  s = s.replace(/\bfor (kids|youth|teens|beginners|girls|boys|\d+ year olds?)\b/g, ' ').replace(/\b\d+ year olds?\b/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  if (!/basketball/.test(s) || s.split(' ').length > 5) return null;
  return { head: titleCase(s), qual: qual ? titleCase(qual, false) : '' };
}

// ---------------------------------------------------------------- choosing the phrase

/**
 * The phrase worth leading with. Search Console first: a real search that showed this page,
 * scored by views, with page-one-adjacent positions (4 to 20) weighted up because that is where
 * better words move a page. Live autocomplete only when Search Console has nothing for the page.
 */
export function pickPhrase(page, profile, queries = [], phrases = []) {
  const candidates = [];
  for (const q of queries) {
    const text = String(q.query || '').toLowerCase();
    if (isBranded(text) || !profile.fits(text) || !subjectOf(text)) continue;
    const pos = Number(q.position) || 50;
    const weight = (Number(q.impressions) || 0) * (pos >= 4 && pos <= 20 ? 2 : pos < 4 ? 1 : 0.5);
    candidates.push({ phrase: text, weight, from: 'search', q });
  }
  if (!candidates.length) {
    phrases.forEach((p, i) => {
      const text = String(p).toLowerCase();
      if (profile.fits(text) && subjectOf(text)) candidates.push({ phrase: text, weight: 10 - i, from: 'live' });
    });
  }
  candidates.sort((a, b) => b.weight - a.weight);
  return candidates[0] || null;
}

// ---------------------------------------------------------------- writing

const BRAND = ' | Fast Basketball';
// `cityHead` is set only on a city page, where the city in the title is what the page ranks for:
// it is worth more than the searched wording, so the page's own head keeps the city before the
// city is given up.
function fitTitle(head, qual, place, cityHead) {
  const tries = [
    place && qual ? head + ' ' + qual + ' in ' + place : null,
    place ? head + ' in ' + place : null,
    cityHead ? cityHead + ' in ' + place : null,
    qual ? head + ' ' + qual : null,
    head
  ].filter(Boolean).map((t) => t + BRAND);
  return tries.find((t) => t.length >= 25 && t.length <= 60) || null;
}
function fitDescription(lead, says, ask) {
  // Greedy: the lead and the gym, then facts in order while they fit, then the ask if it fits.
  // Nothing is cut mid-sentence.
  let out = lead + ' ' + GYM;
  for (const s of says.slice(1)) if ((out + ' ' + s + ' ' + ask).length <= 155) out += ' ' + s;
  if ((out + ' ' + ask).length <= 155) out += ' ' + ask;
  return out.length >= 120 && out.length <= 160 ? out : null;
}

/**
 * A draft for one page, or null when the data gives nothing better than what is there. Same
 * shape the research run expects: { title, description, why, sources }.
 */
export function writeDraft(page, { queries = [], phrases = [], findings = [] } = {}) {
  const profile = profileFor(page.path);
  if (!profile) return null;
  const pick = pickPhrase(page, profile, queries, phrases);
  const subject = pick ? subjectOf(pick.phrase) : { head: profile.head, qual: '' };
  if (!subject) return null;
  // A phrase that names the page's subject differently still has to say what the page is:
  // "Basketball Lessons" is fine for a city page, "Basketball" alone is not a subject.
  if (!/training|lessons|trainer|coach|evaluation|camp|program|clinic/i.test(subject.head)) subject.head = profile.head;
  const place = page.city || profile.area || '';
  const title = fitTitle(subject.head, subject.qual, place, page.city ? profile.head : null);
  if (!title) return null;

  // Sentence case mid-description: "Private basketball lessons for kids with...".
  const lead = subject.head[0] + subject.head.slice(1).toLowerCase() + (subject.qual ? ' ' + subject.qual.toLowerCase() : '') + (page.city ? ' in ' + page.city : '') + ' ' + profile.says[0];
  const description = fitDescription(lead, profile.says, profile.ask);
  if (!description) return null;

  // Only worth showing if it is different and speaks to the phrase the data picked.
  if (title === page.title && description === page.description) return null;
  if (pick && !covers(title + ' ' + description, pick.phrase.replace(CITY_WORDS, ' '))) return null;

  const why = pick
    ? (pick.from === 'search'
      ? 'Leads with “' + pick.phrase + '”, the search that showed this page most (' + pick.q.impressions + ' times, position ' + Math.round(pick.q.position) + ') and is not in the current title.'
      : 'Leads with “' + pick.phrase + '”, what people are typing into Google right now for this kind of page.')
    : 'Keeps the page’s subject and fixes what the data flagged: ' + findings.map((f) => f.kind.replace(/-/g, ' ')).join(', ') + '.';
  const sources = [];
  if (pick && pick.from === 'search') sources.push({ url: 'https://search.google.com/search-console', title: 'Google Search Console, last 28 days' });
  if (phrases.length) sources.push({ url: 'https://www.google.com/search?q=' + encodeURIComponent(phrases[0]), title: 'Live Google searches' });
  const draft = { title, description, why, sources };
  return checkProposal(draft, page).ok ? draft : null;
}

/** Thrown when the data has nothing better than the page already says; the run skips it. */
export class NothingBetter extends Error {}

/** The research run's drafter interface: async, like any other source of drafts. */
export const siteWriter = async (page, context) => {
  const d = writeDraft(page, context);
  if (!d) throw new NothingBetter('nothing better to suggest from this week’s data');
  return d;
};
