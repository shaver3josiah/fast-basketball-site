// Per-page change detection, which is what both <lastmod> and IndexNow are built on.
//
// The obvious implementation of lastmod — stamp every page with the build time — is worse
// than emitting nothing. Google states it uses lastmod only while a site reports it
// accurately, and a site where all 15 URLs change on every deploy is indistinguishable
// from a site that lies, so the element gets discarded wholesale. IndexNow asks the same
// thing from the other direction: do not submit a URL that did not change.
//
// So a page's date moves when, and only when, its rendered bytes move. That needs a
// committed record of what each page last looked like, which is `scripts/page-dates.json`.
// The build is byte-deterministic (no timestamps reach the HTML, verified), so a rebuild
// of unchanged content produces identical hashes and the dates hold still.
//
// A build in CI works from the committed manifest. If content changed but the manifest was
// not committed with it, CI computes today's date for that page, which is correct — it just
// does not persist, and the next local build writes it down.

import { createHash } from 'node:crypto';

export function hashPage(html) {
  // 16 hex characters. This is change detection, not integrity: the inputs are our own
  // build outputs, so the only thing being defended against is accidental collision.
  return createHash('sha256').update(html).digest('hex').slice(0, 16);
}

export function isoDay(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

// pages: { '/path': '<html>' }   previous: the committed manifest   day: 'YYYY-MM-DD'
//
// Returns the dates to put in the sitemap, the paths whose bytes moved, and the manifest to
// write back. Paths absent from `pages` are pruned, so a page removed from the sitemap does
// not linger in the record and come back as "unchanged" if it is ever restored.
export function resolveDates(pages, previous = {}, day = isoDay()) {
  const dates = {};
  const changed = [];
  const manifest = {};
  for (const path of Object.keys(pages).sort()) {
    const hash = hashPage(pages[path]);
    const before = previous[path];
    const held = Boolean(before) && before.hash === hash && Boolean(before.date);
    const date = held ? before.date : day;
    if (!held) changed.push(path);
    manifest[path] = { hash, date };
    dates[path] = date;
  }
  return { dates, changed, manifest };
}
