// Run: node --test server/functions/lib/blobs.test.mjs
//
// The key encoding only. The Firestore calls themselves need the emulator, which needs a
// JDK, and neither belongs in `npm test`. What is worth pinning without a server is the
// round trip: every key this codebase actually writes has to come back out of a document
// id byte-identical, or listLeads() would rename somebody's enrollment.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { docId, decodeId } from './blobs.mjs';

test('every key shape the site writes survives the round trip', () => {
  const keys = [
    'registration:0d1f2a3b-4c5d-4e6f-8a7b-9c0d1e2f3a4b',
    'enrollment:cs_test_a1B2c3D4',
    'contact:2026-09-09T22:05:07.393Z-c1kdgf',
    'playbook:2026-09-09T22:05:07.393Z-bg87yn',
    'checkout:203.0.113.7',
    'src/data/site.json',
    'src/data/content.json',
    'media/__index',
    'media/9f8e7d6c',
    '__publishes'
  ];
  for (const key of keys) {
    assert.equal(decodeId(docId(key)), key, key);
    assert.ok(!docId(key).includes('/'), 'a slash would make ' + key + ' a subcollection path, not a document');
  }
});

test('ids Firestore reserves, or that are too long, are refused rather than written', () => {
  for (const bad of ['', '.', '..']) {
    assert.throws(() => docId(bad), /bad store key/, JSON.stringify(bad));
  }
  assert.throws(() => docId('x'.repeat(1501)), /too long/);
  // A key of exactly the limit is fine; only past it throws.
  assert.equal(docId('x'.repeat(1500)).length, 1500);
});

test('a key that percent-encodes longer than it looks is measured after encoding', () => {
  // Each space becomes %20, so 600 spaces is 1800 bytes of document id. Measuring the raw
  // key would have let this through and Firestore would have rejected the write instead.
  assert.throws(() => docId(' '.repeat(600)), /too long/);
});
