// Run: node --test server/functions/tests/traffic.test.mjs
//
// Offline, in a scratch directory. FB_LOCAL sends visits, links, leads and the ledger to
// .local/*.json, and must be set before any handler imports because every store captures it
// into a module-level const.
process.env.FB_LOCAL = 'true';
process.env.ADMIN_SESSION_SECRET = 'test-secret-1234567890';
delete process.env.STRIPE_SECRET_KEY;
delete process.env.RESEND_API_KEY;
delete process.env.PLAYBOOK_FROM_EMAIL;

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sampleRegistration, validateRegistration } from '../../../src/lib/registration.mjs';
import { isAttributed } from '../../../src/lib/commission.mjs';

process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), 'fb-traffic-')));
const { channelOf, cleanArrival, parseTrk, summarize, creditOf, dayList } = await import('../lib/traffic.mjs');
const { putLink, getVisit, activeClaim } = await import('../lib/traffic-store.mjs');
const { default: track } = await import('../track.mjs');
const { handle: adminTraffic } = await import('../admin-traffic.mjs');
const { default: checkout } = await import('../checkout.mjs');
const { accrueFromSession } = await import('../lib/accrue.mjs');
const { listEntries } = await import('../lib/ledger.mjs');
const { addLead, listLeads } = await import('../lib/leads.mjs');
const { createSessionCookie } = await import('../lib/auth.mjs');

const CTX = { ip: '10.1.2.3' };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1';
const SID = 'sessionaaaa0001';
const VID = 'visitoraaaa0001';
const reset = () => { fs.rmSync('.local', { recursive: true, force: true }); };

function beat(body, ua = UA) {
  return track(new Request('http://localhost/api/track', {
    method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': ua }, body: JSON.stringify(body)
  }), CTX);
}
const cookie = () => createSessionCookie(60_000).split(';')[0];
function admin(method, body, { query = '', signedIn = true, now = Date.now(), send = async () => true } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (signedIn) headers.cookie = cookie();
  return adminTraffic(new Request('http://localhost/api/admin-traffic' + query, {
    method, headers, body: body ? JSON.stringify(body) : undefined
  }), { now, send });
}
const link = (over = {}) => ({ id: 'josiah01', name: 'The Rivera family', dest: '/enroll', developer: true, note: '', createdAt: '2026-09-01T00:00:00.000Z', revokedAt: null, ...over });

// ---------------------------------------------------------------- channels

test('channels: a tracked link wins, then paid, then the utm tags, then the referrer', () => {
  assert.equal(channelOf({ via: 'abc123', ref: 'google.com' }), 'Tracked link');
  assert.equal(channelOf({ paid: true, ref: 'google.com' }), 'Paid search');
  assert.equal(channelOf({ src: 'google', med: 'cpc' }), 'Paid search');
  assert.equal(channelOf({ src: 'instagram' }), 'Social');
  assert.equal(channelOf({ src: 'newsletter', med: 'email' }), 'Email');
  assert.equal(channelOf({ src: 'flyer' }), 'Campaign');
  assert.equal(channelOf({ ref: 'google.com' }), 'Organic search');
  assert.equal(channelOf({ ref: 'google.co.uk' }), 'Organic search');
  assert.equal(channelOf({ ref: 'bing.com' }), 'Organic search');
  assert.equal(channelOf({ ref: 'l.instagram.com' }), 'Social');
  assert.equal(channelOf({ ref: 'm.facebook.com' }), 'Social');
  assert.equal(channelOf({ ref: 't.co' }), 'Social');
  assert.equal(channelOf({ ref: 'someblog.org' }), 'Referral');
  assert.equal(channelOf({ ref: 'fast-basketball.com' }), 'Direct', 'our own domain is not a source');
  assert.equal(channelOf({ ref: 'checkout.stripe.com' }), 'Direct', 'back from Stripe is not a source');
  assert.equal(channelOf({}), 'Direct');
});

test('an arrival is bounded and keeps the host of the referrer, never its path or query', () => {
  const a = cleanArrival({ ref: 'https://www.google.com/search?q=fast+basketball', landing: '/enroll?email=mom@x.com#top', src: 'X'.repeat(500), via: 'NOT OK!' });
  assert.equal(a.ref, 'google.com');
  assert.equal(a.landing, '/enroll', 'the query string can carry an email; it is cut');
  assert.equal(a.src.length, 60);
  assert.equal(a.via, '', 'a malformed link id is dropped');
  assert.equal(a.ch, 'Campaign');
});

test('parseTrk takes the hidden form field and returns null for anything else', () => {
  assert.equal(parseTrk(''), null);
  assert.equal(parseTrk('not json'), null);
  assert.equal(parseTrk('x'.repeat(4000)), null);
  assert.equal(parseTrk('{"vid":"<script>"}'), null);
  const t = parseTrk(JSON.stringify({ vid: VID, ft: { ref: 'https://www.google.com/' }, ss: { src: 'instagram' } }));
  assert.equal(t.vid, VID);
  assert.equal(t.first.ch, 'Organic search');
  assert.equal(t.visit.ch, 'Social');
});

test('days are New York calendar days, and a 30-day range is exactly 30 of them', () => {
  // 02:00 UTC on 4 October is still 3 October in Fort Lauderdale.
  const now = Date.parse('2026-10-04T02:00:00Z');
  const days = dayList(now, 30);
  assert.equal(days.length, 30);
  assert.equal(days[29], '2026-10-03');
  assert.equal(days[0], '2026-09-04');
  // Across the November clock change nothing repeats and nothing is skipped.
  const fall = dayList(Date.parse('2026-11-05T15:00:00Z'), 7);
  assert.deepEqual(fall, ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05']);
});

// ---------------------------------------------------------------- whose effort

test('credit: his link and the Google answer count; a search with another answer is only evidence', () => {
  assert.equal(creditOf({ claim: { id: 'josiah01', name: 'Rivera' } }).who, 'link');
  assert.equal(creditOf({ hearAbout: 'Google or online search' }).who, 'answer');
  const s = creditOf({ hearAbout: 'Coach Blake directly', source: { first: { ch: 'Organic search', ref: 'google.com' } } });
  assert.equal(s.who, 'search');
  assert.equal(s.counts, false, 'Google hides the search words: secondary evidence, never counted');
  assert.equal(creditOf({ hearAbout: 'Friend, family, or referral' }).who, 'fast');
  assert.equal(creditOf({}).who, 'fast');
});

test('isAttributed takes a claim only as a literal true the server computed', () => {
  assert.equal(isAttributed({ claimed: true, hearAbout: 'Coach Blake directly' }), true);
  assert.equal(isAttributed({ claimed: 'true', hearAbout: 'Coach Blake directly' }), false);
  assert.equal(isAttributed({ claimed: 1 }), false);
});

test('a claimed family need not answer the intake question, but an answer given is still checked', () => {
  const body = { ...sampleRegistration(), hearAbout: '' };
  assert.ok(validateRegistration(body).errors.hearAbout, 'unclaimed: still required');
  assert.equal(validateRegistration(body, { claimed: true }).errors.hearAbout, undefined);
  assert.ok(validateRegistration({ ...body, hearAbout: 'Google' }, { claimed: true }).errors.hearAbout, 'not a Schedule 1 choice');
});

// ---------------------------------------------------------------- the report

test('summarize counts visits, leads and paid registrations per channel and per link', () => {
  const now = Date.parse('2026-09-25T16:00:00Z');
  const sessions = [
    { sid: 's1', vid: 'v1', nv: true, day: '2026-09-25', ch: 'Organic search', ref: 'google.com', landing: '/', pv: 3, ms: 90000, pages: ['/', '/enroll', '/contact'], dev: 'phone' },
    { sid: 's2', vid: 'v1', day: '2026-09-24', ch: 'Direct', landing: '/enroll', pv: 1, ms: 2000, pages: ['/enroll'], dev: 'phone' },
    { sid: 's3', vid: 'v2', nv: true, day: '2026-09-24', ch: 'Tracked link', via: 'josiah01', landing: '/enroll', pv: 2, ms: 60000, pages: ['/enroll', '/enroll/thanks'], dev: 'desktop' },
    { sid: 'old', vid: 'v9', day: '2026-07-01', ch: 'Direct', landing: '/', pv: 1, ms: 0, pages: ['/'] }
  ];
  const leads = [
    { key: 'registration:a', type: 'enrollment', timestamp: '2026-09-24T18:00:00Z', name: 'Rivera', paymentStatus: 'paid', claim: { id: 'josiah01', name: 'The Rivera family' }, source: { first: cleanArrival({ via: 'josiah01' }) } },
    { key: 'contact:b', type: 'contact', timestamp: '2026-09-25T15:00:00Z', name: 'Kim', hearAbout: 'Coach Blake directly', source: { first: cleanArrival({ ref: 'https://www.google.com/' }) } },
    { key: 'contact:c', type: 'contact', timestamp: '2026-09-25T15:00:00Z', name: 'Bot', spam: 'fast' },
    { key: 'visit:x', type: 'visit', timestamp: '2026-09-25T15:00:00Z' },
    { key: 'contact:d', type: 'contact', timestamp: '2026-06-01T15:00:00Z', name: 'Too old' }
  ];
  const r = summarize({ sessions, leads, links: [link()], now, days: 30 });
  assert.equal(r.totals.sessions, 3, 'the July visit is outside 30 days');
  assert.equal(r.totals.visitors, 2);
  assert.equal(r.totals.newVisitors, 2);
  assert.equal(r.totals.pageviews, 6);
  assert.equal(r.totals.leads, 2, 'spam, visits and old leads are left out');
  assert.equal(r.totals.enrolled, 1);
  const ch = Object.fromEntries(r.channels.map((c) => [c.name, c]));
  assert.equal(ch['Organic search'].sessions, 1);
  assert.equal(ch['Organic search'].leads, 1);
  assert.equal(ch['Tracked link'].enrolled, 1);
  assert.equal(r.links[0].sessions, 1);
  assert.equal(r.links[0].leads, 1);
  assert.equal(r.links[0].enrolled, 1);
  assert.equal(r.credit.link.length, 1);
  assert.equal(r.credit.search.length, 1);
  assert.equal(r.daily.length, 30);
  assert.equal(r.daily[29].sessions, 1);
  assert.equal(r.daily[28].sessions, 2);
  assert.equal(r.sources[0].name === 'The Rivera family' || r.sources.some((s) => s.name === 'The Rivera family'), true, 'a link shows by its name');
});

// ---------------------------------------------------------------- /api/track

test('track: a first view opens a visit, later views add pages, a hide adds capped time', async () => {
  reset();
  assert.equal((await beat({ t: 'pv', sid: SID, vid: VID, p: '/?x=1', nv: true, w: 390, s: { ref: 'https://www.google.com/' } })).status, 204);
  await beat({ t: 'pv', sid: SID, vid: VID, p: '/enroll', w: 390, s: { ref: 'https://evil.example/' } });
  await beat({ t: 'lv', sid: SID, vid: VID, ms: 45000 });
  await beat({ t: 'lv', sid: SID, vid: VID, ms: 99 * 3600e3 });
  const v = await getVisit(SID);
  assert.equal(v.ch, 'Organic search', 'the arrival is fixed by the first view of a visit');
  assert.equal(v.ref, 'google.com');
  assert.equal(v.landing, '/');
  assert.deepEqual(v.pages, ['/', '/enroll']);
  assert.equal(v.pv, 2);
  assert.equal(v.dev, 'phone');
  assert.equal(v.ms, 45000 + 30 * 60 * 1000, 'a tab left open all night counts 30 minutes');
});

test('track: bots, junk ids and the owner’s own device store nothing', async () => {
  reset();
  await beat({ t: 'pv', sid: SID, vid: VID, p: '/' }, 'Googlebot/2.1 (+http://www.google.com/bot.html)');
  await beat({ t: 'pv', sid: 'short', vid: VID, p: '/' });
  await beat({ t: 'pv', sid: SID, vid: VID, p: 'https://elsewhere/' });
  await beat({ t: 'pv', sid: SID, vid: VID, p: '/', nt: true });
  assert.equal(await getVisit(SID), null);
});

test('track: a real developer link is kept and confirmed; an invented one is dropped', async () => {
  reset();
  await putLink(link());
  await putLink(link({ id: 'blakes01', name: 'Instagram bio', developer: false }));
  let res = await beat({ t: 'pv', sid: SID, vid: VID, p: '/enroll', s: { via: 'josiah01' } });
  assert.deepEqual(await res.json(), { claim: true, id: 'josiah01' });
  assert.equal((await getVisit(SID)).ch, 'Tracked link');

  res = await beat({ t: 'pv', sid: 'sessionbbbb0002', vid: VID, p: '/', s: { via: 'blakes01' } });
  assert.deepEqual(await res.json(), { claim: false, id: null }, "Blake's own link tracks but claims nobody");

  res = await beat({ t: 'pv', sid: 'sessioncccc0003', vid: VID, p: '/', s: { via: 'made0up1', ref: 'https://www.bing.com/' } });
  const v = await getVisit('sessioncccc0003');
  assert.equal(v.via, '', 'no row for a link nobody made');
  assert.equal(v.ch, 'Organic search', 'the channel falls back to what else it knew');

  // A stored claim re-checked on a later visit, and after a revoke.
  res = await beat({ t: 'pv', sid: 'sessiondddd0004', vid: VID, p: '/enroll', c: 'josiah01' });
  assert.equal((await res.json()).claim, true);
  await putLink(link({ revokedAt: new Date(Date.now() - 1000).toISOString() }));
  res = await beat({ t: 'pv', sid: 'sessioneeee0005', vid: VID, p: '/enroll', c: 'josiah01' });
  assert.equal((await res.json()).claim, false);
});

test('a revoke stops new families but never reaches back past it', async () => {
  reset();
  await putLink(link({ revokedAt: '2026-09-20T00:00:00.000Z' }));
  assert.ok(await activeClaim('josiah01', '2026-09-19T12:00:00.000Z'), 'registered before the revoke');
  assert.equal(await activeClaim('josiah01', '2026-09-21T12:00:00.000Z'), null);
  assert.equal(await activeClaim('josiah01'), null, 'and nobody new today');
});

// ---------------------------------------------------------------- /api/admin-traffic

test('admin-traffic: signed out is 401, and a range is only ever 7, 30 or 90 days', async () => {
  reset();
  assert.equal((await admin('GET', null, { signedIn: false })).status, 401);
  const r = await (await admin('GET', null, { query: '?days=9999' })).json();
  assert.equal(r.report.days, 30);
  assert.equal((await (await admin('GET', null, { query: '?days=90' })).json()).report.daily.length, 90);
});

test('admin-traffic: compares with the window before, and never with days before counting began', async () => {
  reset();
  const visit = (sid, day) => ({ sid: sid + 'aaaaaaaaaaaa', vid: sid + 'bbbbbbbbbbbb', day, ch: 'Direct', pv: 1, ms: 0, pages: ['/'], at: day + 'T16:00:00.000Z' });
  fs.mkdirSync('.local', { recursive: true });
  // 15 December, 7 days: this window is 9 to 15 December, the previous one 2 to 8 December.
  fs.writeFileSync('.local/traffic.json', JSON.stringify([
    visit('a', '2026-12-14'), visit('b', '2026-12-10'), visit('c', '2026-12-09'),
    visit('d', '2026-12-08'), visit('e', '2026-12-02'), visit('f', '2026-12-01')
  ]));
  const now = Date.parse('2026-12-15T18:00:00Z');
  let r = (await (await admin('GET', null, { query: '?days=7', now })).json()).report;
  assert.equal(r.totals.sessions, 3);
  assert.equal(r.previous.sessions, 2, '8 and 2 December; the 1st is outside both windows');
  assert.equal(r.trackingSince, '2026-09-29');
  assert.equal(r.daily[0].day, '2026-12-09');

  // Early October, 30 days: the previous window is all before the counter existed.
  r = (await (await admin('GET', null, { query: '?days=30', now: Date.parse('2026-10-02T18:00:00Z') })).json()).report;
  assert.equal(r.previous, null, 'zeros before counting began are not a slow month');
});

test("admin-traffic: making Josiah's link emails the OWNER, a FAST link emails nobody", async () => {
  reset();
  const sent = [];
  const send = async (m) => { sent.push(m); return true; };
  let res = await admin('POST', { action: 'create', name: 'x', dest: '/enroll' }, { send });
  assert.equal(res.status, 422, 'a name is required');
  res = await admin('POST', { action: 'create', name: 'The Rivera family', dest: '/nowhere' }, { send });
  assert.equal(res.status, 422, 'destinations are a fixed list');

  res = await admin('POST', { action: 'create', name: 'Spring flyer', dest: '/', developer: false }, { send });
  const flyer = (await res.json()).link;
  assert.equal(sent.length, 0);
  assert.match(flyer.url, /\/\?via=[a-z0-9]{8}$/);

  // No email to Blake, no link: the email is the approval record. Refused or thrown, nothing is stored.
  const { listLinks } = await import('../lib/traffic-store.mjs');
  const before = (await listLinks()).length;
  res = await admin('POST', { action: 'create', name: 'Quiet link', dest: '/enroll', developer: true }, { send: async () => false });
  assert.equal(res.status, 502);
  res = await admin('POST', { action: 'create', name: 'Quiet link', dest: '/enroll', developer: true }, { send: async () => { throw new Error('resend down'); } });
  assert.equal(res.status, 502);
  assert.equal((await listLinks()).length, before, 'a developer link Blake was never told about does not exist');

  res = await admin('POST', { action: 'create', name: 'The Rivera <b>family</b>', dest: '/enroll', developer: true }, { send });
  const out = await res.json();
  assert.equal(out.link.developer, true);
  assert.match(out.link.url, /\/enroll\?via=[a-z0-9]{8}$/);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'blake@fast-basketball.com', "the owner's inbox, never the backup the developer reads");
  assert.match(sent[0].html, /revoke/i);
  assert.ok(!sent[0].html.includes('<b>family</b>'), 'the name is escaped');

  res = await admin('POST', { action: 'revoke', id: out.link.id }, { send });
  assert.ok((await res.json()).link.revokedAt);
  assert.equal((await admin('POST', { action: 'revoke', id: 'nosuch99' })).status, 404);
});

// ---------------------------------------------------------------- the money path

const REG = { ...sampleRegistration(), plan: 'group-3m-1x', pay: 'monthly', 'en-hp': '' };
function enroll(body) {
  return checkout(new Request('http://localhost/api/checkout', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  }), { ip: '10.9.9.' + Math.floor(Math.random() * 200) });
}

test('checkout: a family on a live developer link is registered without the intake answer', async () => {
  reset();
  await putLink(link());
  const trk = JSON.stringify({ vid: VID, ft: { via: 'josiah01', landing: '/enroll' }, ss: { via: 'josiah01' } });
  const res = await enroll({ ...REG, hearAbout: '', claim: 'JOSIAH01 ', trk });
  assert.equal(res.status, 503, 'saved, then stopped at Stripe (no key in tests)');
  const [row] = await listLeads();
  assert.deepEqual(row.claim, { id: 'josiah01', name: 'The Rivera family' });
  assert.equal(row.hearAbout, '');
  assert.equal(row.source.first.ch, 'Tracked link');
});

test('checkout: an invented or revoked claim is no claim, so the question is required again', async () => {
  reset();
  await putLink(link({ revokedAt: '2026-01-01T00:00:00.000Z' }));
  for (const claim of ['made0up1', 'josiah01']) {
    const res = await enroll({ ...REG, hearAbout: '', claim });
    assert.equal(res.status, 422, claim);
    assert.ok((await res.json()).errors.hearAbout);
  }
  assert.equal((await listLeads()).length, 0, 'nothing stored');
  // A tool buyer never carries a claim: the 50/50 split does not depend on who sent them.
});

test('accrual: a claimed family earns 8 percent; revoked before they registered, 2.5', async () => {
  reset();
  const session = { id: 'cs_live_T', mode: 'payment', payment_status: 'paid', amount_total: 45000, currency: 'usd', payment_intent: 'pi_T', metadata: { registrationId: 'reg-T', plan: 'group-3m-1x' } };
  const EVENT = { created: 1_789_000_000, livemode: true };
  await putLink(link({ revokedAt: '2026-09-20T00:00:00.000Z' }));
  await addLead('registration:reg-T', { type: 'enrollment', name: 'Rivera', email: 'r@x.test', hearAbout: '', timestamp: '2026-09-10T00:00:00.000Z', claim: { id: 'josiah01', name: 'The Rivera family' } });
  await accrueFromSession(session, EVENT);
  let [e] = (await listEntries()).entries;
  assert.equal(e.rate, 0.08, 'registered while the link was approved');
  assert.equal(e.claim, 'The Rivera family', 'the statement can say why');

  reset();
  await putLink(link({ revokedAt: '2026-09-01T00:00:00.000Z' }));
  await addLead('registration:reg-T', { type: 'enrollment', name: 'Rivera', email: 'r@x.test', hearAbout: '', timestamp: '2026-09-10T00:00:00.000Z', claim: { id: 'josiah01', name: 'The Rivera family' } });
  await accrueFromSession(session, EVENT);
  [e] = (await listEntries()).entries;
  assert.equal(e.rate, 0.025);

  // After the webhook merges Stripe's facts, `timestamp` is the PAYMENT time and the
  // registration's own time is registeredAt. A renewal paid after a revoke still counts.
  reset();
  await putLink(link({ revokedAt: '2026-09-20T00:00:00.000Z' }));
  await addLead('registration:reg-T', { type: 'enrollment', name: 'Rivera', email: 'r@x.test', hearAbout: '', registeredAt: '2026-09-10T00:00:00.000Z', timestamp: '2026-09-25T00:00:00.000Z', claim: { id: 'josiah01', name: 'The Rivera family' } });
  await accrueFromSession(session, EVENT);
  [e] = (await listEntries()).entries;
  assert.equal(e.rate, 0.08, 'judged at registration, not at the later payment');
});
