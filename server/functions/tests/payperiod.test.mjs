// Run: node --test server/functions/tests/payperiod.test.mjs
//
// FB_LOCAL before the imports: ledger.mjs captures it at import time.
// The test lives HERE and not beside server/jobs/, because the npm test glob covers
// server/functions/tests/*.test.mjs and would not pick up a new directory: a test at
// server/jobs/pay-period.test.mjs would run zero cases and report success.
process.env.FB_LOCAL = 'true';
delete process.env.RESEND_API_KEY;
delete process.env.PLAYBOOK_FROM_EMAIL;

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), 'fb-payperiod-')));
const { summarise, periodCsv, money } = await import('../lib/payreport.mjs');
const { putEntry } = await import('../lib/ledger.mjs');
const { runPayPeriod } = await import('../../jobs/pay-period.mjs');

const clear = () => {
  for (const f of ['.local/commissions.json', '.local/payperiod-sent.json']) {
    if (fs.existsSync(f)) fs.rmSync(f);
  }
};
const E = (o) => ({ type: 'commission', livemode: true, kind: 'accrual', rate: 0.08, ...o });

// --- the rollup ------------------------------------------------------------------------
test('only livemode rows reach the totals', () => {
  const { periods, skippedTestMode } = summarise([
    E({ paidAt: '2026-09-16T00:00:00.000Z', amountCents: 45000, commissionCents: 3600 }),
    E({ paidAt: '2026-09-16T00:00:00.000Z', amountCents: 99999, commissionCents: 9999, livemode: false })
  ]);
  assert.equal(skippedTestMode, 1, 'a test-mode payment must never be payable');
  assert.equal(periods.length, 1);
  assert.equal(periods[0].netCents, 3600);
});

test('a refund nets the accrual out of its period', () => {
  const { periods } = summarise([
    E({ paidAt: '2026-09-16T00:00:00.000Z', amountCents: 45000, commissionCents: 3600 }),
    E({ paidAt: '2026-09-18T00:00:00.000Z', kind: 'reversal', amountCents: -45000, commissionCents: -3600 })
  ]);
  assert.equal(periods[0].accrualCents, 3600);
  assert.equal(periods[0].reversalCents, -3600);
  assert.equal(periods[0].netCents, 0, 'nothing is owed on money that was given back');
});

test('payments are bucketed by when the money moved, and periods come back newest first', () => {
  const { periods } = summarise([
    E({ paidAt: '2026-09-16T00:00:00.000Z', amountCents: 1000, commissionCents: 80 }),
    E({ paidAt: '2026-09-29T00:00:00.000Z', amountCents: 1000, commissionCents: 80 })
  ]);
  assert.deepEqual(periods.map((p) => p.key), ['2026-09-28', '2026-09-14']);
});

test('the last millisecond of a period stays in that period', () => {
  const { periods } = summarise([E({ paidAt: '2026-09-27T23:59:59.999Z', amountCents: 1000, commissionCents: 80 })]);
  assert.equal(periods[0].key, '2026-09-14');
});

test('a row with no readable date is counted, not silently dropped', () => {
  const { periods, undated } = summarise([
    E({ paidAt: null, amountCents: 1000, commissionCents: 80 }),
    E({ paidAt: 'not a date', amountCents: 1000, commissionCents: 80 })
  ]);
  assert.equal(undated, 2, 'a missing payout must be visible, not a green-looking total');
  assert.equal(periods.length, 0);
});

test('the CSV keeps numbers numeric so a refund actually subtracts', () => {
  const { periods } = summarise([
    E({ paidAt: '2026-09-16T00:00:00.000Z', amountCents: 45000, commissionCents: 3600, familyName: 'Ann' }),
    E({ paidAt: '2026-09-18T00:00:00.000Z', kind: 'reversal', amountCents: -45000, commissionCents: -3600, familyName: 'Ann' })
  ]);
  const csv = periodCsv(periods[0]);
  assert.match(csv, /,-450,/, 'a negative amount must be a number');
  assert.match(csv, /,-36,/, 'a negative commission must be a number');
  assert.doesNotMatch(csv, /,'-/, "apostrophising a negative would make it text and it would not sum");
  // And the totals block must be numeric too, not just the rows.
  assert.match(csv, /^Reversed,-36\.00$/m);
});

test('a formula typed into a family name is still neutralised', () => {
  const { periods } = summarise([
    E({ paidAt: '2026-09-16T00:00:00.000Z', amountCents: 1000, commissionCents: 80, familyName: '=SUM(A1:A9)' })
  ]);
  assert.match(periodCsv(periods[0]), /,'=SUM\(A1:A9\),/);
});

test('money formats cents without ever parsing a string back', () => {
  assert.equal(money(3600), '$36.00');
  assert.equal(money(-3600), '-$36.00');
  assert.equal(money(0), '$0.00');
  assert.equal(money(100000), '$1000.00');
});

// --- the scheduled job -----------------------------------------------------------------
// 2026-09-14 is the anchor Monday, so 09-14 starts period 0 and 09-28 starts period 1.
const PAY_MONDAY = '2026-09-28T13:00:00.000Z'; // first Monday of period 1 -> pays period 0
const OFF_MONDAY = '2026-09-21T13:00:00.000Z'; // second Monday of period 0 -> pays nothing

test('an off week does nothing at all', async () => {
  clear();
  const r = await runPayPeriod(OFF_MONDAY);
  assert.equal(r.skipped, 'not a pay week', JSON.stringify(r));
});

test('with no recipient configured it refuses rather than pretending', async () => {
  clear();
  delete process.env.PAYOUT_REPORT_EMAIL;
  delete process.env.ADMIN_BACKUP_EMAIL;
  const r = await runPayPeriod(PAY_MONDAY);
  assert.equal(r.skipped, 'no PAYOUT_REPORT_EMAIL configured');
});

test('a pay week emails the period that just CLOSED, with both attachments', async () => {
  clear();
  await putEntry('acc_cs_1', E({
    paidAt: '2026-09-16T00:00:00.000Z', amountCents: 45000, commissionCents: 3600,
    familyName: 'Ann Parent', sourceId: 'cs_1', billingReason: 'checkout', likedSite: true
  }));
  process.env.PAYOUT_REPORT_EMAIL = 'dev@example.test';
  process.env.RESEND_API_KEY = 'k';
  process.env.PLAYBOOK_FROM_EMAIL = 'from@example.test';
  const sends = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sends.push(JSON.parse(init.body)); return { ok: true }; };
  try {
    const r = await runPayPeriod(PAY_MONDAY);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.periodKey, '2026-09-14', 'it pays the closed period, not the open one');
    assert.equal(r.netCents, 3600);
    assert.equal(sends.length, 1);
    const mail = sends[0];
    assert.deepEqual(mail.to, ['dev@example.test']);
    assert.ok(mail.subject.includes('$36.00'), 'the amount due is in the subject: ' + mail.subject);
    assert.ok(Array.isArray(mail.attachments), 'attachments MUST be an array or sendEmail drops them silently');
    assert.equal(mail.attachments.length, 2);
    const names = mail.attachments.map((a) => a.filename);
    assert.ok(names.some((n) => n.endsWith('.csv')), names.join(','));
    assert.ok(names.some((n) => n.endsWith('.xlsx')), names.join(','));
    // Base64, not a Buffer: JSON.stringify turns a Buffer into {"type":"Buffer",...}.
    for (const a of mail.attachments) {
      assert.equal(typeof a.content, 'string');
      assert.match(a.content, /^[A-Za-z0-9+/=]+$/);
    }
    // The xlsx attachment must really be a zip: PK\x03\x04.
    const xlsx = Buffer.from(mail.attachments.find((a) => a.filename.endsWith('.xlsx')).content, 'base64');
    assert.equal(xlsx.subarray(0, 2).toString('utf8'), 'PK');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('a retry does not send the same fortnight twice', async () => {
  const sends = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sends.push(JSON.parse(init.body)); return { ok: true }; };
  try {
    const again = await runPayPeriod(PAY_MONDAY);
    assert.equal(again.skipped, 'already sent', JSON.stringify(again));
    assert.equal(sends.length, 0, 'a scheduled retry re-runs the whole handler: it must not re-email');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('a failed send throws, so the scheduled function retries it', async () => {
  clear();
  process.env.PAYOUT_REPORT_EMAIL = 'dev@example.test';
  process.env.RESEND_API_KEY = 'k';
  process.env.PLAYBOOK_FROM_EMAIL = 'from@example.test';
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false });
  try {
    await assert.rejects(() => runPayPeriod(PAY_MONDAY), /was not sent/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('an empty period still reports, rather than going quiet', async () => {
  clear();
  process.env.PAYOUT_REPORT_EMAIL = 'dev@example.test';
  process.env.RESEND_API_KEY = 'k';
  process.env.PLAYBOOK_FROM_EMAIL = 'from@example.test';
  const sends = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sends.push(JSON.parse(init.body)); return { ok: true }; };
  try {
    const r = await runPayPeriod(PAY_MONDAY);
    assert.equal(r.ok, true);
    assert.equal(r.netCents, 0);
    assert.ok(sends[0].subject.includes('$0.00'), 'silence would read as "the job is broken"');
  } finally {
    globalThis.fetch = realFetch;
  }
});
