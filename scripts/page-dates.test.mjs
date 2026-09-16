import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDates, hashPage, isoDay } from './page-dates.mjs';

const DAY = '2026-09-16';

test('a page whose bytes did not move keeps the date it already had', () => {
  const html = '<p>same</p>';
  const previous = { '/': { hash: hashPage(html), date: '2026-08-01' } };
  const { dates, changed } = resolveDates({ '/': html }, previous, DAY);
  assert.equal(dates['/'], '2026-08-01');
  assert.deepEqual(changed, []);
});

test('a page whose bytes moved takes today and is reported as changed', () => {
  const previous = { '/': { hash: hashPage('<p>old</p>'), date: '2026-08-01' } };
  const { dates, changed } = resolveDates({ '/': '<p>new</p>' }, previous, DAY);
  assert.equal(dates['/'], DAY);
  assert.deepEqual(changed, ['/']);
});

test('a page with no record is changed, which is what makes the first build honest', () => {
  const { dates, changed } = resolveDates({ '/contact': '<p>hi</p>' }, {}, DAY);
  assert.equal(dates['/contact'], DAY);
  assert.deepEqual(changed, ['/contact']);
});

// The whole point of the manifest: if a rebuild of untouched content reported changes, every
// deploy would restamp all 15 URLs and both lastmod and IndexNow would be noise.
test('rebuilding the same pages twice reports nothing changed the second time', () => {
  const pages = { '/': '<p>a</p>', '/contact': '<p>b</p>' };
  const first = resolveDates(pages, {}, '2026-09-01');
  assert.deepEqual(first.changed, ['/', '/contact']);
  const second = resolveDates(pages, first.manifest, DAY);
  assert.deepEqual(second.changed, []);
  assert.deepEqual(second.dates, { '/': '2026-09-01', '/contact': '2026-09-01' });
});

test('one page changing does not restamp its neighbours', () => {
  const pages = { '/': '<p>a</p>', '/contact': '<p>b</p>' };
  const before = resolveDates(pages, {}, '2026-09-01').manifest;
  const { dates, changed } = resolveDates({ ...pages, '/contact': '<p>edited</p>' }, before, DAY);
  assert.deepEqual(changed, ['/contact']);
  assert.equal(dates['/'], '2026-09-01');
  assert.equal(dates['/contact'], DAY);
});

test('a page dropped from the sitemap is pruned from the manifest', () => {
  const before = resolveDates({ '/': '<p>a</p>', '/gone': '<p>b</p>' }, {}, '2026-09-01').manifest;
  const { manifest } = resolveDates({ '/': '<p>a</p>' }, before, DAY);
  assert.deepEqual(Object.keys(manifest), ['/']);
});

// A record carrying a hash but no date (a hand-edited or half-written manifest) must not
// emit `<lastmod></lastmod>`; it is treated as unknown and restamped.
test('a record missing its date is restamped rather than emitted empty', () => {
  const html = '<p>a</p>';
  const { dates, changed } = resolveDates({ '/': html }, { '/': { hash: hashPage(html) } }, DAY);
  assert.equal(dates['/'], DAY);
  assert.deepEqual(changed, ['/']);
});

test('isoDay is the date only, which is the form sitemaps.org allows', () => {
  assert.equal(isoDay(new Date('2026-09-16T23:45:01Z')), '2026-09-16');
  assert.match(isoDay(), /^\d{4}-\d{2}-\d{2}$/);
});
