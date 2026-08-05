// Run: node src/lib/suburb-copy.test.mjs
// Guards the 0 / 1 / many and missing-field shapes of the suburb prose so no
// record can ship unpunctuated or fused into the next one.
import assert from 'node:assert/strict';
import { schoolsProse, venuesProse } from './suburb-copy.mjs';

const ends = (s) => assert.ok(/[.!?]$/.test(s.trim()), 'must end in punctuation: ' + s);

// Every note must be closed by punctuation, which is what stops the next
// record's name from fusing onto the end of it.
function notesClosed(out, notes) {
  for (const note of notes) {
    const body = note.replace(/^./, (c) => c.toLowerCase());
    const i = out.indexOf(body) >= 0 ? out.indexOf(body) : out.indexOf(note);
    assert.ok(i >= 0, 'note missing: ' + note);
    const after = out.slice(i + body.length, i + body.length + 1);
    assert.ok(after === '' || /[.!?]/.test(after), 'note not closed off: ' + out);
  }
}

const clean = (s) => assert.ok(!/[,—] *\./.test(s) && !/ {2}/.test(s) && !/—\s*$/.test(s), 'dangling connector: ' + s);

// 0 records
assert.equal(schoolsProse({ name: 'Nowhere' }), '');
assert.equal(venuesProse({ name: 'Nowhere', training_venues: [] }), '');

// 1 high school + 1 middle school
const one = schoolsProse({
  name: 'Westchester',
  high_schools: [{ name: 'Coral Park', note: 'Zoned high school for Westchester, 8865 SW 16th St' }],
  middle_schools: [{ name: 'Rockway Middle School' }]
});
ends(one);
clean(one);
notesClosed(one, ['Zoned high school for Westchester, 8865 SW 16th St']);
// Colon, not an em dash: 5 dashes per suburb page tripped the em-dash-overuse detector.
assert.ok(one.includes('Coral Park: zoned high school'), one);
assert.ok(!one.includes('—'), 'no em dashes in generated suburb prose: ' + one);

// many high schools
const manyNotes = ['Zoned high school for much of central Kendall, 10655 SW 97th Ave', 'Serves the Hammocks and West Kendall area'];
const many = schoolsProse({
  name: 'Kendall',
  high_schools: [{ name: 'Killian', note: manyNotes[0] }, { name: 'Varela', note: manyNotes[1] }]
});
ends(many);
clean(many);
notesClosed(many, manyNotes);
assert.ok(many.includes('97th Ave. Varela:'), many);
 assert.ok(!many.includes('—'), 'no em dashes: ' + many);

// no high school at all (Margate): must degrade to middle-school-only copy, not
// open on a dangling "runs through" and not claim a high school that is not there.
const midsOnly = schoolsProse({
  name: 'Margate',
  high_schools: [],
  middle_schools: [{ name: 'Margate Middle School', note: 'Serves the area from 500 NW 65th Ave' }]
});
ends(midsOnly);
clean(midsOnly);
assert.ok(midsOnly.includes('The school game in Margate starts at Margate Middle School: serves the area'), midsOnly);
notesClosed(midsOnly, ['Serves the area from 500 NW 65th Ave']);
assert.ok(!/high school/i.test(midsOnly), 'must not mention a high school it does not have: ' + midsOnly);
// missing key entirely behaves the same as an empty array
ends(schoolsProse({ name: 'Margate', middle_schools: [{ name: 'Margate Middle School' }] }));
// neither list: still empty, never a bare fragment
assert.equal(schoolsProse({ name: 'Margate', high_schools: [], middle_schools: [] }), '');

// middle school notes must reach the page (verified feeder pattern), closed off
// and never fused into the next record
const feederNotes = ['Every one of its eighth graders goes on to Coral Springs High', 'Sends the whole eighth grade on to J.P. Taravella High'];
const feeders = schoolsProse({
  name: 'Coral Springs',
  high_schools: [{ name: 'Coral Springs High' }],
  middle_schools: [
    { name: 'Forest Glen Middle School', note: feederNotes[0] },
    { name: 'Ramblewood Middle School', note: feederNotes[1] },
    { name: 'Coral Springs Middle School' }
  ]
});
ends(feeders);
clean(feeders);
notesClosed(feeders, feederNotes);
// notes follow the list sentence, each closed, and a note-less school adds nothing
assert.ok(feeders.includes('Coral Springs Middle School. Forest Glen Middle School: every one'), feeders);
assert.ok(feeders.includes('Coral Springs High. Ramblewood Middle School: sends the whole'), feeders);
assert.ok(!feeders.includes('—'), 'no em dashes: ' + feeders);

// high school with no note at all
const noNote = schoolsProse({ name: 'X', high_schools: [{ name: 'A High' }, { name: 'B High' }] });
ends(noNote);
clean(noNote);

// proper-name note keeps its capital
assert.ok(schoolsProse({
  name: 'Coral Gables',
  high_schools: [{ name: 'Gables High', note: 'City of Coral Gables zoned high school, 450 Bird Rd' }]
}).includes(': City of Coral Gables'));

// missing note / address / type must not leave a dangling connector
for (const v of [
  { name: 'Bare Park' },
  { name: 'Bare Park', address: '1 Main St' },
  { name: 'Bare Park', type: 'public park', courts: 'both' },
  { name: 'Bare Park', note: 'Confirmed two outdoor courts' }
]) {
  const solo = venuesProse({ name: 'X', training_venues: [v] });
  const pair = venuesProse({ name: 'X', training_venues: [v, { name: 'Other Park', address: '2 Main St', note: 'Confirmed one court' }] });
  ends(solo);
  clean(solo);
  notesClosed(solo, [v.note].filter(Boolean));
  ends(pair);
  clean(pair);
  notesClosed(pair, [v.note, 'Confirmed one court'].filter(Boolean));
}

// "both" must not render as "with both courts"
assert.ok(venuesProse({ name: 'X', training_venues: [{ name: 'P', type: 'rec center', courts: 'both' }] })
  .includes('a rec center with indoor and outdoor courts'));

console.log('suburb-copy: ok');
