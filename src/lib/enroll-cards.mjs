// The plan cards on /enroll, as markup. One renderer for two callers: build.mjs writes them into
// the static page, and /api/packages returns the same markup for the packages the admin added or
// repriced since that build, which src/js/packages.js swaps into the page. Two renderers would
// drift; this is the only one.
//
// It deliberately imports nothing but plans.mjs, so the Cloud Function that serves it does not
// have to load the page renderer.
import { PLANS, getPlan, payOptionsFor, checkoutSpec, totalCents, dollars } from './plans.mjs';

const escapeHtml = (str) => String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (str) => escapeHtml(str).replace(/"/g, '&quot;');

export function payLine(key, pay, plans = PLANS) {
  const spec = checkoutSpec(key, pay, plans);
  if (pay === 'full') return dollars(spec.amountCents) + ' today';
  if (!spec.iterations) return dollars(spec.amountCents) + ' a month until you cancel';
  return dollars(spec.amountCents) + ' a month for ' + spec.iterations + ' months, ' + dollars(totalCents(key, pay, plans)) + ' in total';
}

// "Individual Training, 9 months, once a week" -> "9 months, once a week". The panel heading
// already names the program, so a card names only the package.
export const shortLabel = (plan) => {
  const i = plan.label.indexOf(', ');
  return i > -1 ? plan.label.slice(i + 2) : plan.label;
};

const SESSIONS = { 'once a week': 'One private session', 'twice a week': 'Two private sessions', 'three times a week': 'Three private sessions' };

function body(key, plan, plans) {
  let out = '';
  if (plan.program === 'individual' && !plan.custom) {
    const weekly = plan.kind === 'recurring';
    const term = plan.kind === 'term';
    out += '<span class="en-card-t">' + escapeHtml(term ? shortLabel(plan) : weekly ? plan.frequency : 'Single session') + '</span>\n';
    out += '<span class="prog-price">' + dollars(term ? plan.totals.full : weekly ? plan.totals.monthly : plan.cents) + '<small>' + (term ? 'paid in full' : weekly ? 'a month' : 'one session') + '</small></span>\n';
    out += '<span class="en-card-d">' + escapeHtml(term
      ? 'One private session a week with Coach Blake for ' + plan.termMonths + ' months, paid in full.'
      : weekly
        ? (SESSIONS[plan.frequency] || 'Private sessions') + ' a week with Coach Blake. Billed monthly until you cancel.'
        : plan.description) + '</span>\n';
  } else if (plan.custom) {
    // A package Blake made in the admin. Its name is his words, so it is escaped like any text.
    const individual = plan.program === 'individual';
    const sessions = individual ? (SESSIONS[plan.frequency] || 'Private sessions') + ' a week with Coach Blake' : 'Group sessions, ' + plan.frequency;
    out += '<span class="en-card-t">' + escapeHtml(shortLabel(plan)) + '</span>\n';
    if (plan.kind === 'once') {
      out += '<span class="prog-price">' + dollars(plan.cents) + '<small>one payment</small></span>\n';
      out += '<span class="en-card-d">' + escapeHtml(plan.description || plan.label) + '</span>\n';
    } else if (plan.kind === 'recurring') {
      out += '<span class="prog-price">' + dollars(plan.totals.monthly) + '<small>a month</small></span>\n';
      out += '<span class="en-card-d">' + escapeHtml(sessions + '. Billed monthly until you cancel.') + '</span>\n';
    } else {
      out += '<span class="prog-price">' + dollars(plan.totals.full) + '<small>paid in full</small></span>\n';
      out += '<span class="en-card-d">' + escapeHtml(sessions + ' for ' + plan.termMonths + ' months, paid in full.') + '</span>\n';
    }
  } else if (plan.kind === 'once') {
    out += '<span class="en-card-t">' + escapeHtml(plan.label) + '</span>\n';
    out += '<span class="prog-price">' + dollars(plan.cents) + '<small>60 minutes</small></span>\n';
    out += '<span class="en-card-d">' + escapeHtml(key === 'eval-call' ? 'The 48-hour rate from your intro call.' : plan.description) + '</span>\n';
  } else {
    out += '<span class="en-card-t">' + plan.months + ' months, ' + escapeHtml(plan.frequency) + '</span>\n';
    out += '<span class="prog-price">' + dollars(totalCents(key, 'full', plans)) + '<small>paid in full</small></span>\n';
    // The monthly figure belongs on the card, not only beside the pay radio: that span is
    // filled by enroll.js, so without JS this is the only place the parent can read it.
    if (payOptionsFor(key, plans).includes('monthly')) out += '<span class="en-card-d">Or ' + escapeHtml(payLine(key, 'monthly', plans)) + '.</span>\n';
    out += '<span class="en-card-d">Group Training Membership. Weekly 60 minute sessions with level matched players. Cancel in writing ' + plan.noticeDays + ' days before the end of the term or it renews.</span>\n';
  }
  return out;
}

// The attributes carrying one amount line per pay option the plan actually prices; enroll.js's
// syncPay reads them, and so does the CSS that hides the pay options a plan does not price.
export function cardAttrs(key, plans = PLANS) {
  return payOptionsFor(key, plans).map((pay) => ' data-' + pay + '="' + escapeAttr(payLine(key, pay, plans)) + '"').join('');
}

// The inside of a card, without its <label> and <input>. packages.js swaps THIS into a card that
// is already on the page, so the radio the family may have ticked keeps its state and listeners.
export function cardInner(key, plans = PLANS) {
  return '<span class="en-card-b">\n' + body(key, getPlan(key, plans), plans) + '</span>\n';
}

export function cardHtml(key, plans = PLANS) {
  // The 48-hour rate is quoted on the intro call and linked from the follow-up email,
  // never listed: enroll.js un-hides it for ?plan=eval-call only.
  return '<label class="en-card"' + cardAttrs(key, plans) + (key === 'eval-call' ? ' hidden' : '') + '>\n' +
    '<input type="radio" name="plan" value="' + key + '" required>\n' + cardInner(key, plans) + '</label>\n';
}

export const keysIn = (program, plans = PLANS, retired = []) =>
  Object.keys(plans).filter((k) => plans[k].program === program && !retired.includes(k));

// The two tiles above the packages, worded from the catalog so a repriced plan moves its tile.
export function programTiles(plans = PLANS, retired = []) {
  const keys = (program) => keysIn(program, plans, retired);
  const fulls = keys('group').filter((k) => Object.hasOwn(plans[k].totals || {}, 'full')).map((k) => totalCents(k, 'full', plans)).sort((a, b) => a - b);
  const weeklies = keys('individual').filter((k) => plans[k].kind === 'recurring').map((k) => totalCents(k, 'monthly', plans)).sort((a, b) => a - b);
  const single = keys('individual').find((k) => plans[k].kind === 'once' && !plans[k].custom);
  return [
    { id: 'individual', title: 'Individual training',
      line: 'One on one with Coach Blake. ' + (single ? dollars(plans[single].cents) + ' a session' + (weeklies.length ? ', or ' : '.') : '') + (weeklies.length ? 'from ' + dollars(weeklies[0]) + ' a month.' : '') },
    { id: 'group', title: 'Group training',
      line: 'Level matched groups. 3 or 6 month memberships' + (fulls.length ? ', ' + dollars(fulls[0]) + ' to ' + dollars(fulls[fulls.length - 1]) + '.' : '.') }
  ];
}
