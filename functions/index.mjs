// The only Cloud Function. Firebase Hosting rewrites /api/** here (firebase.json), and
// server/router.mjs picks the handler out of the path.
//
// Cloud Functions hands a handler Express's (req, res). Every handler in this codebase
// speaks the Web Request/Response API, because that is what Netlify passed them and it is
// the better interface. Rather than rewrite thirteen handlers, this file translates once,
// in both directions. That is the whole migration for the function bodies: nothing else
// in server/functions/ knows which host it is running on.
//
// server/ and src/ are copied in beside this file by scripts/functions-pack.mjs, which
// firebase.json runs as a predeploy step. They are gitignored here: the originals one
// directory up are the source of truth, and a stale copy that got committed would be a
// very slow bug to find.

import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { route } from './server/router.mjs';

// 60s and 512MiB because the canvas renderer and the preview builder both compile a page
// on demand; every other endpoint returns in milliseconds and is billed for what it uses.
export const api = onRequest(
  { region: 'us-central1', memory: '512MiB', timeoutSeconds: 60, maxInstances: 10 },
  async (req, res) => {
    let response;
    try {
      response = await route(toWebRequest(req), { ip: clientIp(req) });
    } catch (err) {
      // A throw here is a bug, not a client error. Log the stack for the owner and answer
      // 500 so a Stripe webhook retries rather than treating it as handled.
      console.error('api ' + req.originalUrl + ' failed: ' + (err && err.stack ? err.stack : err));
      res.status(500).json({ error: 'internal error' });
      return;
    }
    await sendWebResponse(res, response);
  }
);

// The monthly developer pay report, on the 1st, covering the month that just closed
// (agreement Section 8). Monthly IS expressible in cron, so there is no anchor date and no
// parity check to get wrong. timeZone is explicit because ScheduleOptions defaults to UTC,
// which would put a 9am job at 4am or 5am Eastern depending on the season and could move which
// calendar day it lands on.
// maxInstances 1: this must never run beside itself. The body is imported lazily so deploy
// discovery does not load the ledger, the spreadsheet writer or Stripe just to read the schedule.
export const payPeriod = onSchedule(
  {
    region: 'us-central1',
    schedule: '0 9 1 * *',
    timeZone: 'America/New_York',
    maxInstances: 1,
    timeoutSeconds: 120,
    memory: '512MiB'
  },
  async (event) => {
    const { runPayPeriod } = await import('./server/jobs/pay-period.mjs');
    const result = await runPayPeriod(event.scheduleTime);
    console.log('[payPeriod] ' + JSON.stringify(result));
    // Monthly housekeeping rides the same schedule: visit rows older than the retention period
    // (traffic-store.mjs RETAIN_MONTHS, stated on /privacy) are deleted. After the statement,
    // and caught, so it can never stop or retry the statement.
    try {
      const { pruneVisits } = await import('./server/functions/lib/traffic-store.mjs');
      console.log('[payPeriod] pruned ' + (await pruneVisits(Date.parse(event.scheduleTime) || Date.now())) + ' old visits');
    } catch (err) {
      console.error('[payPeriod] visit pruning failed: ' + err.message);
    }
  }
);

// Weekly SEO research, Monday 6am Eastern: reads the live site, Google Search Console, live
// autocomplete, drafts titles from that data with the site's own writer (no AI service, no key),
// and stores one report for the admin Traffic tab. Changes nothing public; see
// server/functions/lib/seo-research.mjs. 540 seconds for up to 40 page reads and 30 paced
// autocomplete calls.
async function seoRun(reason, now) {
  const { runResearch } = await import('./server/functions/lib/seo-research.mjs');
  const { siteWriter } = await import('./server/functions/lib/seo-writer.mjs');
  const report = await runResearch({ now, reason, drafter: siteWriter });
  console.log('[seo] ' + reason + ': ' + report.opportunities.length + ' findings, ' + Object.keys(report.drafts).length + ' drafts, search console ' + (report.sources.searchConsole.connected ? 'connected' : 'not connected'));
  return report;
}
export const seoWeekly = onSchedule(
  { region: 'us-central1', schedule: '0 6 * * 1', timeZone: 'America/New_York', maxInstances: 1, timeoutSeconds: 540, memory: '512MiB' },
  async (event) => { await seoRun('weekly', Date.parse(event.scheduleTime) || Date.now()); }
);
// "Research now" in the admin panel writes a document to seo-requests; this runs it. A request
// through Firebase Hosting is cut off at 60 seconds, which a live research run does not fit in.
export const seoResearchNow = onDocumentCreated(
  { document: 'seo-requests/{id}', region: 'us-central1', maxInstances: 1, timeoutSeconds: 540, memory: '512MiB', retry: false },
  async () => {
    const { getSeo, putSeo } = await import('./server/functions/lib/seo-research.mjs');
    try {
      await seoRun('on demand', Date.now());
    } finally {
      const q = await getSeo('queued');
      if (q) await putSeo('queued', { ...q, doneAt: new Date().toISOString() });
    }
  }
);

function clientIp(req) {
  // Hosting sits in front of the function, so the caller's address is the first hop in
  // x-forwarded-for. req.ip would be the proxy.
  const forwarded = req.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.ip || 'unknown';
}

function toWebRequest(req) {
  // x-forwarded-proto is https in front of Hosting and http under the emulator, so the
  // absolute URL a handler sees matches the one the browser asked for. Handlers read
  // url.searchParams from it, and checkout.mjs builds Stripe's return URLs from
  // SITE_URL rather than from here, so a spoofed Host header cannot redirect a payment.
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  const url = proto + '://' + req.get('host') + req.originalUrl;

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) for (const v of value) headers.append(key, v);
    else if (value != null) headers.set(key, String(value));
  }

  // rawBody is the exact bytes Cloud Functions received, before its body parser touched
  // them. stripe-webhook.mjs verifies an HMAC over that string, so anything re-serialised
  // from req.body would fail every signature check.
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  return new Request(url, {
    method: req.method,
    headers,
    body: hasBody ? (req.rawBody ?? undefined) : undefined
  });
}

async function sendWebResponse(res, response) {
  res.status(response.status);
  // Set-Cookie is the one header that legally repeats, and Headers.get() would join the
  // values with a comma into a single broken cookie. admin-login.mjs sets one.
  const cookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() !== 'set-cookie') res.setHeader(key, value);
  });
  if (cookies.length) res.setHeader('Set-Cookie', cookies);

  if (!response.body) {
    res.end();
    return;
  }
  res.end(Buffer.from(await response.arrayBuffer()));
}
