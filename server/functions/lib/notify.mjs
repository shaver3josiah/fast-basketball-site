// One Resend call for every function that emails. It lived inside playbook.mjs until the
// Stripe webhook needed the same thing with a different recipient and subject.
//
// Never throws and never blocks the caller's real work: a playbook download and an
// enrollment record must not depend on email working. Missing config or a failed send
// both come back as false, and the caller decides what to log.

import { CONTACT } from '../../../src/lib/site-config.mjs';

export async function sendEmail({ to, subject, html, attachments = [], replyTo = null }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.PLAYBOOK_FROM_EMAIL;
  if (!apiKey || !from) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from, to: [to], subject, html,
        ...(attachments.length ? { attachments } : {}),
        // So Blake can hit reply on an enquiry and reach the parent, not himself.
        ...(replyTo ? { reply_to: replyTo } : {})
      })
    });
    return res.ok;
  } catch (err) {
    console.error('email send failed', err.message);
    return false;
  }
}

// Where owner alerts go. Overridable so test-mode webhooks can land in the developer's
// inbox without touching the address families see on the site.
export function ownerEmail() {
  return process.env.ENROLL_NOTIFY_EMAIL || CONTACT.email;
}

// ponytail: duplicated from playbook.mjs rather than moved, so that file's only change is
// the sendEmail import. Fold playbook's copy into this one the next time it is edited.
export function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// A record as the owner emails print it: one row per field. `notified` is bookkeeping, not
// something Blake reads. `signature` is still skipped though nothing writes one any more:
// the enrollment form's drawing pad went in September 2026, and a stray record carrying one
// would otherwise print a screenful of base64 into an email.
export function recordTable(record, skip = ['signature', 'notified']) {
  return '<table border="1" cellpadding="4" style="border-collapse:collapse">' +
    Object.entries(record)
      .filter(([k]) => !skip.includes(k))
      .map(([k, v]) => '<tr><th align="left">' + escapeHtml(k) + '</th><td>' + escapeHtml(v ?? '') + '</td></tr>')
      .join('') +
    '</table>';
}

