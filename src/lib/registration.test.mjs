// Run: node --test src/lib/registration.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIELDS, validateRegistration, sampleRegistration, SIGNATURE_MAX_CHARS } from './registration.mjs';

test('the sample registration is valid and every field comes back trimmed', () => {
  const r = validateRegistration({ ...sampleRegistration(), school: '  Westglades Middle  ' });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.values.school, 'Westglades Middle');
  assert.equal(r.values.goals, '', 'an optional field left out is an empty string, not undefined');
  assert.ok(r.values.signature.startsWith('data:image/png;base64,'));
});

test('every required field is reported, all at once', () => {
  const r = validateRegistration({});
  assert.equal(r.ok, false);
  const required = FIELDS.filter((f) => f.required).map((f) => f.key).concat(['reviewed', 'terms', 'signature']);
  assert.deepEqual(Object.keys(r.errors).sort(), required.sort());
});

test('shape checks: email, phone digits, past date, select membership, length', () => {
  const cases = [
    ['email', 'not-an-email'], ['phone', '555-0100'], ['dob', '2099-01-01'], ['dob', '2012-02-30'], ['dob', '04/09/2012'],
    ['gender', 'Other'], ['program', '__proto__'], ['school', 'x'.repeat(201)], ['goals', 'x'.repeat(2001)]
  ];
  for (const [key, value] of cases) {
    const r = validateRegistration({ ...sampleRegistration(), [key]: value });
    assert.deepEqual(Object.keys(r.errors), [key], key + '=' + String(value).slice(0, 20));
  }
});

test('the agreement boxes must be literally true and the signature a PNG data URL', () => {
  const cases = [
    { reviewed: 'yes' }, { terms: 1 }, { signature: '' },
    { signature: 'data:text/html;base64,PHNjcmlwdD4=' },
    { signature: 'data:image/png;base64,' + 'A'.repeat(SIGNATURE_MAX_CHARS) }
  ];
  for (const bad of cases) {
    const r = validateRegistration({ ...sampleRegistration(), ...bad });
    assert.deepEqual(Object.keys(r.errors), Object.keys(bad), JSON.stringify(bad).slice(0, 60));
  }
});

test('a non-object body is every required error, not a throw', () => {
  for (const body of [null, 'x', 42]) assert.equal(validateRegistration(body).ok, false);
});
