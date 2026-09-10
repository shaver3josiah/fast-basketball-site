// Run: node --test scripts/stripe-check.test.mjs
//
// Offline. auditStripe() takes the client as an argument, so a fake stands in for Stripe and
// every failure the owner could hit is reproducible without an account.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalog } from '../src/lib/plans.mjs';
import { auditStripe, REQUIRED_EVENTS, WEBHOOK_PATH, keyMode } from './stripe-check.mjs';

const SITE = 'https://fast-basketball.com';

// A price for every lookup key, shaped the way Stripe returns them.
function goodPrices() {
  return catalog().map((spec, i) => ({
    id: 'price_' + i,
    lookup_key: spec.lookupKey,
    unit_amount: spec.amountCents,
    currency: 'usd',
    recurring: spec.mode === 'subscription' ? { interval: spec.interval, interval_count: 1 } : null
  }));
}

function goodEndpoint() {
  return { id: 'we_1', url: SITE + WEBHOOK_PATH, status: 'enabled', enabled_events: [...REQUIRED_EVENTS] };
}

function fakeStripe({ prices = goodPrices(), endpoints = [goodEndpoint()], sessionError = null, log = {} } = {}) {
  log.created = [];
  log.expired = [];
  return {
    prices: { list: async () => ({ data: prices }) },
    checkout: {
      sessions: {
        create: async (params) => {
          if (sessionError) throw new Error(sessionError);
          log.created.push(params);
          return { id: 'cs_probe' };
        },
        expire: async (id) => { log.expired.push(id); return { id }; }
      }
    },
    webhookEndpoints: { list: async () => ({ data: endpoints }) }
  };
}

const by = (checks, name) => checks.find((c) => c.name === name);

test('a fully configured account passes every check', async () => {
  const log = {};
  const { ok, checks } = await auditStripe(fakeStripe({ log }), { siteUrl: SITE });
  assert.equal(ok, true, JSON.stringify(checks, null, 1));
  assert.deepEqual(checks.map((c) => c.name), ['prices', 'terms of service', 'webhook']);
  assert.match(by(checks, 'prices').detail, new RegExp('^' + catalog().length + ' lookup keys'));
});

test('the terms probe creates a session with the consent box and always expires it', async () => {
  const log = {};
  await auditStripe(fakeStripe({ log }), { siteUrl: SITE });
  assert.equal(log.created.length, 1, 'exactly one probe session');
  assert.deepEqual(log.created[0].consent_collection, { terms_of_service: 'required' },
    'the probe has to ask for the very thing that fails without a Terms URL');
  assert.deepEqual(log.expired, ['cs_probe'], 'nothing payable is left behind');
});

test('a missing Terms of service URL is reported as the thing that breaks every enrollment', async () => {
  const { ok, checks } = await auditStripe(
    fakeStripe({ sessionError: 'You must provide a Terms of service URL in your public business settings.' }),
    { siteUrl: SITE }
  );
  assert.equal(ok, false);
  const tos = by(checks, 'terms of service');
  assert.equal(tos.ok, false);
  assert.match(tos.detail, /Terms of service URL to https:\/\/fast-basketball\.com\/terms/);
  assert.match(tos.detail, /EVERY enrollment fails/);
});

test('an unrelated session error is reported verbatim, not misdiagnosed as the terms URL', async () => {
  const { checks } = await auditStripe(fakeStripe({ sessionError: 'Invalid API Key provided' }), { siteUrl: SITE });
  const tos = by(checks, 'terms of service');
  assert.equal(tos.ok, false);
  assert.match(tos.detail, /Invalid API Key/);
  assert.ok(!/Terms of service URL to/.test(tos.detail));
});

test('a catalog that was never pushed for this mode names the keys and the fix', async () => {
  const { ok, checks } = await auditStripe(fakeStripe({ prices: [] }), { siteUrl: SITE });
  assert.equal(ok, false);
  const prices = by(checks, 'prices');
  assert.equal(prices.ok, false);
  assert.match(prices.detail, /no active price for: /);
  assert.match(prices.detail, /stripe:catalog in THIS mode/);
  // With no price there is nothing to build a probe session from, and saying so beats
  // reporting a terms failure the owner cannot act on yet.
  assert.equal(by(checks, 'terms of service').ok, false);
  assert.match(by(checks, 'terms of service').detail, /Fix prices first/);
});

test('a price that drifted from plans.mjs is caught, with both numbers named', async () => {
  const prices = goodPrices();
  prices[0].unit_amount = 12345;
  const { ok, checks } = await auditStripe(fakeStripe({ prices }), { siteUrl: SITE });
  assert.equal(ok, false);
  assert.match(by(checks, 'prices').detail, /\$123\.45 in Stripe/);
});

test('a subscription price billed at the wrong cadence is caught', async () => {
  const prices = goodPrices();
  const monthly = prices.find((p) => p.recurring);
  monthly.recurring = { interval: 'year', interval_count: 1 };
  const { ok } = await auditStripe(fakeStripe({ prices }), { siteUrl: SITE });
  assert.equal(ok, false);
});

test('no webhook endpoint is a failure that spells out what to add', async () => {
  const { ok, checks } = await auditStripe(fakeStripe({ endpoints: [] }), { siteUrl: SITE });
  assert.equal(ok, false);
  const hook = by(checks, 'webhook');
  assert.match(hook.detail, new RegExp('Add https://fast-basketball\\.com' + WEBHOOK_PATH));
  for (const e of REQUIRED_EVENTS) assert.ok(hook.detail.includes(e), 'names ' + e);
});

test('an endpoint missing checkout.session.expired is caught, not waved through', async () => {
  const endpoint = goodEndpoint();
  endpoint.enabled_events = REQUIRED_EVENTS.filter((e) => e !== 'checkout.session.expired');
  const { ok, checks } = await auditStripe(fakeStripe({ endpoints: [endpoint] }), { siteUrl: SITE });
  assert.equal(ok, false);
  assert.match(by(checks, 'webhook').detail, /missing events: checkout\.session\.expired/);
});

test('a disabled endpoint does not count as a working one', async () => {
  const endpoint = goodEndpoint();
  endpoint.status = 'disabled';
  const { ok } = await auditStripe(fakeStripe({ endpoints: [endpoint] }), { siteUrl: SITE });
  assert.equal(ok, false);
});

test('an endpoint subscribed to everything satisfies the event check', async () => {
  const endpoint = goodEndpoint();
  endpoint.enabled_events = ['*'];
  const { ok } = await auditStripe(fakeStripe({ endpoints: [endpoint] }), { siteUrl: SITE });
  assert.equal(ok, true);
});

test('an endpoint on the old host still passes, but the mismatch is called out', async () => {
  const endpoint = goodEndpoint();
  endpoint.url = 'https://fast-basketball-b3ebe.web.app' + WEBHOOK_PATH;
  const { ok, checks } = await auditStripe(fakeStripe({ endpoints: [endpoint] }), { siteUrl: SITE });
  assert.equal(ok, true, 'a staging endpoint is a live one during cutover');
  assert.match(by(checks, 'webhook').detail, /NOTE: it points at https:\/\/fast-basketball-b3ebe\.web\.app/);
});

test('keyMode tells the owner which mode they just checked', () => {
  assert.equal(keyMode('sk_test_abc'), 'test');
  assert.equal(keyMode('rk_test_abc'), 'test');
  assert.equal(keyMode('sk_live_abc'), 'live');
  assert.equal(keyMode('rk_live_abc'), 'live');
  assert.equal(keyMode('whsec_abc'), 'unknown');
});
