// Run: node --test src/lib/registration.test.mjs
// The /pay form's short questions (when a link carries no consultation). The consultation and
// the lead-source mapping are tested in server/functions/tests/consult.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PAYER_FIELDS, validateRegistration, sampleRegistration, payerFromConsult } from './registration.mjs';

test('the sample payment is valid, trimmed, and carries its Schedule 1 answer', () => {
  const r = validateRegistration({ ...sampleRegistration(), athleteFirst: '  Jordan  ' });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.values.athleteFirst, 'Jordan');
  assert.equal(r.values.hearAbout, 'Friend, family, or referral');
  assert.equal(r.values.hearAboutOther, 'Referred by the Smiths');
});

test('every required field is reported, all at once', () => {
  const r = validateRegistration({});
  assert.equal(r.ok, false);
  const required = PAYER_FIELDS.filter((f) => f.required).map((f) => f.key).concat(['terms']);
  assert.deepEqual(Object.keys(r.errors).sort(), required.sort());
});

test('shape checks: email, phone digits, lead source membership, length', () => {
  for (const [key, value] of [['email', 'not-an-email'], ['phone', '555-0100'], ['leadSource', '__proto__'], ['athleteFirst', 'x'.repeat(201)]]) {
    const r = validateRegistration({ ...sampleRegistration(), [key]: value });
    assert.deepEqual(Object.keys(r.errors), [key], key);
  }
});

test('the terms box must be literally true', () => {
  for (const bad of ['yes', 1, undefined, 'true']) {
    assert.deepEqual(Object.keys(validateRegistration({ ...sampleRegistration(), terms: bad }).errors), ['terms']);
  }
});

test('with a consultation, the family comes from it and the body cannot override it', () => {
  const consult = { consultationId: 'c-1', parentFirst: 'Ben', parentLast: 'Parent', email: 'parent@example.com', phone: '9545550100',
    athleteFirst: 'Jordan', athleteLast: 'Parent', leadSource: 'Google Search', hearAbout: 'Google or online search', hearAboutOther: '' };
  const r = validateRegistration({ terms: true, email: 'evil@example.test', hearAbout: 'Other (please describe)' }, { consult });
  assert.equal(r.ok, true);
  assert.deepEqual(r.values, payerFromConsult(consult));
  assert.equal(r.values.email, 'parent@example.com');
  assert.equal(r.values.hearAbout, 'Google or online search');
  assert.equal(r.values.consultationId, 'c-1');
});

test('a non-object body is every required error, not a throw', () => {
  for (const body of [null, 'x', 42]) assert.equal(validateRegistration(body).ok, false);
});
