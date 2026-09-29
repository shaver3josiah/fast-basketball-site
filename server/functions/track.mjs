// POST /api/track: the site's own visit counter. src/js/track.js sends two kinds of beat:
//   { t:'pv', vid, sid, p, nv, w, s?, c? }  a page was viewed. `s` (how this visit arrived) rides
//                                           only on the first view of a visit; `c` is a stored
//                                           claim id the page wants re-checked.
//   { t:'lv', vid, sid, ms }                the tab was hidden after `ms` of being looked at.
// One row per visit (sid), never per page view, so the store grows with visits, not clicks.
//
// Answers a page view with { claim: true|false } when there was a link id to judge, which is how
// the page learns whether to answer the intake question for the family. Every other answer is a
// quiet 204: a dropped beat misses a data point and must never break a page.
import { json } from './lib/stripe.mjs';
import { checkRateLimit, clientIp } from './lib/rate-limit.mjs';
import { cleanArrival, channelOf, cleanPath, deviceOf, dayOf, ID_RE, BOT_UA, clip } from './lib/traffic.mjs';
import { getVisit, putVisit, getLink, activeClaim } from './lib/traffic-store.mjs';

const noContent = () => new Response(null, { status: 204 });
// A real visitor sends a view per page plus a hide per tab switch. 120 in ten minutes is a
// very busy human; past it, a script is filling the store.
const RATE = { windowMs: 10 * 60 * 1000, max: 120 };
const MAX_PAGES = 40;
// A tab left open overnight is not half a day of reading. One hide counts at most this much.
const MAX_BEAT_MS = 30 * 60 * 1000;

export default async (request, context) => {
  if (request.method !== 'POST') return json(405, { error: 'method not allowed' });
  if (BOT_UA.test(request.headers.get('user-agent') || '')) return noContent();

  let body;
  try { body = await request.json(); } catch { body = null; }
  if (!body || typeof body !== 'object') return noContent();
  const sid = typeof body.sid === 'string' && ID_RE.test(body.sid) ? body.sid : '';
  const vid = typeof body.vid === 'string' && ID_RE.test(body.vid) ? body.vid : '';
  if (!sid || !vid || (body.t !== 'pv' && body.t !== 'lv')) return noContent();

  if (!(await checkRateLimit('track:' + clientIp(request, context), RATE))) return noContent();

  const now = Date.now();
  let visit = null;
  try { visit = await getVisit(sid); } catch (err) { console.error('[track] read ' + sid + ': ' + err.message); }

  if (body.t === 'lv') {
    if (!visit) return noContent();
    const ms = Number(body.ms);
    if (Number.isFinite(ms) && ms > 0) visit.ms = (visit.ms || 0) + Math.min(Math.round(ms), MAX_BEAT_MS);
    visit.last = new Date(now).toISOString();
    try { await putVisit(visit); } catch (err) { console.error('[track] save ' + sid + ': ' + err.message); }
    return noContent();
  }

  const path = cleanPath(body.p);
  if (!path) return noContent();

  let claimId = '';
  // Coach Blake's own device (the admin panel sets a flag the page passes on): nothing is
  // counted, but a link he is testing still answers exactly as a family would see it.
  const counted = body.nt !== true;
  if (!visit) {
    const arrival = cleanArrival(body.s);
    // A link id is only kept when the link exists, so a typo or a stranger's guess cannot put a
    // "tracked link" row in the panel that no one ever made.
    if (arrival.via && !(await getLink(arrival.via))) {
      arrival.via = '';
      arrival.ch = channelOf(arrival);
    }
    claimId = arrival.via;
    visit = {
      sid,
      vid,
      nv: body.nv === true,
      start: new Date(now).toISOString(),
      day: dayOf(now),
      landing: path,
      ch: arrival.ch,
      src: arrival.src,
      med: arrival.med,
      camp: arrival.camp,
      via: arrival.via,
      ref: arrival.ref,
      dev: deviceOf(body.w),
      pv: 0,
      ms: 0,
      pages: []
    };
  }
  visit.pv += 1;
  visit.last = new Date(now).toISOString();
  if (visit.pages.length < MAX_PAGES) visit.pages.push(path);
  if (counted) {
    try { await putVisit(visit); } catch (err) { console.error('[track] save ' + sid + ': ' + err.message); }
  }

  // This visit arrived on a link, and/or the page asks about a claim it stored on an earlier
  // visit. The first that is a live developer link wins.
  const asked = [claimId, clip(body.c, 20).toLowerCase()].filter(Boolean);
  if (!asked.length) return noContent();
  let claim = null;
  for (const id of asked) {
    try { claim = await activeClaim(id); } catch (err) { console.error('[track] claim ' + id + ': ' + err.message); }
    if (claim) break;
  }
  return json(200, { claim: !!claim, id: claim ? claim.id : null });
};
