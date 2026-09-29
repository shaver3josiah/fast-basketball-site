// Traffic: how visitors reach the site, and which of them became leads.
//
// First-party, deliberately. The agreement (Section 7) calls analytics SECONDARY evidence of
// attribution and the intake answer primary, and this is the secondary half, kept in FAST's own
// Firestore and read in FAST's own admin panel: no third-party script, no cookie, no consent
// banner, and nothing a family did on the site leaves Google's project for anyone else.
//
// Pure module: no I/O, no clock. The endpoint (track.mjs) and the admin read (admin-traffic.mjs)
// pass the time in, so the same inputs always give the same report and a test needs nothing.

// ---------------------------------------------------------------- cleaning

// Every string here arrives from a browser, so it is bounded and stripped of control characters
// before it becomes a store field, a table cell in the admin panel or a spreadsheet column.
export function clip(v, max = 80) {
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

// A path, never a full URL: the query string can carry an email (the enroll link builder puts
// one there), and an email has no business sitting in traffic rows.
export function cleanPath(v) {
  const p = clip(v, 200).split(/[?#]/)[0];
  return p.startsWith('/') ? p : '';
}

// The referring site's host, lower-cased, without "www.". Never the path: a search engine's
// referrer path is empty anyway, and another site's path can hold anything.
export function refHost(v) {
  const s = clip(v, 300);
  if (!s) return '';
  try {
    const host = new URL(s).hostname.toLowerCase().replace(/^www\./, '');
    return /^[a-z0-9.-]{1,120}$/.test(host) ? host : '';
  } catch {
    return '';
  }
}

export const ID_RE = /^[a-z0-9]{12,40}$/;
export const LINK_ID_RE = /^[a-z0-9]{6,20}$/;

// ---------------------------------------------------------------- channels

// The order of this list is the order the panel shows them in.
export const CHANNELS = ['Tracked link', 'Organic search', 'Paid search', 'Social', 'Email', 'Referral', 'Campaign', 'Direct'];

const SEARCH = /(^|\.)(google|bing|duckduckgo|yahoo|ecosia|baidu|yandex|startpage|qwant)\.[a-z.]+$|^search\.brave\.com$|^search\.yahoo\.com$/;
const SOCIAL = /(^|\.)(instagram|facebook|fb|messenger|tiktok|twitter|x|t|linkedin|lnkd|youtube|youtu|snapchat|pinterest|reddit|nextdoor|threads|whatsapp)\.(com|co|me|net|be|in)$|^l\.instagram\.com$|^lm\.facebook\.com$/;
const SOCIAL_SRC = /^(ig|instagram|fb|facebook|meta|tiktok|twitter|x|linkedin|youtube|snapchat|pinterest|reddit|nextdoor|threads|whatsapp)$/;
// Our own domain as a referrer is a visitor moving between pages or back from Stripe, not a
// source. It counts as direct.
const SELF = /(^|\.)fast-basketball\.com$|(^|\.)web\.app$|(^|\.)firebaseapp\.com$|^localhost$|^127\.0\.0\.1$|(^|\.)stripe\.com$/;

/**
 * How one arrival reached the site, in the terms the panel uses.
 *
 * A tracked link always wins, because it is the one source somebody chose on purpose. Then the
 * explicit UTM medium, then the referrer. Google's own click ids (gclid, and its newer wbraid /
 * gbraid) only ever ride on an ad click, so they mean paid search even with no utm tags.
 */
export function channelOf(s) {
  const src = (s && s.src) || '';
  const med = (s && s.med) || '';
  const ref = (s && s.ref) || '';
  if (s && s.via) return 'Tracked link';
  if (s && s.paid) return 'Paid search';
  if (/^(cpc|ppc|paid|paidsearch|paid-search|paid_search|sem)$/.test(med)) return 'Paid search';
  if (/^(social|social-media|paid-social|paidsocial|sm)$/.test(med) || SOCIAL_SRC.test(src)) return 'Social';
  if (/^(email|e-mail|newsletter)$/.test(med)) return 'Email';
  if (/^(organic)$/.test(med)) return 'Organic search';
  if (src) return 'Campaign';
  if (ref && !SELF.test(ref)) {
    if (SEARCH.test(ref)) return 'Organic search';
    if (SOCIAL.test(ref)) return 'Social';
    return 'Referral';
  }
  return 'Direct';
}

/** A short human name for where it came from: the link's name, the utm source, the site. */
export function sourceName(s, linkNames = {}) {
  if (!s) return '(unknown)';
  if (s.via) return linkNames[s.via] || 'Link ' + s.via;
  if (s.src) return s.src;
  if (s.ref && !SELF.test(s.ref)) return s.ref;
  return '(direct)';
}

/**
 * One arrival as the browser described it, bounded and normalised. `via` is only a claim at
 * this point: nothing on the money path ever trusts it (checkout re-reads the link itself), it
 * is kept so the panel can show which tracked link a lead arrived through.
 */
export function cleanArrival(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const via = clip(r.via, 20).toLowerCase();
  const out = {
    src: clip(r.src, 60).toLowerCase(),
    med: clip(r.med, 40).toLowerCase(),
    camp: clip(r.camp, 80),
    via: LINK_ID_RE.test(via) ? via : '',
    ref: refHost(r.ref) || (/^[a-z0-9.-]{1,120}$/.test(clip(r.ref, 120)) ? clip(r.ref, 120).toLowerCase() : ''),
    landing: cleanPath(r.landing),
    paid: r.paid === true,
    at: typeof r.at === 'string' && !Number.isNaN(Date.parse(r.at)) ? new Date(r.at).toISOString() : ''
  };
  out.ch = channelOf(out);
  return out;
}

/**
 * The hidden `trk` field a form carries: the visitor id, the FIRST time this browser found the
 * site, and how this visit arrived. Returns null for anything that is not that shape, so a
 * missing or mangled field just means "source unknown", never a failed submission.
 */
export function parseTrk(value) {
  if (typeof value !== 'string' || !value || value.length > 3000) return null;
  let raw;
  try { raw = JSON.parse(value); } catch { return null; }
  if (!raw || typeof raw !== 'object') return null;
  const vid = typeof raw.vid === 'string' && ID_RE.test(raw.vid) ? raw.vid : '';
  const first = raw.ft ? cleanArrival(raw.ft) : null;
  const visit = raw.ss ? cleanArrival(raw.ss) : null;
  if (!vid && !first && !visit) return null;
  return { vid, first: first || visit, visit: visit || first };
}

export function deviceOf(width) {
  const w = Number(width);
  if (!Number.isFinite(w) || w <= 0) return 'unknown';
  if (w < 700) return 'phone';
  if (w < 1100) return 'tablet';
  return 'desktop';
}

// Crawlers and uptime checkers announce themselves; counting them would make every day look
// busy. Headless browsers are included, which is also why an automated test run is not traffic.
export const BOT_UA = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|facebookexternalhit|embedly|curl|wget|python|axios|node-fetch|go-http|java\/|okhttp|monitor|pingdom|uptime/i;

// ---------------------------------------------------------------- days

// Blake reads the chart in Fort Lauderdale time. A visit at 9pm on the 3rd is the 3rd there even
// though it is the 4th in UTC.
const DAY_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
export const dayOf = (ms) => DAY_FMT.format(new Date(ms));

/** The last `days` calendar days, oldest first, ending on the day that holds `now`. */
export function dayList(now, days) {
  const out = [];
  // Noon UTC steps a whole day at a time without ever landing on a DST edge in New York.
  const today = dayOf(now);
  let t = Date.parse(today + 'T12:00:00Z');
  for (let i = 0; i < days; i += 1) {
    out.unshift(dayOf(t));
    t -= 864e5;
  }
  return out;
}

// ---------------------------------------------------------------- the report

const LEAD_TYPES = { contact: 'Enquiry', enrollment: 'Registration', playbook: 'Playbook', apporder: 'Tool order' };
const paid = (l) => l.paymentStatus === 'paid' || l.paymentStatus === 'no_payment_required';
export const ATTRIBUTING_ANSWER = 'Google or online search';

function leadType(l) {
  if (l.type === 'enrollment' || String(l.key || '').startsWith('registration:')) return 'enrollment';
  if (String(l.key || '').startsWith('apporder:')) return 'apporder';
  return l.type;
}

/**
 * Whose effort brought this lead in, in the terms of Section 7, with the reason in words.
 *
 *   'link'    arrived through a tracked link marked as Josiah's, which Blake was told about when
 *             it was made. Counts.
 *   'answer'  answered "Google or online search". The primary evidence. Counts.
 *   'search'  first found the site from a search engine but answered something else. SECONDARY
 *             evidence only: Google hides the search words, so whether it was a branded search
 *             ("Fast Basketball") cannot be told from here. Not counted; the parties confer.
 *   'fast'    everything else: Blake's own efforts, a referral, direct, unknown.
 */
export function creditOf(lead, linkNames = {}) {
  if (lead.claim && lead.claim.id) {
    return { who: 'link', counts: true, why: "Came through Josiah's link “" + (linkNames[lead.claim.id] || lead.claim.name || lead.claim.id) + '”' };
  }
  if (lead.hearAbout === ATTRIBUTING_ANSWER) {
    return { who: 'answer', counts: true, why: 'Answered “Google or online search”' };
  }
  const first = lead.source && lead.source.first;
  if (first && first.ch === 'Organic search') {
    return {
      who: 'search', counts: false,
      why: 'First found the site from ' + (first.ref || 'a search engine') + ', but answered ' +
        (lead.hearAbout ? '“' + lead.hearAbout + '”' : 'nothing') + '. Secondary evidence only.'
    };
  }
  return { who: 'fast', counts: false, why: lead.hearAbout ? 'Answered “' + lead.hearAbout + '”' : 'No answer and no tracked source' };
}

function bump(map, key, field, n = 1) {
  if (!map.has(key)) map.set(key, { name: key, sessions: 0, leads: 0, enrolled: 0, views: 0 });
  map.get(key)[field] += n;
}
const top = (map, field, n) => [...map.values()].sort((a, b) => b[field] - a[field] || (a.name < b.name ? -1 : 1)).slice(0, n);

/**
 * Everything the Traffic tab shows, from raw rows. `sessions` are track.mjs records, `leads` the
 * leads store as listLeads returns it, `links` the tracked links. Only rows inside the last
 * `days` days (New York calendar) are counted.
 */
export function summarize({ sessions = [], leads = [], links = [], now, days = 30 }) {
  const dayKeys = dayList(now, days);
  const inRange = new Set(dayKeys);
  const linkNames = Object.fromEntries(links.map((l) => [l.id, l.name]));
  const daily = new Map(dayKeys.map((d) => [d, { day: d, sessions: 0, visitors: new Set(), leads: 0 }]));

  const visitors = new Set();
  const newVisitors = new Set();
  let pageviews = 0;
  let engagedMs = 0;
  let bounces = 0;
  const channels = new Map(CHANNELS.map((c) => [c, { name: c, sessions: 0, leads: 0, enrolled: 0, views: 0 }]));
  const sources = new Map();
  const landing = new Map();
  const pages = new Map();
  const devices = new Map();
  const referrers = new Map();
  const byLink = new Map();

  let sessionCount = 0;
  for (const s of sessions) {
    const day = s.day || (s.start ? dayOf(Date.parse(s.start)) : '');
    if (!inRange.has(day)) continue;
    sessionCount += 1;
    const d = daily.get(day);
    d.sessions += 1;
    if (s.vid) { d.visitors.add(s.vid); visitors.add(s.vid); if (s.nv) newVisitors.add(s.vid); }
    pageviews += s.pv || 0;
    engagedMs += s.ms || 0;
    if ((s.pv || 0) <= 1 && (s.ms || 0) < 10000) bounces += 1;
    const ch = CHANNELS.includes(s.ch) ? s.ch : channelOf(s);
    bump(channels, ch, 'sessions');
    bump(sources, sourceName(s, linkNames), 'sessions');
    if (s.landing) bump(landing, s.landing, 'sessions');
    for (const p of s.pages || []) bump(pages, p, 'views');
    bump(devices, s.dev || 'unknown', 'sessions');
    if (s.ref && !SELF.test(s.ref)) bump(referrers, s.ref, 'sessions');
    if (s.via) bump(byLink, s.via, 'sessions');
  }

  const recent = [];
  const credit = { link: [], answer: [], search: [] };
  const counts = { leads: 0, enquiries: 0, registrations: 0, enrolled: 0 };
  for (const l of leads) {
    const type = leadType(l);
    if (!LEAD_TYPES[type] || l.spam) continue;
    // registeredAt first: once paid, a registration's timestamp is rewritten to the payment time.
    const t = Date.parse(l.registeredAt || l.timestamp);
    if (!Number.isFinite(t) || !inRange.has(dayOf(t))) continue;
    const isPaid = type === 'enrollment' && paid(l);
    counts.leads += 1;
    if (type === 'contact') counts.enquiries += 1;
    if (type === 'enrollment') counts.registrations += 1;
    if (isPaid) counts.enrolled += 1;
    daily.get(dayOf(t)).leads += 1;

    const first = l.source && l.source.first;
    const ch = first ? (CHANNELS.includes(first.ch) ? first.ch : channelOf(first)) : null;
    if (ch) {
      bump(channels, ch, 'leads');
      if (isPaid) bump(channels, ch, 'enrolled');
      bump(sources, sourceName(first, linkNames), 'leads');
    }
    const via = (l.claim && l.claim.id) || (first && first.via) || (l.source && l.source.visit && l.source.visit.via) || '';
    if (via) {
      bump(byLink, via, 'leads');
      if (isPaid) bump(byLink, via, 'enrolled');
    }
    const c = type === 'apporder' ? { who: 'app', counts: false, why: 'Tool sale, split 50/50 whatever the source' } : creditOf(l, linkNames);
    const row = {
      key: l.key || '',
      type,
      typeLabel: LEAD_TYPES[type],
      name: l.name || [l.parentFirst, l.parentLast].filter(Boolean).join(' ') || l.email || '(no name)',
      player: l.playerName || '',
      at: new Date(t).toISOString(),
      paid: isPaid,
      status: type === 'enrollment' ? l.paymentStatus || '' : '',
      hearAbout: l.hearAbout || '',
      channel: ch || 'Unknown',
      source: first ? sourceName(first, linkNames) : '',
      landing: (first && first.landing) || '',
      credit: c
    };
    recent.push(row);
    if (credit[c.who]) credit[c.who].push(row);
  }
  recent.sort((a, b) => (a.at < b.at ? 1 : -1));

  const linkRows = links.map((link) => {
    const m = byLink.get(link.id) || { sessions: 0, leads: 0, enrolled: 0 };
    return { ...link, sessions: m.sessions, leads: m.leads, enrolled: m.enrolled };
  });

  return {
    days,
    from: dayKeys[0],
    to: dayKeys[dayKeys.length - 1],
    totals: {
      visitors: visitors.size,
      newVisitors: newVisitors.size,
      sessions: sessionCount,
      pageviews,
      avgEngagedMs: sessionCount ? Math.round(engagedMs / sessionCount) : 0,
      bounceRate: sessionCount ? bounces / sessionCount : 0,
      ...counts,
      conversion: visitors.size ? counts.leads / visitors.size : 0
    },
    daily: [...daily.values()].map((d) => ({ day: d.day, sessions: d.sessions, visitors: d.visitors.size, leads: d.leads })),
    channels: [...channels.values()].filter((c) => c.sessions || c.leads),
    sources: top(sources, 'sessions', 12),
    landing: top(landing, 'sessions', 10),
    pages: top(pages, 'views', 12),
    devices: top(devices, 'sessions', 4),
    referrers: top(referrers, 'sessions', 10),
    links: linkRows,
    credit,
    recent: recent.slice(0, 60)
  };
}
