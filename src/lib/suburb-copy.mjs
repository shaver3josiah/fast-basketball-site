import { OFFERS } from './site-config.mjs';

function joinList(items) {
  if (items.length === 1) return items[0];
  if (items.length === 2) return items[0] + ' and ' + items[1];
  return items.slice(0, -1).join(', ') + ', and ' + items[items.length - 1];
}

// The notes in suburbs.json are unpunctuated fragments. Everything that goes
// into parts[] runs through here so parts.join(' ') can never fuse two records
// into one run-on sentence.
function endSentence(text) {
  const t = String(text).trim();
  if (!t) return '';
  return /[.!?]$/.test(t) ? t : t + '.';
}

// Notes are attached after a colon, so the leading capital goes unless the note
// opens with a proper name ("City of Coral Gables ..."). A colon rather than an
// em dash on purpose: it reads correctly for both noun-phrase notes ("zoned high
// school for ...") and verb-phrase notes ("serves the Hammocks ..."), and dashing
// every record put 5 em dashes on each suburb page, which is its own machine tell.
function appositive(note) {
  const t = String(note).trim();
  const second = t.split(/\s+/)[1] || '';
  if (second === 'of' || /^[A-Z]/.test(second)) return t;
  return t.charAt(0).toLowerCase() + t.slice(1);
}

const COURTS = { outdoor: 'outdoor courts', indoor: 'indoor courts', both: 'indoor and outdoor courts' };

// The note, when present, already describes the place better than the generic
// type/courts filler, so it replaces that filler instead of repeating it.
function venueDetail(v) {
  if (v.note) return appositive(v.note);
  const courts = v.courts ? COURTS[v.courts] || v.courts + ' courts' : '';
  return [v.type ? 'a ' + v.type : '', courts].filter(Boolean).join(' with ');
}

export function schoolsProse(suburb) {
  const parts = [];
  const highs = (suburb.high_schools || []).filter((h) => h && h.name);
  // One school folds its note into the opener; naming it, stopping, then naming it
  // again immediately reads as a stutter.
  if (highs.length === 1 && highs[0].note) {
    parts.push(endSentence('The high school game in ' + suburb.name + ' runs through ' + highs[0].name + ': ' + appositive(highs[0].note)));
  } else if (highs.length > 0) {
    parts.push(endSentence('The high school game in ' + suburb.name + ' runs through ' + joinList(highs.map((h) => h.name))));
    for (const h of highs) {
      if (h.note) parts.push(endSentence(h.name + ': ' + appositive(h.note)));
    }
  }
  const mids = (suburb.middle_schools || []).filter((m) => m && m.name);
  if (mids.length > 0) {
    // With no high school in the record (Margate has none), the middle school has
    // to open the paragraph instead of following one. The opener stays neutral on
    // purpose: an empty high_schools array is missing data everywhere except the
    // one city where the absence was actually verified, so the code never asserts
    // that a city has no high school. That claim belongs in local_paragraph.
    const opener = highs.length > 0
      ? 'Middle schoolers mostly come up through '
      : 'The school game in ' + suburb.name + ' starts at ';
    // Same 1-vs-many shape as the high schools above, so a middle school note
    // (the verified BCPS feeder pattern) reaches the page instead of being
    // dropped on the floor, and a single school never gets named twice in a row.
    if (mids.length === 1 && mids[0].note) {
      parts.push(endSentence(opener + mids[0].name + ': ' + appositive(mids[0].note)));
    } else {
      parts.push(endSentence(opener + joinList(mids.map((m) => m.name))));
      for (const m of mids) {
        if (m.note) parts.push(endSentence(m.name + ': ' + appositive(m.note)));
      }
    }
    parts.push('That is the age to fix a habit, before a varsity tryout finds it first.');
  }
  return parts.join(' ');
}

// NOBODY TRAINS AT THESE PARKS. Corrected 14 September 2026 on the owner's word: the only place
// Coach Blake or anyone from Fast Basketball meets a player is the gym named below. Until that
// day every suburb page opened "In <city>, sessions run at <five city parks>", which was simply
// untrue and sent families to the wrong address. The city courts in suburbs.json are kept and
// reframed as recommendations for the homework the program sets between sessions, which is what
// they were always good for. Same gym as faq.2.a in faq.html, FAQ_PAIRS in render.mjs and the
// /enroll page; four hand-typed copies now, so change them together.
const HOME_CITY = 'Fort Lauderdale';
export const HOME_GYM = 'the Salvation Army Fort Lauderdale Corps gym, 100 SW 9th Ave, ' + HOME_CITY;

export function venuesProse(suburb) {
  const venues = (suburb.training_venues || []).filter((v) => v && v.name);
  // Stated even when a city has no recommended courts on file: a family landing on this page
  // from search has to learn where they would actually be driving.
  const home = endSentence('Every session runs at ' + HOME_GYM);
  if (venues.length === 0) return home;
  const opener = (venues.length === 1 ? 'The court we recommend in ' : 'The courts we recommend in ')
    + suburb.name + ' for work between sessions' + (venues.length === 1 ? ' is ' : ' are ');

  // A single venue reads better folded into the opener than repeated in a
  // second sentence, and that is how 11 of the 12 records are shaped.
  if (venues.length === 1) {
    const v = venues[0];
    const detail = venueDetail(v);
    // Colon, matching schoolsProse. Promoting the detail to its own sentence
    // instead would strand a subject-less fragment ("A rec center with ...").
    return home + ' ' + endSentence(opener + v.name + (v.address ? ', ' + v.address : '') + (detail ? ': ' + detail : ''));
  }

  const parts = [home, endSentence(opener + joinList(venues.map((v) => v.name)))];
  for (const v of venues) {
    const detail = venueDetail(v);
    if (v.address && detail) parts.push(endSentence(v.name + ' is at ' + v.address + ': ' + detail));
    else if (v.address) parts.push(endSentence(v.name + ' is at ' + v.address));
    else if (v.note) parts.push(endSentence(v.name + ': ' + detail));
    else if (detail) parts.push(endSentence(v.name + ' is ' + detail));
  }
  return parts.join(' ');
}

export function drivingProse(suburb) {
  if (suburb.drive_time_from_base_min === null || suburb.drive_time_from_base_min === undefined) return '';
  return 'From ' + suburb.name + ', the drive to a session runs about ' + suburb.drive_time_from_base_min + ' minutes.';
}

export function landmarksProse(suburb) {
  if (!suburb.landmarks || suburb.landmarks.length === 0) return '';
  // Was "<city> sessions get booked around the neighborhoods near ...", which put the sessions
  // in the wrong city along with everything else. Where families travel from, not where they train.
  return suburb.name + ' families come from the neighborhoods near ' + joinList(suburb.landmarks) + ', and a standing weekly slot is what keeps the drive predictable.';
}

export function neighborsProse(suburb) {
  if (!suburb.nearest_neighbors || suburb.nearest_neighbors.length === 0) return '';
  const links = suburb.nearest_neighbors.map((slug) => '<a href="/basketball-training/' + slug + '">' + slugToName(slug) + '</a>');
  return 'Families also drive in from ' + joinList(links) + ' for the same weekly slots.';
}

export function whyHereProse(suburb) {
  const tierLine = suburb.tier === 1
    ? suburb.name + ' is core coverage, so weekly recurring slots are easiest to hold here and rarely get bumped.'
    : suburb.name + ' runs on a scheduled rotation, so booking a recurring weekly slot early keeps the same time all season.';
  return 'Coach Blake came to South Florida straight off the college side of the recruiting table: two staffs, two championships, an NCAA Tournament run. Every ' + suburb.name + ' session gets the same read a college staff would give. ' +
    // "just closer to home" went with the same correction: the gym is in Fort Lauderdale, so for
    // most of these cities it is a drive, and the page should not pretend otherwise.
    tierLine + ' The method does not change by zip code: screen, isolate, load, read, log. A ' + suburb.name + ' player builds the exact same foundation as every player in the program.';
}

// FAQ answers below feed both the visible HTML and the FAQPage JSON-LD from the same
// {question, answer} array (suburb-page.mjs renders one and hands the other straight to
// faqPage()), so the two can never say something different. Every answer traces to a
// field on the suburb record; a question whose data is missing is left out rather than
// padded with a generic line, which is why suburbFaqPairs() below returns 4 to 6 pairs
// instead of a fixed six.

function faqTrainingAnswer(suburb) {
  const zips = (suburb.zip_codes || []).join(', ');
  // Same honesty rule as venuesProse: the gym is in Fort Lauderdale, not the city on this
  // page, so the answer has to say so instead of letting the question imply otherwise. The
  // one exception is the gym's own city, where "no location of its own" would be false.
  if (suburb.name === HOME_CITY) {
    return 'Every session runs at ' + HOME_GYM + ', the one Fast Basketball location, so ' + suburb.name +
      ' players have the shortest drive in the program.';
  }
  return 'Every session runs at ' + HOME_GYM + '. ' + suburb.name + (zips ? ' (' + zips + ')' : '') +
    ' has no Fast Basketball location of its own, so players drive in for every session.';
}

// Names only, no street addresses: these are public parks, not the business's own premises,
// and the owner's policy is to keep the FAQ to the one address (the gym, above) that the
// site already publishes elsewhere.
function faqPracticeAnswer(suburb) {
  const venues = (suburb.training_venues || []).filter((v) => v && v.name);
  if (venues.length === 0) return '';
  return 'Between sessions, ' + suburb.name + ' players can get shots up on their own at ' +
    joinList(venues.map((v) => v.name)) + '. These are public courts we recommend for practice, not Fast Basketball locations.';
}

function faqSchoolsAnswer(suburb) {
  // De-duplicated: Tamarac's Millennium 6-12 Collegiate Academy is both the record's one
  // high school and its one middle school, and naming it twice would read as a stutter.
  const names = [];
  for (const school of [...(suburb.high_schools || []), ...(suburb.middle_schools || [])]) {
    if (school && school.name && !names.includes(school.name)) names.push(school.name);
  }
  if (names.length === 0) return '';
  // Says which schools serve the city, never that players come from them: nobody has checked
  // a roster against this list, and "players train with us from" every school on it would be
  // a claim the site cannot stand behind.
  return 'No. The schools serving ' + suburb.name + ' include ' + joinList(names) +
    ', and players from any school, public or private, are welcome. Fast Basketball is not affiliated with, endorsed by, or partnered with any school.';
}

// Ages and the one published price are the same in every city; only the evaluation and the
// private 1-on-1 stay off this page because Blake quotes those on the call, not in markup.
// Ages, price and the intake path are the same in every city, so these two answers take no
// suburb argument. Threading the city name through them ("<City> included", "every <City>
// family") would read as personalised while saying nothing a family could not read on the
// homepage - the same fake specificity venuesProse above exists to avoid. Two cities giving
// the same answer to the same universal question is honest; dressing it up is not.
// From OFFERS, the same figures the homepage's business markup carries, not a third typed copy.
const GROUP = OFFERS.find((o) => o.path === '/training/group-training');
function faqCostAnswer() {
  return 'The program trains players roughly ages 11 through 18. ' +
    'The Group Training Membership runs $' + GROUP.price + ' to $' + Number(GROUP.maxPrice).toLocaleString('en-US') +
    ' for a 3 or 6 month term. The evaluation session ' +
    'and private 1-on-1 training are priced on the intro call, not published here.';
}

function faqStartAnswer() {
  return 'Start with a 15 to 20 minute call. If it looks like a fit, next is a 60 minute on-court ' +
    'evaluation, then enrollment.';
}

export function suburbFaqPairs(suburb) {
  const pairs = [{ question: 'Where do ' + suburb.name + ' players actually train?', answer: faqTrainingAnswer(suburb) }];

  const practice = faqPracticeAnswer(suburb);
  if (practice) pairs.push({ question: 'Where can my player practice between sessions in ' + suburb.name + '?', answer: practice });

  const schools = faqSchoolsAnswer(suburb);
  if (schools) pairs.push({ question: 'Does it matter which ' + suburb.name + ' school my player attends?', answer: schools });

  // `shared`: the same answer on every city page, so only the visible copy carries it (see
  // suburb-page.mjs); Google asks for one marked-up instance of a repeated FAQ.
  pairs.push({ question: 'What ages do you train, and what does it cost?', answer: faqCostAnswer(), shared: true });
  pairs.push({ question: 'How do we start?', answer: faqStartAnswer(), shared: true });

  return pairs;
}

export function slugToName(slug) {
  return slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
