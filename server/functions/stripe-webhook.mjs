// The source of truth for an enrollment. The thanks page is copy; this is where a paid
// Checkout Session becomes a record in the leads store and an email to Blake.
//
// Order inside checkout.session.completed matters: write the record, then talk to Stripe,
// then email. A schedule Blake can fix in the dashboard; an enrollment that never got
// recorded he cannot. A throw out of the handler is answered 500 so Stripe retries: the
// leads-store calls are the only things in here that throw, both happen before the owner
// email, and the guard in onCheckoutCompleted makes every retry safe.

import Stripe from 'stripe';
import { addLead, getLead, listLeads } from './lib/leads.mjs';
import { sendEmail, ownerEmail, escapeHtml, recordTable, signatureAttachment } from './lib/notify.mjs';
import { stripeClient, json } from './lib/stripe.mjs';
import { getPlan, checkoutSpec, dollars, cancelNoticeBy, PAY_LABELS } from '../../src/lib/plans.mjs';
import { CONTACT, absoluteUrl } from '../../src/lib/site-config.mjs';

export default async (request) => {
  if (request.method !== 'POST') return json(405, { error: 'method not allowed' });

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return json(503, { error: 'payments not configured' });

  // stripe v22 exposes the webhook helpers as a static on the default export
  // (Stripe.webhooks.constructEvent), so verification is pure HMAC with no client and no
  // API key. STRIPE_SECRET_KEY is only needed further down, for the schedule call.
  const raw = await request.text();
  let event;
  try {
    event = Stripe.webhooks.constructEvent(raw, request.headers.get('stripe-signature'), secret);
  } catch (err) {
    console.error('webhook signature rejected: ' + err.message);
    return json(400, { error: 'bad signature' });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': return json(200, await onCheckoutCompleted(event));
      case 'checkout.session.expired': return json(200, await onSessionExpired(event));
      case 'invoice.payment_failed': return json(200, await onPaymentFailed(event));
      case 'customer.subscription.deleted': return json(200, await onSubscriptionDeleted(event));
      default: return json(200, { ignored: event.type });
    }
  } catch (err) {
    // 500 on purpose. A 200 here would tell Stripe a paid enrollment was handled when the
    // store write failed, nothing was recorded and nobody was emailed, and Stripe would
    // never deliver it again. Retries run for three days and are idempotent.
    console.error('webhook ' + event.type + ' (' + event.id + ') failed: ' + err.message);
    return json(500, { error: err.message });
  }
};

async function onCheckoutCompleted(event) {
  const session = event.data.object;
  const meta = session.metadata || {};
  // A session the enroll page opened carries its registration id, and the record that page
  // wrote is completed in place: one row per family. A session Blake made in the dashboard
  // has none and gets a record of its own, keyed by the session, holding what Stripe knows.
  const regId = typeof meta.registrationId === 'string' && meta.registrationId ? meta.registrationId : null;
  const key = regId ? 'registration:' + regId : 'enrollment:' + session.id;
  // The marker is "Blake was told", not "a record exists". A retry or a dashboard resend is
  // the only second chance the owner email gets; skipping on the record alone spent that
  // chance on the run where the send failed.
  const seen = await getLead(key);
  if (seen && seen.notified) return { duplicate: true };
  const reg = regId && seen ? seen : null;
  if (regId && !seen) console.error('session ' + session.id + ' names registration ' + regId + ', which is not in the store');

  const timestamp = new Date(event.created * 1000).toISOString();
  const plan = meta.plan || '';
  const pay = meta.pay || '';
  let planLabel = plan;
  try {
    planLabel = getPlan(plan).label;
  } catch (err) {
    console.error('enrollment ' + session.id + ' has a plan not in the catalog: ' + plan);
  }
  const months = Number(meta.months) || null;
  const noticeDays = Number(meta.noticeDays) || null;
  const amountCents = session.amount_total ?? 0;

  // The registration's own answers come first and Stripe's facts land on top. Stripe's
  // email and phone win because the receipt went there; the names come from the form,
  // with the typed-to-agree name kept beside them as the contract's own evidence.
  const record = {
    ...(reg || {}),
    type: 'enrollment',
    timestamp,
    registeredAt: reg ? reg.timestamp : null,
    sessionId: session.id,
    customerId: session.customer || null,
    subscriptionId: session.subscription || null,
    email: session.customer_details?.email || session.customer_email || reg?.email || null,
    phone: session.customer_details?.phone || reg?.phone || null,
    name: reg?.name || customField(session, 'agree_name'),
    agreeName: customField(session, 'agree_name'),
    playerName: reg?.playerName || customField(session, 'player_name'),
    plan,
    planLabel,
    pay,
    amountCents,
    amount: dollars(amountCents),
    months,
    termTotalCents: Number(meta.totalCents) || null,
    noticeDays,
    startDate: timestamp.slice(0, 10),
    cancelNoticeBy: months ? cancelNoticeBy(timestamp, months, noticeDays) : null,
    paymentStatus: session.payment_status,
    termsAccepted: session.consent?.terms_of_service === 'accepted',
    livemode: !!event.livemode
  };
  await addLead(key, record);

  const scheduleNote = await attachSchedule(session, plan, pay);

  // Stripe completes the session before the money lands: a card that attaches but fails its
  // first invoice arrives here as 'unpaid'. Record it either way, but never hand Blake a
  // ready-to-send welcome email for a family that has not paid.
  const paid = record.paymentStatus === 'paid' || record.paymentStatus === 'no_payment_required';
  const sent = await sendEmail({
    to: ownerEmail(),
    subject: (paid ? 'New enrollment: ' : 'UNPAID, do not welcome yet: ') + planLabel + ' (' + (PAY_LABELS[pay] || pay) + ') - ' + (record.name || record.email),
    html: enrollmentHtml(record, scheduleNote, paid),
    attachments: signatureAttachment(record)
  });
  if (sent) await addLead(key, { ...record, notified: true });
  else console.error('owner email not sent for ' + key + '; the record is saved, and a Stripe resend of this event will try again');
  return { ok: true };
}

function customField(session, key) {
  const field = (session.custom_fields || []).find((f) => f.key === key);
  return field?.text?.value || null;
}

// Checkout creates an open-ended subscription. A monthly plan has a fixed number of term
// payments, so a schedule is wrapped around the subscription and released to run on month
// to month after that many. Returns one line for the owner email; never throws.
async function attachSchedule(session, plan, pay) {
  if (session.mode !== 'subscription' || !session.subscription) return 'not needed, one payment';
  let spec;
  try {
    spec = checkoutSpec(plan, pay);
  } catch (err) {
    return 'not attached, ' + err.message;
  }
  if (!spec.iterations) return 'not needed, one payment';

  try {
    const stripe = stripeClient();
    if (!stripe) {
      console.error('schedule for ' + session.subscription + ' skipped: payments not configured');
      return 'NOT ATTACHED, payments not configured on the server. Fix in the Stripe dashboard: subscription ' + session.subscription;
    }
    const sub = await stripe.subscriptions.retrieve(session.subscription);
    if (sub.schedule) return 'already attached';
    const schedule = await stripe.subscriptionSchedules.create({ from_subscription: sub.id });
    await stripe.subscriptionSchedules.update(schedule.id, {
      end_behavior: spec.endBehavior,
      phases: [{
        items: schedule.phases[0].items.map((i) => ({ price: i.price, quantity: i.quantity })),
        start_date: schedule.phases[0].start_date,
        iterations: spec.iterations
      }]
    });
    return 'attached, ' + spec.iterations + ' payments then ' + spec.endBehavior;
  } catch (err) {
    console.error('schedule for ' + session.subscription + ' failed: ' + err.message);
    return 'FAILED, ' + err.message + '. Fix in the Stripe dashboard: subscription ' + session.subscription;
  }
}

function enrollmentHtml(record, scheduleNote, paid) {
  return '<h2>' + (paid ? 'New enrollment' : 'Enrollment recorded, payment NOT collected') + '</h2>' +
    recordTable(record) +
    (record.signature ? '<p>The parent\'s signature is attached.</p>' : '') +
    '<p><b>Installment schedule:</b> ' + escapeHtml(scheduleNote) + '</p>' +
    (paid
      ? '<h2>Welcome email to paste</h2>' +
        '<p>Fill the two [brackets], then send it from your own inbox so the YES reply lands there. Stripe already sent the receipt.</p>' +
        '<div style="border:1px solid #ccc;padding:16px">' + welcomeHtml(record) + '</div>'
      : '<p><b>No welcome email yet.</b> Stripe reports payment_status ' + escapeHtml(record.paymentStatus ?? 'unknown') +
        ', so the money has not arrived. Check the payment in the dashboard before you welcome them.</p>');
}

// The welcome email from docs/source-of-truth/parent-closing-checklist.md with the blanks
// filled from the record.
function welcomeHtml(r) {
  const firstName = r.name ? r.name.trim().split(/\s+/)[0] : 'there';
  const terms = absoluteUrl('/terms');
  const steps = [
    'Here is our recorded Zoom meeting where we went over the agreement: [Zoom recording link]',
    'Here is a copy of the terms you agreed to when you enrolled: <a href="' + terms + '">' + terms + '</a>'
  ];
  if (r.months) {
    let renewal = 'If you want to stop after this term, email ' + CONTACT.email + ' by ' + longDate(r.cancelNoticeBy) +
      ' (' + r.noticeDays + ' days before the end). Otherwise your membership continues.';
    renewal += r.pay === 'monthly'
      ? ' Your card is billed monthly and keeps going until you cancel in writing.'
      : ' Coach Blake will send you a renewal link before the term ends.';
    steps.push(renewal);
  }
  return '<p>Hi ' + escapeHtml(firstName) + ',</p>' +
    '<p>Thanks for completing the steps to enroll' + (r.playerName ? ' ' + escapeHtml(r.playerName) : '') + ' in our program.</p>' +
    '<p><strong>Please read this email and respond with "YES" so I know you have all of the details.</strong></p>' +
    '<ol>' + steps.map((s) => '<li>' + s + '</li>').join('') + '</ol>' +
    '<p>See you on [first session date] for our first session at [place]!</p>' +
    '<p>Again, please respond with "YES".</p>' +
    '<p>Coach Blake</p>';
}

function longDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

// Stripe expires a session 23 hours after the page opened it (SESSION_TTL in checkout.mjs). A
// registration still pending then is a family that filled in the form and never paid, which
// is a text Blake wants to send. One that is no longer pending was paid through a later
// session from the same tab and stays as it is.
async function onSessionExpired(event) {
  const id = event.data.object.metadata?.registrationId;
  if (!id) return { ignored: 'no registration' };
  const key = 'registration:' + id;
  const reg = await getLead(key);
  if (!reg || reg.paymentStatus !== 'pending') return { ignored: 'not pending' };
  // ponytail: a full scan of the store, fine at this size. A parent who came back in a fresh
  // tab registered again under a new id; if that one paid, this one is not a lost family.
  const twin = (await listLeads()).find((l) => l.key !== key && l.type === 'enrollment' && l.paymentStatus === 'paid' &&
    l.email === reg.email && l.playerName === reg.playerName);
  await addLead(key, { ...reg, paymentStatus: twin ? 'superseded' : 'abandoned' });
  if (twin) return { ok: true, superseded: true };
  await alert(
    'Registered, did not pay: ' + reg.playerName,
    '<h2>Registration without payment</h2>' +
    '<p>' + escapeHtml(reg.name) + ' registered ' + escapeHtml(reg.playerName) + ' for ' + escapeHtml(reg.planLabel) +
    ' and the checkout expired unpaid. Preferred contact: ' + escapeHtml(reg.contactMethod || '?') + ', ' +
    escapeHtml(reg.phone || '') + ', ' + escapeHtml(reg.email || '') + '.</p>' +
    '<p>The spot is not reserved. A text from you is usually what finishes it.</p>'
  );
  return { ok: true };
}

async function onPaymentFailed(event) {
  const inv = event.data.object;
  const email = inv.customer_email || '';
  const amount = dollars(inv.amount_due ?? 0);
  const next = inv.next_payment_attempt
    ? longDate(new Date(inv.next_payment_attempt * 1000).toISOString())
    : 'none scheduled';
  await alert(
    'Payment failed: ' + email + ' (' + amount + ')',
    '<h2>Membership payment failed</h2>' +
    '<p>Parent: ' + escapeHtml(email) + '<br>Amount due: ' + amount +
    '<br>Attempt: ' + (inv.attempt_count ?? '?') + '<br>Next automatic retry: ' + next +
    '<br>Customer: ' + escapeHtml(inv.customer || '') + '</p>' +
    '<p>The parent already has Stripe\'s own email with a link to update the card. Nothing to send unless the retries keep failing.</p>'
  );
  return { ok: true };
}

async function onSubscriptionDeleted(event) {
  const sub = event.data.object;
  const details = sub.cancellation_details || {};
  const reason = [details.reason, details.feedback, details.comment].filter(Boolean).join('; ') || 'not given';
  const meta = sub.metadata || {};
  await alert(
    'Subscription ended: ' + sub.customer,
    '<h2>Subscription ended</h2>' +
    '<p>Customer: ' + escapeHtml(sub.customer || '') + '<br>Subscription: ' + escapeHtml(sub.id) +
    '<br>Plan: ' + escapeHtml((meta.plan || '?') + ' / ' + (meta.pay || '?')) +
    '<br>Reason: ' + escapeHtml(reason) + '</p>'
  );
  return { ok: true };
}

async function alert(subject, html) {
  const sent = await sendEmail({ to: ownerEmail(), subject, html });
  if (!sent) console.error('owner alert not sent: ' + subject);
}
