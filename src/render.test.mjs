// Run: node --test src/render.test.mjs
//
// Guards the substitution engine (replace-all, the new attribute hook, and both escaping
// contexts) and the single-source derivations (footer, contact area select, FAQ JSON-LD,
// motion emission) that read content.json with the site's current hardcoded strings as
// fallbacks. Fixtures are hand-written strings, never the real template files — those are
// owned by another slice of this build and are not safe to import here.

import assert from 'node:assert/strict';
import {
  applyTextEdits, applyAttrEdits, escapeHtml, escapeAttr,
  buildHead, buildFooter, fixContactAreaSelect, deriveFaqPairs
} from './render.mjs';
import { AREA_SERVED } from './lib/site-config.mjs';

// ---------------------------------------------------------------- applyTextEdits: replace-all

// The ticker repeats its items twice in the DOM for the marquee loop — both copies of the
// same key must move together, not just the first one encountered.
{
  const fixture = '<div class="tick-a"><span data-edit="tick.1">Old A</span></div>' +
    '<div class="tick-b"><span data-edit="tick.1">Old A</span></div>';
  const out = applyTextEdits(fixture, { 'tick.1': 'New B' });
  const matches = out.match(/New B/g) || [];
  assert.equal(matches.length, 2, 'both occurrences of the repeated key must be substituted: ' + out);
  assert.ok(!out.includes('Old A'), 'no original text should survive: ' + out);
}

// ---------------------------------------------------------------- applyTextEdits: leaf splice unchanged

// A well-formed leaf hook (no child tags) splices cleanly between the tag's own '>' and '</'.
{
  const fixture = '<p class="lede" data-edit="ct.lede">original copy</p>';
  const out = applyTextEdits(fixture, { 'ct.lede': 'new copy' });
  assert.equal(out, '<p class="lede" data-edit="ct.lede">new copy</p>');
}

// Nested markup guard: the splice is documented as "between tag-open > and next </" with
// no knowledge of nesting. Feeding it a hooked element that (against convention) wraps a
// child tag must keep producing exactly that same naive splice — proving item 1 only added
// replace-all and did not change the underlying splice semantics.
{
  const fixture = '<p data-edit="x"><b>old</b> tail</p>';
  const out = applyTextEdits(fixture, { x: 'REPLACED' });
  // tagOpenEnd lands on <p ...>'s '>'; closeStart lands on the nested </b>, not </p> —
  // exactly the malformed-if-nested behaviour the leaf-only convention exists to avoid.
  assert.equal(out, '<p data-edit="x">REPLACED</b> tail</p>');
}

// ---------------------------------------------------------------- applyAttrEdits

{
  const fixture = '<input type="tel" placeholder="Old placeholder" data-edit-attr="placeholder:ct.phoneholder">';
  const replaced = applyAttrEdits(fixture, { 'ct.phoneholder': 'Say "hi" & <bye>' });
  assert.ok(replaced.includes('placeholder="Say &quot;hi&quot; &amp; &lt;bye&gt;"'), 'attr value must be escaped: ' + replaced);
  assert.ok(!replaced.includes('Old placeholder'), 'original placeholder must be gone: ' + replaced);

  // Missing key: an attr-hook whose key was never edited keeps its template default.
  const untouched = applyAttrEdits(fixture, {});
  assert.equal(untouched, fixture, 'a key absent from the map must leave the attribute untouched');

  // Order-independent: attrname="..." may sit before or after data-edit-attr in the tag.
  const reordered = '<input type="tel" data-edit-attr="placeholder:ct.phoneholder" placeholder="Old placeholder">';
  const replacedReordered = applyAttrEdits(reordered, { 'ct.phoneholder': 'New' });
  assert.ok(replacedReordered.includes('placeholder="New"'), 'attr search must not depend on attribute order: ' + replacedReordered);
}

// ---------------------------------------------------------------- escape round-trip

{
  const dangerous = 'A & B < C > D "quoted" <script>alert(1)</script>';

  // Text context: escapeHtml covers & < > (quotes are safe unescaped inside a text node).
  const textOut = applyTextEdits('<p data-edit="k">orig</p>', { k: dangerous });
  assert.ok(textOut.includes('A &amp; B &lt; C &gt; D "quoted" &lt;script&gt;alert(1)&lt;/script&gt;'), 'text context must escape & < >: ' + textOut);
  assert.ok(!textOut.includes('<script>alert(1)</script>'), 'the script tag must not survive intact in text context: ' + textOut);

  // Attribute context: same escaping plus " so the value cannot close the attribute early.
  const attrOut = applyAttrEdits('<input placeholder="x" data-edit-attr="placeholder:k">', { k: dangerous });
  assert.ok(attrOut.includes('placeholder="A &amp; B &lt; C &gt; D &quot;quoted&quot; &lt;script&gt;alert(1)&lt;/script&gt;"'), 'attr context must also escape ": ' + attrOut);
  assert.ok(!attrOut.includes('<script>alert(1)</script>'), 'the script tag must not survive intact in attribute context: ' + attrOut);

  assert.equal(escapeAttr('"'), '&quot;');
}

// ---------------------------------------------------------------- motion emission

{
  const content = { text: {} };
  const head = buildHead({ title: 'T', description: 'D', canonicalPath: '/', includeHeroPreload: false, content, jsonLd: [] });

  assert.ok(head.includes('<html lang="en">'), 'default motion must not add any data-* attribute to <html>: ' + head.slice(0, 200));
  assert.ok(!/data-motion|data-intro|data-ticker|data-reveals|data-night/.test(head), 'no motion attribute at defaults: ' + head.slice(0, 200));
  assert.ok(head.includes('<style id="fb-motion">:root{--motion-speed:1;--t-ticker:38s}</style>'), 'default CSS vars missing: ' + head);
  assert.ok(head.includes('window.__FB_MOTION='), 'motion script tag missing');
  assert.ok(head.indexOf('window.__FB_MOTION=') < head.indexOf('</head>'), 'motion script must ship in <head>, before main.js (loaded in <body>)');
}

{
  const head = buildHead({ title: 'T', description: 'D', canonicalPath: '/', includeHeroPreload: false, content: { text: {}, motion: { enabled: false } }, jsonLd: [] });
  assert.ok(head.includes('<html lang="en" data-motion="off">'), 'enabled:false must emit data-motion="off": ' + head.slice(0, 200));
}

{
  const head = buildHead({ title: 'T', description: 'D', canonicalPath: '/', includeHeroPreload: false, content: { text: {}, motion: { speed: 2 } }, jsonLd: [] });
  assert.ok(head.includes('--motion-speed:2'), 'speed 2 must reach the CSS var: ' + head);
  assert.ok(!head.includes('data-motion="off"'), 'speed alone must not disable motion');
}

// ---------------------------------------------------------------- footer / area / FAQ fallbacks
//
// With empty content.text every derivation must fall back to the site's current hardcoded
// strings, copied here (not imported) so a change to render.mjs's own fallback constant
// cannot silently drag its test down with it.

{
  const footer = buildFooter({ content: { text: {} } });
  // The h3s carry data-edit hooks (the footer is a pseudo-section in the editor, and a
  // field with no clickable node on the canvas would be unreachable) — assert on the
  // rendered text, not the exact tag.
  assert.ok(/<h3[^>]*>Training<\/h3>/.test(footer), 'Training header fallback: ' + footer);
  assert.ok(/<h3[^>]*>Areas<\/h3>/.test(footer), 'Areas header fallback: ' + footer);
  assert.ok(/<h3[^>]*>More<\/h3>/.test(footer), 'More header fallback: ' + footer);
  assert.ok(footer.includes('Private basketball training in north Broward. Built by a college coach for players chasing the next level.'), 'tagline fallback: ' + footer);
  assert.ok(footer.includes('Fast Basketball. Elevate to Execute.'), 'bottom line fallback: ' + footer);
  // The Areas column has only ever shown the first 4 of AREA_SERVED's 5 cities.
  for (const name of AREA_SERVED.slice(0, 4)) {
    assert.ok(footer.includes('<a href="/basketball-training/' + name.toLowerCase().replace(/\s+/g, '-') + '">' + name + '</a>'), 'area link fallback missing for ' + name);
  }
  assert.ok(!footer.includes('Tamarac'), 'the footer must still cap at 4 areas, not all 5: ' + footer);

  // Override still reads through: a seeded area.2.name replaces just that slot.
  const overridden = buildFooter({ content: { text: { 'area.2.name': 'Renamed City' } } });
  assert.ok(overridden.includes('Renamed City'), 'area.2.name override must reach the footer: ' + overridden);
  assert.ok(!overridden.includes('>Parkland<'), 'the overridden slot must not also show its old name: ' + overridden);
}

{
  const selectFixture = '<select id="cArea" name="area">\n<option>Coral Springs</option><option>Parkland</option>\n<option>Other</option>\n</select>';
  const out = fixContactAreaSelect(selectFixture, { text: {} });
  const expected = '<select id="cArea" name="area">' +
    AREA_SERVED.map((n) => '<option>' + n + '</option>').join('') +
    '<option>Other</option></select>';
  assert.equal(out, expected, 'contact area select fallback must list all 5 AREA_SERVED cities plus Other: ' + out);
}

{
  const FAQ_FALLBACK = [
    { question: 'What ages do you train?', answer: 'Players from roughly 11 through 18, from first year middle school through senior year. Younger players get more habit building, older players get more decision work and recruiting support.' },
    { question: 'Where do sessions actually happen?', answer: 'City parks and partner courts across north Broward County. When you book, you get the exact location for your area. If you have access to a court through a school or community center, we can often train there.' },
    { question: 'How fast will we see a difference?', answer: 'Form changes show up in two to three weeks. Game changes usually take six to eight, because a skill has to survive speed, contact, and fatigue before it shows up on a Friday night.' },
    { question: 'Do you help with college recruiting?', answer: 'Yes, inside the College Track Program. Coach Blake spent the last two seasons on college staffs at the NJCAA and NCAA Division I levels, so he has evaluated high school film from the recruiting side.' },
    { question: 'Is the First Look session really free?', answer: 'Yes. It is a full evaluation. You leave with a written summary of strengths and gaps whether or not you book anything after.' },
    { question: 'Do you train girls teams and players?', answer: 'Yes. Every program listed is open to any player. Skill work does not change by gender.' }
  ];
  assert.deepEqual(deriveFaqPairs({ text: {} }), FAQ_FALLBACK, 'FAQ fallback must match the site\'s current hardcoded pairs');

  // Per-pair override: editing only faq.2.q must not blank out faq.2's answer or any other pair.
  const overridden = deriveFaqPairs({ text: { 'faq.2.q': 'New question?' } });
  assert.equal(overridden[1].question, 'New question?');
  assert.equal(overridden[1].answer, FAQ_FALLBACK[1].answer, 'an untouched faq.N.a must keep its fallback');
  assert.deepEqual(overridden[0], FAQ_FALLBACK[0], 'other pairs must be untouched by one override');
}

console.log('render: ok');
