// Where traffic lives: one row per visit (collection `traffic`) and one per tracked link
// (collection `links`). Their own collections, never `leads`: leads-list returns that collection
// unfiltered, so a visit stored there would show in the Leads tab as a family. Same
// local-file-in-dev pattern as leads.mjs, deals.mjs and ledger.mjs.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { clip, LINK_ID_RE } from './traffic.mjs';

const LOCAL = process.env.FB_LOCAL === 'true';
const localPath = (name) => resolve(process.cwd(), '.local/' + name + '.json');

function readLocal(name) {
  if (!existsSync(localPath(name))) return [];
  try {
    const parsed = JSON.parse(readFileSync(localPath(name), 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function writeLocal(name, rows) {
  mkdirSync(dirname(localPath(name)), { recursive: true });
  writeFileSync(localPath(name), JSON.stringify(rows, null, 2) + '\n');
}

async function store(name) {
  const { getStore } = await import('./blobs.mjs');
  return getStore(name);
}

// ---------------------------------------------------------------- visits

export async function getVisit(sid) {
  if (LOCAL) return readLocal('traffic').find((v) => v.sid === sid) || null;
  return (await store('traffic')).get(sid, { type: 'json' });
}

export async function putVisit(visit) {
  if (LOCAL) {
    const rows = readLocal('traffic').filter((v) => v.sid !== visit.sid);
    rows.push({ ...visit, at: new Date().toISOString() });
    writeLocal('traffic', rows);
    return;
  }
  await (await store('traffic')).setJSON(visit.sid, visit);
}

/**
 * Every visit touched since `sinceIso`. A range query on the write time the store stamps on each
 * row, so the admin panel reads the window it shows and never the whole history.
 * ponytail: one read per visit in the window; add daily rollup rows if a 90-day view ever
 * climbs past a few tens of thousands of visits.
 */
export async function visitsSince(sinceIso) {
  if (LOCAL) return readLocal('traffic').filter((v) => !v.at || v.at >= sinceIso);
  const out = [];
  for (const { value } of await (await store('traffic')).since(sinceIso)) {
    try { if (value) out.push(JSON.parse(value)); } catch { /* unreadable row: skipped */ }
  }
  return out;
}

/**
 * How long a visit row is kept. Twenty-five months holds a full year-on-year comparison, any
 * customer's twelve-month attribution window (Section 7) and the 60 days of records access after
 * a final statement (Section 8), with room to spare. The privacy page states the same number.
 */
export const RETAIN_MONTHS = 25;

/** The cutoff for `now`: RETAIN_MONTHS calendar months back, by UTC month arithmetic. */
export function retentionCutoff(now) {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - RETAIN_MONTHS, d.getUTCDate())).toISOString();
}

/** Deletes visits last touched before the retention cutoff. Returns how many went. */
export async function pruneVisits(now) {
  const cutoff = retentionCutoff(now);
  if (LOCAL) {
    const rows = readLocal('traffic');
    const kept = rows.filter((v) => (v.at || v.last || v.start || '') >= cutoff);
    writeLocal('traffic', kept);
    return rows.length - kept.length;
  }
  return (await store('traffic')).deleteBefore(cutoff);
}

// ---------------------------------------------------------------- tracked links

// Where a link can land. A fixed list, because the id rides on these paths and a free-typed
// path is how a link ends up pointing somewhere that 404s.
export const DESTINATIONS = { '/': 'Homepage', '/enroll': 'Enroll page', '/contact': 'Contact page', '/locker': 'The Locker' };

export function validateLink(input) {
  const b = input && typeof input === 'object' ? input : {};
  const errors = {};
  const name = clip(b.name, 60);
  const note = clip(b.note, 200);
  const dest = Object.hasOwn(DESTINATIONS, b.dest) ? b.dest : '';
  if (name.length < 2) errors.name = 'Give the link a name, like the family or the flyer it is for.';
  if (!dest) errors.dest = 'Pick where the link opens.';
  if (Object.keys(errors).length) return { errors };
  return {
    errors,
    link: {
      // 8 base-36 characters: short enough to read out over the phone, and a guess at one
      // gains nobody anything, because a link only ever changes whose effort a family counts as.
      id: [...randomBytes(8)].map((n) => (n % 36).toString(36)).join(''),
      name,
      note,
      dest,
      developer: b.developer === true,
      createdAt: new Date().toISOString(),
      revokedAt: null
    }
  };
}

export async function getLink(id) {
  if (typeof id !== 'string' || !LINK_ID_RE.test(id)) return null;
  if (LOCAL) return readLocal('links').find((l) => l.id === id) || null;
  return (await store('links')).get(id, { type: 'json' });
}

export async function putLink(link) {
  if (LOCAL) {
    writeLocal('links', [...readLocal('links').filter((l) => l.id !== link.id), link]);
    return;
  }
  await (await store('links')).setJSON(link.id, link);
}

export async function listLinks() {
  if (LOCAL) return readLocal('links');
  const out = [];
  for (const { value } of await (await store('links')).entries()) {
    try { if (value) out.push(JSON.parse(value)); } catch { /* unreadable row: skipped */ }
  }
  return out;
}

/**
 * The link, if it claimed a family for the developer at `atIso` (default: now): marked as his,
 * and not revoked by then. Checkout asks about now; every accrual asks about the moment the
 * family registered.
 *
 * Revoking therefore stops NEW families and never reaches back. A family who arrived while
 * both Parties had approved the link came through an approved link, which is what Section 7
 * pays for; if Blake thinks one should not count, the agreement's answer is that the Parties
 * confer, not that a button quietly re-prices a customer. Blake is emailed the moment a link
 * is made, before any family can use it, which is when an objection belongs.
 */
export async function activeClaim(id, atIso = new Date().toISOString()) {
  const link = await getLink(id);
  if (!link || link.developer !== true) return null;
  if (link.revokedAt && link.revokedAt <= atIso) return null;
  return link;
}
