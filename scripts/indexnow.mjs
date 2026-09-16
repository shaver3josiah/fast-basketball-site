// Tell Bing and Yandex which URLs changed, in minutes instead of weeks.
//
// Google does not participate in IndexNow, so this does nothing for the main target; it is
// here because Bing held zero pages of this site and its own crawler is slow to find a new
// domain with no inbound links. DuckDuckGo is Bing-fed, so it follows along.
//
// RUN THIS AFTER THE DEPLOY, NEVER DURING THE BUILD. Announcing a URL before it is live
// invites an immediate crawl of the bytes that are still there, which teaches the index the
// old page and wastes the one fast signal available.
//
// The key is deliberately in the repo. IndexNow proves ownership by serving the key as a
// file at the site root, so it is public by construction and is not a secret.

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const INDEXNOW_KEY = '0ec211c90d82b90b7b470eb6889ce903';

// Only ever announce the real domain. A preview channel and the raw web.app address serve
// the same pages, and submitting either would ask Bing to index a second copy of the site.
export const INDEXNOW_HOST = 'fast-basketball.com';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const QUEUE_FILE = resolve(ROOT, 'indexnow-changed.json');

const ENDPOINT = 'https://api.indexnow.org/indexnow';

export function readQueue(file = QUEUE_FILE) {
  if (!existsSync(file)) return null;
  try {
    const queue = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(queue?.urls) ? queue : null;
  } catch {
    return null;
  }
}

export function payload(urls, host = INDEXNOW_HOST, key = INDEXNOW_KEY) {
  return {
    host,
    key,
    keyLocation: 'https://' + host + '/' + key + '.txt',
    urlList: urls
  };
}

// `--all` submits every URL in the LIVE sitemap, for seeding an index that has never seen
// the site (Bing held zero pages when this was written) or re-seeding one that has lost it.
// It reads the deployed sitemap rather than the local dist on purpose: that way it cannot
// announce a URL that is not actually published, which is the one mistake IndexNow punishes.
//
// Not part of the deploy. A deploy submits what changed; this is a deliberate hand-run.
async function everyLiveUrl() {
  const res = await fetch('https://' + INDEXNOW_HOST + '/sitemap.xml');
  if (!res.ok) throw new Error('live sitemap returned HTTP ' + res.status);
  const xml = await res.text();
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
}

async function main() {
  if (process.argv.includes('--all')) {
    const urls = await everyLiveUrl();
    console.log('IndexNow: seeding all ' + urls.length + ' URL(s) from the live sitemap.');
    await submit(urls);
    return;
  }

  const queue = readQueue();
  if (!queue) {
    console.log('IndexNow: no change list from this build, nothing to announce.');
    return;
  }
  if (queue.host !== INDEXNOW_HOST) {
    console.log('IndexNow: build targeted ' + queue.host + ', not ' + INDEXNOW_HOST + '. Skipped.');
    return;
  }
  if (queue.urls.length === 0) {
    console.log('IndexNow: no page changed in this deploy. Nothing submitted, by design.');
    return;
  }

  console.log('IndexNow: submitting ' + queue.urls.length + ' changed URL(s):');
  for (const url of queue.urls) console.log('  ' + url);
  await submit(queue.urls);
}

async function submit(urls) {
  const body = payload(urls);
  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body)
    });
  } catch (err) {
    // A failed ping is not a failed deploy. The site is already live and Bing will find it
    // the slow way, so this warns and leaves the workflow green.
    console.warn('IndexNow: could not reach the endpoint (' + err.message + '). Not fatal.');
    return;
  }

  if (res.ok) {
    console.log('IndexNow: accepted (HTTP ' + res.status + ').');
    return;
  }
  // 403 means the key file is not being served at keyLocation; 422 means a submitted URL is
  // not on `host`. Both are our bug, so say which rather than just printing a number.
  const hint = { 400: 'malformed request', 403: 'key file not served at keyLocation', 422: 'a URL does not belong to host', 429: 'rate limited' }[res.status];
  console.warn('IndexNow: rejected, HTTP ' + res.status + (hint ? ' (' + hint + ')' : '') + '. Not fatal.');
}

// Compare resolved paths, not URL strings: on Windows the two spellings differ (drive
// letter case, backslashes) and a string compare would let `node --test` import this module
// and fire a real submission as a side effect of loading it.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
