// One Resend call for every function that emails. It lived inside playbook.mjs until the
// Stripe webhook needed the same thing with a different recipient and subject.
//
// Never throws and never blocks the caller's real work: a playbook download and an
// enrollment record must not depend on email working. Missing config or a failed send
// both come back as false, and the caller decides what to log.

import { CONTACT } from '../../../src/lib/site-config.mjs';

export async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.PLAYBOOK_FROM_EMAIL;
  if (!apiKey || !from) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, html })
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
