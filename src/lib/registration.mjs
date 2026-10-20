// Two forms, one field list (Blake, 19 October 2026).
//
// /enroll is the CONSULTATION: Coach Blake fills it in himself while he is on the phone with a
// family, and nothing is paid there. Its answers are stored as `consult:<uuid>` and emailed to him.
//
// /pay takes the money for the evaluation and, after it, the training package Blake recommends.
// A link Blake sends carries the consultation's id (?c=), and then /pay asks nothing but the
// terms box: who the family is and how they heard about FAST come from the consultation. A /pay
// link with no consultation (a deal, an old link) asks the short PAYER_FIELDS list instead.
//
// build.mjs renders both forms from these lists, consult.mjs and checkout.mjs validate against
// them, and admin/admin.js mirrors the keys for the CSV.
//
// THE LEAD SOURCE AND SCHEDULE 1. Blake's list ("Instagram", "Google Search", ...) is what the
// form shows. The signed Website Development Agreement quotes a different, coarser list in its
// Schedule 1 (HEAR_ABOUT_CHOICES in commission.mjs), and Section 7 makes one of those answers the
// evidence of attribution. So every answer is stored twice: `leadSource` as Blake picked it, and
// `hearAbout` as the Schedule 1 answer it maps to (HEAR_ABOUT_CHOICES, which a test holds every
// mapping to). Commission reads only `hearAbout`.

// Each of Blake's answers and the Schedule 1 answer it is recorded under. "FAST Basketball
// Website" maps to Other, not to Google: Schedule 1 has no website answer, and a family can reach
// the site by typing the address off a flyer, so the honest reading is the one that does not
// assume a search. Change that only with Blake's written agreement.
export const LEAD_SOURCES = [
  { label: 'Instagram', hearAbout: 'Instagram or other social media' },
  { label: 'Facebook', hearAbout: 'Instagram or other social media' },
  { label: 'TikTok', hearAbout: 'Instagram or other social media' },
  { label: 'Google Search', hearAbout: 'Google or online search' },
  { label: 'FAST Basketball Website', hearAbout: 'Other (please describe)' },
  { label: 'In Person', hearAbout: 'Coach Blake directly' },
  { label: 'Referral', hearAbout: 'Friend, family, or referral', detail: 'referrer' },
  { label: 'School or Coach', hearAbout: 'School, camp, or clinic' },
  { label: 'Other', hearAbout: 'Other (please describe)', detail: 'other' }
];

// The Schedule 1 pair a lead source is stored as. Pure; the one place the mapping is applied.
export function leadAnswer(leadSource, leadDetail = '') {
  const src = LEAD_SOURCES.find((s) => s.label === leadSource);
  if (!src) return { hearAbout: '', hearAboutOther: '' };
  let other = '';
  if (src.detail === 'referrer') other = leadDetail ? 'Referred by ' + leadDetail : '';
  else if (src.hearAbout === 'Other (please describe)') other = leadDetail || src.label;
  return { hearAbout: src.hearAbout, hearAboutOther: other };
}

export const CONSULT_SECTIONS = [
  { id: 'family', title: 'The family' },
  { id: 'player', title: 'Player information' },
  { id: 'development', title: 'Basketball development' },
  { id: 'source', title: 'Lead source' }
];

const YES_NO = ['Yes', 'No'];

// Only the contact details are required: a call does not always reach every question, and a
// consultation half answered is still worth saving. Every development question is a text box
// Blake types the family's answer into; confidence is a 1 to 10 pick.
export const CONSULT_FIELDS = [
  { key: 'athleteFirst', section: 'family', label: 'Player first name', type: 'text', required: true, row: 'athlete', placeholder: 'First name' },
  { key: 'athleteLast', section: 'family', label: 'Player last name', type: 'text', required: true, row: 'athlete', placeholder: 'Last name' },
  { key: 'parentFirst', section: 'family', label: 'Parent first name', type: 'text', required: true, row: 'parent', placeholder: 'First name' },
  { key: 'parentLast', section: 'family', label: 'Parent last name', type: 'text', required: true, row: 'parent', placeholder: 'Last name' },
  { key: 'relationship', section: 'family', label: 'Relationship to player', type: 'text', placeholder: 'Mother, father or guardian' },
  { key: 'email', section: 'family', label: 'Parent email', type: 'email', required: true, row: 'reach', placeholder: 'parent@email.com' },
  { key: 'phone', section: 'family', label: 'Parent cell phone', type: 'tel', required: true, row: 'reach', placeholder: '(954) 555 0100' },
  { key: 'homeCity', section: 'family', label: 'Home city or ZIP code', type: 'text', placeholder: 'Coral Springs, or 33071' },
  { key: 'contactMethod', section: 'family', label: 'Preferred contact method', type: 'select', options: ['Text', 'Email', 'Phone'] },

  { key: 'age', section: 'player', label: 'How old is the player?', type: 'text', inputmode: 'numeric', row: 'age', placeholder: '13' },
  { key: 'grade', section: 'player', label: 'What grade are they in?', type: 'text', row: 'age', placeholder: '8th' },
  { key: 'school', section: 'player', label: 'What school do they attend?', type: 'text', placeholder: 'School name' },
  { key: 'aau', section: 'player', label: 'Are they currently playing AAU basketball?', type: 'select', options: YES_NO },
  { key: 'yearsPlaying', section: 'player', label: 'How long have they been playing basketball?', type: 'text', placeholder: 'About 3 years' },
  { key: 'hadTrainer', section: 'player', label: 'Have they ever worked with an individual basketball trainer?', type: 'select', options: YES_NO },

  { key: 'interest', section: 'development', label: '1. What made you interested in basketball training?', type: 'textarea' },
  { key: 'strengths', section: 'development', label: '2. What would you say are the player\'s biggest strengths?', type: 'textarea' },
  { key: 'improve', section: 'development', label: '3. What are 2 to 3 areas of their game that need improvement?', type: 'textarea' },
  { key: 'feedback', section: 'development', label: '4. What kind of feedback have they received from their coaches?', type: 'textarea' },
  { key: 'confidence', section: 'development', label: '5. On a scale of 1 to 10, how confident are they on the basketball court?', type: 'select', options: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'] },
  { key: 'obstacles', section: 'development', label: '6. What\'s preventing them from becoming the player they\'re capable of becoming?', type: 'textarea' },
  { key: 'goals', section: 'development', label: '7. What are the player\'s biggest basketball goals?', type: 'textarea' },
  { key: 'independent', section: 'development', label: '8. Are they able to spend time working on their game independently outside of team practices and workouts?', type: 'textarea' },
  { key: 'success', section: 'development', label: '9. If we\'re sitting down one month or six months from now, what would need to change in their game for you to consider the training a success?', type: 'textarea' },

  { key: 'leadSource', section: 'source', label: 'How did you hear about FAST Basketball?', type: 'select', required: true, options: LEAD_SOURCES.map((s) => s.label) },
  { key: 'leadDetail', section: 'source', label: 'Who referred them, or where?', type: 'text', placeholder: 'Only for Referral or Other' },
  { key: 'notes', section: 'source', label: 'Anything else from the call', type: 'textarea' }
];

// What /pay asks when the link carries no consultation. The same definitions, so the two forms
// cannot bound the same answer differently.
const PAYER_KEYS = ['parentFirst', 'parentLast', 'email', 'phone', 'athleteFirst', 'athleteLast', 'leadSource', 'leadDetail'];
export const PAYER_FIELDS = PAYER_KEYS.map((k) => CONSULT_FIELDS.find((f) => f.key === k));

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MAX_CHARS = { text: 200, email: 200, tel: 40, date: 10, select: 100, textarea: 2000 };

/**
 * One typed field list in, every problem out, keyed by field so a page can mark each one
 * rather than the first. Pure, so it runs in a test without a request.
 *
 * Shared with src/lib/apporder.mjs, which asks a different and much shorter set of questions
 * for a tool purchase but has to bound and shape its answers on exactly the same terms: both
 * lists arrive over the same public endpoint, so one relaxed copy of this loop would be a hole
 * in the other form's trust boundary.
 */
export function validateFields(fields, body) {
  const errors = {};
  const values = {};
  const src = body && typeof body === 'object' ? body : {};
  for (const f of fields) {
    const v = typeof src[f.key] === 'string' ? src[f.key].trim() : '';
    values[f.key] = v;
    if (!v) {
      if (f.required) errors[f.key] = f.label + ' is required';
      continue;
    }
    if (v.length > MAX_CHARS[f.type]) errors[f.key] = f.label + ' is too long';
    else if (f.type === 'email' && !EMAIL_RE.test(v)) errors[f.key] = f.label + ' does not look like an email address';
    else if (f.type === 'tel' && v.replace(/\D/g, '').length < 10) errors[f.key] = f.label + ' needs ten digits';
    else if (f.type === 'date' && !pastDate(v)) errors[f.key] = f.label + ' must be a past date';
    else if (f.type === 'select' && !f.options.includes(v)) errors[f.key] = f.label + ' is not one of the choices';
  }
  return { errors, values };
}

// The lead source, mapped to Schedule 1, with its detail required where Blake asked for one.
function withLead(errors, values) {
  const src = LEAD_SOURCES.find((s) => s.label === values.leadSource);
  if (src && src.detail && !values.leadDetail) {
    errors.leadDetail = src.detail === 'referrer' ? 'Who referred them?' : 'Say where they heard about FAST';
  }
  Object.assign(values, leadAnswer(values.leadSource, values.leadDetail));
}

/** The consultation Blake fills in on /enroll. */
export function validateConsultation(body) {
  const { errors, values } = validateFields(CONSULT_FIELDS, body);
  if (values.age && !/^\d{1,2}$/.test(values.age)) errors.age = 'Age as a number, like 13';
  withLead(errors, values);
  return { ok: Object.keys(errors).length === 0, errors, values };
}

// What a payment row copies off the consultation it is paying against: who the family is, and
// the attribution evidence. The rest of the consultation stays on its own row.
export function payerFromConsult(consult) {
  const values = {};
  for (const k of PAYER_KEYS) values[k] = typeof consult[k] === 'string' ? consult[k] : '';
  values.hearAbout = consult.hearAbout || '';
  values.hearAboutOther = consult.hearAboutOther || '';
  values.consultationId = consult.consultationId;
  return values;
}

/**
 * A /pay submission. With a consultation, the family's answers are the consultation's and only
 * the terms box is the payer's; without one, the short PAYER_FIELDS list is asked.
 */
export function validateRegistration(body, { claimed = false, consult = null } = {}) {
  const src = body && typeof body === 'object' ? body : {};
  let errors = {};
  let values;
  if (consult) values = payerFromConsult(consult);
  else {
    ({ errors, values } = validateFields(PAYER_FIELDS, src));
    withLead(errors, values);
    // A family on a developer link (checkout has already re-read the link) is not asked how they
    // heard about FAST: the link is the answer, and the page hides the question.
    if (claimed && !values.leadSource) delete errors.leadSource;
  }
  // Agreement to the terms is ticked on /pay and again, with a typed name, on Stripe's page.
  if (src.terms !== true) errors.terms = 'Agreement to the terms is required';
  return { ok: Object.keys(errors).length === 0, errors, values };
}

// YYYY-MM-DD, a real calendar day, before today. The date input gives exactly this shape.
function pastDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s && d.getTime() < Date.now();
}

// A complete, valid /pay submission for tests and fixtures.
export function sampleRegistration() {
  return {
    athleteFirst: 'Jordan', athleteLast: 'Parent', parentFirst: 'Ben', parentLast: 'Parent',
    email: 'parent@example.com', phone: '(954) 555-0100', leadSource: 'Referral', leadDetail: 'the Smiths',
    terms: true
  };
}

// A complete, valid consultation for tests and fixtures.
export function sampleConsultation() {
  return {
    athleteFirst: 'Jordan', athleteLast: 'Parent', parentFirst: 'Ben', parentLast: 'Parent',
    email: 'parent@example.com', phone: '(954) 555-0100', age: '13', grade: '8th', aau: 'Yes',
    confidence: '6', goals: 'Make varsity', leadSource: 'Google Search'
  };
}
