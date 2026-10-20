// POST /api/consult: the consultation Coach Blake fills in on /enroll while he is on the phone
// with a family (19 October 2026). Nothing is paid here. The answers are stored as
// `consult:<uuid>` in the leads store, Blake is emailed a copy, and the id comes back so the page
// can hand him the family's payment and agreement links straight away.
//
// A saved consultation is never rewritten through this endpoint. Its id rides in every /pay link
// Blake sends the family, so "update by id" would let anyone holding a payment link change the
// lead source that sets a commission rate. A correction is a new consultation.
import { randomUUID } from 'node:crypto';
import { validateConsultation } from '../../src/lib/registration.mjs';
import { checkRateLimit, clientIp } from './lib/rate-limit.mjs';
import { addLead } from './lib/leads.mjs';
import { sendEmail, ownerEmail, escapeHtml, recordTable } from './lib/notify.mjs';
import { json } from './lib/stripe.mjs';

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 20;

export default async (request, context) => {
  if (request.method !== 'POST') return json(405, { error: 'method not allowed' });
  let body;
  try { body = await request.json(); } catch (err) { body = null; }
  if (!body || typeof body !== 'object') return json(400, { error: 'invalid request body' });
  // Honeypot: a bot is thanked and nothing is stored.
  if (body['en-hp']) return json(200, { ok: true });

  const ip = clientIp(request, context);
  if (!(await checkRateLimit('consult:' + ip, { windowMs: RATE_LIMIT_WINDOW_MS, max: RATE_LIMIT_MAX }))) {
    return json(429, { error: 'too many requests, try again later' });
  }

  const { ok, errors, values } = validateConsultation(body);
  if (!ok) return json(422, { error: Object.values(errors)[0], errors });

  const id = randomUUID();
  const record = {
    type: 'consultation',
    consultationId: id,
    timestamp: new Date().toISOString(),
    ...values,
    name: values.parentFirst + ' ' + values.parentLast,
    playerName: values.athleteFirst + ' ' + values.athleteLast
  };
  try {
    await addLead('consult:' + id, record);
  } catch (err) {
    console.error('consultation ' + id + ' not saved: ' + err.message);
    return json(500, { error: 'consultation not saved' });
  }
  const sent = await sendEmail({
    to: ownerEmail(),
    subject: 'Consultation: ' + record.playerName + ' (' + record.name + ')',
    html: '<h2>Consultation saved</h2><p>' + escapeHtml(record.playerName) + ', parent ' + escapeHtml(record.name) +
      '. The payment and agreement links for this family are on its card in the admin Leads tab.</p>' +
      '<p>Heard about FAST: <b>' + escapeHtml(record.leadSource) + '</b>, which counts as <b>' + escapeHtml(record.hearAbout) + '</b>.</p>' + recordTable(record)
  });
  if (!sent) console.error('consultation email not sent for ' + id + '; the record is saved');
  return json(200, { ok: true, id });
};
