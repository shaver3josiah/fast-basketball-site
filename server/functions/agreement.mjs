// POST /api/agreement: a family signs the training agreement on /agreement (19 October 2026).
//
// The signature is the parent's typed full name, today's date and a ticked box, which is what
// Blake asked for. The record keeps what a dispute needs: the exact lines agreed to and their
// version, the typed name, the date the parent entered, the server's own clock, and the browser
// and network address the signature came from. Stored as `agreement:<uuid>` and emailed twice:
// Blake's copy with the record, the parent's copy with the agreement as they signed it.
import { randomUUID } from 'node:crypto';
import { validateAgreement, packageTerms, agreementText, GENERAL_LINES, AGREEMENT_VERSION } from '../../src/lib/agreement.mjs';
import { getPlan } from '../../src/lib/plans.mjs';
import { checkRateLimit, clientIp } from './lib/rate-limit.mjs';
import { addLead, getLead } from './lib/leads.mjs';
import { sendEmail, ownerEmail, escapeHtml, recordTable } from './lib/notify.mjs';
import { json } from './lib/stripe.mjs';

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 10;

// The agreement as an email body: the same lines the page showed, then the signature.
export function agreementHtml(record) {
  const t = packageTerms(record.plan);
  const li = (lines) => '<ul>' + lines.map((l) => '<li>' + escapeHtml(l) + '</li>').join('') + '</ul>';
  return '<h2>FAST Basketball Training Agreement</h2>' +
    '<p><b>' + escapeHtml(t.title) + '</b>, ' + escapeHtml(t.price) + '</p>' + li(t.lines) + li(GENERAL_LINES) +
    '<p>Player: ' + escapeHtml(record.playerName) + '<br>Signed by: ' + escapeHtml(record.signature) +
    '<br>Date: ' + escapeHtml(record.signedDate) + '<br>Agreement version: ' + escapeHtml(record.version) + '</p>';
}

export default async (request, context) => {
  if (request.method !== 'POST') return json(405, { error: 'method not allowed' });
  let body;
  try { body = await request.json(); } catch (err) { body = null; }
  if (!body || typeof body !== 'object') return json(400, { error: 'invalid request body' });
  if (body['ag-hp']) return json(200, { ok: true });

  const ip = clientIp(request, context);
  if (!(await checkRateLimit('agreement:' + ip, { windowMs: RATE_LIMIT_WINDOW_MS, max: RATE_LIMIT_MAX }))) {
    return json(429, { error: 'too many requests, try again later' });
  }

  const { ok, errors, values } = validateAgreement(body);
  if (!ok) return json(422, { error: Object.values(errors)[0], errors });

  // Linked to the consultation only when it really exists, so the next step's payment link
  // carries an id checkout will accept.
  let consultationId = null;
  if (values.consult) {
    const row = await getLead('consult:' + values.consult);
    if (row && row.type === 'consultation') consultationId = values.consult;
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  const record = {
    type: 'agreement',
    agreementId: id,
    timestamp: now,
    name: values.signature,
    signature: values.signature,
    playerName: values.playerName,
    email: values.email,
    plan: values.plan,
    planLabel: getPlan(values.plan).label,
    signedDate: values.signedDate,
    signedAt: now,
    version: AGREEMENT_VERSION,
    agreementText: agreementText(values.plan),
    ip,
    userAgent: (request.headers.get('user-agent') || '').slice(0, 300),
    consultationId
  };
  try {
    await addLead('agreement:' + id, record);
  } catch (err) {
    console.error('agreement ' + id + ' not saved: ' + err.message);
    return json(500, { error: 'agreement not saved' });
  }

  const html = agreementHtml(record);
  // recordTable skips `signature` by default (a leftover from the drawing pad); here it is the
  // typed name and has to print, so this call names only the bookkeeping field.
  const toBlake = await sendEmail({
    to: ownerEmail(), replyTo: record.email,
    subject: 'Agreement signed: ' + record.playerName + ' (' + packageTerms(record.plan).title + ')',
    html: html + '<h3>Record</h3>' + recordTable(record, ['notified', 'agreementText'])
  });
  const toParent = await sendEmail({
    to: record.email,
    subject: 'Your FAST Basketball training agreement',
    html: '<p>Thank you. This is your copy of the agreement you signed.</p>' + html
  });
  if (!toBlake || !toParent) console.error('agreement ' + id + ' email not sent (blake ' + toBlake + ', parent ' + toParent + '); the record is saved');

  const pay = '/pay?plan=' + encodeURIComponent(record.plan) + (consultationId ? '&c=' + consultationId : '');
  return json(200, { ok: true, id, emailed: toParent, payUrl: pay });
};
