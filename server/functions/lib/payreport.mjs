// Rolling the commission ledger up into calendar-month pay periods, and rendering one.
//
// Section 8 of the agreement: compensation is calculated monthly and paid within 15 days of
// month end, with a statement listing the Website Transactions and the Attributed Customers.
//
// Pure apart from the ledger read: everything below takes entries in and gives numbers out, so
// the totals can be tested without Firestore and without a clock.
import { periodKeyFor, periodRange } from '../../../src/lib/commission.mjs';
import { listEntries } from './ledger.mjs';
import { buildXlsx } from './xlsx.mjs';

/** Integer cents to a plain "$12.34" / "-$12.34". Never round here: the cents are already exact. */
export function money(cents) {
  const n = Number(cents) || 0;
  const s = (Math.abs(n) / 100).toFixed(2);
  return (n < 0 ? '-$' : '$') + s;
}

/**
 * Group ledger entries into periods, newest first.
 *
 * ONLY livemode rows count. A test-mode event writes a structurally identical row, and paying on
 * one would be paying on money that never moved. Rows are bucketed by `paidAt`, which is when
 * Stripe says the money moved, not when the webhook happened to be processed: a three-day retry
 * must still land in the month it was earned.
 */
export function summarise(entries, { nowPeriodKey = null } = {}) {
  const byPeriod = new Map();
  let skippedTestMode = 0;
  let undated = 0;

  for (const e of entries) {
    if (e.livemode !== true) { skippedTestMode += 1; continue; }
    if (!e.paidAt) { undated += 1; continue; }
    let key;
    try {
      key = periodKeyFor(e.paidAt);
    } catch {
      undated += 1;
      continue;
    }
    if (!byPeriod.has(key)) {
      byPeriod.set(key, {
        ...periodRange(key),
        grossPaidCents: 0, accrualCents: 0, reversalCents: 0, netCents: 0,
        // Two rate worlds in one payout. The owner is settling 2.5% or 8% of training revenue
        // and 50% of tool sales out of a single figure, so the figure has to show its working
        // before he pays it; a net that does not split is a number nobody can check.
        trainingNetCents: 0, appNetCents: 0, appCount: 0,
        entryCount: 0, unmatchedCount: 0, entries: [],
        attributedCustomers: [], attributedSeen: new Set()
      });
    }
    const p = byPeriod.get(key);
    p.entries.push(e);
    p.entryCount += 1;
    p.grossPaidCents += Number(e.amountCents) || 0;
    if (e.kind === 'reversal') p.reversalCents += Number(e.commissionCents) || 0;
    else p.accrualCents += Number(e.commissionCents) || 0;
    p.netCents += Number(e.commissionCents) || 0;
    // A row written before the app products existed carries no `product` and is training.
    if (e.product === 'app') {
      p.appNetCents += Number(e.commissionCents) || 0;
      // Sales, not rows: a refund is a reversal and counting it would make the statement say
      // "3 payments" for two sales and a refund.
      if (e.kind !== 'reversal') p.appCount += 1;
    } else {
      p.trainingNetCents += Number(e.commissionCents) || 0;
    }
    if (e.unmatched) p.unmatchedCount += 1;
    // Section 8: the statement lists the Attributed Customers it charged 8% for. One line per
    // customer, not per payment, and only while they are inside their 12 months.
    if (e.kind === 'accrual' && e.attributed && e.withinWindow) {
      const who = e.customerKey || e.familyName || e.sourceId;
      if (!p.attributedSeen.has(who)) {
        p.attributedSeen.add(who);
        p.attributedCustomers.push({
          customerKey: e.customerKey || null,
          familyName: e.familyName || null,
          hearAbout: e.hearAbout || null,
          campaign: e.campaign || null
        });
      }
    }
  }

  const periods = [...byPeriod.values()].sort((a, b) => (a.key < b.key ? 1 : -1));
  for (const p of periods) {
    p.current = nowPeriodKey ? p.key === nowPeriodKey : false;
    p.entries.sort((a, b) => (a.paidAt < b.paidAt ? -1 : 1));
    delete p.attributedSeen; // a Set does not survive JSON, and the list is what matters
  }
  return { periods, skippedTestMode, undated };
}

/** The ledger, summarised. `now` is passed in so nothing here reads a clock. */
export async function payPeriods(now) {
  const { entries, unreadable } = await listEntries();
  const nowPeriodKey = now ? periodKeyFor(now) : null;
  const { periods, skippedTestMode, undated } = summarise(entries, { nowPeriodKey });
  return { periods, unreadable, skippedTestMode, undated };
}

const COLUMNS = [
  { header: 'Paid at', key: 'paidAt', type: 'string' },
  { header: 'Kind', key: 'kind', type: 'string' },
  { header: 'Line', key: 'product', type: 'string' },
  { header: 'Family', key: 'familyName', type: 'string' },
  { header: 'Player', key: 'playerName', type: 'string' },
  { header: 'Plan', key: 'planLabel', type: 'string' },
  { header: 'Source', key: 'billingReason', type: 'string' },
  { header: 'How they heard', key: 'hearAbout', type: 'string' },
  { header: 'Attributed', key: 'attributed', type: 'string' },
  { header: 'Amount paid', key: 'amount', type: 'money' },
  { header: 'Rate', key: 'rate', type: 'number' },
  { header: 'Commission', key: 'commission', type: 'money' },
  { header: 'Reference', key: 'sourceId', type: 'string' }
];

/** One row per ledger entry, money in DOLLARS because that is what a spreadsheet wants to sum. */
function rowsFor(period) {
  return period.entries.map((e) => ({
    paidAt: (e.paidAt || '').slice(0, 19).replace('T', ' '),
    kind: e.kind === 'reversal' ? (e.sourceType === 'dispute' ? 'Dispute' : 'Refund') : 'Accrual',
    // Why this row is priced where it is. Without it a 50% line sitting beside a 2.5% line
    // reads as an error in the spreadsheet rather than as a different product.
    product: e.product === 'app' ? 'Tool (50/50)' : 'Training',
    familyName: e.familyName || '',
    playerName: e.playerName || '',
    planLabel: e.planLabel || '',
    billingReason: e.billingReason || '',
    hearAbout: e.hearAbout || '',
    // Says WHY the rate is what it is: an attributed customer past 12 months reads 'Yes, expired'
    // rather than looking like a mistake on the statement.
    attributed: e.attributed ? (e.withinWindow ? 'Yes' : 'Yes, 12 months expired') : 'No',
    amount: (Number(e.amountCents) || 0) / 100,
    rate: Number(e.rate) || 0,
    commission: (Number(e.commissionCents) || 0) / 100,
    sourceId: e.sourceId || e.id || ''
  }));
}

export function periodCsv(period) {
  // RFC 4180 quoting for every cell, plus the leading = + - @ TAB CR guard, but the guard is for
  // TEXT ONLY. It must never touch a numeric column: "-450" starts with a minus, and apostrophising
  // it makes the spreadsheet read it as text, so a refund would sit in the sheet without
  // subtracting from the total. That is the whole point of the reversal row.
  const quote = (s) => (/[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s);
  const textCell = (v) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return quote(s);
  };
  const numCell = (v) => (v == null || v === '' ? '' : String(v));
  const cellFor = (col, v) => (col.type === 'string' ? textCell(v) : numCell(v));

  const lines = [COLUMNS.map((c) => textCell(c.header)).join(',')];
  for (const r of rowsFor(period)) lines.push(COLUMNS.map((c) => cellFor(c, r[c.key])).join(','));
  lines.push('');
  // The totals are numbers too, so they go through numCell for the same reason as the rows.
  const total = (label, cents) => textCell(label) + ',' + numCell((cents / 100).toFixed(2));
  lines.push(total('Gross paid', period.grossPaidCents));
  lines.push(total('Accrued', period.accrualCents));
  lines.push(total('Reversed', period.reversalCents));
  lines.push(total('Training commission', period.trainingNetCents));
  lines.push(total('Tool sales, 50/50', period.appNetCents));
  lines.push(total('Net due', period.netCents));
  return lines.join('\r\n') + '\r\n';
}

export function periodXlsx(period) {
  const rows = rowsFor(period);
  // A blank spacer then the totals, so the sheet reads like the CSV and SUM still works above it.
  rows.push({});
  rows.push({ familyName: 'Gross paid', amount: period.grossPaidCents / 100 });
  rows.push({ familyName: 'Accrued', commission: period.accrualCents / 100 });
  rows.push({ familyName: 'Reversed', commission: period.reversalCents / 100 });
  rows.push({ familyName: 'Training commission', commission: period.trainingNetCents / 100 });
  rows.push({ familyName: 'Tool sales, 50/50', commission: period.appNetCents / 100 });
  rows.push({ familyName: 'Net due', commission: period.netCents / 100 });
  return buildXlsx({ sheetName: 'Pay ' + period.key, columns: COLUMNS, rows });
}

export const fileBase = (period) => 'fast-basketball-dev-pay-' + period.key;
