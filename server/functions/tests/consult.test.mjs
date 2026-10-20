// Run: node --test server/functions/tests/consult.test.mjs
//
// The October 2026 flow, end to end and offline: Blake saves a consultation on /enroll, a /pay
// link carrying its id becomes a payment row with the consultation's family and lead source
// (never the page's), and a family signs the agreement on /agreement.
process.env.FB_LOCAL = 'true';
delete process.env.STRIPE_SECRET_KEY;
delete process.env.RESEND_API_KEY;
delete process.env.PLAYBOOK_FROM_EMAIL;

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sampleConsultation, LEAD_SOURCES, leadAnswer, validateConsultation } from '../../../src/lib/registration.mjs';
import { HEAR_ABOUT_CHOICES } from '../../../src/lib/commission.mjs';
import { validateAgreement, agreementPlans, todayNY } from '../../../src/lib/agreement.mjs';

process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), 'fb-consult-')));
const { default: consult } = await import('../consult.mjs');
const { default: checkout } = await import('../checkout.mjs');
const { default: agreement } = await import('../agreement.mjs');

const CTX = { ip: '127.0.0.1' };
const post = (body) => new Request('http://localhost/api/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const rows = () => {
  const file = path.resolve('.local/leads.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
};

test('every lead source maps to a real Schedule 1 answer, and Google Search is the one that attributes', () => {
  for (const s of LEAD_SOURCES) assert.ok(HEAR_ABOUT_CHOICES.includes(s.hearAbout), s.label);
  assert.equal(leadAnswer('Google Search').hearAbout, 'Google or online search');
  assert.deepEqual(leadAnswer('Referral', 'the Smiths'), { hearAbout: 'Friend, family, or referral', hearAboutOther: 'Referred by the Smiths' });
  assert.deepEqual(leadAnswer('FAST Basketball Website'), { hearAbout: 'Other (please describe)', hearAboutOther: 'FAST Basketball Website' });
  assert.deepEqual(leadAnswer('Other', 'a flyer'), { hearAbout: 'Other (please describe)', hearAboutOther: 'a flyer' });
});

test('a consultation needs only the family\'s contact details and a lead source; Referral and Other need their detail', () => {
  assert.equal(validateConsultation(sampleConsultation()).ok, true);
  assert.deepEqual(Object.keys(validateConsultation({}).errors).sort(),
    ['athleteFirst', 'athleteLast', 'email', 'leadSource', 'parentFirst', 'parentLast', 'phone']);
  assert.ok(validateConsultation({ ...sampleConsultation(), leadSource: 'Referral' }).errors.leadDetail);
  assert.ok(validateConsultation({ ...sampleConsultation(), confidence: '11' }).errors.confidence);
  assert.ok(validateConsultation({ ...sampleConsultation(), age: 'thirteen' }).errors.age);
});

test('consultation saved, then paid against: the payment row takes the family and lead source from the consultation', async () => {
  const saved = await consult(post(sampleConsultation()), CTX);
  assert.equal(saved.status, 200);
  const { id } = await saved.json();
  const c = rows().find((r) => r.key === 'consult:' + id);
  assert.equal(c.type, 'consultation');
  assert.equal(c.hearAbout, 'Google or online search');
  assert.equal(c.leadSource, 'Google Search');

  // The page sends nothing about the family; a forged answer in the body is ignored.
  const res = await checkout(post({ plan: 'eval', pay: 'full', consult: id, terms: true, leadSource: 'Other', email: 'evil@example.test' }), CTX);
  assert.equal(res.status, 503, 'saved, then no Stripe key in this suite');
  const { registrationId } = await res.json();
  const pay = rows().find((r) => r.key === 'registration:' + registrationId);
  assert.equal(pay.type, 'enrollment');
  assert.equal(pay.consultationId, id);
  assert.equal(pay.email, 'parent@example.com');
  assert.equal(pay.playerName, 'Jordan Parent');
  assert.equal(pay.hearAbout, 'Google or online search', 'the commission evidence is the consultation\'s');
  assert.equal(pay.amountCents, 5000);
});

test('a payment still needs the terms box, and an unknown consultation is refused before anything is written', async () => {
  const saved = await (await consult(post(sampleConsultation()), CTX)).json();
  const before = rows().length;
  const noTerms = await checkout(post({ plan: 'eval', pay: 'full', consult: saved.id }), CTX);
  assert.equal(noTerms.status, 422);
  assert.ok((await noTerms.json()).errors.terms);
  const unknown = await checkout(post({ plan: 'eval', pay: 'full', consult: '11111111-2222-4333-8444-555555555555', terms: true }), CTX);
  assert.equal(unknown.status, 422);
  assert.ok((await unknown.json()).errors.consult);
  assert.equal(rows().length, before);
});

test('the agreement: today\'s date, a first and last name, a package it covers, and the box', () => {
  const now = new Date('2026-10-19T15:00:00Z');
  const ok = { plan: 'individual-6m', signature: 'Ben Parent', playerName: 'Jordan Parent', email: 'parent@example.com', signedDate: todayNY(now), agree: true };
  assert.equal(validateAgreement(ok, now).ok, true);
  assert.deepEqual(agreementPlans(), ['individual-1x', 'individual-6m']);
  for (const [bad, key] of [[{ plan: 'group-3m-1x' }, 'plan'], [{ signature: 'Ben' }, 'signature'], [{ signedDate: '2026-01-01' }, 'signedDate'], [{ agree: 'yes' }, 'agree']]) {
    assert.ok(validateAgreement({ ...ok, ...bad }, now).errors[key], key);
  }
});

test('a signed agreement is stored with its text and version, and points at that family\'s payment', async () => {
  const c = await (await consult(post(sampleConsultation()), CTX)).json();
  const res = await agreement(post({ plan: 'individual-1x', signature: 'Ben Parent', playerName: 'Jordan Parent', email: 'parent@example.com', signedDate: todayNY(), agree: true, consult: c.id }), CTX);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.payUrl, '/pay?plan=individual-1x&c=' + c.id);
  const row = rows().find((r) => r.key === 'agreement:' + body.id);
  assert.equal(row.type, 'agreement');
  assert.equal(row.signature, 'Ben Parent');
  assert.ok(row.agreementText.includes('14 days'));
  assert.ok(row.version);
  assert.equal(row.consultationId, c.id);
});
