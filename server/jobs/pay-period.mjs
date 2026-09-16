// The monthly developer pay report: totals for the month that just closed, emailed with a CSV
// and an XLSX attached.
//
// Section 8 of the agreement: "FAST will calculate compensation monthly and pay undisputed
// amounts within 15 days after the end of each calendar month, together with a transaction
// summary listing the Website Transactions and Attributed Customers."
//
// Monthly IS expressible in cron ("the 1st"), so there is no anchor date, no fortnight parity
// and no off-week branch: the job runs on the 1st and reports the month that just ended. It
// still reads event.scheduleTime rather than a clock, because a retry running late on the 2nd
// must report the same month, and it still writes a sent marker before returning, because a
// scheduled function retries on a throw and would otherwise email the same month twice.
import { periodKeyFor, previousPeriodKey, periodRange } from '../../src/lib/commission.mjs';
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
    // Section 8 requires the statement to list the Attributed Customers it charged 8% for.
    '<h3>Attributed Customers (8%)</h3>' +
    (period.attributedCustomers && period.attributedCustomers.length
      ? '<ul>' + period.attributedCustomers.map((c) =>
          '<li>' + escapeHtml(c.familyName || c.customerKey || 'unnamed') +
          (c.campaign ? ' (campaign: ' + escapeHtml(c.campaign) + ')'
                      : ' (answered: ' + escapeHtml(c.hearAbout || 'unknown') + ')') +
          '</li>').join('') + '</ul>'
      : '<p>None this month. Every payment was charged at the 2.5% rate.</p>') +
    '<p>The CSV and the spreadsheet attached hold one row per payment, with how each family said ' +
    'they heard about FAST and whether that made them an Attributed Customer.</p>'
  );
}

/**
 * The job body. `scheduleTimeIso` is passed in rather than read from a clock so this is testable.
 * Returns a plain object describing what it did, which the wrapper logs.
 */
export async function runPayPeriod(scheduleTimeIso, { force = false } = {}) {
  const fired = Date.parse(scheduleTimeIso);
  const at = Number.isFinite(fired) ? fired : Date.now();

  // The job fires on the 1st, so the month that just CLOSED is the previous one.
  const key = previousPeriodKey(periodKeyFor(at));
  const already = await wasSent(key);
  if (already && !force) return { skipped: 'already sent', periodKey: key, sentAt: already.sentAt };

  const { periods, unreadable, skippedTestMode } = await payPeriods(at);
  const period = periods.find((p) => p.key === key) || {
    ...periodRange(key),
    grossPaidCents: 0, accrualCents: 0, reversalCents: 0, netCents: 0,
    entryCount: 0, unmatchedCount: 0, entries: [], attributedCustomers: []
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
