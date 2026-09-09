// The only Cloud Function. Firebase Hosting rewrites /api/** here (firebase.json), and
// server/router.mjs picks the handler out of the path.
//
// Cloud Functions hands a handler Express's (req, res). Every handler in this codebase
// speaks the Web Request/Response API, because that is what Netlify passed them and it is
// the better interface. Rather than rewrite thirteen handlers, this file translates once,
// in both directions. That is the whole migration for the function bodies: nothing else
// in server/functions/ knows which host it is running on.
//
// server/ and src/ are copied in beside this file by scripts/functions-pack.mjs, which
// firebase.json runs as a predeploy step. They are gitignored here: the originals one
// directory up are the source of truth, and a stale copy that got committed would be a
// very slow bug to find.

import { onRequest } from 'firebase-functions/v2/https';
import { route } from './server/router.mjs';

// 60s and 512MiB because the canvas renderer and the preview builder both compile a page
// on demand; every other endpoint returns in milliseconds and is billed for what it uses.
export const api = onRequest(
  { region: 'us-central1', memory: '512MiB', timeoutSeconds: 60, maxInstances: 10 },
  async (req, res) => {
    let response;
    try {
      response = await route(toWebRequest(req), { ip: clientIp(req) });
    } catch (err) {
      // A throw here is a bug, not a client error. Log the stack for the owner and answer
      // 500 so a Stripe webhook retries rather than treating it as handled.
      console.error('api ' + req.originalUrl + ' failed: ' + (err && err.stack ? err.stack : err));
      res.status(500).json({ error: 'internal error' });
      return;
    }
    await sendWebResponse(res, response);
  }
);

function clientIp(req) {
  // Hosting sits in front of the function, so the caller's address is the first hop in
  // x-forwarded-for. req.ip would be the proxy.
  const forwarded = req.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.ip || 'unknown';
}

function toWebRequest(req) {
  // x-forwarded-proto is https in front of Hosting and http under the emulator, so the
  // absolute URL a handler sees matches the one the browser asked for. Handlers read
  // url.searchParams from it, and checkout.mjs builds Stripe's return URLs from
  // SITE_URL rather than from here, so a spoofed Host header cannot redirect a payment.
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  const url = proto + '://' + req.get('host') + req.originalUrl;

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) for (const v of value) headers.append(key, v);
    else if (value != null) headers.set(key, String(value));
  }

  // rawBody is the exact bytes Cloud Functions received, before its body parser touched
  // them. stripe-webhook.mjs verifies an HMAC over that string, so anything re-serialised
  // from req.body would fail every signature check.
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  return new Request(url, {
    method: req.method,
    headers,
    body: hasBody ? (req.rawBody ?? undefined) : undefined
  });
}

async function sendWebResponse(res, response) {
  res.status(response.status);
  // Set-Cookie is the one header that legally repeats, and Headers.get() would join the
  // values with a comma into a single broken cookie. admin-login.mjs sets one.
  const cookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() !== 'set-cookie') res.setHeader(key, value);
  });
  if (cookies.length) res.setHeader('Set-Cookie', cookies);

  if (!response.body) {
    res.end();
    return;
  }
  res.end(Buffer.from(await response.arrayBuffer()));
}
