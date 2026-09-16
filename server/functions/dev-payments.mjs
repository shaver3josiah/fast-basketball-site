// POST /api/dev-payments: the developer-commission ledger, rolled into fortnightly pay periods.
//
// Session-gated like every other admin endpoint. It is the owner's own revenue being committed,
// so this is deliberately in HIS panel rather than somewhere only the developer can see it.
//
// Two shapes on one route, because the admin panel needs both and a download has to come from the
// server: no body (or {}) returns the JSON summary; { download, period } returns the file bytes.
import { verifyRequestSession } from './lib/auth.mjs';
import { payPeriods, periodCsv, periodXlsx, fileBase } from './lib/payreport.mjs';

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' }
});

export default async (request) => {
  if (!verifyRequestSession(request)) return json(401, { error: 'not authenticated' });
  if (request.method !== 'POST') return json(405, { error: 'method not allowed' });

  let body = {};
  try { body = (await request.json()) || {}; } catch { body = {}; }

  const { periods, unreadable, skippedTestMode, undated } = await payPeriods(Date.now());

  if (!body.download) {
    // `entries` is dropped from the summary on purpose: it carries family names and is a whole
    // ledger per period. The panel only ever draws totals; the rows travel in the file instead.
    return json(200, {
      periods: periods.map(({ entries, ...rest }) => rest),
      unreadable,
      skippedTestMode,
      undated
    });
  }

  const period = periods.find((p) => p.key === body.period);
  if (!period) return json(404, { error: 'no such pay period: ' + String(body.period) });

  if (body.download === 'csv') {
    return new Response(periodCsv(period), {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Cache-Control': 'private, no-store',
        'Content-Disposition': 'attachment; filename="' + fileBase(period) + '.csv"'
      }
    });
  }
  if (body.download === 'xlsx') {
    const buf = periodXlsx(period);
    return new Response(buf, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Cache-Control': 'private, no-store',
        'Content-Disposition': 'attachment; filename="' + fileBase(period) + '.xlsx"'
      }
    });
  }
  return json(400, { error: 'download must be csv or xlsx' });
};
