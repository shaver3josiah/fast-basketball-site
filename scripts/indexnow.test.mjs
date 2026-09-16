import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readQueue, payload, INDEXNOW_KEY, INDEXNOW_HOST } from './indexnow.mjs';

// Importing this module must not submit anything. If the main-module guard ever regresses,
// running the suite would announce URLs to Bing as a side effect of loading a file.
test('importing the module does not submit', () => {
  assert.equal(typeof payload, 'function');
});

// A wrong keyLocation is the cause of a 403, and it is silent: the deploy succeeds and the
// submission is simply refused. Pin the exact URL the key file is written to by the build.
test('keyLocation points at the key file the build writes to the site root', () => {
  const body = payload(['https://fast-basketball.com/']);
  assert.equal(body.keyLocation, 'https://' + INDEXNOW_HOST + '/' + INDEXNOW_KEY + '.txt');
  assert.equal(body.host, INDEXNOW_HOST);
  assert.equal(body.key, INDEXNOW_KEY);
  assert.deepEqual(body.urlList, ['https://fast-basketball.com/']);
});

test('the key is 32 hex characters, which is what the protocol accepts', () => {
  assert.match(INDEXNOW_KEY, /^[a-f0-9]{32}$/);
});

test('a missing queue file reads as nothing to do, not a crash', () => {
  assert.equal(readQueue(join(mkdtempSync(join(tmpdir(), 'in-')), 'absent.json')), null);
});

test('a corrupt or wrong-shaped queue reads as nothing to do', () => {
  const dir = mkdtempSync(join(tmpdir(), 'in-'));
  const bad = join(dir, 'bad.json');
  writeFileSync(bad, '{ not json');
  assert.equal(readQueue(bad), null);
  const wrong = join(dir, 'wrong.json');
  writeFileSync(wrong, JSON.stringify({ host: 'x', urls: 'everything' }));
  assert.equal(readQueue(wrong), null);
});

test('a well-formed queue round-trips, empty list included', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'in-')), 'q.json');
  writeFileSync(file, JSON.stringify({ host: INDEXNOW_HOST, urls: [] }));
  assert.deepEqual(readQueue(file), { host: INDEXNOW_HOST, urls: [] });
});
