// POST /api/admin-otp-request: email the owner a fresh six-digit sign-in code. No input,
// because there is one owner and the code always goes to ownerEmail(); nothing here reveals
// whether an account exists, so it always answers 200. admin-login.mjs verifies the code.
//
// Rate-limited hard, because this SENDS mail: a loose limit is an email-bomb button.
import { randomInt } from 'node:crypto';
import { hashOtp } from './lib/auth.mjs';
import { setOtp } from './lib/otp.mjs';
import { sendEmail, ownerEmail } from './lib/notify.mjs';
import { checkRateLimit, clientIp } from './lib/rate-limit.mjs';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_REQUESTS = 5;
const CODE_TTL_MS = 10 * 60 * 1000;

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' }
});

export default async (request, context) => {
  if (request.method !== 'POST') return json(405, { error: 'method not allowed' });

  const ip = clientIp(request, context);
  if (!(await checkRateLimit('otp-request:' + ip, { windowMs: WINDOW_MS, max: MAX_REQUESTS }))) {
    return json(429, { error: 'too many code requests, wait a few minutes' });
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await setOtp({ hash: hashOtp(code), expires: Date.now() + CODE_TTL_MS, tries: 0 });

  // Local dev has no mail: print the code so a developer can sign in. Never logged in prod.
  if (process.env.FB_LOCAL === 'true') console.log('[admin] sign-in code: ' + code);

  // The code goes to the owner and, if set, a backup address (ADMIN_BACKUP_EMAIL), so a lost
  // inbox does not lock the panel out for good. Deduped so one address is never mailed twice.
  const seen = new Set();
  const recipients = [ownerEmail(), process.env.ADMIN_BACKUP_EMAIL]
    .filter(Boolean)
    .filter((e) => { const k = e.trim().toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });

  await sendEmail({
    to: recipients,
    subject: 'Your Fast Basketball admin code: ' + code,
    html: '<h2>Sign-in code</h2>' +
      '<p>Your code is <b style="font-size:1.4em;letter-spacing:2px">' + code + '</b></p>' +
      '<p>It signs you in to the admin panel and expires in 10 minutes. If you did not ask for it, ignore this email and your account stays as it was.</p>'
  });

  // Always 200: one owner, nothing to enumerate, and the UI just says "check your email".
  return json(200, { ok: true });
};
