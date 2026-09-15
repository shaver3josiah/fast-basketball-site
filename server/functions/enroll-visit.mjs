// POST /api/enroll-visit: a small engagement beacon from /enroll. Blake shares a private
// enrollment link with one family after a call, and this tells him it was opened and for
// how long. Two events from the page: 'open' on load, 'leave' on tab-hide / navigation away,
// carrying whether the form was submitted. One row per page-load visit, keyed by a client
// vid, shown in the admin Leads tab. When a TAGGED family (a ?ref= in the link) looks for
// real and leaves WITHOUT submitting, Blake gets one follow-up email while the lead is warm.
//
// First-party only: no cookies, no third party, no card, and it never blocks anything. A
// dropped beacon just misses a data point, so every failure path is quiet.
import { addLead, getLead } from './lib/leads.mjs';
import { sendEmail, ownerEmail, escapeHtml } from './lib/notify.mjs';
import { checkRateLimit, clientIp } from './lib/rate-limit.mjs';
import { json } from './lib/stripe.mjs';

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
// A real visit fires open + one leave; 40 leaves room for a flaky tab without letting a
// script write thousands of rows from one address.
const RATE_LIMIT_MAX = 40;
// Below this a leave is a bounce, not a look: no "they didn't finish" email. Tunable.
const EMAIL_MIN_DWELL_MS = 20 * 1000;
// The client's per-visit id, bounded because it becomes a store key.
const VID_RE = /^[a-z0-9-]{8,64}$/i;

const noContent = () => new Response(null, { status: 204 });

// ref rides in the URL Blake types, so cap it and drop control chars before it lands in a
// store row and an email. HTML escaping happens at render time; this is just tidiness.
function cleanRef(v) {
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
}

function human(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return s + 's';
  return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
}

export default async (request, context) => {
  if (request.method !== 'POST') return json(405, { error: 'method not allowed' });

  let body;
  try { body = await request.json(); } catch (err) { body = null; }
  if (!body || typeof body !== 'object') return noContent();

  const vid = typeof body.vid === 'string' && VID_RE.test(body.vid) ? body.vid : '';
  const event = body.event === 'open' || body.event === 'leave' ? body.event : '';
  if (!vid || !event) return noContent();

  const ip = clientIp(request, context);
  if (!(await checkRateLimit('enroll-visit:' + ip, { windowMs: RATE_LIMIT_WINDOW_MS, max: RATE_LIMIT_MAX }))) {
    return noContent();
  }

  const key = 'visit:' + vid;
  const now = Date.now();
  const prior = await getLead(key);
  const ref = cleanRef(body.ref) || (prior && prior.ref) || '';
  // openedAt anchors the dwell, so it is the server's first-seen time, never the client's.
  const openedAt = prior && prior.openedAt ? prior.openedAt : now;
  const submitted = body.submitted === true || (prior && prior.submitted) || false;
  const priorDwell = prior && typeof prior.dwellMs === 'number' ? prior.dwellMs : 0;
  const dwellMs = event === 'leave' ? Math.max(priorDwell, now - openedAt) : priorDwell;

  const record = {
    type: 'visit',
    vid,
    ref,
    name: ref || '(untagged visit)',
    openedAt,
    timestamp: new Date(openedAt).toISOString(),
    lastSeen: new Date(now).toISOString(),
    dwellMs,
    submitted,
    emailed: (prior && prior.emailed) || false
  };

  // One follow-up per visit: a tagged family that looked for real and left without paying.
  // Untagged visits are logged but never emailed, because "someone" is nothing Blake can act
  // on. emailed flips only on a successful send, so a failed one is retried by the next leave.
  const shouldEmail = event === 'leave' && ref && !submitted && dwellMs >= EMAIL_MIN_DWELL_MS && !record.emailed;
  if (shouldEmail) {
    const sent = await sendEmail({
      to: ownerEmail(),
      subject: 'Opened the enroll link, did not finish: ' + ref,
      html: '<h2>Enroll link opened, no registration</h2>' +
        '<p><b>' + escapeHtml(ref) + '</b> opened the enrollment link you sent, spent ' +
        escapeHtml(human(dwellMs)) + ' on it, then left without submitting.</p>' +
        '<p>Nothing was saved and no card was charged. A text now, while it is fresh, is usually what finishes it.</p>'
    });
    if (sent) record.emailed = true;
  }

  try { await addLead(key, record); } catch (err) { console.error('visit ' + vid + ' not saved: ' + err.message); }
  return noContent();
};
