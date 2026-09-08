// The source of truth for an enrollment. The thanks page is copy; this is where a paid
// Checkout Session becomes a record in the leads store and an email to Blake.
//
// Order inside checkout.session.completed matters: write the record, then talk to Stripe,
// then email. A schedule Blake can fix in the dashboard; an enrollment that never got
// recorded he cannot. Nothing after signature verification may throw out of the handler,
// because a non-2xx makes Stripe retry and that would mean a second owner email.

import Stripe from 'stripe';
import { addLead, getLead } from './lib/leads.mjs';
import { sendEmail, ownerEmail, escapeHtml } from './lib/notify.mjs';
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
      case 'invoice.payment_failed': return json(200, await onPaymentFailed(event));
      case 'customer.subscription.deleted': return json(200, await onSubscriptionDeleted(event));
      default: return json(200, { ignored: event.type });
    }
  } catch (err) {
    console.error('webhook ' + event.type + ' (' + event.id + ') failed: ' + err.message);
    return json(200, { warning: err.message });
  }
};

async function onCheckoutCompleted(event) {
  const session = event.data.object;
  const key = 'enrollment:' + session.id;
  if (await getLead(key)) return { duplicate: true };

  const timestamp = new Date(event.created * 1000).toISOString();
  const meta = session.metadata || {};
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

  const record = {
    type: 'enrollment',
    timestamp,
    sessionId: session.id,
    customerId: session.customer || null,
    subscriptionId: session.subscription || null,
    email: session.customer_details?.email || session.customer_email || null,
    phone: session.customer_details?.phone || null,
    name: customField(session, 'agree_name'),
    playerName: customField(session, 'player_name'),
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

  const sent = await sendEmail({
    to: ownerEmail(),
    subject: 'New enrollment: ' + planLabel + ' (' + (PAY_LABELS[pay] || pay) + ') - ' + (record.name || record.email),
    html: enrollmentHtml(record, scheduleNote)
  });
  if (!sent) console.error('owner email not sent for ' + key + '; the record is saved');
  return { ok: true };
}

function customField(session, key) {
  const field = (session.custom_fields || []).find((f) => f.key === key);
  return field?.text?.value || null;
}

// Checkout creates an open-ended subscription. Split and monthly plans have a fixed number
// of payments, so a schedule is wrapped around the subscription to stop it (split) or let
// it run on month to month (monthly) after that many. Returns one line for the owner
// email; never throws.
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

function enrollmentHtml(record, scheduleNote) {
  const rows = Object.entries(record)
    .map(([k, v]) => '<tr><th align="left">' + k + '</th><td>' + escapeHtml(v ?? '') + '</td></tr>')
    .join('');
  return '<h2>New enrollment</h2>' +
    '<table border="1" cellpadding="4" style="border-collapse:collapse">' + rows + '</table>' +
    '<p><b>Installment schedule:</b> ' + escapeHtml(scheduleNote) + '</p>' +
    '<h2>Welcome email to paste</h2>' +
    '<p>Fill the two [brackets], then send it from your own inbox so the YES reply lands there. Stripe already sent the receipt.</p>' +
    '<div style="border:1px solid #ccc;padding:16px">' + welcomeHtml(record) + '</div>';
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
