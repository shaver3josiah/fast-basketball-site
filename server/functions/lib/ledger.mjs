// The developer-commission ledger: one document per payment, append-only in effect.
//
// A SEPARATE Firestore collection from `leads`, deliberately. Ledger rows must not land in
// the admin Leads tab (leads-list.mjs returns listLeads() unfiltered), and listLeads() is a
// whole-collection read that several handlers already run inside the money path. Keeping the
// ledger out of it means a year of commission rows cannot slow an enrollment down.
//
// ONE DOCUMENT PER ENTRY, never a running total. The store surface (lib/blobs.mjs) has no
// update, no FieldValue.increment and no transaction: `set` is a full-document overwrite. A
// single accumulating document would be a read-modify-write with a real lost-update race the
// moment two payments land together. Firestore's ~1 write/sec ceiling is per DOCUMENT, so
// one-per-entry also scales where one-hot-document would not.
//
// IDEMPOTENCY IS THE DOCUMENT ID. Stripe retries a non-2xx for three days and a dashboard
// resend produces a NEW event.id for the SAME payment, so the id is derived from the payment
// (session/invoice/charge), never from the event. A replay overwrites its own row with an
// identical one instead of double-paying.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

// Read at import time, exactly like leads.mjs and otp.mjs. Any test must set the env at the
// very top of the file, BEFORE importing this module, or it silently takes the Firestore path.
const LOCAL = process.env.FB_LOCAL === 'true';
const LOCAL_PATH = () => resolve(process.cwd(), '.local/commissions.json');
const STORE_NAME = 'commissions';

async function store() {
  const { getStore } = await import('./blobs.mjs');
  return getStore(STORE_NAME);
}

function readLocal() {
  const path = LOCAL_PATH();
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('[ledger] .local/commissions.json is not readable JSON: ' + err.message);
    return [];
  }
}

// --- "this pay period has already been sent" -------------------------------------------
//
// A scheduled function RETRIES on a throw, and a retry re-runs the whole handler, so without a
// marker a failure after the send would email the same month twice. Its own store, because a
// marker is not a ledger entry and must never reach the totals.
const SENT_NAME = 'payperiod-sent';
const SENT_PATH = () => resolve(process.cwd(), '.local/payperiod-sent.json');

async function sentStore() {
  const { getStore } = await import('./blobs.mjs');
  return getStore(SENT_NAME);
}

export async function wasSent(periodKey) {
  if (LOCAL) {
    if (!existsSync(SENT_PATH())) return null;
    try { return JSON.parse(readFileSync(SENT_PATH(), 'utf8'))[periodKey] || null; } catch { return null; }
  }
  return (await (await sentStore()).get(periodKey, { type: 'json' })) || null;
}

export async function markSent(periodKey, info) {
  if (LOCAL) {
    let all = {};
    if (existsSync(SENT_PATH())) { try { all = JSON.parse(readFileSync(SENT_PATH(), 'utf8')); } catch { all = {}; } }
    all[periodKey] = info;
    mkdirSync(dirname(SENT_PATH()), { recursive: true });
    writeFileSync(SENT_PATH(), JSON.stringify(all, null, 2) + '\n');
    return;
  }
  await (await sentStore()).setJSON(periodKey, info);
}

export async function putEntry(id, entry) {
  if (LOCAL) {
    const path = LOCAL_PATH();
    const kept = readLocal().filter((e) => e.id !== id);
    kept.push({ ...entry, id });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(kept, null, 2) + '\n');
    return;
  }
  await (await store()).setJSON(id, { ...entry, id });
}

export async function getEntry(id) {
  if (LOCAL) return readLocal().find((e) => e.id === id) || null;
  return (await (await store()).get(id, { type: 'json' })) || null;
}

/**
 * Every entry, plus a count of rows that could not be read.
 *
 * listLeads() silently drops unparseable rows and only logs. For leads that loses an enquiry;
 * for money it would be a missing payout behind a green-looking total, so the unreadable count
 * comes back with the data and the report prints it.
 */
export async function listEntries() {
  if (LOCAL) return { entries: readLocal(), unreadable: 0 };
  const entries = [];
  let unreadable = 0;
  for (const { key, value } of await (await store()).entries()) {
    if (!value) { unreadable += 1; continue; }
    try {
      entries.push({ id: key, ...JSON.parse(value) });
    } catch (err) {
      unreadable += 1;
      console.error('[ledger] ' + key + ' is not readable JSON: ' + err.message);
    }
  }
  return { entries, unreadable };
}
