// The athlete registration: every question on Blake's Jotform (form 252193112119145), in
// its order, as one list. build.mjs renders the /enroll form from it, checkout.mjs
// validates a submission against it, and admin/admin.js mirrors its keys for the CSV.
// Option text is the Jotform's own, minus its em-dashes: visible copy carries none.
//
// Four Jotform items are not in this list because they are covered elsewhere: the Square
// product picker is the plan card from plans.mjs, the two free-text "Training Frequency"
// and "Length / Commitment" boxes are what the plan card already fixes, the card name fields
// are Stripe's, and the signature pad is Stripe's consent box and typed name (see below).
// The two agreement boxes and the plan are validated below the loop, since neither is a
// typed answer.

export const SECTIONS = [
  { id: 'athlete', title: 'The athlete' },
  { id: 'parent', title: 'Parent or guardian' },
  { id: 'program', title: 'Program' },
  { id: 'health', title: 'Health insurance' }
];

// Every typed field carries a placeholder: grey example text the parent types over, so no
// box is ever a blank the form has to explain. Selects open on "Please select" instead.
export const FIELDS = [
  { key: 'athleteFirst', section: 'athlete', label: 'First name', type: 'text', required: true, row: 'athlete', placeholder: 'Athlete first name' },
  { key: 'athleteLast', section: 'athlete', label: 'Last name', type: 'text', required: true, row: 'athlete', placeholder: 'Athlete last name' },
  { key: 'dob', section: 'athlete', label: 'Date of birth', type: 'date', required: true },
  { key: 'gender', section: 'athlete', label: 'Gender', type: 'select', required: true, options: ['Male', 'Female', 'N/A'] },
  { key: 'grade', section: 'athlete', label: 'Current grade', type: 'text', required: true, placeholder: 'Grade this school year, like 8th' },
  { key: 'school', section: 'athlete', label: 'School', type: 'text', required: true, placeholder: 'School name' },
  { key: 'studentEmail', section: 'athlete', label: 'Athlete email', type: 'email', placeholder: 'player@email.com' },
  { key: 'studentPhone', section: 'athlete', label: 'Athlete phone', type: 'tel', placeholder: '(954) 555 0100' },
  { key: 'experience', section: 'athlete', label: 'Experience level', type: 'select', required: true, options: ['Beginner', 'Intermediate', 'Advanced', 'High-level/competitive'] },
  { key: 'team', section: 'athlete', label: 'Current team or program', type: 'text', placeholder: 'Team, club or program, if any' },
  { key: 'position', section: 'athlete', label: 'Primary position', type: 'text', placeholder: 'Guard, wing or post' },
  { key: 'goals', section: 'athlete', label: 'Athlete goals', type: 'textarea', placeholder: 'What would you like your athlete to improve?' },

  { key: 'parentFirst', section: 'parent', label: 'Parent first name', type: 'text', required: true, row: 'parent', autocomplete: 'given-name', placeholder: 'Your first name' },
  { key: 'parentLast', section: 'parent', label: 'Parent last name', type: 'text', required: true, row: 'parent', autocomplete: 'family-name', placeholder: 'Your last name' },
  { key: 'relationship', section: 'parent', label: 'Relationship to athlete', type: 'text', required: true, placeholder: 'Mother, father or guardian' },
  { key: 'email', section: 'parent', label: 'Email', type: 'email', required: true, autocomplete: 'email', placeholder: 'you@email.com' },
  { key: 'phone', section: 'parent', label: 'Cell phone', type: 'tel', required: true, autocomplete: 'tel', placeholder: '(954) 555 0100' },
  { key: 'homeCity', section: 'parent', label: 'Home city or ZIP code', type: 'text', placeholder: 'Coral Springs, or 33071' },
  { key: 'contactMethod', section: 'parent', label: 'Preferred contact method', type: 'select', required: true, options: ['Text', 'Email', 'Phone'] },

  { key: 'program', section: 'program', label: 'Which program are you registering for?', type: 'select', required: true, options: [
    '3rd to 5th Grade Training', '6th to 8th Grade Training', 'High School Training',
    'Private 1-on-1 Training, request a consultation', 'Small Group Training', 'Camp/Clinic', 'Not sure, help me choose'
  ] },
  { key: 'frequency', section: 'program', label: 'Training frequency', type: 'select', options: ['1x/week', 'unlimited'] },
  { key: 'day', section: 'program', label: 'Preferred day', type: 'select', options: ['Thursday', 'Friday', 'Either', 'Both'] },
  { key: 'tshirt', section: 'program', label: 'T-shirt size', type: 'select', options: ['YS', 'YM', 'YL', 'S', 'M', 'L', 'XL', 'XXL'] },

  { key: 'insuranceProvider', section: 'health', label: 'Insurance provider', type: 'text', required: true, placeholder: 'Insurance company name' },
  { key: 'insurancePolicy', section: 'health', label: 'Policy number', type: 'text', required: true, autocomplete: 'off', placeholder: 'Policy or member number from the card' },

  { key: 'notes', section: 'agreement', label: 'Questions or comments', type: 'textarea', placeholder: 'Anything Coach Blake should know before the first session' }
];

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MAX_CHARS = { text: 200, email: 200, tel: 40, date: 10, select: 100, textarea: 2000 };

// Pure, so it runs in a test without a request. Returns every problem at once, keyed by
// field, so the page can mark each one rather than the first.
export function validateRegistration(body) {
  const errors = {};
  const values = {};
  const src = body && typeof body === 'object' ? body : {};
  for (const f of FIELDS) {
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
  // The two agreement boxes. A drawn signature pad sat beside them until September 2026 and
  // was removed: the training agreement's own Step 2 says a family agrees "by entering your
  // full name on the checkout form" and ticking the I-agree box, which is Stripe Checkout's
  // consent_collection plus its agree_name field. That is the record Blake would show in a
  // dispute, it is collected on Stripe's page rather than ours, and a canvas drawing added
  // friction on a phone without adding to it.
  if (src.reviewed !== true) errors.reviewed = 'Parent review and agreement is required';
  if (src.terms !== true) errors.terms = 'Agreement to the terms is required';
  return { ok: Object.keys(errors).length === 0, errors, values };
}

// YYYY-MM-DD, a real calendar day, before today. The date input gives exactly this shape.
function pastDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s && d.getTime() < Date.now();
}

// A complete, valid submission for tests and fixtures. Everything optional left blank.
export function sampleRegistration() {
  return {
    athleteFirst: 'Jordan', athleteLast: 'Parent', dob: '2012-04-09', gender: 'Male', grade: '8th', school: 'Westglades Middle',
    experience: 'Intermediate', parentFirst: 'Ben', parentLast: 'Parent', relationship: 'Father',
    email: 'parent@example.com', phone: '(954) 555-0100', contactMethod: 'Text', program: '6th to 8th Grade Training',
    insuranceProvider: 'Florida Blue', insurancePolicy: 'XYZ123456',
    reviewed: true, terms: true
  };
}
