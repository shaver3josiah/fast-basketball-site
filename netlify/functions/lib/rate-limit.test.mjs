import assert from 'node:assert/strict';
import { checkRateLimit, clientIp } from './rate-limit.mjs';

// An injectable store lets the real counting code run here. Without it the module would
// reach for Netlify Blobs, which does not exist on a laptop — the same reason the module
// itself has a local-mode escape hatch.
function fakeStore(clock) {
  const data = new Map();
  return {
    data,
    async get(k) { return data.has(k) ? data.get(k) : null; },
    async setJSON(k, v) { data.set(k, v); },
    clock
  };
}

{
  const store = fakeStore();
  const opts = { windowMs: 60_000, max: 3, store };

  assert.equal(await checkRateLimit('ip:1', opts), true, 'first attempt allowed');
  assert.equal(await checkRateLimit('ip:1', opts), true, 'second allowed');
  assert.equal(await checkRateLimit('ip:1', opts), true, 'third allowed, at max');
  assert.equal(await checkRateLimit('ip:1', opts), false, 'fourth refused inside the window');
  assert.equal(await checkRateLimit('ip:1', opts), false, 'still refused while the window holds');

  // Callers are counted independently, so one guesser cannot lock out everyone else.
  assert.equal(await checkRateLimit('ip:2', opts), true, 'a different key has its own budget');
}

{
  // Once the window has passed, the counter resets and the caller is allowed again.
  const store = fakeStore();
  const opts = { windowMs: 60_000, max: 1, store };
  assert.equal(await checkRateLimit('ip:3', opts), true, 'first allowed');
  assert.equal(await checkRateLimit('ip:3', opts), false, 'second refused');

  const entry = store.data.get('ip:3');
  store.data.set('ip:3', { ...entry, windowStart: entry.windowStart - 60_001 });
  assert.equal(await checkRateLimit('ip:3', opts), true, 'allowed again once the window has passed');
  assert.equal(store.data.get('ip:3').count, 1, 'the reset restarts the count at 1');
}

{
  // The property that keeps the owner out of a lockout: a broken store must not refuse.
  // A rate limiter is not the thing guarding the door; the password behind it is.
  const brokenStore = {
    async get() { throw new Error('blobs unreachable'); },
    async setJSON() { throw new Error('blobs unreachable'); }
  };
  assert.equal(
    await checkRateLimit('ip:4', { windowMs: 1000, max: 1, store: brokenStore }),
    true,
    'a store failure must fail open, never lock the caller out'
  );
}

{
  const req = { headers: { get: (h) => (h === 'x-nf-client-connection-ip' ? '203.0.113.7' : null) } };
  assert.equal(clientIp(req, { ip: '198.51.100.4' }), '198.51.100.4', 'context.ip wins when present');
  assert.equal(clientIp(req, {}), '203.0.113.7', 'falls back to the Netlify header');
  assert.equal(clientIp({ headers: { get: () => null } }, {}), 'unknown', 'never throws when both are missing');
}

console.log('rate-limit: ok');
