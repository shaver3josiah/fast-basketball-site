// /api/admin-traffic: the Traffic tab. Session-gated.
//   GET ?days=7|30|90                     -> the report (lib/traffic.mjs summarize) plus the links
//   POST {action:'create', name, dest, developer, note}  -> a new tracked link
//   POST {action:'revoke', id}            -> the link stops claiming NEW families
//
// A link marked as the developer's is the "tracked campaign link ... that Developer created and
// both Parties approved" of Section 7. Both the owner and the developer can sign in to this
// panel, so the approval cannot be "whoever pressed the button": Blake is emailed the moment
// such a link exists, before any family can arrive through it, with what it means and how to
// revoke it. That email is the written half of the approval, and it is sent to the owner's
// inbox only, never to the backup address the developer reads.
import { verifyRequestSession } from './lib/auth.mjs';
import { json } from './lib/stripe.mjs';
import { listLeads } from './lib/leads.mjs';
import { sendEmail, ownerEmail, escapeHtml } from './lib/notify.mjs';
import { summarize } from './lib/traffic.mjs';
import { visitsSince, listLinks, getLink, putLink, validateLink, DESTINATIONS } from './lib/traffic-store.mjs';
import { SITE_URL } from '../../src/lib/site-config.mjs';

const RANGES = [7, 30, 90];

export const linkUrl = (link) => SITE_URL.replace(/\/$/, '') + link.dest + '?via=' + link.id;
const view = (link) => ({ ...link, url: linkUrl(link), destLabel: DESTINATIONS[link.dest] || link.dest });

export default (request) => handle(request, { now: Date.now(), send: sendEmail });

// `now` and `send` are parameters so the tests can fix the clock and read the email.
export async function handle(request, { now, send }) {
  if (!verifyRequestSession(request)) return json(401, { error: 'not authenticated' });

  if (request.method === 'GET') {
    const asked = Number(new URL(request.url).searchParams.get('days'));
    const days = RANGES.includes(asked) ? asked : 30;
    // A day of slack on the read: the report cuts by New York calendar day, the store by write time.
    const sinceIso = new Date(now - (days + 1) * 864e5).toISOString();
    const [sessions, leads, links] = await Promise.all([visitsSince(sinceIso), listLeads(), listLinks()]);
    links.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const report = summarize({ sessions, leads, links: links.map(view), now, days });
    return json(200, { report, destinations: DESTINATIONS });
  }
  if (request.method !== 'POST') return json(405, { error: 'method not allowed' });

  let body;
  try { body = await request.json(); } catch { body = null; }
  if (!body || typeof body !== 'object') return json(400, { error: 'invalid request body' });

  if (body.action === 'revoke') {
    const link = await getLink(body.id);
    if (!link) return json(404, { error: 'No link with that id.' });
    if (!link.revokedAt) {
      link.revokedAt = new Date(now).toISOString();
      await putLink(link);
    }
    return json(200, { link: view(link) });
  }

  if (body.action !== 'create') return json(400, { error: 'unknown action' });
  const { errors, link } = validateLink(body);
  const keys = Object.keys(errors);
  if (keys.length) return json(422, { error: errors[keys[0]], errors });
  link.createdAt = new Date(now).toISOString();

  // A developer link exists only once Blake has been told about it. The email is the approval
  // record, so it goes FIRST and the link is stored only if it went: a link that could claim
  // families without the owner ever hearing of it is the one outcome this must not allow.
  let notified = null;
  if (link.developer) {
    let sent = false;
    try {
      sent = await send({
        to: ownerEmail(),
        subject: "A link was made that counts families as Josiah's: " + link.name,
        html: '<h2>New developer link</h2>' +
          '<p>A tracked link named <b>' + escapeHtml(link.name) + '</b> was just made in the admin panel and marked ' +
          'as one Josiah brought in.</p>' +
          '<p>A family who arrives through it is counted as a customer Josiah generated: 8% of what they pay for their ' +
          'first 12 months, instead of 2.5%, under Section 7 of the website agreement. The form will not ask them how ' +
          'they heard about you, because the link already says.</p>' +
          '<p><a href="' + escapeHtml(linkUrl(link)) + '">' + escapeHtml(linkUrl(link)) + '</a></p>' +
          (link.note ? '<p>Note: ' + escapeHtml(link.note) + '</p>' : '') +
          '<p><b>If you did not agree to this, revoke it now</b>: admin panel, Traffic tab, Links, Revoke. Revoking stops ' +
          'any new family being counted this way.</p>'
      });
    } catch (err) {
      console.error('[admin-traffic] owner notice failed: ' + err.message);
    }
    if (!sent) {
      return json(502, { error: "The email telling Blake about this link did not send, so the link was not made. Nothing changed; try again in a minute." });
    }
    notified = true;
  }
  await putLink(link);
  return json(200, { link: view(link), notified });
}
