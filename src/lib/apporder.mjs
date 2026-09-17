// The /appbuy order form: who is buying, what it is for, and the two boxes they tick.
//
// The same shape as src/lib/registration.mjs and for the same reason: build.mjs renders the
// form from this list, checkout.mjs validates a submission against it, and there is one place
// to add a question. It is a SEPARATE list because the two forms ask different things for
// different reasons. Registration is an athlete joining a training program, so it asks for a
// date of birth, a school and a health insurance policy number, because a coach needs those if
// a player goes down on the court. Nothing about selling a $20 phone tool justifies holding any
// of that, and asking for it anyway would be collecting a child's medical identifiers to sell
// software. So this list is deliberately short.
//
// Two more things this form does NOT ask, on purpose:
//
//   - "How did you hear about us?" The intake question sets the commission rate on a training
//     family (Schedule 1 of the agreement, see commission.mjs) and /privacy says so in as many
//     words. These products pay a flat 50/50 whatever the answer, so asking it here would put a
//     question on the page whose stated purpose would be untrue of it.
//   - The ?camp= campaign tag. Same reason: nothing about a campaign can change what this
//     purchase pays, so there is nothing for an approved slug to do.

import { validateFields } from './registration.mjs';

export const SECTIONS = [
  { id: 'buyer', title: 'About you' },
  { id: 'use', title: 'Who it is for' }
];

// Every typed field carries a placeholder, the same as the registration form: grey example
// text the buyer types over, so no box is a blank the page has to explain.
export const FIELDS = [
  { key: 'firstName', section: 'buyer', label: 'First name', type: 'text', required: true, row: 'name', autocomplete: 'given-name', placeholder: 'Your first name' },
  { key: 'lastName', section: 'buyer', label: 'Last name', type: 'text', required: true, row: 'name', autocomplete: 'family-name', placeholder: 'Your last name' },
  { key: 'email', section: 'buyer', label: 'Email', type: 'email', required: true, autocomplete: 'email', placeholder: 'you@email.com' },
  { key: 'phone', section: 'buyer', label: 'Cell phone', type: 'tel', autocomplete: 'tel', placeholder: '(954) 555 0100' },
  { key: 'homeCity', section: 'buyer', label: 'Home city or ZIP code', type: 'text', placeholder: 'Coral Springs, or 33071' },

  { key: 'role', section: 'use', label: 'You are', type: 'select', required: true, options: [
    'A parent or guardian', 'The athlete', 'A coach', 'Someone else'
  ] },
  { key: 'athleteName', section: 'use', label: 'Athlete name', type: 'text', placeholder: 'Who will be using it' },
  { key: 'notes', section: 'use', label: 'Questions or comments', type: 'textarea', placeholder: 'Anything you want Coach Blake to know' }
];

/**
 * Every problem at once, keyed by field, plus the two boxes.
 *
 * `terms` and `norefund` are checked for literal `true` exactly the way the registration form
 * checks its own two: a string, a 1 or a present-but-empty value is not agreement. `norefund`
 * is its own box rather than a clause folded into the terms box because a payment plan that
 * cannot be cancelled or refunded is the one surprising thing about this purchase, and a buyer
 * should have to say they read that sentence on its own.
 */
export function validateAppOrder(body) {
  const { errors, values } = validateFields(FIELDS, body);
  const src = body && typeof body === 'object' ? body : {};
  if (src.terms !== true) errors.terms = 'Agreement to the terms is required';
  if (src.norefund !== true) errors.norefund = 'The no-refund acknowledgement is required';
  return { ok: Object.keys(errors).length === 0, errors, values };
}

/** A complete, valid order for tests and fixtures. Everything optional left blank. */
export function sampleAppOrder() {
  return {
    firstName: 'Dana', lastName: 'Buyer', email: 'buyer@example.com',
    role: 'A parent or guardian', terms: true, norefund: true
  };
}
