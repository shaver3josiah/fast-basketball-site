import { getStore } from '@netlify/blobs';
import { isLocal } from './store.mjs';

// Fixed-window counter in Netlify Blobs, shared by every function that needs one.
// It lived inside playbook.mjs until admin-login.mjs turned out to need it too, and an
// unauthenticated login endpoint with unlimited guesses is the one that actually matters.
//
// Netlify Blobs does not exist on a laptop and throws there, so local mode skips the
// hosted service rather than mocking it — draft.mjs and leads.mjs already take that way out.
//
// FAILS OPEN, deliberately. If the store is unreachable or unconfigured, this returns true
// and the caller proceeds. The alternative locks the owner out of his own admin panel
// because a storage backend had a bad minute, and the password check behind this is the
// control that actually guards the door — the limit only makes guessing at it impractical.
//
// ponytail: fixed window, not a sliding one. A caller can get up to 2x max across a window
// boundary, which is the wrong tradeoff only if someone is tuning the limit to the request.
// Swap in a sliding log if that day comes; for stopping a password guesser it is plenty.
export async function checkRateLimit(key, { windowMs, max, store = null } = {}) {
  if (isLocal) return true;
  try {
    const blobs = store || getStore('rate-limits');
    const now = Date.now();
    const existing = await blobs.get(key, { type: 'json' });
    if (!existing || now - existing.windowStart > windowMs) {
      await blobs.setJSON(key, { count: 1, windowStart: now });
      return true;
    }
    if (existing.count >= max) return false;
    await blobs.setJSON(key, { count: existing.count + 1, windowStart: existing.windowStart });
    return true;
  } catch (err) {
    console.error('rate limit unavailable, allowing request: ' + err.message);
    return true;
  }
}

// One place for "who is calling", so two functions cannot key their limits differently.
export function clientIp(request, context) {
  return (context && context.ip) || request.headers.get('x-nf-client-connection-ip') || 'unknown';
}
