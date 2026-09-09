// POST /api/contact: the "Book Your Call" form on the homepage and on /contact.
//
// This endpoint is new. Until September 2026 the form was a Netlify Form: the markup
// carried data-netlify and Netlify captured the submission, stored it and emailed Blake
// with no code of ours. Firebase has no equivalent, so the capture, the storage and the
// notification live here now. The upside is that an enquiry finally lands in the same
// leads store as an enrollment and a playbook request, which is what the admin panel
// reads, instead of in a dashboard on a third company's site.
//
// Two callers, as with checkout: src/js/contact-form.js sends JSON and reads JSON back,
// and the plain form posts urlencoded if that script never ran and gets a 303 back to the
// page it came from, where .pb-out:target reveals the same success box.

import { checkRateLimit, clientIp } from './lib/rate-limit.mjs';
import { addLead } from './lib/leads.mjs';
import { sendEmail, ownerEmail, escapeHtml, recordTable } from './lib/notify.mjs';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 10;
// Long enough for a parent who wants to explain everything, short enough that the store
// is never where somebody pastes a novel.
const MAX = { name: 120, email: 200, phone: 40, area: 120, program: 160, message: 4000 };

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' }
});

// The form is on two pages, so a fixed redirect target would answer half of them on the
// wrong page. The Referer names the right one; anything cross-origin is ignored rather
// than trusted, so a foreign page cannot use this endpoint as an open redirect.
function backTo(request, hash) {
  const referer = request.headers.get('referer');
  if (referer) {
    try {
      const from = new URL(referer);
      if (from.origin === new URL(request.url).origin) return from.pathname + hash;
    } catch (err) { /* unparseable referer: fall through to /contact */ }
  }
  return '/contact' + hash;
}

const redirect = (location) => new Response(null, { status: 303, headers: { Location: location } });

export default async (request, context) => {
  if (request.method !== 'POST') return json(405, { error: 'method not allowed' });

  const isForm = (request.headers.get('content-type') || '').includes('application/x-www-form-urlencoded');
  const fail = (status, error) => (isForm ? redirect(backTo(request, '#ctErr')) : json(status, { error }));

  let body;
  if (isForm) {
    const form = new URLSearchParams(await request.text());
    body = Object.fromEntries(form.entries());
    body.guardianConfirmed = form.get('guardian-confirmed') === 'yes';
  } else {
    try {
      body = await request.json();
    } catch (err) {
      body = null;
    }
    if (!body || typeof body !== 'object') return json(400, { error: 'invalid request body' });
  }

  // Honeypot, same as the playbook and enrollment forms: a bot is thanked and forgotten.
  if (body['ct-hp']) return isForm ? redirect(backTo(request, '#ctDone')) : json(200, { ok: true });

  const ip = clientIp(request, context);
  const allowed = await checkRateLimit('contact:' + ip, { windowMs: RATE_LIMIT_WINDOW_MS, max: RATE_LIMIT_MAX });
  if (!allowed) return fail(429, 'too many requests, try again later');

  const text = (key) => String(body[key] ?? '').trim().slice(0, MAX[key]);
  const name = text('name');
  const email = text('email');
  if (!name) return fail(422, 'a name is required');
  if (!EMAIL_RE.test(email)) return fail(422, 'a valid email is required');
  // Parent gate, matching the form's own checkbox: a child must not be able to send their
  // own details. The no-JS path maps the checkbox's "yes" to true above.
  if (body.guardianConfirmed !== true) return fail(422, 'guardian confirmation is required');

  const timestamp = new Date().toISOString();
  const record = {
    type: 'contact',
    timestamp,
    name,
    email,
    phone: text('phone'),
    area: text('area'),
    program: text('program'),
    message: text('message'),
    guardianConfirmed: true
  };

  // Store first, notify second, for the reason checkout.mjs gives: an email that fails to
  // send is a lead Blake can still find in the admin panel, but a lead that was never
  // written is gone. A store failure is the one case worth telling the visitor about.
  try {
    await addLead('contact:' + timestamp + '-' + Math.random().toString(36).slice(2, 8), record);
  } catch (err) {
    console.error('contact lead not saved: ' + err.message);
    return fail(500, 'that did not send');
  }

  const sent = await sendEmail({
    to: ownerEmail(),
    replyTo: email,
    subject: 'New enquiry: ' + name + (record.area ? ' (' + record.area + ')' : ''),
    html: '<h2>New enquiry</h2>' +
      '<p>' + escapeHtml(name) + ' asked about ' + escapeHtml(record.program || 'the program') +
      '. Reply to this email, or text ' + escapeHtml(record.phone || 'the number they left') + '.</p>' +
      recordTable(record, ['type', 'guardianConfirmed'])
  });
  if (!sent) console.error('contact email not sent for ' + email + '; the lead is saved');

  return isForm ? redirect(backTo(request, '#ctDone')) : json(200, { ok: true });
};
