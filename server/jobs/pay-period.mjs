// The fortnightly developer pay report: totals for the period that just closed, emailed with a
// CSV and an XLSX attached.
//
// WHY THIS RUNS WEEKLY. Unix cron cannot express "every two weeks". `0 9 1-31/14 * *` fires on
// the 1st, 15th and 29th and then resets at the month boundary, so 29 Jan to 1 Feb is a 3-day
// "fortnight" and the periods drift inside the month. The schedule is therefore WEEKLY and the
// parity check lives here, against a fixed anchor: isPayWeek() is a modulo on the offset from
// PAY_PERIOD_ANCHOR, so it alternates forever without drift.
//
// WHY event.scheduleTime AND NOT Date.now(). scheduleTime is the time the job was MEANT to fire.
// A retry, or a cold start that ran late, can put Date.now() hours or a day later, which near a
// boundary pays the wrong fortnight. On a manual trigger scheduleTime is the execution time
// instead, which is why it is parsed defensively and falls back rather than throwing.
import { periodKeyFor, previousPeriodKey, isPayWeek, periodRange } from '../../src/lib/commission.mjs';
import { payPeriods, periodCsv, periodXlsx, fileBase, money } from '../functions/lib/payreport.mjs';
import { wasSent, markSent } from '../functions/lib/ledger.mjs';
import { sendEmail, escapeHtml } from '../functions/lib/notify.mjs';

/** Where the report goes. Env, not a literal: this repo is public. */
function reportEmail() {
  return process.env.PAYOUT_REPORT_EMAIL || process.env.ADMIN_BACKUP_EMAIL || '';
}

function summaryHtml(period, extra) {
  const row = (label, value) =>
    '<tr><th align="left" style="padding:4px 12px 4px 0">' + escapeHtml(label) +
    '</th><td style="padding:4px 0">' + escapeHtml(value) + '</td></tr>';
  return (
    '<h2>Developer pay period ' + escapeHtml(period.key) + '</h2>' +
    '<p>' + escapeHtml(period.startISO.slice(0, 10)) + ' to ' + escapeHtml(period.endISO.slice(0, 10)) +
    ', payable ' + escapeHtml(period.payDateISO) + '.</p>' +
    '<table style="border-collapse:collapse">' +
    row('Net due', money(period.netCents)) +
    row('Accrued', money(period.accrualCents)) +
    row('Reversed', money(period.reversalCents)) +
    row('Gross paid by families', money(period.grossPaidCents)) +
    row('Payments in this period', String(period.entryCount)) +
    '</table>' +
    (period.unmatchedCount
      ? '<p><b>' + period.unmatchedCount + ' reversal(s) could not be matched to an accrual</b> and were ' +
        'reversed at the base rate. Check those rows in the attachment before paying.</p>'
      : '') +
    (extra.unreadable
      ? '<p><b>' + extra.unreadable + ' ledger row(s) could not be read</b> and are missing from these ' +
        'totals. That is a real gap, not a rounding difference.</p>'
      : '') +
    '<p>The CSV and the spreadsheet attached hold one row per payment, including which families ' +
    'ticked the website question.</p>'
  );
}

/**
 * The job body. `scheduleTimeIso` is passed in rather than read from a clock so this is testable.
 * Returns a plain object describing what it did, which the wrapper logs.
 */
export async function runPayPeriod(scheduleTimeIso, { force = false } = {}) {
  const fired = Date.parse(scheduleTimeIso);
  const at = Number.isFinite(fired) ? fired : Date.now();

  if (!force && !isPayWeek(at)) {
    return { skipped: 'not a pay week', periodKey: periodKeyFor(at) };
  }

  // On the first Monday of a period, the period that just CLOSED is the previous one.
  const key = previousPeriodKey(periodKeyFor(at));
  const already = await wasSent(key);
  if (already && !force) return { skipped: 'already sent', periodKey: key, sentAt: already.sentAt };

  const { periods, unreadable, skippedTestMode } = await payPeriods(at);
  const period = periods.find((p) => p.key === key) || {
    ...periodRange(key),
    grossPaidCents: 0, accrualCents: 0, reversalCents: 0, netCents: 0,
    entryCount: 0, unmatchedCount: 0, entries: []
  };

  const to = reportEmail();
  if (!to) return { skipped: 'no PAYOUT_REPORT_EMAIL configured', periodKey: key };

  const base = fileBase(period);
  const sent = await sendEmail({
    to,
    subject: 'Fast Basketball dev pay ' + key + ': ' + money(period.netCents) + ' due ' + period.payDateISO,
    html: summaryHtml(period, { unreadable }),
    // Resend wants base64 in `content`, and `attachments` MUST be an array: sendEmail drops a
    // non-array silently (`.length` is undefined) and the mail arrives looking fine, minus the money.
    attachments: [
      { filename: base + '.csv', content: Buffer.from(periodCsv(period), 'utf8').toString('base64') },
      { filename: base + '.xlsx', content: Buffer.from(periodXlsx(period)).toString('base64') }
    ]
  });

  // sendEmail returns false and never throws, so a failed send has to be turned into one
  // deliberately: throwing is what makes the scheduled function retry.
  if (!sent) throw new Error('pay period ' + key + ' report was not sent; will retry');

  await markSent(key, { sentAt: new Date().toISOString(), netCents: period.netCents, to });
  return { ok: true, periodKey: key, netCents: period.netCents, entryCount: period.entryCount, skippedTestMode };
}
