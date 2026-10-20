// The basketball training agreement a family signs after the evaluation (Blake, 19 October 2026).
// One text, three readers: build.mjs prints it on /agreement, agreement.mjs (the endpoint) stores
// the exact lines the family agreed to, and the same lines go into both copies it emails. So the
// stored record can never say something the page did not.
//
// This is NOT the agreement reproduced on /terms. That page is an earlier signed document kept
// verbatim; this one is Blake's current package terms. Its prices are read from plans.mjs, so a
// price changed in the admin is the price the agreement states.
//
// Bump AGREEMENT_VERSION whenever a line below changes: every signed record carries the version it
// was signed under, which is how a dispute finds the words that applied.
import { PLANS, getPlan, totalCents, dollars } from './plans.mjs';

export const AGREEMENT_VERSION = '2026-10-19';

// The packages /agreement offers, in page order: every plan flagged `agreement` in plans.mjs.
export const agreementPlans = () => Object.keys(PLANS).filter((k) => PLANS[k].agreement);

// The terms of one package: a title, its price line, and the lines the family agrees to.
export function packageTerms(key) {
  const plan = getPlan(key);
  if (key === 'individual-1x') {
    return {
      key, title: 'Monthly Training', price: dollars(totalCents(key, 'monthly')) + ' per month',
      lines: [
        'One individual training session per week.',
        'Payments renew automatically every month.',
        'To cancel, you must give at least 14 days’ written notice before your next billing date.',
        'Without that notice, the next monthly payment will be processed automatically.'
      ]
    };
  }
  if (key === 'individual-6m') {
    return {
      key, title: 'Six-Month Commitment', price: dollars(totalCents(key, 'full')) + ' paid upfront',
      lines: [
        'One individual training session per week.',
        'A six-month commitment with one additional month free: ' + plan.termMonths + ' months of training in total.',
        'Payment is collected upfront.',
        'If you do not wish to continue, you must give at least 30 days’ written notice before the end of your training term.'
      ]
    };
  }
  throw new Error('no agreement terms for ' + key);
}

// What applies whichever package is chosen.
export const GENERAL_LINES = [
  'Written notice means a message in writing (email or text) to Coach Blake Kingsley Jr.',
  'The program policies and the release of liability on the FAST Basketball terms and conditions page (fast-basketball.com/terms) also apply. Where that page says something different about payment, renewal or cancellation, the terms above are the ones that apply to you.',
  'By typing your full name below and submitting this form, you sign this agreement electronically. Your typed name is your signature.'
];

// The agreement as plain lines, exactly as it is stored on a signed record.
export function agreementText(key) {
  const t = packageTerms(key);
  return [t.title + ' (' + t.price + ')'].concat(t.lines.map((l) => '- ' + l), [''], GENERAL_LINES.map((l) => '- ' + l)).join('\n');
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const str = (v) => (typeof v === 'string' ? v.trim() : '');

// The New York calendar day, which is the one the parent sees on the page.
export const todayNY = (now = new Date()) => now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

/**
 * A signature submission. Pure, so it runs in a test without a request. The date must be today
 * (New York time), give or take one day for a parent signing near midnight in another zone; the
 * record also keeps the server's own clock, which is the one that counts.
 */
export function validateAgreement(body, now = new Date()) {
  const src = body && typeof body === 'object' ? body : {};
  const errors = {};
  const values = {
    plan: str(src.plan), signature: str(src.signature), playerName: str(src.playerName),
    email: str(src.email), signedDate: str(src.signedDate), consult: str(src.consult)
  };
  if (!agreementPlans().includes(values.plan)) errors.plan = 'Choose your training package';
  if (values.signature.length < 3 || values.signature.length > 120 || !/\S+\s+\S+/.test(values.signature)) errors.signature = 'Type your full name, first and last';
  if (!values.playerName || values.playerName.length > 120) errors.playerName = 'Enter the player’s name';
  if (!EMAIL_RE.test(values.email) || values.email.length > 200) errors.email = 'Enter your email so we can send your copy';
  const day = (offset) => todayNY(new Date(now.getTime() + offset * 864e5));
  if (![day(-1), day(0), day(1)].includes(values.signedDate)) errors.signedDate = 'Use today’s date';
  if (src.agree !== true) errors.agree = 'Tick the box to agree';
  if (values.consult && !UUID_RE.test(values.consult)) values.consult = '';
  return { ok: Object.keys(errors).length === 0, errors, values };
}
